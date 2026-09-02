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

  /**
   * Cập nhật avatar URL — POST /auth/change-avatar.
   *
   * Flow chuẩn cho caller:
   *   1. Upload file ảnh qua `uploadStore.uploadImage(file, 'avatars')`
   *      → trả `{ url, key, mime, size }`.
   *   2. Gọi `changeAvatar(url)` để persist URL mới vào `user_profiles.avatar_url`.
   *   3. Update local state (auth store + profile view) để UI phản ánh ngay.
   *
   * Backend dùng `authService.changeAvatar` (backend/src/service/auth.service.ts),
   * tự insert row mới nếu `user_profiles` chưa tồn tại — không cần user tạo
   * profile trước.
   *
   * Response backend: `{ success: true, message: 'Avatar updated successfully' }`.
   * Method này không trả data hữu ích — chỉ cần success/fail (fail throw error).
   */
  changeAvatar: (avatarUrl: string) =>
    http.post<ApiResponse<{ message: string }>>('/auth/change-avatar', { avatarUrl }),

  /**
   * Đổi mật khẩu cho user đang đăng nhập — POST /auth/change-password.
   *
   * Caller (vd SettingsModal) phải validate client-side trước:
   *   - newPassword.length >= 8 (đồng bộ với backend schema).
   *   - confirm === newPassword (FE-only check, không gửi confirm lên BE).
   *
   * Backend flow:
   *   1. Verify currentPassword qua bcrypt → 401 INVALID_PASSWORD nếu sai.
   *   2. Reject nếu newPassword === currentPassword → 400 SAME_PASSWORD.
   *   3. Hash + update `users.passwordHash`.
   *
   * Response backend: `{ success: true, message: 'Đổi mật khẩu thành công' }`.
   *
   * Sau khi đổi thành công:
   *   - User vẫn dùng accessToken cũ (BE chỉ rotate refresh token ở /refresh).
   *   - Không tự động logout — UX tốt hơn vì user đang trong flow cài đặt.
   *   - Tuy nhiên, nếu muốn ép đăng nhập lại ngay → FE tự gọi auth.logout() +
   *     router.push('/login') sau toast.
   */
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<ApiResponse<{ message: string }>>('/auth/change-password', {
      currentPassword,
      newPassword,
    }),
};
