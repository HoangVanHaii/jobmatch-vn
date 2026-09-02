/**
 * useOAuth composable — Google/FB/GitHub flow
 *
 * Callback trả về discriminated union:
 *   - EXISTING_USER → setTokens + push home (ngay tại caller)
 *   - NEW_USER      → push tới /select-role để user chọn Role, sau đó completeRegistration
 */
import { useOAuthStore } from '@stores/oauth';
import { useAuthStore } from '@stores/auth';
import { storeToRefs } from 'pinia';
import type { OAuthProvider } from '@services/auth.oauth.api';

export const useOAuth = () => {
  const oauthStore = useOAuthStore();
  const authStore = useAuthStore();
  const { linkedAccounts, pendingToken, pendingProfile } = storeToRefs(oauthStore);

  const loginWith = async (provider: OAuthProvider): Promise<void> => {
    await oauthStore.initiateLogin(provider);
  };

  /**
   * Handle OAuth callback. Caller (OAuthCallbackView) phải check `result.status`:
   *   - 'EXISTING_USER' → đã login xong, push tới `/`.
   *   - 'NEW_USER' → pendingToken đã lưu vào store, push tới `/select-role`.
   */
  const handleOAuthCallback = async (provider: OAuthProvider) => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state') ?? sessionStorage.getItem('oauth_state') ?? '';
    if (!code) throw new Error('Missing OAuth code');

    const result = await oauthStore.handleCallback(provider, code, state);

    if (result.status === 'EXISTING_USER') {
      authStore.setTokens(result.accessToken, result.refreshToken);
      await authStore.fetchMe();
    }
    // NEW_USER: pendingToken/profile đã được store lưu sẵn — caller push /select-role.

    // Cleanup sessionStorage PKCE + state dù EXISTING_USER hay NEW_USER.
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('oauth_state');

    return result;
  };

  /** Hoàn tất pending OAuth registration với Role đã chọn. */
  const completeOAuthRegistration = async (role: 'candidate' | 'employer') => {
    const data = await oauthStore.completeRegistration(role);
    authStore.setTokens(data.accessToken, data.refreshToken);
    await authStore.fetchMe();
  };

  const unlink = async (provider: OAuthProvider) => oauthStore.unlink(provider);

  return {
    linkedAccounts,
    pendingToken,
    pendingProfile,
    loginWith,
    handleOAuthCallback,
    completeOAuthRegistration,
    unlink,
  };
};