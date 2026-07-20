/**
 * Auth Pinia store
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authApi } from '@services/auth.api';

export interface User {
  id: string;
  email: string;
  role: 'candidate' | 'employer' | 'admin';
  status: string;
  metadata?: Record<string, unknown>;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const accessToken = ref<string | null>(localStorage.getItem('access_token'));
  const refreshToken = ref<string | null>(localStorage.getItem('refresh_token'));
  const isLoading = ref(false);

  const isAuthenticated = computed(() => !!user.value && !!accessToken.value);

  const fetchMe = async (): Promise<void> => {
    try {
      const { data } = await authApi.me();
      user.value = data.data;
    } catch { logout(); }
  };

  const login = async (email: string, password: string): Promise<void> => {
    isLoading.value = true;
    try {
      const { data } = await authApi.login({ email, password });
      setTokens(data.data.accessToken, data.data.refreshToken);
      user.value = data.data.user;
    } finally { isLoading.value = false; }
  };

  const register = async (payload: {
    email: string;
    password: string;
    fullName: string;
    role: 'candidate' | 'employer';
  }): Promise<void> => {
    isLoading.value = true;
    try {
      const { data } = await authApi.register(payload);
      setTokens(data.data.accessToken, data.data.refreshToken);
      user.value = data.data.user;
    } finally { isLoading.value = false; }
  };

  const logout = async (): Promise<void> => {
    try {
      if (refreshToken.value) await authApi.logout(refreshToken.value);
    } finally {
      user.value = null;
      accessToken.value = null;
      refreshToken.value = null;
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }
  };

  const setTokens = (access: string, refresh: string): void => {
    accessToken.value = access;
    refreshToken.value = refresh;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
  };

  return {
    user, accessToken, refreshToken, isLoading,
    isAuthenticated,
    fetchMe, login, register, logout, setTokens,
  };
});