/**
 * Unit tests cho companyMember.service — tập trung vào các case critical:
 *   - Case 3: accept + auto-cancel atomic transaction (chống partial state).
 *   - Case 6/7: chặn xoá/rời owner cuối cùng.
 *   - Case 11: race condition handling — UPDATE với WHERE status='pending' check.
 *
 * Lưu ý: các test này cần DB thật (PostgreSQL). Chạy với `npm run db:migrate`
 * trước khi test, hoặc dùng testcontainers / docker compose để có DB riêng.
 *
 * Setup DB test:
 *   - Option A: dùng DB dev hiện có (cần reset trước/sau).
 *   - Option B: docker compose run --rm postgres-test.
 *
 * Test này chạy với Jest — dùng supertest nếu muốn test HTTP layer.
 * Ở đây test trực tiếp service function (đơn giản, không cần mock).
 */
import { db } from '../src/config/database';
import {
  companyMembers,
  companies,
  users,
  userProfiles,
} from '../src/db/schema';
import { companyMemberService } from '../src/service/companyMember.service';
import { CompanyMemberErrorCode } from '../src/interface/companyMember';
import { AppError } from '../src/middleware/errorHandler';
import { and, eq } from 'drizzle-orm';

/**
 * Helper: tạo user mới + return id. Cleanup sau test.
 */
const makeUser = async (email: string): Promise<string> => {
  const [u] = await db
    .insert(users)
    .values({ email, role: 'employer', status: 'active' })
    .returning();
  if (!u) throw new Error('Failed to create user');
  // user_profiles — không bắt buộc nhưng thêm để tránh FK issue nếu test khác cần
  await db.insert(userProfiles).values({ userId: u.id }).onConflictDoNothing();
  return u.id;
};

const makeCompany = async (name: string, ownerId: string): Promise<string> => {
  const [c] = await db
    .insert(companies)
    .values({ name, slug: `test-${Date.now()}-${Math.random()}`, createdBy: ownerId })
    .returning();
  if (!c) throw new Error('Failed to create company');
  return c.id;
};

/** Cleanup user/company sau test. */
const cleanupCompany = async (companyId: string) => {
  await db.delete(companyMembers).where(eq(companyMembers.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
};

const cleanupUser = async (userId: string) => {
  await db.delete(companyMembers).where(eq(companyMembers.userId, userId));
  await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
};

/* ============================================================================
 * Test suites
 * ==========================================================================*/

describe('companyMemberService.invite', () => {
  let ownerId: string;
  let targetId: string;
  let companyId: string;

  beforeEach(async () => {
    ownerId = await makeUser(`owner-${Date.now()}-${Math.random()}@test.com`);
    targetId = await makeUser(`target-${Date.now()}-${Math.random()}@test.com`);
    companyId = await makeCompany(`Test Co ${Date.now()}`, ownerId);
    // Insert owner active
    await db.insert(companyMembers).values({
      companyId,
      userId: ownerId,
      role: 'owner',
      status: 'active',
    });
  });

  afterEach(async () => {
    await cleanupCompany(companyId);
    await cleanupUser(ownerId);
    await cleanupUser(targetId);
  });

  it('case 1 — invite user lần đầu tạo row pending mới', async () => {
    const targetEmail = 'unknown';
    // Lấy email thật từ user vừa tạo
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetId));
    expect(targetUser).toBeDefined();

    const result = await companyMemberService.invite(
      companyId,
      targetUser!.email,
      ownerId,
    );
    expect(result.status).toBe('pending');
    expect(result.userId).toBe(targetId);
    expect(result.role).toBe('member');
    expect(result.invitedBy).toBe(ownerId);
  });

  it('case 9 — chặn invite user đã pending', async () => {
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetId));
    // Tạo pending invite trước
    await companyMemberService.invite(companyId, targetUser!.email, ownerId);

    // Invite lần 2 → throw ALREADY_PENDING
    await expect(
      companyMemberService.invite(companyId, targetUser!.email, ownerId),
    ).rejects.toMatchObject({
      code: CompanyMemberErrorCode.ALREADY_PENDING,
      statusCode: 409,
    });
  });

  it('case 10 — chặn invite user đã active', async () => {
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetId));
    // Insert active row trước
    await db.insert(companyMembers).values({
      companyId,
      userId: targetId,
      role: 'member',
      status: 'active',
    });

    await expect(
      companyMemberService.invite(companyId, targetUser!.email, ownerId),
    ).rejects.toMatchObject({
      code: CompanyMemberErrorCode.ALREADY_ACTIVE,
      statusCode: 409,
    });
  });

  it('self-invite — chặn owner tự mời mình', async () => {
    const [ownerUser] = await db.select().from(users).where(eq(users.id, ownerId));

    await expect(
      companyMemberService.invite(companyId, ownerUser!.email, ownerId),
    ).rejects.toMatchObject({
      code: CompanyMemberErrorCode.CANNOT_INVITE_SELF,
      statusCode: 400,
    });
  });

  it('case 8 — re-invite từ declined (reset row về pending, clear ended_at)', async () => {
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetId));
    // Tạo pending invite → decline → re-invite
    await companyMemberService.invite(companyId, targetUser!.email, ownerId);
    await companyMemberService.decline(companyId, targetId);

    const [declined] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, targetId)));
    expect(declined?.status).toBe('declined');
    expect(declined?.respondedAt).toBeDefined();
    expect(declined?.endedAt).toBeNull();

    // Re-invite → reset
    const result = await companyMemberService.invite(companyId, targetUser!.email, ownerId);
    expect(result.status).toBe('pending');
    expect(result.respondedAt).toBeNull();
    expect(result.endedAt).toBeNull();
    expect(result.invitedAt).toBeDefined();
    // invitedAt phải mới hơn (hoặc bằng) respondedAt cũ
    expect(result.invitedAt!.getTime()).toBeGreaterThanOrEqual(declined!.respondedAt!.getTime());
  });

  it('invite email chưa đăng ký → USER_NOT_FOUND 404', async () => {
    await expect(
      companyMemberService.invite(companyId, 'nonexistent@nowhere.com', ownerId),
    ).rejects.toMatchObject({
      code: CompanyMemberErrorCode.USER_NOT_FOUND,
      statusCode: 404,
    });
  });
});

describe('companyMemberService.accept', () => {
  let ownerAId: string;
  let ownerBId: string;
  let userId: string;
  let companyAId: string;
  let companyBId: string;

  beforeEach(async () => {
    ownerAId = await makeUser(`owner-a-${Date.now()}@test.com`);
    ownerBId = await makeUser(`owner-b-${Date.now()}@test.com`);
    userId = await makeUser(`user-${Date.now()}@test.com`);
    companyAId = await makeCompany(`Co A ${Date.now()}`, ownerAId);
    companyBId = await makeCompany(`Co B ${Date.now()}`, ownerBId);
    // owner A active, owner B active
    await db.insert(companyMembers).values([
      { companyId: companyAId, userId: ownerAId, role: 'owner', status: 'active' },
      { companyId: companyBId, userId: ownerBId, role: 'owner', status: 'active' },
    ]);
  });

  afterEach(async () => {
    await cleanupCompany(companyAId);
    await cleanupCompany(companyBId);
    await cleanupUser(ownerAId);
    await cleanupUser(ownerBId);
    await cleanupUser(userId);
  });

  it('case 3 — accept invite (chưa active ở đâu)', async () => {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    // Mời từ company A
    await companyMemberService.invite(companyAId, user!.email, ownerAId);
    // Mời từ company B
    await companyMemberService.invite(companyBId, user!.email, ownerBId);

    // Accept invite A
    const { membership, autoCancelledCount } = await companyMemberService.accept(companyAId, userId);
    expect(membership.status).toBe('active');

    // Check invite B đã bị auto_cancelled
    const [bRow] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyBId), eq(companyMembers.userId, userId)));
    expect(bRow?.status).toBe('auto_cancelled');

    // autoCancelledCount = 1 (chỉ có invite từ B)
    expect(autoCancelledCount).toBe(1);
  });

  it('case 4 — accept invite khi đang active ở company khác → ALREADY_ACTIVE_ELSEWHERE', async () => {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    // Insert user đã active ở company B
    await db.insert(companyMembers).values({
      companyId: companyBId,
      userId,
      role: 'member',
      status: 'active',
    });
    // Mời từ company A
    await companyMemberService.invite(companyAId, user!.email, ownerAId);

    // Accept → throw ALREADY_ACTIVE_ELSEWHERE
    try {
      await companyMemberService.accept(companyAId, userId);
      fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(409);
      expect(appErr.code).toBe(CompanyMemberErrorCode.ALREADY_ACTIVE_ELSEWHERE);
      // Phải kèm thông tin activeCompany
      expect((appErr as AppError & { details?: { activeCompany?: { id: string; name: string } } }).details?.activeCompany?.id).toBe(companyBId);
    }

    // Check invite A vẫn còn pending (rollback)
    const [aRow] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyAId), eq(companyMembers.userId, userId)));
    expect(aRow?.status).toBe('pending');
  });

  it('case 11 — race: 2 lần accept cùng 1 invite chỉ 1 thắng', async () => {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    await companyMemberService.invite(companyAId, user!.email, ownerAId);

    // 2 request accept cùng lúc
    const results = await Promise.allSettled([
      companyMemberService.accept(companyAId, userId),
      companyMemberService.accept(companyAId, userId),
    ]);

    // 1 success, 1 fail với INVITATION_NOT_PENDING
    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
      code: CompanyMemberErrorCode.INVITATION_NOT_PENDING,
    });
  });
});

describe('companyMemberService.remove + leave', () => {
  let ownerId: string;
  let memberId: string;
  let companyId: string;

  beforeEach(async () => {
    ownerId = await makeUser(`owner-${Date.now()}@test.com`);
    memberId = await makeUser(`member-${Date.now()}@test.com`);
    companyId = await makeCompany(`Test Co ${Date.now()}`, ownerId);
    await db.insert(companyMembers).values([
      { companyId, userId: ownerId, role: 'owner', status: 'active' },
      { companyId, userId: memberId, role: 'member', status: 'active' },
    ]);
  });

  afterEach(async () => {
    await cleanupCompany(companyId);
    await cleanupUser(ownerId);
    await cleanupUser(memberId);
  });

  it('case 5 — owner xoá member (soft delete)', async () => {
    const result = await companyMemberService.remove(companyId, memberId, ownerId);
    expect(result.status).toBe('removed');
    expect(result.endedAt).toBeDefined();

    // Row vẫn còn trong DB (không DELETE)
    const [row] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, memberId)));
    expect(row).toBeDefined();
    expect(row!.status).toBe('removed');
  });

  it('case 6 — owner xoá owner cuối cùng → CANNOT_REMOVE_OWNER', async () => {
    // Xoá member trước (không phải owner) — phải OK
    await companyMemberService.remove(companyId, memberId, ownerId);
    // Giờ chỉ còn owner. Thử xoá owner → phải throw
    await expect(
      companyMemberService.remove(companyId, ownerId, ownerId),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: CompanyMemberErrorCode.CANNOT_REMOVE_OWNER,
    });
  });

  it('owner có thể xoá owner khác nếu còn ≥1 owner khác active', async () => {
    // Tạo thêm 1 owner thứ 2
    const secondOwnerId = await makeUser(`owner2-${Date.now()}@test.com`);
    await db.insert(companyMembers).values({
      companyId,
      userId: secondOwnerId,
      role: 'owner',
      status: 'active',
    });

    // owner đầu xoá owner thứ 2 → OK
    const result = await companyMemberService.remove(companyId, secondOwnerId, ownerId);
    expect(result.status).toBe('removed');

    await cleanupUser(secondOwnerId);
  });

  it('case 7 — member tự rời công ty', async () => {
    const result = await companyMemberService.leave(companyId, memberId);
    expect(result.status).toBe('left');
    expect(result.endedAt).toBeDefined();
  });

  it('owner cuối cùng KHÔNG thể tự rời → CANNOT_LEAVE_AS_LAST_OWNER', async () => {
    // Xoá member trước
    await companyMemberService.remove(companyId, memberId, ownerId);
    // Giờ chỉ còn owner. Thử leave → phải throw
    await expect(
      companyMemberService.leave(companyId, ownerId),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: CompanyMemberErrorCode.CANNOT_LEAVE_AS_LAST_OWNER,
    });
  });
});

describe('companyMemberService.decline', () => {
  let ownerId: string;
  let targetId: string;
  let companyId: string;

  beforeEach(async () => {
    ownerId = await makeUser(`owner-${Date.now()}@test.com`);
    targetId = await makeUser(`target-${Date.now()}@test.com`);
    companyId = await makeCompany(`Test Co ${Date.now()}`, ownerId);
    await db.insert(companyMembers).values({
      companyId, userId: ownerId, role: 'owner', status: 'active',
    });
  });

  afterEach(async () => {
    await cleanupCompany(companyId);
    await cleanupUser(ownerId);
    await cleanupUser(targetId);
  });

  it('case 2 — decline invite thành công', async () => {
    const [u] = await db.select().from(users).where(eq(users.id, targetId));
    await companyMemberService.invite(companyId, u!.email, ownerId);
    const result = await companyMemberService.decline(companyId, targetId);
    expect(result.status).toBe('declined');
    expect(result.respondedAt).toBeDefined();
  });

  it('case 11 — race: decline 2 lần, 1 thắng 1 thua INVITATION_NOT_PENDING', async () => {
    const [u] = await db.select().from(users).where(eq(users.id, targetId));
    await companyMemberService.invite(companyId, u!.email, ownerId);

    const results = await Promise.allSettled([
      companyMemberService.decline(companyId, targetId),
      companyMemberService.decline(companyId, targetId),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });
});
