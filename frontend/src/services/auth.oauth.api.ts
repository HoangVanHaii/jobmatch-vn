/**
 * OAuth API — Google, Facebook, GitHub
 */
import { http } from './http';

export type OAuthProvider = 'google' | 'facebook' | 'github';
export type OAuthRole = 'candidate' | 'employer';

/** Profile summary BE trả khi OAuth user mới — để hiển thị ở Select Role UI. */
export interface OAuthProfilePreview {
  name: string;
  email: string;
  avatarUrl: string;
  provider: OAuthProvider;
}

/**
 * Discriminated union — FE check `status` để dispatch:
 *   - EXISTING_USER → set tokens, push về home
 *   - NEW_USER → lưu pendingToken, push tới /select-role
 */
export type OAuthCallbackResult =
  | {
      status: 'EXISTING_USER';
      user: { id: string; email: string; role: 'candidate' | 'employer' | 'admin' };
      accessToken: string;
      refreshToken: string;
    }
  | {
      status: 'NEW_USER';
      pendingToken: string;
      profile: OAuthProfilePreview;
    };

export const oauthApi = {
  /** Bắt đầu OAuth flow — backend trả authorization URL + state */
  initiate: (provider: OAuthProvider, codeChallenge: string) =>
    http.post<{ success: true; data: { url: string } }>(`/auth/oauth/${provider}`, { codeChallenge }),

  /** Sau khi provider redirect về SPA, gửi code + PKCE verifier lên backend.
   *  Response là discriminated union — check `status` để xử lý tiếp. */
  callback: (provider: OAuthProvider, code: string, codeVerifier: string, state: string) =>
    http.post<{ success: true; data: OAuthCallbackResult }>(
      `/auth/oauth/${provider}/callback`,
      { code, codeVerifier, state },
    ),

  /** Hoàn tất đăng ký OAuth user mới với Role đã chọn ở /select-role.
   *  Trả về giống login: { user, accessToken, refreshToken }. */
  completeRegistration: (pendingToken: string, role: OAuthRole) =>
    http.post<{
      success: true;
      data: { user: { id: string; email: string; role: 'candidate' | 'employer' | 'admin' }; accessToken: string; refreshToken: string };
    }>('/auth/oauth/complete', { pendingToken, role }),

  /** List các OAuth đã link */
  listLinked: () => http.get('/auth/oauth/accounts'),

  /** Link thêm OAuth vào account hiện tại */
  link: (provider: OAuthProvider, code: string, codeVerifier: string) =>
    http.post(`/auth/oauth/${provider}/link`, { code, codeVerifier }),

  /** Unlink OAuth */
  unlink: (provider: OAuthProvider) => http.delete(`/auth/oauth/${provider}`),
};