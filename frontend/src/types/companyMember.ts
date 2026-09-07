/**
 * CompanyMember types — đồng bộ với backend (company_members schema + controller response).
 * Frontend dùng các type này làm contract khi gọi companyMemberApi.
 */

/** Role của 1 member trong công ty (enum company_member_role ở DB) */
export type CompanyMemberRole = 'owner' | 'member';

/**
 * Trạng thái membership (enum company_member_status ở DB — xem
 * backend/src/db/schema/enums.ts + migration 0026).
 *
 * Lifecycle:
 *   pending        → user vừa được mời
 *   active         → user accept, đang là thành viên
 *   declined       → user từ chối lời mời
 *   removed        → owner xoá (soft delete)
 *   left           → user tự rời (soft delete)
 *   auto_cancelled → user accept invite ở company khác, invite này bị huỷ
 */
export type CompanyMemberStatus =
  | 'pending'
  | 'active'
  | 'declined'
  | 'removed'
  | 'left'
  | 'auto_cancelled';

/**
 * Thông tin user đính kèm trong CompanyMember — subset public của User, đủ để
 * UI hiển thị name + email + avatar mà không cần lookup riêng.
 * `fullName` / `avatarUrl` nullable (user chưa cập nhật profile).
 * Field `user` ở CompanyMember cũng nullable nếu user account bị xoá.
 */
export interface CompanyMemberUserInfo {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

/**
 * Một dòng trong bảng company_members — BE trả kèm user info từ
 * listByCompany / accept / decline / remove / leave.
 *
 * Khớp với BE service listByCompany trả về (xem
 * backend/src/service/companyMember.service.ts).
 */
export interface CompanyMember {
  /** PK đơn — thêm ở migration 0027. */
  id: string;
  companyId: string;
  userId: string;
  role: CompanyMemberRole;
  status: CompanyMemberStatus;
  /** User nào đã gửi invite — null nếu owner tự tạo hoặc row cũ. */
  invitedBy?: string | null;
  /** Thời điểm được mời (= thời điểm row được insert/update). */
  invitedAt: string;
  /** Lần cuối user phản hồi invite — null nếu chưa phản hồi. */
  respondedAt: string | null;
  /** Lần membership kết thúc (removed/left) — null khi đang active/pending. */
  endedAt: string | null;
  updatedAt: string;
  /** Optional — chỉ có ở response của listByCompany/accept. Null nếu user bị xoá. */
  user?: CompanyMemberUserInfo | null;
}

/**
 * Body POST /companies/:id/members — owner thêm member.
 * Dùng `email` (không phải userId) — BE sẽ lookup user từ email và throw
 * `USER_NOT_FOUND` 404 nếu email chưa đăng ký.
 *
 * role CHỈ được là 'member' (Zod middleware khóa literal — invite 'owner'
 * phải đi qua flow transfer riêng).
 *
 * Status KHÔNG có ở payload — BE luôn set = 'pending' khi insert/re-invite.
 * (Trước đây FE có gửi kèm status → BE Zod reject vì field không có trong
 * schema. Đã fix bằng cách bỏ field khỏi type + bỏ khỏi submitInvite.)
 */
export interface AddCompanyMemberPayload {
  email: string;
  role: CompanyMemberRole;
}

/** Body PATCH /companies/:companyId/members/:userId — đổi role/status */
export interface UpdateCompanyMemberPayload {
  role?: CompanyMemberRole;
  status?: CompanyMemberStatus;
}

/** Body POST /companies/:id/transfer-owner — chuyển ownership */
export interface TransferCompanyOwnerPayload {
  newOwnerUserId: string;
}

/** Response của POST /companies/:id/transfer-owner — atomic swap */
export interface TransferCompanyOwnerResult {
  newOwner: CompanyMember;
  previousOwner: CompanyMember;
}
