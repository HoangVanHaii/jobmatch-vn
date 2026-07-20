/**
 * Axios instance — interceptors + auto refresh token
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
  timeout: 30_000,
});

let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null = null): void => {
  failedQueue.forEach(({ resolve, reject }) => {
    error ? reject(error) : resolve(token!);
  });
  failedQueue = [];
};

// Request interceptor — attach access token
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

// Response interceptor — auto refresh on 401
http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status !== 401 || original._retry || original.url?.includes('/auth/')) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers.set('Authorization', `Bearer ${token}`);
        return http(original);
      });
    }

    original._retry = true;
    isRefreshing = true;
    try {
      const refreshToken = localStorage.getItem('refresh_token');
      const { data } = await axios.post(`${import.meta.env.VITE_API_BASE_URL}/auth/refresh`, { refreshToken });
      localStorage.setItem('access_token', data.data.accessToken);
      localStorage.setItem('refresh_token', data.data.refreshToken);
      processQueue(null, data.data.accessToken);
      original.headers.set('Authorization', `Bearer ${data.data.accessToken}`);
      return http(original);
    } catch (err) {
      processQueue(err);
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);