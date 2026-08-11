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
 *   POST   /companies/:companyId/members/me/accept  member tự accept lời mời
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

  /** POST /companies/:companyId/members/me/accept — member tự accept lời mời */
  acceptInvite: (companyId: string) =>
    http.post<ApiResponse<CompanyMember>>(
      `/companies/${companyId}/members/me/accept`,
    ),

  /** POST /companies/:id/transfer-owner — owner chuyển ownership (atomic swap) */
  transferOwner: (companyId: string, data: TransferCompanyOwnerPayload) =>
    http.post<ApiResponse<TransferCompanyOwnerResult>>(
      `/companies/${companyId}/transfer-owner`,
      data,
    ),
};
