/**
 * CompanyMember — API types/interfaces (input/output contract).
 *
 * File này CHỈ chứa TypeScript types/interfaces mô tả dữ liệu API vào/ra.
 * KHÔNG chứa Zod schema, validation rule, hay validation middleware.
 *
 * Model types `CompanyMember` derive từ Drizzle schema (`companyMembers`).
 * Status lifecycle (1 row per (company_id, user_id), reuse qua mọi vòng đời):
 *
 *   pending → user accept → active
 *          → user decline → declined
 *          → user accept invite khác → auto_cancelled
 *   active  → owner xoá → removed
 *          → user tự rời → left
 *
 * Endpoint mapping (xem router/companyMember.ts):
 *   POST   /companies/:companyId/members/invite            (owner invite)
 *   POST   /companies/:companyId/members/:userId/accept  (user accept)
 *   POST   /companies/:companyId/members/:userId/decline (user decline)
 *   DELETE /companies/:companyId/members/:userId          (owner remove)
 *   POST   /companies/:companyId/members/:userId/leave    (user tự rời)
 *   GET    /companies/me/invitations                       (user list pending invites)
 *   GET    /companies/:companyId/members                   (list members)
 */
import type { companyMembers } from '../db/schema/companyMembers';

/* ============================================================================
 * Model types — derive từ Drizzle
 * ==========================================================================*/
export type CompanyMember = typeof companyMembers.$inferSelect;
export type CompanyMemberRole = CompanyMember['role'];
export type CompanyMemberStatus = CompanyMember['status'];

/* ============================================================================
 * Error codes — dùng thống nhất giữa service throw + controller response.
 *
 * Format: APP_ERROR_CODE (UPPER_SNAKE).
 * ==========================================================================*/
export const CompanyMemberErrorCode = {
  /** User đang được mời đã tồn tại với status='pending' */
  ALREADY_PENDING: 'ALREADY_PENDING',
  /** User đã là thành viên active của công ty này */
  ALREADY_ACTIVE: 'ALREADY_ACTIVE',
  /** User đang active ở 1 công ty khác — phải rời trước */
  ALREADY_ACTIVE_ELSEWHERE: 'ALREADY_ACTIVE_ELSEWHERE',
  /** Owner tự mời chính mình */
  CANNOT_INVITE_SELF: 'CANNOT_INVITE_SELF',
  /** Row status không phải 'pending' — không thể accept/decline */
  INVITATION_NOT_PENDING: 'INVITATION_NOT_PENDING',
  /** User tự rời nhưng là owner duy nhất */
  CANNOT_LEAVE_AS_LAST_OWNER: 'CANNOT_LEAVE_AS_LAST_OWNER',
  /** Owner xoá owner cuối cùng */
  CANNOT_REMOVE_OWNER: 'CANNOT_REMOVE_OWNER',
  /** Row status không phải 'active' — không thể remove/leave */
  NOT_ACTIVE: 'NOT_ACTIVE',
  /** User không có row pending — không thể accept/decline */
  NO_PENDING_INVITATION: 'NO_PENDING_INVITATION',
  /** Email lookup không ra user (chưa đăng ký) */
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  /** Member row không tồn tại cho (companyId, userId) */
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  /** Caller không phải owner active của company */
  FORBIDDEN_NOT_OWNER: 'FORBIDDEN_NOT_OWNER',
  /** Caller không phải member active của company */
  FORBIDDEN_NOT_MEMBER: 'FORBIDDEN_NOT_MEMBER',
  /** Caller cố transfer ownership cho chính mình */
  CANNOT_TRANSFER_TO_SELF: 'CANNOT_TRANSFER_TO_SELF',
  /** Caller cố transfer cho user đã là owner (no-op) */
  CANNOT_TRANSFER_TO_OWNER: 'CANNOT_TRANSFER_TO_OWNER',
  /**
   * User được mời đang active ở 1 công ty khác — không thể mời user này
   * vì user sẽ không accept được (BE accept cũng reject với cùng lý do).
   * Dùng để fail-fast ở invite (thay vì để user nhận notification rồi mới báo lỗi).
   */
  USER_ACTIVE_ELSEWHERE: 'USER_ACTIVE_ELSEWHERE',
  /**
   * User được mời không phải employer/admin (vd role='candidate').
   * Company chỉ dành cho nhà tuyển dụng + admin; invite candidate là vô nghĩa
   * và spam notification nhầm vai trò.
   */
  USER_NOT_EMPLOYER: 'USER_NOT_EMPLOYER',
  /**
   * User tồn tại nhưng không thể hoạt động (status ≠ 'active': pending
   * chưa verify email, suspended, banned). Tách riêng USER_NOT_EMPLOYER
   * vì lý do fail khác nhau → FE render message khác nhau.
   */
  USER_NOT_ACTIVE: 'USER_NOT_ACTIVE',
} as const;
export type CompanyMemberErrorCode =
  (typeof CompanyMemberErrorCode)[keyof typeof CompanyMemberErrorCode];

/* ============================================================================
 * Subset thông tin user — để hiển thị name/email/avatar trên UI list members
 * (qua JOIN users + user_profiles trong listByCompany).
 * ==========================================================================*/
export interface CompanyMemberUserInfo {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

/** CompanyMember enriched với thông tin user. */
export type CompanyMemberWithUser = CompanyMember & {
  user: CompanyMemberUserInfo | null;
};

/* ============================================================================
 * Input types (tường minh, KHÔNG dùng z.infer) — match với Zod middleware
 * ==========================================================================*/

/** POST /companies/:companyId/members/invite — body gửi email + role. */
export interface InviteMemberBody {
  email: string;
  role?: CompanyMemberRole;
}

/** Path params cho endpoints có :userId (accept/decline/remove/leave). */
export interface CompanyMemberUserParams {
  companyId: string;
  userId: string;
}

/** Path params cho /:companyId/members (list, invite) và /:companyId/transfer-owner. */
export interface CompanyIdParams {
  companyId: string;
}

/** Body POST /companies/:companyId/transfer-owner — đổi owner cho user khác. */
export interface TransferCompanyOwnerBody {
  newOwnerUserId: string;
}

/* ============================================================================
 * Response types — 1 endpoint = 1 response type
 * ==========================================================================*/

/** Response của POST /companies/:companyId/members/invite — row sau khi invite (mới hoặc re-invite). */
export type InviteMemberResponse = CompanyMember;

/** Response của POST /companies/:companyId/members/:userId/accept — membership sau khi active. */
export type AcceptInvitationResponse = CompanyMemberWithUser & {
  /** Số pending invites bị auto_cancelled ở các company khác (do user có thể đang có
   *  pending invite ở nhiều nơi). */
  autoCancelledCount: number;
};

/** Response của POST /companies/:companyId/members/:userId/decline. */
export type DeclineInvitationResponse = CompanyMember;

/** Response của DELETE /companies/:companyId/members/:userId — soft delete row. */
export type RemoveMemberResponse = CompanyMember;

/** Response của POST /companies/:companyId/members/:userId/leave. */
export type LeaveCompanyResponse = CompanyMember;

/** Response của POST /companies/:companyId/transfer-owner — 2 row sau atomic swap. */
export interface TransferCompanyOwnerResult {
  /** Row sau khi promote (target user). */
  newOwner: CompanyMember;
  /** Row sau khi demote (caller — current owner). */
  previousOwner: CompanyMember;
}

/** Response của GET /companies/me/invitations — danh sách pending invites của user hiện tại. */
export interface MyInvitationItem {
  /** ID của row company_members. */
  id: string;
  /** ID của company. */
  companyId: string;
  /** Tên công ty (lookup qua JOIN companies). */
  companyName: string;
  /** Logo công ty (nullable). */
  companyLogoUrl: string | null;
  /** Industry / sizeRange cho UI context. */
  companyIndustry: string | null;
  companySizeRange: string | null;
  /** Role mà user được mời vào. */
  role: CompanyMemberRole;
  /** Thời điểm được mời (ISO 8601). */
  invitedAt: string;
  /** Email của người mời (owner) — null nếu row cũ trước migration 0025. */
  invitedBy: { userId: string; email: string; fullName: string | null } | null;
}
export type MyInvitationsResponse = MyInvitationItem[];

/** Response của GET /companies/:companyId/members — list members enriched. */
export type ListCompanyMembersResponse = CompanyMemberWithUser[];

/* ============================================================================
 * Error response shape (extend base AppError nếu cần — đặt tại đây để
 * service/controller import trực tiếp).
 * ==========================================================================*/
export interface InviteErrorDetails {
  /** Khi ALREADY_ACTIVE_ELSEWHERE — thông tin company đang active. */
  activeCompany?: { id: string; name: string };
  /** Khi ALREADY_PENDING/ALREADY_ACTIVE — trạng thái row hiện tại. */
  currentStatus?: CompanyMemberStatus;
}
