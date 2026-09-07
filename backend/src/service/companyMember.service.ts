/**
 * CompanyMember service — business logic cho invite / accept / decline / remove / leave.
 *
 * Lifecycle status (1 row per (company_id, user_id), reuse qua mọi vòng đời):
 *
 *   ┌─────────┐  user accept (case 3/4)   ┌────────┐
 *   │ pending │ ─────────────────────────► │ active │
 *   └─────────┘                            └────────┘
 *        │                                     │
 *        │ user decline (case 2)              │ owner remove (case 5)
 *        │ owner cancel invite                │ user leave (case 7)
 *        │                                    │
 *        ▼                                    ▼
 *   ┌───────────┐                         ┌──────────┐
 *   │ declined  │                         │ removed  │ / left
 *   └───────────┘                         └──────────┘
 *        │                                    │
 *        │ owner re-invite (case 8)         │ owner re-invite (case 8)
 *        └──────────► pending               └──────────► pending
 *
 *   + auto_cancelled: pending → auto_cancelled khi user accept invite khác.
 *
 * Quy tắc business:
 *   - 1 user CHỈ active ở 1 công ty tại 1 thời điểm (check trong accept).
 *   - 1 công ty CHỈ CÓ 1 active owner duy nhất (partial unique index).
 *   - Soft delete — không bao giờ DELETE row, chỉ UPDATE status.
 *
 * Error codes (xem interface/companyMember.ts):
 *   CANNOT_INVITE_SELF, ALREADY_PENDING, ALREADY_ACTIVE, ALREADY_ACTIVE_ELSEWHERE,
 *   INVITATION_NOT_PENDING, CANNOT_REMOVE_OWNER, CANNOT_LEAVE_AS_LAST_OWNER,
 *   NOT_ACTIVE, USER_NOT_FOUND, MEMBER_NOT_FOUND.
 */
import { db } from '../config/database';
import {
  companyMembers,
  companies,
  notifications,
  users,
  userProfiles,
} from '../db/schema';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import {
  type CompanyMember,
  type CompanyMemberErrorCode,
  type CompanyMemberRole,
  type CompanyMemberStatus,
  type CompanyMemberWithUser,
  type MyInvitationItem,
  type TransferCompanyOwnerResult,
} from '../interface/companyMember';
import { CompanyMemberErrorCode as EC } from '../interface/companyMember';
import { notificationService } from './notification.service';

/* ============================================================================
 * Internal helpers
 * ==========================================================================*/

/** Type cho 1 row notification — dùng emit sau commit (socket không rollback được). */
type NotificationRow = typeof notifications.$inferSelect;

/* ============================================================================
 * Legacy helpers — GIỮ LẠI để tương thích với:
 *   - GET /companies/me (dùng findMembershipByUserId)
 *   - GET /companies/me/invites (dùng getPendingInvitesForUser — endpoint cũ)
 *   - job controller (dùng findMembershipByUserId để xác định owner của job)
 *
 * Các endpoint này KHÔNG thuộc invite lifecycle mới (case 1-11 ở trên), nhưng
 * vẫn cần chạy được. Nếu migrate xong có thể refactor FE rồi xoá sau.
 * ==========================================================================*/
// (Các legacy helpers được đặt bên trong companyMemberService ở cuối file.)

/**
 * Tìm user qua email (case-insensitive). Trả cả role + status để caller check
 * được tính "invitable" (employer/admin + active) mà không tốn thêm roundtrip.
 *
 * Trả null nếu chưa đăng ký. Helper dùng cho invite endpoint — FE gửi email
 * thay vì UUID.
 */
const findInvitableUserByEmail = async (
  email: string,
): Promise<{ id: string; role: string; status: string } | null> => {
  const [row] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return row ?? null;
};

/**
 * Lấy row company_members theo (companyId, userId). Trả null nếu không tồn tại.
 * Helper dùng cho tất cả case — query 1 lần cho mọi check.
 */
const getByCompanyAndUser = async (
  companyId: string,
  userId: string,
): Promise<CompanyMember | null> => {
  const [row] = await db
    .select()
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
};

/** Đếm active owner — dùng cho case 6 (chặn xoá owner cuối) và case 7 (chặn rời). */
const countActiveOwners = async (companyId: string): Promise<number> => {
  const rows = await db
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.role, 'owner'),
        eq(companyMembers.status, 'active'),
      ),
    );
  return rows.length;
};

/**
 * Lấy danh sách userId của TẤT CẢ active members của company, TRỪ 1 user
 * (thường là user vừa rời / bị xoá — không cần notify lại chính họ).
 *
 * Dùng cho:
 *   - leave() — notify các member còn lại rằng có người vừa rời.
 *   - remove() — notify các member còn lại rằng có người vừa bị xoá.
 *
 * Trả về mảng userId (UUID string[]). Trả mảng rỗng nếu company không còn
 * member nào active sau khi loại trừ.
 */
const getActiveMemberIdsExcluding = async (
  companyId: string,
  excludedUserId: string,
): Promise<string[]> => {
  const rows = await db
    .select({ userId: companyMembers.userId })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.status, 'active'),
        ne(companyMembers.userId, excludedUserId),
      ),
    );
  return rows.map((r) => r.userId);
};

/**
 * Lấy TẤT CẢ active member userIds của company (không loại trừ ai).
 * Dùng cho transferOwner() — caller tự filter ra 2 bên đã notify riêng.
 */
const getAllActiveMemberIds = async (
  companyId: string,
): Promise<string[]> => {
  const rows = await db
    .select({ userId: companyMembers.userId })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.status, 'active'),
      ),
    );
  return rows.map((r) => r.userId);
};

/** Lookup thông tin company cho error response (ALREADY_ACTIVE_ELSEWHERE). */
const getCompanySummary = async (
  companyId: string,
): Promise<{ id: string; name: string } | null> => {
  const [row] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row ?? null;
};

/* ============================================================================
 * Notification helpers — emit sau khi transaction commit
 * ==========================================================================*/

interface NotifyArgs {
  /** Một hoặc nhiều notification rows. Service dùng 1 row cho invite/accept,
   *  nhiều row cho leave/remove/transfer (notify toàn bộ active members). */
  notif: NotificationRow | NotificationRow[] | null;
  fallbackMsg: string;
}

const emitNotification = ({ notif, fallbackMsg }: NotifyArgs): void => {
  const list = Array.isArray(notif) ? notif : notif ? [notif] : [];
  if (list.length === 0) {
    console.warn('[companyMemberService] emit skipped:', fallbackMsg);
    return;
  }
  for (const row of list) {
    notificationService.emit(row);
  }
};

/** Tạo notification 'company' (kind='company_invite_sent') cho user được mời. */
const buildInviteNotification = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  invitedUserId: string,
  companyId: string,
  companyName: string,
  invitedBy: string,
  role: CompanyMemberRole,
): Promise<NotificationRow> => {
  return notificationService.createInTx(tx, {
    userId: invitedUserId,
    type: 'company',
    title: `Lời mời tham gia ${companyName}`,
    payload: {
      kind: 'company_invite_sent',
      companyId,
      companyName,
      role,
      invitedBy,
    },
  });
};

/**
 * Tạo notification 'company' (kind discriminator) cho các sự kiện nội bộ:
 * accept/decline/auto-cancel/remove/leave/transfer.
 *
 * Sau refactor 0032: mọi sự kiện liên quan company-member lifecycle đều đi qua
 * đây với type='company'. 'system' giữ trong enum cho payment/quota tương lai.
 *
 * `company_invite_auto_cancelled` tách riêng `company_invite_declined` (Bug 2):
 * trước đây owner nhận title "User X đã từ chối" khi user thực ra đã accept ở
 * công ty khác → misleading. Hai tình huống khác nhau về ngữ nghĩa nên
 * tách kind để FE dispatch đúng.
 */
const buildCompanyNotification = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  recipientUserId: string,
  title: string,
  kind:
    | 'company_invite_accepted'
    | 'company_invite_declined'
    | 'company_invite_auto_cancelled'
    | 'removed_from_company'
    | 'invite_cancelled'
    | 'company_member_left'
    | 'company_owner_transferred'
    | 'company_owner_transferred_to_you'
    | 'company_owner_transferred_from_you',
  payload: Record<string, unknown>,
): Promise<NotificationRow> => {
  return notificationService.createInTx(tx, {
    userId: recipientUserId,
    type: 'company',
    title,
    payload: { kind, ...payload },
  });
};

/* ============================================================================
 * Service exports
 * ==========================================================================*/

export const companyMemberService = {
  /* ==========================================================================
   * Case 1 + 8 + 9 + 10 — Owner invite user
   * ==========================================================================
   *
   * Logic phân nhánh:
   *   - Email chưa đăng ký           → USER_NOT_FOUND 404
   *   - Self-invite (email == owner) → CANNOT_INVITE_SELF 400
   *   - Row tồn tại status='pending'  → ALREADY_PENDING 409 (case 9)
   *   - Row tồn tại status='active'   → ALREADY_ACTIVE 409 (case 10)
   *   - Row tồn tại status IN
   *     ('declined','removed','left','auto_cancelled') → RE-INVITE (case 8)
   *   - Chưa có row                  → INSERT mới status='pending' (case 1)
   * ==========================================================================*/
  invite: async (
    companyId: string,
    email: string,
    invitedBy: string,
    role: CompanyMemberRole = 'member',
  ): Promise<CompanyMember> => {
    // 1. Resolve email → { id, role, status }
    const invitedUser = await findInvitableUserByEmail(email);
    if (!invitedUser) {
      throw new AppError(
        404,
        EC.USER_NOT_FOUND,
        'Email chưa đăng ký tài khoản trên JobMatch.',
      );
    }
    const invitedUserId = invitedUser.id;

    // 2. Self-invite guard
    if (invitedUserId === invitedBy) {
      throw new AppError(
        400,
        EC.CANNOT_INVITE_SELF,
        'Không thể tự mời chính mình.',
      );
    }

    // 2.4. Invitable guard — chỉ employer + admin + status='active' mới join công ty.
    //
    // Company là khái niệm của phía nhà tuyển dụng. Invite candidate về mặt
    // business là vô nghĩa, và tệ hơn — tạo notification "Lời mời tham gia
    // công ty X" gửi cho user không có vai trò quản lý công ty, làm rối
    // chuông + tăng nguy cơ candidate accept nhầm rồi chiếm slot member.
    //
    // Check fail-fast ở đây (trước otherActive) để:
    //   - Tránh mất công query 2.5
    //   - Tránh emit notification mồi rồi mới báo lỗi (UX khó chịu)
    //
    // Admin: cho phép (admin cũng có thể là owner công ty nếu business cho).
    // Status: 'pending' (chưa verify email) thì không cho — user chưa vào
    // được app thì accept lời mời cũng vô nghĩa. 'suspended'/'banned' thì
    // rõ ràng chặn.
    const INVITABLE_ROLES = new Set(['employer', 'admin']);
    if (!INVITABLE_ROLES.has(invitedUser.role)) {
      throw new AppError(
        400,
        EC.USER_NOT_EMPLOYER,
        'Chỉ có thể mời tài khoản nhà tuyển dụng.',
      );
    }
    if (invitedUser.status !== 'active') {
      throw new AppError(
        400,
        EC.USER_NOT_ACTIVE,
        'Tài khoản chưa kích hoạt hoặc đang bị tạm khoá.',
      );
    }

    // 2.5. Check user chưa active ở company khác — fail-fast ở invite
    //      (accept() cũng reject với cùng lý do, nhưng để đến lúc đó thì user
    //      đã nhận notification mồi rất khó chịu). Có thể vẫn mời user đang ở
    //      status ended (declined/removed/left/auto_cancelled) ở company khác —
    //      user đó tự do, chỉ cần rời active company hiện tại trước khi accept.
    const otherActive = await db
      .select({ companyId: companyMembers.companyId })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.userId, invitedUserId),
          eq(companyMembers.status, 'active'),
          ne(companyMembers.companyId, companyId),
        ),
      )
      .limit(1);
    if (otherActive.length > 0) {
      const otherCompany = await getCompanySummary(otherActive[0].companyId);
      throw new AppError(
        409,
        EC.USER_ACTIVE_ELSEWHERE,
        `User này đang là thành viên active của "${otherCompany?.name ?? 'công ty khác'}". Họ cần rời trước khi có thể nhận lời mời mới.`,
        otherCompany?.id,
      );
    }

    // 3. Lookup existing row → phân nhánh theo status
    const existing = await getByCompanyAndUser(companyId, invitedUserId);

    // Case 9 — đã pending
    if (existing?.status === 'pending') {
      throw new AppError(
        409,
        EC.ALREADY_PENDING,
        'Đã có lời mời đang chờ user này phản hồi.',
      );
    }

    // Case 10 — đã active
    if (existing?.status === 'active') {
      throw new AppError(
        409,
        EC.ALREADY_ACTIVE,
        'User này đã là thành viên active của công ty.',
      );
    }

    // 4. Lookup company name cho notification
    const company = await getCompanySummary(companyId);
    const companyName = company?.name ?? 'công ty';

    let emitAfterCommit: NotificationRow | null = null;
    let result: CompanyMember;

    if (
      existing &&
      (existing.status === 'declined' ||
        existing.status === 'removed' ||
        existing.status === 'left' ||
        existing.status === 'auto_cancelled')
    ) {
      // Case 8 — RE-INVITE: reset lại row về pending
      result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(companyMembers)
          .set({
            status: 'pending',
            role,
            invitedBy,
            invitedAt: new Date(),
            respondedAt: null,
            endedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(companyMembers.id, existing.id),
              inArray(companyMembers.status, [
                'declined',
                'removed',
                'left',
                'auto_cancelled',
              ]),
            ),
          )
          .returning();
        if (!updated) {
          throw new AppError(
            409,
            EC.NO_PENDING_INVITATION,
            'Row đã thay đổi trạng thái, vui lòng thử lại.',
          );
        }

        emitAfterCommit = await buildInviteNotification(
          tx,
          invitedUserId,
          companyId,
          companyName,
          invitedBy,
          role,
        );

        return updated;
      });
    } else {
      // Case 1 — INSERT mới
      result = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(companyMembers)
          .values({
            companyId,
            userId: invitedUserId,
            role,
            status: 'pending',
            invitedBy,
          })
          .returning();
        if (!inserted) {
          throw new AppError(500, 'INTERNAL_ERROR', 'Không thể tạo invitation.');
        }

        emitAfterCommit = await buildInviteNotification(
          tx,
          invitedUserId,
          companyId,
          companyName,
          invitedBy,
          role,
        );

        return inserted;
      });
    }

    // 5. Emit SAU commit — socket không rollback được
    emitNotification({
      notif: emitAfterCommit,
      fallbackMsg: `invite notification for user=${invitedUserId}`,
    });

    return result;
  },

  /* ==========================================================================
   * Case 2 — User decline invitation
   * ==========================================================================
   *
   * Atomic update: chỉ UPDATE nếu status='pending'. Nếu rowCount=0 → 409.
   * ==========================================================================*/
  decline: async (companyId: string, userId: string): Promise<CompanyMember> => {
    // 1. Pre-check để lấy owner cho notification
    const existing = await getByCompanyAndUser(companyId, userId);
    if (!existing) {
      throw new AppError(
        404,
        EC.MEMBER_NOT_FOUND,
        'Không tìm thấy row cho company/user này.',
      );
    }
    if (existing.status !== 'pending') {
      throw new AppError(
        409,
        EC.INVITATION_NOT_PENDING,
        'Lời mời không ở trạng thái pending — không thể decline.',
      );
    }

    // 2. Atomic UPDATE với WHERE status='pending' (chống race)
    let emitAfterCommit: NotificationRow | null = null;
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(companyMembers)
        .set({
          status: 'declined',
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.userId, userId),
            eq(companyMembers.status, 'pending'),
          ),
        )
        .returning();
      if (!updated) {
        throw new AppError(
          409,
          EC.INVITATION_NOT_PENDING,
          'Lời mời đã được phản hồi (accept/decline) bởi request khác.',
        );
      }

      // 3. Notify owner — emit sau commit
      if (updated.invitedBy) {
        const [inviter] = await tx
          .select({ fullName: userProfiles.fullName, email: users.email })
          .from(users)
          .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
          .where(eq(users.id, updated.invitedBy))
          .limit(1);
        // Lookup tên công ty để title hiển thị rõ — trước đây hardcode 'công ty'
        // (bug dở) → user nhìn bell không biết decline công ty nào.
        const company = await getCompanySummary(updated.companyId);
        const declinerName = inviter?.fullName ?? inviter?.email ?? 'User';
        const companyName = company?.name ?? 'công ty';
        emitAfterCommit = await buildCompanyNotification(
          tx,
          updated.invitedBy,
          `${declinerName} đã từ chối lời mời vào ${companyName}`,
          'company_invite_declined',
          { companyId: updated.companyId, companyName, declinedBy: userId },
        );
      }

      return updated;
    });

    emitNotification({
      notif: emitAfterCommit,
      fallbackMsg: `decline notification for user=${userId}`,
    });

    return result;
  },

  /* ==========================================================================
   * Case 3 + 4 — User accept invitation
   * ==========================================================================
   *
   * Trong 1 transaction (atomic):
   *   a. Check user không active ở công ty khác (UNIQUE 1 active company / user)
   *      - Nếu có → throw ALREADY_ACTIVE_ELSEWHERE 409 (rollback)
   *   b. UPDATE status: pending → active
   *      - WHERE status='pending' (atomic check)
   *      - rowCount=0 → throw INVITATION_NOT_PENDING 409
   *   c. Auto-cancel TẤT CẢ pending invites khác của user này → auto_cancelled
   *      (vì user chỉ được active ở 1 công ty)
   *   d. Tạo notification cho owner (accepted)
   *   e. Tạo notification cho owners bị auto_cancelled
   * ==========================================================================*/
  accept: async (companyId: string, userId: string): Promise<{
    membership: CompanyMember;
    autoCancelledCount: number;
  }> => {
    let ownerNotif: NotificationRow | null = null;
    let autoCancelNotifs: NotificationRow[] = [];

    const { membership, autoCancelledCount } = await db.transaction(async (tx) => {
      // a. Check user không active ở công ty khác
      const otherActive = await tx
        .select()
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.userId, userId),
            eq(companyMembers.status, 'active'),
            ne(companyMembers.companyId, companyId),
          ),
        )
        .limit(1);

      if (otherActive.length > 0) {
        // Lấy tên company đang active để FE hiển thị message rõ ràng
        const otherCompany = await getCompanySummary(otherActive[0].companyId);
        throw new AppError(
          409,
          EC.ALREADY_ACTIVE_ELSEWHERE,
          `Bạn đang là thành viên active của "${otherCompany?.name ?? 'công ty khác'}". Hãy rời trước khi accept lời mời này.`,
          otherCompany?.id, // field = active company id (FE có thể lookup thêm)
        );
      }

      // b. UPDATE pending → active (atomic với WHERE status='pending')
      const [accepted] = await tx
        .update(companyMembers)
        .set({
          status: 'active',
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.userId, userId),
            eq(companyMembers.status, 'pending'),
          ),
        )
        .returning();
      if (!accepted) {
        throw new AppError(
          409,
          EC.INVITATION_NOT_PENDING,
          'Lời mời không ở trạng thái pending — không thể accept.',
        );
      }

      // c. Auto-cancel TẤT CẢ pending invites khác của user này
      const autoCancelled = await tx
        .update(companyMembers)
        .set({
          status: 'auto_cancelled',
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companyMembers.userId, userId),
            eq(companyMembers.status, 'pending'),
            ne(companyMembers.companyId, companyId),
          ),
        )
        .returning();

      // d. Tạo notification cho owner của company vừa accept
      if (accepted.invitedBy) {
        const [inviter] = await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, accepted.invitedBy))
          .limit(1);
        ownerNotif = await buildCompanyNotification(
          tx,
          accepted.invitedBy,
          `${inviter?.email ?? 'User'} đã chấp nhận lời mời vào công ty`,
          'company_invite_accepted',
          {
            companyId: accepted.companyId,
            companyName: '',
            acceptedBy: userId,
          },
        );
      }

      // e. Notify owners bị auto_cancelled — dùng kind riêng 'company_invite_auto_cancelled'
      // (KHÔNG 'company_invite_declined' — user thực ra đã accept ở công ty khác
      // chứ không decline. Phân biệt 2 kind giúp FE dispatch đúng + title rõ.)
      if (autoCancelled.length > 0) {
        for (const ac of autoCancelled) {
          if (ac.invitedBy) {
            autoCancelNotifs.push(
              await buildCompanyNotification(
                tx,
                ac.invitedBy,
                `Lời mời của bạn đã bị huỷ — user đã chấp nhận lời mời của công ty khác`,
                'company_invite_auto_cancelled',
                {
                  companyId: ac.companyId,
                  reason: 'auto_cancelled',
                  acceptedElsewhereCompanyId: companyId,
                },
              ),
            );
          }
        }
      }

      return { membership: accepted, autoCancelledCount: autoCancelled.length };
    });

    // Emit SAU commit
    if (ownerNotif) emitNotification({ notif: ownerNotif, fallbackMsg: 'accept notif' });
    for (const n of autoCancelNotifs) {
      emitNotification({ notif: n, fallbackMsg: 'auto-cancel notif' });
    }

    return { membership, autoCancelledCount };
  },

  /* ==========================================================================
   * Case 5 + 6 — Owner remove member (soft delete)
   * ==========================================================================
   *
   * - Soft delete áp dụng cho CẢ 2 trạng thái:
   *     - status='active'  → "Xoá khỏi công ty"  → status='removed'
   *     - status='pending' → "Huỷ lời mời"       → status='removed'
   *   Cả hai set ended_at = now().
   *
   * - Chặn xoá owner active cuối cùng → CANNOT_REMOVE_OWNER 400.
   *   (Với pending owner invite thì không cần check — owner chưa active
   *   nên xoá không ảnh hưởng active owner count.)
   *
   * - Atomic UPDATE WHERE status IN ('active','pending') (chống race).
   *
   * - Các status KHÁC (declined/removed/left/auto_cancelled) → 409 NOT_ACTIVE.
   *   User phải dùng nút "Mời lại" (re-invite) thay vì xoá.
   *
   * - Emit notification cho user bị ảnh hưởng.
   * ==========================================================================*/
  remove: async (
    companyId: string,
    targetUserId: string,
    removedBy: string,
  ): Promise<CompanyMember> => {
    // 1. Pre-check để biết role + status
    const target = await getByCompanyAndUser(companyId, targetUserId);
    if (!target) {
      throw new AppError(
        404,
        EC.MEMBER_NOT_FOUND,
        'Không tìm thấy member cho (companyId, userId) này.',
      );
    }
    if (target.status !== 'active' && target.status !== 'pending') {
      throw new AppError(
        409,
        EC.NOT_ACTIVE,
        'Member không ở trạng thái active/pending — không thể xoá. Hãy dùng "Mời lại" nếu muốn tái sử dụng row.',
      );
    }

    // 2. Case 6 — chặn xoá owner cuối cùng (chỉ check khi target là active owner).
    //    Pending owner invite thì không ảnh hưởng active owner count.
    if (target.role === 'owner' && target.status === 'active') {
      const ownerCount = await countActiveOwners(companyId);
      if (ownerCount === 1) {
        throw new AppError(
          400,
          EC.CANNOT_REMOVE_OWNER,
          'Không thể xoá owner duy nhất của công ty. Hãy transfer ownership trước.',
        );
      }
    }

    // 3. Atomic UPDATE — chấp nhận cả 'active' và 'pending'
    const emittedNotifs: NotificationRow[] = [];
    const wasActive = target.status === 'active';
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(companyMembers)
        .set({
          status: 'removed',
          endedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.userId, targetUserId),
            inArray(companyMembers.status, ['active', 'pending']),
          ),
        )
        .returning();
      if (!updated) {
        throw new AppError(
          409,
          EC.NOT_ACTIVE,
          'Trạng thái đã thay đổi — vui lòng refresh và thử lại.',
        );
      }

      // 4. Notify user bị ảnh hưởng trực tiếp (bị xoá / invite bị huỷ).
      //    Phân biệt 2 case để message rõ ràng.
      //    CHỈ notify user này — không spam các member khác (họ sẽ reload khi
      //    có action tương ứng — vd mở lại trang hoặc nhận notification khác).
      //
      //    Lưu ý: outer `kind` của buildCompanyNotification là kind cuối cùng
      //    lưu trong notification.payload.kind. KHÔNG truyền `kind` trong payload
      //    để tránh bị spread đè (trước đây có bug — outer 'company_member_removed'
      //    bị inner 'removed_from_company' đè → FE không match listener).
      const company = await getCompanySummary(companyId);
      const notifKind: 'removed_from_company' | 'invite_cancelled' = wasActive
        ? 'removed_from_company'
        : 'invite_cancelled';
      const notifTitle = wasActive
        ? `Bạn đã bị xoá khỏi ${company?.name ?? 'công ty'}`
        : `Lời mời tham gia ${company?.name ?? 'công ty'} đã bị huỷ`;
      emittedNotifs.push(
        await buildCompanyNotification(
          tx,
          targetUserId,
          notifTitle,
          notifKind,
          {
            companyId,
            companyName: company?.name ?? null,
            removedBy,
            previousStatus: target.status,
          },
        ),
      );

      return updated;
    });

    emitNotification({
      notif: emittedNotifs,
      fallbackMsg: `remove notification for user=${targetUserId}`,
    });

    return result;
  },

  /* ==========================================================================
   * Case 7 — Member tự rời công ty (leave)
   * ==========================================================================
   *
   * - Chỉ cho phép user tự thao tác trên chính mình (caller === targetUserId).
   * - Chặn rời nếu là owner cuối cùng → CANNOT_LEAVE_AS_LAST_OWNER.
   * - Soft delete: status: active → left, set ended_at.
   * - Emit notification cho owner duy nhất.
   * ==========================================================================*/
  leave: async (companyId: string, userId: string): Promise<CompanyMember> => {
    // 1. Caller phải tự rời chính mình (controller đã check từ token, nhưng check thêm ở service cho chắc)
    // (Caller = userId từ token — controller pass vào)

    // 2. Pre-check
    const target = await getByCompanyAndUser(companyId, userId);
    if (!target) {
      throw new AppError(
        404,
        EC.MEMBER_NOT_FOUND,
        'Bạn không phải thành viên của công ty này.',
      );
    }
    if (target.status !== 'active') {
      throw new AppError(
        409,
        EC.NOT_ACTIVE,
        'Bạn không ở trạng thái active — không thể rời.',
      );
    }

    // 3. Chặn rời nếu là owner cuối
    if (target.role === 'owner') {
      const ownerCount = await countActiveOwners(companyId);
      if (ownerCount === 1) {
        throw new AppError(
          400,
          EC.CANNOT_LEAVE_AS_LAST_OWNER,
          'Bạn là owner duy nhất của công ty. Hãy transfer ownership trước khi rời.',
        );
      }
    }

    // 4. Atomic UPDATE
    const emittedNotifs: NotificationRow[] = [];
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(companyMembers)
        .set({
          status: 'left',
          endedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.userId, userId),
            eq(companyMembers.status, 'active'),
          ),
        )
        .returning();
      if (!updated) {
        throw new AppError(
          409,
          EC.NOT_ACTIVE,
          'Trạng thái đã thay đổi — vui lòng refresh và thử lại.',
        );
      }

      // 5. Notify owner duy nhất của company (ngoại trừ chính người rời nếu họ
      //    là owner — tránh notify chính mình). Owner cần biết để cập nhật danh
      //    sách member.
      const [ownerRow] = await tx
        .select({ userId: companyMembers.userId })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.role, 'owner'),
            eq(companyMembers.status, 'active'),
          ),
        )
        .limit(1);

      if (ownerRow && ownerRow.userId !== userId) {
        emittedNotifs.push(
          await buildCompanyNotification(
            tx,
            ownerRow.userId,
            `Một thành viên đã rời công ty của bạn`,
            'company_member_left',
            {
              companyId,
              leftUserId: userId,
            },
          ),
        );
      }

      return updated;
    });

    emitNotification({
      notif: emittedNotifs,
      fallbackMsg: `leave notification`,
    });

    return result;
  },

  /* ==========================================================================
   * Transfer ownership — atomic swap role giữa current owner và new owner
   * ==========================================================================
   *
   * Flow:
   *   1. Pre-check: caller phải là active owner của company.
   *   2. Pre-check: target phải là active MEMBER của company (không phải owner,
   *      không phải pending/declined/removed/left/auto_cancelled).
   *   3. Pre-check: target.userId !== caller.userId (no-op).
   *   4. Atomic transaction (đảm bảo constraint "1 active owner duy nhất"):
   *      a. Demote caller: role='owner' → 'member' (vẫn status='active').
   *      b. Promote target: role='member' → 'owner' (vẫn status='active').
   *      c. Nếu (a) thành công nhưng (b) fail (vd race condition) → rollback toàn bộ.
   *   5. Emit notifications cho cả 2 bên:
   *      - newOwner: "Bạn đã trở thành owner của {company}"
   *      - previousOwner: "Bạn đã chuyển quyền sở hữu {company} cho {newOwnerName}"
   *
   * Error codes:
   *   FORBIDDEN_NOT_OWNER       — caller không phải active owner
   *   MEMBER_NOT_FOUND          — target không có row trong company
   *   NOT_ACTIVE                — target không ở status='active'
   *   CANNOT_TRANSFER_TO_OWNER  — target đã là owner (no-op)
   *   CANNOT_TRANSFER_TO_SELF   — caller === target (no-op)
   * ==========================================================================*/
  transferOwner: async (
    companyId: string,
    currentOwnerUserId: string,
    newOwnerUserId: string,
  ): Promise<TransferCompanyOwnerResult> => {
    // 0. Self-transfer guard (không cần query DB).
    if (currentOwnerUserId === newOwnerUserId) {
      throw new AppError(
        400,
        EC.CANNOT_TRANSFER_TO_SELF,
        'Bạn đã là owner — không thể transfer cho chính mình.',
      );
    }

    // 1. Pre-check target row — biết role + status để validate + biết tên để notify.
    const target = await getByCompanyAndUser(companyId, newOwnerUserId);
    if (!target) {
      throw new AppError(
        404,
        EC.MEMBER_NOT_FOUND,
        'Không tìm thấy member mới — user này chưa thuộc công ty.',
      );
    }
    if (target.status !== 'active') {
      throw new AppError(
        409,
        EC.NOT_ACTIVE,
        'Member mới không ở trạng thái active — chỉ có thể transfer cho member đang hoạt động.',
      );
    }
    if (target.role === 'owner') {
      throw new AppError(
        400,
        EC.CANNOT_TRANSFER_TO_OWNER,
        'Người này đã là owner — không thể transfer cho owner khác.',
      );
    }

    // 2. Pre-check caller là active owner — middleware requireCompanyOwner đã check,
    //    nhưng check lại trong service để defensive (tránh bypass middleware).
    const caller = await getByCompanyAndUser(companyId, currentOwnerUserId);
    if (!caller || caller.role !== 'owner' || caller.status !== 'active') {
      throw new AppError(
        403,
        EC.FORBIDDEN_NOT_OWNER,
        'Chỉ owner active mới có quyền transfer ownership.',
      );
    }

    // 3. Atomic swap — đảm bảo constraint "1 active owner duy nhất" luôn đúng.
    //    Order: demote caller TRƯỚC, promote target SAU (rollback nếu promote fail).
    const emittedNotifs: NotificationRow[] = [];
    const result = await db.transaction(async (tx) => {
      // 3a. Demote current owner → member (atomic WHERE role='owner' AND status='active')
      const [demoted] = await tx
        .update(companyMembers)
        .set({ role: 'member', updatedAt: new Date() })
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.userId, currentOwnerUserId),
            eq(companyMembers.role, 'owner'),
            eq(companyMembers.status, 'active'),
          ),
        )
        .returning();
      if (!demoted) {
        throw new AppError(
          409,
          EC.FORBIDDEN_NOT_OWNER,
          'Bạn không còn là active owner — vui lòng refresh và thử lại.',
        );
      }

      // 3b. Promote target member → owner (atomic WHERE role='member' AND status='active')
      const [promoted] = await tx
        .update(companyMembers)
        .set({ role: 'owner', updatedAt: new Date() })
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.userId, newOwnerUserId),
            eq(companyMembers.role, 'member'),
            eq(companyMembers.status, 'active'),
          ),
        )
        .returning();
      if (!promoted) {
        throw new AppError(
          409,
          EC.FORBIDDEN_NOT_OWNER,
          'Member mới đã thay đổi role/status — vui lòng refresh và thử lại.',
        );
      }

      // 4. Notify các bên liên quan.
      const company = await getCompanySummary(companyId);
      const companyName = company?.name ?? 'công ty';

      const newOwnerProfile = await tx
        .select({ fullName: userProfiles.fullName, email: users.email })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(eq(users.id, newOwnerUserId))
        .limit(1);
      const newOwnerName =
        newOwnerProfile[0]?.fullName ?? newOwnerProfile[0]?.email ?? 'thành viên';

      // 4a. newOwner
      emittedNotifs.push(
        await buildCompanyNotification(
          tx,
          newOwnerUserId,
          `Bạn đã trở thành owner của ${companyName}`,
          'company_owner_transferred_to_you',
          {
            companyId,
            companyName,
            previousOwnerUserId: currentOwnerUserId,
          },
        ),
      );

      // 4b. previousOwner
      emittedNotifs.push(
        await buildCompanyNotification(
          tx,
          currentOwnerUserId,
          `Bạn đã chuyển quyền sở hữu ${companyName} cho ${newOwnerName}`,
          'company_owner_transferred_from_you',
          {
            companyId,
            companyName,
            newOwnerUserId,
            newOwnerName,
          },
        ),
      );

      // 4c. Tất cả active members còn lại (trừ 2 bên đã notify ở trên).
      const allActiveIds = await getAllActiveMemberIds(companyId);
      for (const recipientId of allActiveIds) {
        if (recipientId === currentOwnerUserId) continue;
        if (recipientId === newOwnerUserId) continue;
        emittedNotifs.push(
          await buildCompanyNotification(
            tx,
            recipientId,
            `Quyền sở hữu ${companyName} đã được chuyển`,
            'company_owner_transferred',
            {
              companyId,
              companyName,
              newOwnerUserId,
              newOwnerName,
              previousOwnerUserId: currentOwnerUserId,
            },
          ),
        );
      }

      return { newOwner: promoted, previousOwner: demoted };
    });

    emitNotification({
      notif: emittedNotifs,
      fallbackMsg: `transfer-owner notification (${emittedNotifs.length} recipients)`,
    });

    return result;
  },

  /* ==========================================================================
   * GET /companies/me/invitations — list pending invites của user hiện tại
   * ==========================================================================
   *
   * Trả về tất cả row company_members có status='pending' của user hiện tại,
   * JOIN với companies để lấy tên + logo + industry + sizeRange.
   * Sắp xếp theo invited_at DESC (mới nhất trước).
   * ==========================================================================*/
  listMyInvitations: async (userId: string): Promise<MyInvitationItem[]> => {
    const rows = await db
      .select({
        id: companyMembers.id,
        companyId: companyMembers.companyId,
        companyName: companies.name,
        companyLogoUrl: companies.logoUrl,
        companyIndustry: companies.industry,
        companySizeRange: companies.sizeRange,
        role: companyMembers.role,
        invitedAt: companyMembers.invitedAt,
        inviterUserId: users.id,
        inviterEmail: users.email,
        inviterFullName: userProfiles.fullName,
      })
      .from(companyMembers)
      .innerJoin(companies, eq(companies.id, companyMembers.companyId))
      .leftJoin(users, eq(users.id, companyMembers.invitedBy))
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(
        and(
          eq(companyMembers.userId, userId),
          eq(companyMembers.status, 'pending'),
        ),
      )
      .orderBy(desc(companyMembers.invitedAt));

    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      companyName: r.companyName,
      companyLogoUrl: r.companyLogoUrl,
      companyIndustry: r.companyIndustry,
      companySizeRange: r.companySizeRange,
      role: r.role,
      invitedAt:
        r.invitedAt instanceof Date ? r.invitedAt.toISOString() : String(r.invitedAt),
      invitedBy: r.inviterUserId
        ? {
            userId: r.inviterUserId,
            email: r.inviterEmail,
            fullName: r.inviterFullName ?? null,
          }
        : null,
    })) as MyInvitationItem[];
  },

  /* ==========================================================================
   * GET /companies/:companyId/members — list members (giữ nguyên logic cũ nhưng
   * trả về enriched với user info + support status filter cho owner xem mọi status)
   * ==========================================================================*/
  listByCompany: async (
    companyId: string,
    viewerUserId: string,
  ): Promise<CompanyMemberWithUser[]> => {
    // 1. Check viewer status — dùng regular query builder (an toàn hơn relational API)
    const viewerRows = await db
      .select({ role: companyMembers.role, status: companyMembers.status })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, viewerUserId),
        ),
      )
      .limit(1);

    const viewer = viewerRows[0];
    if (!viewer || viewer.status !== 'active') return [];

    // 2. Query với LEFT JOIN users + user_profiles
    const baseSelect = db
      .select({
        // Member fields
        id: companyMembers.id,
        companyId: companyMembers.companyId,
        userId: companyMembers.userId,
        role: companyMembers.role,
        status: companyMembers.status,
        invitedBy: companyMembers.invitedBy,
        invitedAt: companyMembers.invitedAt,
        respondedAt: companyMembers.respondedAt,
        endedAt: companyMembers.endedAt,
        updatedAt: companyMembers.updatedAt,
        // User fields (LEFT JOIN)
        userEmail: users.email,
        userFullName: userProfiles.fullName,
        userAvatarUrl: userProfiles.avatarUrl,
      })
      .from(companyMembers)
      .leftJoin(users, eq(users.id, companyMembers.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id));

    const rows =
      viewer.role === 'owner'
        ? await baseSelect.where(eq(companyMembers.companyId, companyId))
        : await baseSelect.where(
            and(
              eq(companyMembers.companyId, companyId),
              eq(companyMembers.status, 'active'),
            ),
          );

    // 3. Map to enriched rows
    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      userId: r.userId,
      role: r.role,
      status: r.status,
      invitedBy: r.invitedBy,
      invitedAt: r.invitedAt,
      respondedAt: r.respondedAt,
      endedAt: r.endedAt,
      updatedAt: r.updatedAt,
      user: r.userEmail
        ? {
            id: r.userId,
            email: r.userEmail,
            fullName: r.userFullName ?? null,
            avatarUrl: r.userAvatarUrl ?? null,
          }
        : null,
    }));
  },

  /* ==========================================================================
   * Helper — dùng bởi controller company.controller.ts khi tạo company mới
   * (auto-insert owner trong cùng transaction).
   * ==========================================================================*/
  addOwner: async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    companyId: string,
    userId: string,
  ): Promise<CompanyMember> => {
    const [row] = await tx
      .insert(companyMembers)
      .values({
        companyId,
        userId,
        role: 'owner',
        status: 'active',
      })
      .returning();
    if (!row) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Không thể insert owner.');
    }
    return row;
  },

  /* ==========================================================================
   * Legacy helpers — GIỮ LẠI để tương thích với:
   *   - GET /companies/me (dùng findMembershipByUserId)
   *   - GET /companies/me/invites (dùng getPendingInvitesForUser — endpoint cũ)
   *   - job controller (dùng findMembershipByUserId để xác định owner của job)
   *
   * Các endpoint này KHÔNG thuộc invite lifecycle mới (case 1-11 ở trên), nhưng
   * vẫn cần chạy được. Nếu migrate xong có thể refactor FE rồi xoá sau.
   * ==========================================================================*/

  /**
   * Tìm row membership của user (status active hoặc ended: declined/removed/left/auto_cancelled)
   * — dùng cho /companies/me để biết user đang/đã từng thuộc company nào.
   *
   * Note: status enum đã đổi từ 'inactive' → 'declined' | 'removed' | 'left' | 'auto_cancelled'.
   * Endpoint cũ /companies/me chỉ cần biết user có thuộc company không — không
   * cần phân biệt chi tiết status ended.
   */
  findMembershipByUserId: async (
    userId: string,
  ): Promise<{ companyId: string } | null> => {
    const [row] = await db
      .select({ companyId: companyMembers.companyId })
      .from(companyMembers)
        .where(
            and(
                eq(companyMembers.userId, userId),
                eq(companyMembers.status, 'active')
            )
        )
      .limit(1);
    return row ?? null;
  },

  /**
   * Legacy: trả về pending invites của user (alias của listMyInvitations mới
   * — giữ để không break FE cũ. Return shape khớp với MyInvitationItem).
   */
  getPendingInvitesForUser: async (
    userId: string,
  ): Promise<MyInvitationItem[]> => {
    return companyMemberService.listMyInvitations(userId);
  },
};
