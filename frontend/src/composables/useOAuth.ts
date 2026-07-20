/**
 * useOAuth composable — Google/FB/GitHub flow
 */
import { useOAuthStore } from '@stores/oauth';
import { useAuthStore } from '@stores/auth';
import { storeToRefs } from 'pinia';
import type { OAuthProvider } from '@services/auth.oauth.api';

export const useOAuth = () => {
  const oauthStore = useOAuthStore();
  const authStore = useAuthStore();
  const { linkedAccounts } = storeToRefs(oauthStore);

  const loginWith = async (provider: OAuthProvider): Promise<void> => {
    await oauthStore.initiateLogin(provider);
  };

  const handleOAuthCallback = async (provider: OAuthProvider) => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state') ?? sessionStorage.getItem('oauth_state') ?? '';
    if (!code) throw new Error('Missing OAuth code');

    const result = await oauthStore.handleCallback(provider, code, state);
    authStore.setTokens(result.accessToken, result.refreshToken);
    await authStore.fetchMe();
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('oauth_state');
  };

  const unlink = async (provider: OAuthProvider) => oauthStore.unlink(provider);

  return { linkedAccounts, loginWith, handleOAuthCallback, unlink };
};