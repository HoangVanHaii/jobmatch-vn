/**
 * OAuth API — Google, Facebook, GitHub
 */
import { http } from './http';

export type OAuthProvider = 'google' | 'facebook' | 'github';

export const oauthApi = {
  /** Bắt đầu OAuth flow — backend trả authorization URL + state */
  initiate: (provider: OAuthProvider) =>
    http.get<{ success: true; data: { url: string } }>(`/auth/oauth/${provider}`),

  /** Sau khi provider redirect về SPA, gửi code + PKCE verifier lên backend */
  callback: (provider: OAuthProvider, code: string, codeVerifier: string, state: string) =>
    http.post<{ success: true; data: { user: any; accessToken: string; refreshToken: string } }>(
      `/auth/oauth/${provider}/callback`,
      { code, codeVerifier, state },
    ),

  /** List các OAuth đã link */
  listLinked: () => http.get('/auth/oauth/accounts'),

  /** Link thêm OAuth vào account hiện tại */
  link: (provider: OAuthProvider, code: string, codeVerifier: string) =>
    http.post(`/auth/oauth/${provider}/link`, { code, codeVerifier }),

  /** Unlink OAuth */
  unlink: (provider: OAuthProvider) => http.delete(`/auth/oauth/${provider}`),
};