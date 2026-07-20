/**
 * OAuth store — Google/Facebook/GitHub linked accounts
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { oauthApi, OAuthProvider } from '@services/auth.oauth.api';

interface LinkedAccount {
  id: string;
  provider: OAuthProvider;
  providerEmail: string;
  linkedAt: string;
  lastUsedAt: string | null;
}

export const useOAuthStore = defineStore('oauth', () => {
  const linkedAccounts = ref<LinkedAccount[]>([]);
  const isLoading = ref(false);

  const fetchLinked = async (): Promise<void> => {
    isLoading.value = true;
    try {
      const { data } = await oauthApi.listLinked();
      linkedAccounts.value = data.data;
    } finally { isLoading.value = false; }
  };

  const initiateLogin = async (provider: OAuthProvider): Promise<void> => {
    // 1. Tạo PKCE verifier + challenge
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    sessionStorage.setItem('pkce_verifier', verifier);

    // 2. Gọi backend lấy authorization URL + state
    const { data } = await oauthApi.initiate(provider);
    sessionStorage.setItem('oauth_state', extractState(data.data.url));

    // 3. Redirect đến provider
    window.location.href = data.data.url;
  };

  const handleCallback = async (provider: OAuthProvider, code: string, state: string) => {
    const verifier = sessionStorage.getItem('pkce_verifier');
    if (!verifier) throw new Error('Missing PKCE verifier');
    const { data } = await oauthApi.callback(provider, code, verifier, state);
    return data.data;
  };

  const unlink = async (provider: OAuthProvider): Promise<void> => {
    await oauthApi.unlink(provider);
    await fetchLinked();
  };

  return { linkedAccounts, isLoading, fetchLinked, initiateLogin, handleCallback, unlink };
});

// PKCE helpers
function generateCodeVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const enc = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function extractState(url: string): string {
  return new URL(url).searchParams.get('state') ?? '';
}