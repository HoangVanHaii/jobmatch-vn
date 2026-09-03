/**
 * Axios instance — interceptors + auto refresh token
 *
 * Lưu ý: mọi axios call (kể cả raw `axios.post` cho refresh) PHẢI có timeout.
 * Trước đây refresh dùng raw axios không timeout → nếu BE /auth/refresh
 * treo (server down, DNS, network unreachable), isRefreshing=true vĩnh viễn,
 * failedQueue không bao giờ drain → mọi 401 concurrent treo theo. Spinner
 * ở OAuthCallback quay mãi không bao giờ navigate đi.
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// Raw axios (dùng cho /auth/refresh) cũng cần timeout — set default toàn cục.
axios.defaults.timeout = 30_000;

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
  timeout: 30_000,
});

let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];

/** Timeout cho queued requests chờ refresh. Nếu refresh bị stuck (do BE treo),
 *  mọi request queued sẽ bị reject sau timeout này — tránh memory leak + UI
 *  treo mãi không release. */
const QUEUED_WAIT_TIMEOUT_MS = 30_000;

const processQueue = (error: unknown, token: string | null = null): void => {
  failedQueue.forEach(({ resolve, reject }) => {
    error ? reject(error) : resolve(token!);
  });
  failedQueue = [];
};

/** Wrap queued promise với timeout. Nếu refresh không resolve/reject trong
 *  QUEUED_WAIT_TIMEOUT_MS → reject với timeout error, request gốc sẽ fail
 *  thay vì treo vĩnh viễn. */
const withQueueTimeout = <T>(promise: Promise<T>): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Refresh queue wait exceeded — BE không phản hồi'));
    }, QUEUED_WAIT_TIMEOUT_MS);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
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
      return withQueueTimeout(
        new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }),
      ).then((token) => {
        original.headers.set('Authorization', `Bearer ${token}`);
        return http(original);
      });
    }

    original._retry = true;
    isRefreshing = true;
    try {
      // Dùng instance `http` (đã có timeout 30s) thay vì raw axios.
      // Bảo đảm refresh call luôn có timeout ceiling — nếu BE /auth/refresh
      // treo thì request này timeout sau 30s thay vì treo vĩnh viễn.
      const { data } = await http.post<{ success: true; data: { accessToken: string; refreshToken: string } }>(
        '/auth/refresh',
        { refreshToken: localStorage.getItem('refresh_token') },
      );
      localStorage.setItem('access_token', data.data.accessToken);
      localStorage.setItem('refresh_token', data.data.refreshToken);
      processQueue(null, data.data.accessToken);
      original.headers.set('Authorization', `Bearer ${data.data.accessToken}`);
      return http(original);
    } catch (err) {
      processQueue(err);
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      // KHÔNG hard-redirect khi đang ở /auth/callback/* — để OAuthCallbackView
      // xử lý error + show UI. Trước đây unconditional hard-redirect làm
      // OAuthCallback component bị unmount trước khi catch kịp chạy → user
      // thấy URL nhảy thẳng về /login mà không hiểu vì sao.
      const onCallback = window.location.pathname.startsWith('/auth/callback/');
      if (!onCallback) {
        window.location.href = '/login';
      }
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);