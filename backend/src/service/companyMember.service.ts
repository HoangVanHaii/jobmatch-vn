/**
 * CompanyMember service — business logic cho bảng company_members.
 * Cấu trúc giống companyService: mỗi hàm nằm trong object export.
 * Không có hard delete — chỉ updateStatus (active / invited / inactive).
 * companyService.create() tự insert owner trong cùng transaction tạo company.
 *
 * Nghiệp vụ: 1 công ty CHỈ CÓ 1 OWNER DUY NHẤT.
 *   - countOwners: đếm owner active hiện tại.
 *   - validateAddRole: chặn add role='owner' khi đã có owner.
 *   - updateMember: tự validate khi đổi role/status (chặn promote / khóa status owner / chặn demote owner cuối).
 *   - transferOwner: atomic swap ownership.
 */
import { db } from '../config/database';
import { companyMembers } from '../db/schema';
import { and, eq, or } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import type { CompanyMember } from '../interface/companyMember';
import type {
  AddCompanyMemberInput,
  TransferOwnerInput,
  UpdateCompanyMemberInput,
} from '../interface/companyMember';
import { notificationService } from './notification.service';

/**
 * Map DB unique violation của index "1 user = 1 company" → AppError 409.
 * Index: uniq_company_members_one_active_membership (user_id WHERE status IN active/inactive).
 * Trả về never (luôn throw) — caller để catch (err) { mapMembershipUniqueError(err); } sạch type.
 *
 * Tách ra để 5 nhánh ghi (addOwner, inviteMember, updateMember, updateStatus, acceptInvite)
 * đều map 23505 về cùng 1 AppError — tránh 500 raw khi race.
 */
const MEMBERSHIP_CONSTRAINT = 'uniq_company_members_one_active_membership';
const mapMembershipUniqueError = (err: unknown): never => {
  if (
    err !== null &&
    typeof err === 'object' &&
    (err as { code?: string }).code === '23505' &&
    (err as { constraint?: string }).constraint === MEMBERSHIP_CONSTRAINT
  ) {
    throw new AppError(409, 'ALREADY_IN_COMPANY', 'User đã thuộc một công ty khác');
  }
  throw err;
};

export const companyMemberService = {
  /** Lấy 1 thành viên theo (companyId, userId) */
  getByCompanyAndUser: async ( companyId: string, userId: string): Promise<CompanyMember | null> => {
    const [row] = await db
      .select()
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, userId),
        ),
      );
    return row ?? null;
  },
  
  findMembershipByUserId: async (userId: string): Promise<{ companyId: string } | null> => {
    const [row] = await db
      .select({ companyId: companyMembers.companyId })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.userId, userId),
          or(
            eq(companyMembers.status, 'active'),
            eq(companyMembers.status, 'inactive')
          )
        )
      );
    return row ?? null;
  },

  /**
   * Liệt kê members của 1 công ty.
   * Tự query role của viewer từ DB (không nhận param role):
   *   - Nếu viewer là owner → trả tất cả member (mọi status).
   *   - Nếu viewer là member thường → chỉ trả active member (ẩn invited/inactive).
   *   - Nếu viewer không thuộc công ty → trả mảng rỗng.
   */
  listByCompany: async (companyId: string, viewerUserId: string ): Promise<CompanyMember[]> => {
    const viewer = await db.query.companyMembers.findFirst({
      where: and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.userId, viewerUserId),
      ),
      columns: { role: true, status: true },
    });

    if (!viewer || viewer.status !== 'active') return [];

    if (viewer.role === "owner") {
      return db
        .select()
        .from(companyMembers)
        .where(eq(companyMembers.companyId, companyId));
    }

    return db
      .select()
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.status, "active"),
        ),
      );
  },
  addOwner: async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    companyId: string,
    userId: string
  ): Promise<CompanyMember> => {
    try {
      const [row] = await tx
        .insert(companyMembers)
        .values({ companyId, userId, role: 'owner', status: 'active' })
        .returning();
      return row;
    } catch (err) {
      return mapMembershipUniqueError(err);
    }
  },
  inviteMember: async (
    input: AddCompanyMemberInput & {
      companyId: string;
      companyName: string;
      invitedBy: string;
    },
  ): Promise<CompanyMember> => {
    try {
      const { member, notif } = await db.transaction(async (tx) => {
        // 1. Core write
        const [member] = await tx
          .insert(companyMembers)
          .values({
            companyId: input.companyId,
            userId: input.userId,
            role: input.role,
            status: input.status,
          })
          .returning();

        // 2. Notification row — cùng tx → atomic với member
        const notif = await notificationService.createInTx(tx, {
          userId: input.userId,
          type: "company_invite",
          title: `Lời mời tham gia ${input.companyName}`,
          payload: {
            companyId: input.companyId,
            companyName: input.companyName,
            role: input.role,
            invitedBy: input.invitedBy
          }
        })
        return { member, notif };
      });

      // 3. Socket emit — chỉ chạy khi tx đã commit
      notificationService.emit(notif);

      return member;
    } catch (err) {
      return mapMembershipUniqueError(err);
    }
  },
  /**
   * Cập nhật role/status của 1 member.
   * Toàn bộ business validation (bảo vệ rule "1 owner active duy nhất") nằm ở đây —
   * controller chỉ gọi hàm này rồi xử lý null. Member được query 1 lần cho mọi check:
   *   1. Member không phải owner + input.role='owner'     → ONLY_ONE_OWNER (phải dùng transfer-owner)
   *   2. Owner + input đổi status sang khác 'active'       → OWNER_STATUS_LOCKED (owner luôn active)
   *   3. Owner + input.role='member' mà là owner duy nhất  → LAST_OWNER (còn owner khác thì cho phép)
   */
  updateMember: async (
    companyId: string,
    userId: string,
    input: UpdateCompanyMemberInput,
  ): Promise<CompanyMember | null> => {
    const member = await companyMemberService.getByCompanyAndUser(companyId, userId);
    if (!member) return null;

    // 1. Promote member lên owner → chặn (phải qua transferOwner)
    if (member.role !== 'owner' && input.role === 'owner') {
      throw new AppError(400, 'ONLY_ONE_OWNER', 'Công ty chỉ có 1 owner duy nhất');
    }

    // 2. Owner luôn active → chặn đổi status của owner sang khác active
    if (member.role === 'owner' && input.status !== undefined && input.status !== 'active') {
      throw new AppError( 400, 'OWNER_STATUS_LOCKED', 'Owner luôn phải có status là active. Không thể đổi status của owner.');
    }

    // 3. Demote owner → member: chỉ cho phép khi công ty còn owner khác
    if (member.role === 'owner' && input.role === 'member') {
      const ownerCount = await companyMemberService.countOwners(companyId);
      if (ownerCount === 1) {
        throw new AppError(400, 'LAST_OWNER', 'Công ty phải có ít nhất 1 owner.');
      }
    }

    try {
      const [row] = await db
        .update(companyMembers)
        .set(input)
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.userId, userId),
          ),
        )
        .returning();
      return row ?? null;
    } catch (err) {
      return mapMembershipUniqueError(err);
    }
  },

  /** Đổi status của 1 member (active / invited / inactive) */
  updateStatus: async (
    companyId: string,
    userId: string,
    status: CompanyMember["status"],
  ): Promise<CompanyMember | null> => {
    try {
      const [row] = await db
        .update(companyMembers)
        .set({ status })
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.userId, userId),
          ),
        )
        .returning();
      return row ?? null;
    } catch (err) {
      return mapMembershipUniqueError(err);
    }
  },

  /** Đếm tổng owner (active) của 1 công ty.
   *  Nghiệp vụ: chỉ có 1 owner duy nhất → dùng để validate.
   */
  countOwners: async (companyId: string): Promise<number> => {
    const rows = await db
      .select({ userId: companyMembers.userId })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.role, "owner"),
          eq(companyMembers.status, "active"),
        ),
      );
    return rows.length;
  },

  /**
   * Validate trước khi thêm member.
   * Nếu role='owner' và đã có owner → throw ONLY_ONE_OWNER.
   * (Schema đã chặn owner + status≠active, nên service chỉ cần check số lượng.)
   */
  validateAddRole: async ( companyId: string, role: CompanyMember["role"]): Promise<void> => {
    if (role !== "owner") return;
    const ownerCount = await companyMemberService.countOwners(companyId);
    if (ownerCount >= 1) {
      throw new AppError( 400, "ONLY_ONE_OWNER","Công ty chỉ có 1 owner duy nhất ");
    }
  },

  /**
   * Member tự accept lời mời: invited → active.
   * Trả về null nếu user không có lời mời đang pending (không thuộc công ty).
   * Service không tự throw — controller sẽ check null và trả 404.
   */
  acceptInvite: async ( companyId: string, userId: string): Promise<CompanyMember | null> => {
    try {
      const [row] = await db
        .update(companyMembers)
        .set({ status: "active" })
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.userId, userId),
            eq(companyMembers.status, "invited"),
          ),
        )
        .returning();
      return row ?? null;
    } catch (err) {
      return mapMembershipUniqueError(err);
    }
  },

  /**
   * Transfer ownership: atomic swap (toàn bộ validate + update trong 1 transaction).
   *   - newOwner.role = 'owner' (status giữ nguyên — phải là 'active')
   *   - currentOwner.role = 'member', status = 'active'
   *
   * Thứ tự update: demote current owner TRƯỚC, promote new owner SAU — tránh 2 active
   * owner giữa 2 statement (vi phạm partial unique index uniq_company_members_one_active_owner).
   *
   * Validate (trong tx — chống TOCTOU):
   *   - newOwner tồn tại, là member active, không phải owner, không phải chính caller
   *   - currentUser phải là owner của company
   *
   * Lỗi trả về (throw AppError):
   *   - 404 MEMBER_NOT_FOUND: newOwner không thuộc company
   *   - 400 ALREADY_OWNER: newOwner đã là owner
   *   - 400 NOT_ACTIVE: newOwner status ≠ 'active'
   *   - 400 SELF_TRANSFER: newOwner là chính caller
   *   - 403 NOT_OWNER: caller không phải owner
   *   - 409 ONLY_ONE_OWNER: race condition (concurrent transfer) bị DB index chặn
   */
  transferOwner: async ( companyId: string, currentUserId: string, input: TransferOwnerInput): Promise<{ newOwner: CompanyMember; previousOwner: CompanyMember }> => {
    // 1. Validate newOwner
    if (input.newOwnerUserId === currentUserId) {
      throw new AppError( 400, "SELF_TRANSFER", "Không thể transfer owner cho chính mình");
    }

    // 2. Validate + swap bên trong transaction (chống TOCTOU: read→validate→write cùng tx).
    //    Đọc lại newOwner/currentOwner bằng `tx` để thấy state nhất quán.
    try {
      return await db.transaction(async (tx) => {
        const [newOwner] = await tx
          .select()
          .from(companyMembers)
          .where(
            and(
              eq(companyMembers.companyId, companyId),
              eq(companyMembers.userId, input.newOwnerUserId),
            ),
          );
        if (!newOwner) {
          throw new AppError( 404, "MEMBER_NOT_FOUND", "Người nhận không phải member của công ty");
        }
        if (newOwner.role === "owner") {
          throw new AppError(400, "ALREADY_OWNER", "Người nhận đã là owner");
        }
        if (newOwner.status !== "active") {
          throw new AppError(400, "NOT_ACTIVE", "Người nhận phải là member active");
        }

        const [currentOwner] = await tx
          .select()
          .from(companyMembers)
          .where(
            and(
              eq(companyMembers.companyId, companyId),
              eq(companyMembers.userId, currentUserId),
            ),
          );
        if (!currentOwner || currentOwner.role !== "owner") {
          throw new AppError( 403, "NOT_OWNER", "Chỉ owner mới có thể transfer ownership");
        }

        // Quan trọng: demote current owner TRƯỚC, promote new owner SAU.
        // Partial unique index (uniq_company_members_one_active_owner) chỉ chứa row
        // (owner, active). Nếu promote trước → có 2 row trong index giữa 2 statement
        // → unique violation dù kết quả cuối đúng. Demote trước → 1→0→1, an toàn.
        const [prevOwnerRow] = await tx
          .update(companyMembers)
          .set({ role: "member", status: "active" })
          .where(
            and(
              eq(companyMembers.companyId, companyId),
              eq(companyMembers.userId, currentUserId),
            ),
          )
          .returning();

        const [newOwnerRow] = await tx
          .update(companyMembers)
          .set({ role: "owner" })
          .where(
            and(
              eq(companyMembers.companyId, companyId),
              eq(companyMembers.userId, input.newOwnerUserId),
            ),
          )
          .returning();

        return { newOwner: newOwnerRow, previousOwner: prevOwnerRow };
      });
    } catch (err) {
      // Race condition (vd: 2 transfer chạy chồng nhau): DB partial unique index chặn
      // → PostgreSQL error 23505. Map thành AppError rõ ràng thay vì leak raw error.
      if (
        err !== null &&
        typeof err === "object" &&
        (err as { code?: string }).code === "23505" &&
        (err as { constraint?: string }).constraint ===
          "uniq_company_members_one_active_owner"
      ) {
          throw new AppError(409, "ONLY_ONE_OWNER", "Công ty chỉ có 1 owner duy nhất. Vui lòng thử lại.");
      }
      throw err;
    }
  },
};
