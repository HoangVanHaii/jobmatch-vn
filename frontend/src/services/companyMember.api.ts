/**
 * CompanyMember API — tầng giao tiếp với backend /api/companies/:id/members và
 * /api/companies/:id/transfer-owner.
 *
 * Format theo các api hiện có (auth/job/notification): trả thẳng AxiosResponse,
 * KHÔNG unwrap ở đây. Nơi gọi tự destruct `const { data } = await ...` rồi lấy `data.data`.
 *
 * Endpoint backend (router companyMember.ts):
 *   GET    /companies/:id/members              list members (owner thấy hết, member chỉ thấy active)
 *   POST   /companies/:id/members              owner thêm member
 *   PATCH  /companies/:companyId/members/:userId  owner đổi role/status
 *   POST   /companies/:companyId/members/:userId/accept  member tự accept lời mời
 *   POST   /companies/:id/transfer-owner       owner chuyển ownership
 *
 * Lỗi 401 đã do interceptor trong http.ts tự refresh token; các lỗi khác
 * tự reject để nơi gọi (store) catch.
 */
import { http } from './http';
import type {
  AddCompanyMemberPayload,
  CompanyMember,
  TransferCompanyOwnerPayload,
  TransferCompanyOwnerResult,
  UpdateCompanyMemberPayload,
} from '@/types/companyMember';

/** Backend luôn bọc response: { success: boolean, data: T } */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const companyMemberApi = {
  /** GET /companies/:id/members — owner thấy hết, member thường chỉ thấy active */
  list: (companyId: string) =>
    http.get<ApiResponse<CompanyMember[]>>(`/companies/${companyId}/members`),

  /** POST /companies/:id/members — owner thêm member (mặc định role=member, status=invited) */
  add: (companyId: string, data: AddCompanyMemberPayload) =>
    http.post<ApiResponse<CompanyMember>>(`/companies/${companyId}/members`, data),

  /** PATCH /companies/:companyId/members/:userId — owner đổi role/status */
  update: (companyId: string, userId: string, data: UpdateCompanyMemberPayload) =>
    http.patch<ApiResponse<CompanyMember>>(
      `/companies/${companyId}/members/${userId}`,
      data,
    ),

  /**
   * DELETE /companies/:companyId/members/:userId — owner xoá cứng member
   * khỏi công ty (hard delete row). Service emit notification `system` cho user
   * bị xoá.
   *
   * BE sẽ reject nếu:
   *   - 404 MEMBER_NOT_FOUND: row không tồn tại.
   *   - 400 CANNOT_REMOVE_OWNER: target là owner active (phải transfer trước).
   */
  remove: (companyId: string, userId: string) =>
    http.delete<ApiResponse<{ removedUserId: string; companyId: string }>>(
      `/companies/${companyId}/members/${userId}`,
    ),

  /**
   * POST /companies/:companyId/members/:userId/accept — member tự accept lời mời.
   *
   * BE controller check `req.user.userId !== :userId` để chặn user khác accept
   * giúp → phải truyền userId của chính user đang đăng nhập (lấy từ auth store).
   */
  acceptInvite: (companyId: string, userId: string) =>
    http.post<ApiResponse<CompanyMember>>(
      `/companies/${companyId}/members/${userId}/accept`,
    ),

  /**
   * POST /companies/:companyId/members/:userId/decline — member tự từ chối lời mời.
   * Mirror của acceptInvite; cùng cơ chế self-only check ở controller.
   */
  declineMyInvite: (companyId: string, userId: string) =>
    http.post<ApiResponse<CompanyMember>>(
      `/companies/${companyId}/members/${userId}/decline`,
    ),

  /**
   * POST /companies/:companyId/members/:userId/leave — member tự rời công ty
   * (soft delete: status active → left, set ended_at).
   *
   * Controller check self-only + service chặn last-owner (CANNOT_LEAVE_AS_LAST_OWNER).
   *
   * Lưu ý: BE endpoint trả về CompanyMember row đã update. FE chỉ cần
   * invalidate cache + navigate user về trang state 'no-company'.
   */
  leaveCompany: (companyId: string, userId: string) =>
    http.post<ApiResponse<CompanyMember>>(
      `/companies/${companyId}/members/${userId}/leave`,
    ),

  /** POST /companies/:id/transfer-owner — owner chuyển ownership (atomic swap) */
  transferOwner: (companyId: string, data: TransferCompanyOwnerPayload) =>
    http.post<ApiResponse<TransferCompanyOwnerResult>>(
      `/companies/${companyId}/transfer-owner`,
      data,
    ),
};
