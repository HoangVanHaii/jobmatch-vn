/**
 * Skills API — tầng giao tiếp với backend /api/skills.
 *
 * Format theo các api hiện có (auth/job/notification/company): trả thẳng
 * AxiosResponse, KHÔNG unwrap ở đây. Nơi gọi tự destruct
 * `const { data } = await ...` rồi lấy `data.data`.
 *
 * Endpoint backend (router skills.ts):
 *   GET    /skills                list (optionalAuth, admin có thể ?includeDeleted=true)
 *   GET    /skills/slug/:slug     chi tiết theo slug
 *   GET    /skills/:skillId       chi tiết theo id
 *   POST   /skills                tạo (admin)
 *   PATCH  /skills/:skillId       cập nhật name/slug (admin)
 *   DELETE /skills/:skillId       soft delete — set status='deleted' (admin)
 *
 * Lỗi 401 đã do interceptor trong http.ts tự refresh token; các lỗi khác
 * tự reject để nơi gọi (store) catch.
 */
import { http } from './http';
import type {
  CreateSkillPayload,
  ListSkillsQuery,
  Skill,
  UpdateSkillPayload,
} from '@/types/skills';

/** Backend luôn bọc response: { success: boolean, data: T } */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const skillsApi = {
  /** GET /skills — danh sách skills active (admin có thể ?includeDeleted=true). */
  list: (params?: ListSkillsQuery) =>
    http.get<ApiResponse<Skill[]>>('/skills', { params }),

  /** GET /skills/slug/:slug — chi tiết theo slug. */
  getBySlug: (slug: string) =>
    http.get<ApiResponse<Skill>>(`/skills/slug/${slug}`),

  /** GET /skills/:skillId — chi tiết theo id. */
  getById: (skillId: string) =>
    http.get<ApiResponse<Skill>>(`/skills/${skillId}`),

  /** POST /skills — admin tạo skill mới. */
  create: (data: CreateSkillPayload) =>
    http.post<ApiResponse<Skill>>('/skills', data),

  /** PATCH /skills/:skillId — admin cập nhật (name/slug). */
  update: (skillId: string, data: UpdateSkillPayload) =>
    http.patch<ApiResponse<Skill>>(`/skills/${skillId}`, data),

  /** DELETE /skills/:skillId — admin soft-delete (set status='deleted'). */
  delete: (skillId: string) =>
    http.delete<ApiResponse<{ id: string }>>(`/skills/${skillId}`),
};