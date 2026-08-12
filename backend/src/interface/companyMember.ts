/**
 * CompanyMember — API types/interfaces (input/output contract)
 *
 * File này CHỈ chứa TypeScript types/interfaces mô tả dữ liệu API vào/ra.
 * KHÔNG chứa Zod schema, validation rule, hay validation middleware.
 *
 * - Model types `CompanyMember`, `CompanyMemberRole`, `CompanyMemberStatus` derive từ Drizzle.
 * - Mỗi endpoint có 1 response interface riêng (1 API = 1 response type).
 * - Input types (`AddCompanyMemberInput`, ...) khai báo tường minh (KHÔNG dùng `z.infer`)
 *   để giữ `interface` độc lập với `middleware`.
 *
 * Nghiệp vụ: 1 công ty CHỈ CÓ 1 OWNER DUY NHẤT.
 *   - Add member: chỉ thêm được role='member' (owner phải dùng POST /:id/transfer-owner).
 *   - Update: KHÔNG cho đổi status/role của owner.
 *   - Transfer owner: atomic swap giữa owner hiện tại và 1 member active khác.
 */
import type { companyMembers } from '../db/schema/companyMembers';

/** Model CompanyMember (1 dòng trong bảng company_members) — derive từ Drizzle schema */
export type CompanyMember = typeof companyMembers.$inferSelect;
export type CompanyMemberRole = CompanyMember['role'];
export type CompanyMemberStatus = CompanyMember['status'];

/**
 * Body POST /companies/:id/members — owner thêm member.
 * role CHỈ được là 'member'. Nếu muốn thêm owner phải dùng transfer-owner.
 *
 * Sau Zod validate, `role` và `status` luôn có giá trị (Zod áp default
 * 'member' / 'invited'). Type dùng cho service phải là required để khớp với
 * shape thực tế sau khi middleware đã parse.
 */
export interface AddCompanyMemberInput {
  userId: string;
  role: CompanyMemberRole;
  status: CompanyMemberStatus;
}

/**
 * Body PATCH /companies/:companyId/members/:userId — đổi role/status.
 * KHÔNG cho phép đổi status của owner.
 * KHÔNG cho phép đổi role thành 'owner' (phải dùng transfer-owner).
 */
export interface UpdateCompanyMemberInput {
  role?: CompanyMemberRole;
  status?: CompanyMemberStatus;
}

/**
 * Body POST /companies/:id/transfer-owner — chuyển ownership.
 */
export interface TransferOwnerInput {
  newOwnerUserId: string;
}

/**
 * Params /companies/:companyId/members/:userId
 */
export interface CompanyMemberParams {
  companyId: string;
  userId: string;
}

/**
 * Params /companies/:id/members và /companies/:id/transfer-owner (chỉ cần id).
 */
export interface CompanyIdParam {
  id: string;
}

/**
 * Params /companies/:companyId/members/me/accept (chỉ cần companyId).
 */
export interface CompanyIdOnlyParam {
  companyId: string;
}

/**
 * Response của GET /companies/:id/members
 * - owner thấy tất cả members (mọi status)
 * - member chỉ thấy active
 * - người ngoài: []
 */
export type ListCompanyMembersResponse = CompanyMember[];

/**
 * Response của POST /companies/:id/members — member vừa được thêm
 */
export type AddCompanyMemberResponse = CompanyMember;

/**
 * Response của PATCH /companies/:companyId/members/:userId — member sau khi update
 */
export type UpdateCompanyMemberResponse = CompanyMember;

/**
 * Response của POST /companies/:companyId/members/me/accept — member sau khi accept
 */
export type AcceptCompanyMemberInviteResponse = CompanyMember;

/**
 * Response của POST /companies/:id/transfer-owner — kết quả atomic swap
 */
export interface TransferCompanyOwnerResponse {
  newOwner: CompanyMember;
  previousOwner: CompanyMember;
}
