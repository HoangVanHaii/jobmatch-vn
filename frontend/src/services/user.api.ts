/**
 * User API — search user theo tên để start chat.
 *
 * Endpoint: GET /users/search?q=<name>&limit=<n>
 *
 * Service ở đây CHỈ gói axios + unwrap response — không bind state, không search
 * debounce; caller (ConversationList.vue) tự quản lý debounce + UI.
 *
 * Pattern theo chat.api.ts: trả AxiosResponse; caller tự destruct
 *   `const { data } = await ...; data.data`.
 */
import { http } from './http';

/** Response shape — đồng bộ với backend `UserSearchResult`.
 *  CHỈ chứa field cần cho chat UI: id + fullName + avatarUrl + role.
 *  Không leak email/status/metadata. */
export interface UserSearchResult {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: 'candidate' | 'employer' | 'admin';
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const userApi = {
  /**
   * Tìm user theo fullName (case-insensitive substring).
   * @param q      chuỗi tìm (1–100 ký tự — backend trim)
   * @param limit  số kết quả tối đa (1–50, default 20 — backend coerce + default)
   * @param signal AbortSignal để caller cancel khi user gõ tiếp
   */
  search: (q: string, limit = 20, signal?: AbortSignal) =>
    http.get<ApiResponse<UserSearchResult[]>>('/users/search', {
      params: { q, limit },
      signal,
    }),
};
