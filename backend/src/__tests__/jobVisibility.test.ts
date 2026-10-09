/**
 * Integration test — Job visibility (TASK 1: C-01 + C-02 + m-02).
 *
 * Chạy trên DATABASE_URL của .env (DB dev đang chạy). Test CHỈ SELECT;
 * duy nhất case xem job hợp lệ sẽ +1 views_count — cùng hiệu ứng 1 GET thật
 * từ production (bản thân endpoint detail là UPDATE views_count+1).
 * Không create/delete fixture: test tự tìm fixture có sẵn, thiếu fixture thì
 * skip (không fail) để không phụ thuộc cứng dữ liệu dev.
 *
 * Matrix quyền xem chi tiết (theo yêu cầu):
 *   | Role      | Danh sách /jobs            | Chi tiết                          |
 *   | candidate | chỉ live                   | live; expired(+isExpired); còn lại 404 |
 *   | employer  | live + mọi status công ty mình | như candidate + mọi status công ty mình |
 *   | admin     | mọi status                 | mọi status                        |
 * Job không đủ quyền xem → 404 (không 403) để không lộ sự tồn tại.
 */
import crypto from 'crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { eq, and, ne } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../config/database';
import { env } from '../config/env';
import { jobs, users, companyMembers } from '../db/schema';

// @octokit/rest là ESM-only — jest CJS không load được. OAuth Github không nằm
// trong phạm vi test này → mock stub, chỉ để import chain của app.parse được.
jest.mock('@octokit/rest', () => ({ Octokit: class {} }));

const app = createApp();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Role = 'candidate' | 'employer' | 'admin';

const signToken = (userId: string, role: Role): string =>
  jwt.sign({ userId, role, email: `${role}@visibility-test.local` }, env.JWT_ACCESS_SECRET, {
    expiresIn: '15m',
  });

/** Tìm 1 job theo status (fixture dev). Trả null nếu không có. */
const findJobByStatus = async (
  status: 'draft' | 'live' | 'expired' | 'closed',
): Promise<{ id: string; slug: string | null; companyId: string; postedBy: string } | null> => {
  const [row] = await db
    .select({ id: jobs.id, slug: jobs.slug, companyId: jobs.companyId, postedBy: jobs.postedBy })
    .from(jobs)
    .where(eq(jobs.status, status))
    .limit(1);
  return row ?? null;
};

/** Tìm 1 user theo role (fixture dev). Trả null nếu không có. */
const findUserByRole = async (role: Role): Promise<{ id: string } | null> => {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.role, role)).limit(1);
  return row ?? null;
};

/**
 * Tìm employer CÓ membership active ở company có job theo status — đảm bảo
 * loadCompanyIds() trả về companyId đúng để test quyền "công ty mình".
 */
const findEmployerWithJobInStatus = async (
  status: 'draft' | 'live' | 'expired' | 'closed',
): Promise<{ userId: string; companyId: string; jobId: string; jobSlug: string | null } | null> => {
  const [row] = await db
    .select({
      userId: companyMembers.userId,
      companyId: companyMembers.companyId,
      jobId: jobs.id,
      jobSlug: jobs.slug,
    })
    .from(companyMembers)
    .innerJoin(jobs, eq(jobs.companyId, companyMembers.companyId))
    .where(and(eq(companyMembers.status, 'active'), eq(jobs.status, status)))
    .limit(1);
  return row ?? null;
};

// ---------------------------------------------------------------------------
// 401 — auth bắt buộc (C-01/C-02 bước 1)
// ---------------------------------------------------------------------------

describe('Auth bắt buộc trên job/company read endpoints', () => {
  it('GET /jobs không token → 401', async () => {
    const res = await request(app).get('/api/v1/jobs?status=draft');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /jobs/by-slug/:slug không token → 401', async () => {
    const job = await findJobByStatus('live');
    if (!job?.slug) return; // thiếu fixture → bỏ qua
    const res = await request(app).get(`/api/v1/jobs/by-slug/${job.slug}`);
    expect(res.status).toBe(401);
  });

  it('GET /jobs/:id/applicants-over-time không token → 401', async () => {
    const job = await findJobByStatus('live');
    if (!job) return;
    const res = await request(app).get(`/api/v1/jobs/${job.id}/applicants-over-time`);
    expect(res.status).toBe(401);
  });

  it('GET /companies/:id không token → 401', async () => {
    const job = await findJobByStatus('live');
    if (!job) return;
    const res = await request(app).get(`/api/v1/companies/${job.companyId}`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// C-01 — public list không thể enumeration job chưa publish
// ---------------------------------------------------------------------------

describe('C-01: GET /jobs theo role', () => {
  it('candidate ?status=draft → 200 nhưng danh sách CHỈ gồm job live (filter chỉ thu hẹp)', async () => {
    const user = await findUserByRole('candidate');
    if (!user) return; // thiếu fixture
    const res = await request(app)
      .get('/api/v1/jobs?status=draft&limit=50')
      .set('Authorization', `Bearer ${signToken(user.id, 'candidate')}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    for (const item of res.body.data as Array<{ status: string }>) {
      expect(item.status).toBe('live'); // visibility live AND draft = rỗng/thu hẹp
    }
  });

  it('candidate mặc định chỉ thấy live', async () => {
    const user = await findUserByRole('candidate');
    if (!user) return;
    const res = await request(app)
      .get('/api/v1/jobs?limit=50')
      .set('Authorization', `Bearer ${signToken(user.id, 'candidate')}`);
    expect(res.status).toBe(200);
    for (const item of res.body.data as Array<{ status: string }>) {
      expect(item.status).toBe('live');
    }
  });

  it('employer thấy live (mọi công ty) + mọi status của công ty mình', async () => {
    const membership = await findEmployerWithJobInStatus('draft');
    if (!membership) return; // không có employer nào có job draft → skip
    const res = await request(app)
      .get('/api/v1/jobs?limit=100')
      .set('Authorization', `Bearer ${signToken(membership.userId, 'employer')}`);
    expect(res.status).toBe(200);
    const items = res.body.data as Array<{ status: string; companyId: string }>;
    for (const item of items) {
      const allowed =
        item.status === 'live' || item.companyId === membership.companyId;
      expect(allowed).toBe(true);
    }
    // Đảm bảo test thực sự cover nhánh "công ty mình có job khác live":
    expect(items.some((i) => i.companyId === membership.companyId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C-02 — chi tiết job theo status + role
// ---------------------------------------------------------------------------

describe('C-02: chi tiết job theo role', () => {
  it('candidate xem slug của job draft → 404', async () => {
    const user = await findUserByRole('candidate');
    const draft = await findJobByStatus('draft');
    if (!user || !draft?.slug) return;
    const res = await request(app)
      .get(`/api/v1/jobs/by-slug/${draft.slug}`)
      .set('Authorization', `Bearer ${signToken(user.id, 'candidate')}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('JOB_NOT_FOUND');
  });

  it('candidate xem job live → 200, isExpired=false, response KHÔNG chứa searchTsv/extraData', async () => {
    const user = await findUserByRole('candidate');
    const live = await findJobByStatus('live');
    if (!user || !live?.slug) return;
    const res = await request(app)
      .get(`/api/v1/jobs/by-slug/${live.slug}`)
      .set('Authorization', `Bearer ${signToken(user.id, 'candidate')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isExpired).toBe(false);
    expect(res.body.data).not.toHaveProperty('searchTsv'); // m-02
    expect(res.body.data).not.toHaveProperty('extraData'); // m-02
  });

  it('candidate xem job expired → 200 + isExpired=true', async () => {
    const user = await findUserByRole('candidate');
    const expired = await findJobByStatus('expired');
    if (!user || !expired?.slug) return; // dev DB chưa có job expired → skip
    const res = await request(app)
      .get(`/api/v1/jobs/by-slug/${expired.slug}`)
      .set('Authorization', `Bearer ${signToken(user.id, 'candidate')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isExpired).toBe(true);
  });

  it('employer xem draft CỦA CÔNG TY MÌNH → 200', async () => {
    const membership = await findEmployerWithJobInStatus('draft');
    if (!membership?.jobSlug) return;
    const res = await request(app)
      .get(`/api/v1/jobs/by-slug/${membership.jobSlug}`)
      .set('Authorization', `Bearer ${signToken(membership.userId, 'employer')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');
  });

  it('employer xem draft CÔNG TY KHÁC → 404', async () => {
    const membership = await findEmployerWithJobInStatus('draft');
    if (!membership) return;
    // Draft job của company khác company của employer này.
    const [otherDraft] = await db
      .select({ slug: jobs.slug })
      .from(jobs)
      .where(and(eq(jobs.status, 'draft'), ne(jobs.companyId, membership.companyId)))
      .limit(1);
    if (!otherDraft?.slug) return; // chỉ có 1 công ty trong DB dev → skip
    const res = await request(app)
      .get(`/api/v1/jobs/by-slug/${otherDraft.slug}`)
      .set('Authorization', `Bearer ${signToken(membership.userId, 'employer')}`);
    expect(res.status).toBe(404);
  });

  it('admin xem draft → 200 (mọi status)', async () => {
    const draft = await findJobByStatus('draft');
    if (!draft) return;
    // Token admin ký trực tiếp — auth middleware chỉ verify signature; path
    // read của admin không join users nên không cần user tồn tại trong DB.
    const adminId = crypto.randomUUID();
    const res = await request(app)
      .get(`/api/v1/jobs/${draft.id}`)
      .set('Authorization', `Bearer ${signToken(adminId, 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');
  });
});

// ---------------------------------------------------------------------------
// applicants-over-time — cùng visibility với detail
// ---------------------------------------------------------------------------

describe('applicants-over-time visibility', () => {
  it('candidate truy cập chart của job draft → 404', async () => {
    const user = await findUserByRole('candidate');
    const draft = await findJobByStatus('draft');
    if (!user || !draft) return;
    const res = await request(app)
      .get(`/api/v1/jobs/${draft.id}/applicants-over-time`)
      .set('Authorization', `Bearer ${signToken(user.id, 'candidate')}`);
    expect(res.status).toBe(404);
  });

  it('candidate truy cập chart của job live → 200', async () => {
    const user = await findUserByRole('candidate');
    const live = await findJobByStatus('live');
    if (!user || !live) return;
    const res = await request(app)
      .get(`/api/v1/jobs/${live.id}/applicants-over-time?days=3`)
      .set('Authorization', `Bearer ${signToken(user.id, 'candidate')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.series).toHaveLength(3);
  });
});
