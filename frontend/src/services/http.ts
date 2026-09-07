/**
 * Axios instance — interceptors + auto refresh token
 *
 * Lưu ý: mọi axios call (kể cả raw `axios.post` cho refresh) PHẢI có timeout.
 * Trước đây refresh dùng raw axios không timeout → nếu BE /auth/refresh
 * treo (server down, DNS, network unreachable), isRefreshing=true vĩnh viễn,
 * failedQueue không bao giờ drain → mọi 401 concurrent treo theo. Spinner
 * ở OAuthCallback quay mãi không bao giờ navigate đi.
 *
 * Error handling: BE trả envelope `{ success, error: { code, message, field? } }`
 * cho mọi non-2xx. Interceptor unwrap → ném HttpError với `.code` và `.message`
 * của BE để store/UI dùng trực tiếp (thay vì chỉ thấy default axios string
 * "Request failed with status code 409").
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

/* ============================================================================
 * Error shape + custom class
 * ==========================================================================*/

/** Envelope mà BE trả về cho mọi response (kể cả error). */
export interface ApiResponseEnvelope<T> {
  success: boolean;
  data?: T;
  error?: ApiErrorBody;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  /** Một số error có thêm field (vd userId đang active ở company khác). */
  details?: Record<string, unknown>;
}

/**
 * Error do axios interceptor wrap lại — chứa thông tin từ BE để store/UI dùng.
 *
 *   - `message`: BE trả `error.message` (đã Tiếng Việt, user-friendly).
 *   - `code`: BE trả `error.code` (vd 'USER_NOT_FOUND', 'ALREADY_PENDING').
 *   - `statusCode`: HTTP status (401, 404, 409...).
 *
 * Store có thể check `e instanceof HttpError` để switch theo `code`.
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

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

/** Build HttpError từ AxiosError — unwrap body BE. Trả null nếu không có body. */
const buildHttpErrorFromAxios = (error: AxiosError): HttpError | null => {
  const status = error.response?.status ?? 0;
  const body = error.response?.data as ApiResponseEnvelope<unknown> | undefined;
  const beError = body?.error;
  if (!beError?.message) return null;
  return new HttpError(status, beError.code, beError.message, beError.details);
};

// Request interceptor — attach access token
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

// Response interceptor — auto refresh on 401 + unwrap BE errors
http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // ─── 401 refresh flow (existing) ────────────────────────────────
    if (error.response?.status !== 401 || original._retry || original.url?.includes('/auth/')) {
      // Không refresh: nhảy xuống dưới để unwrap BE error.
    } else if (isRefreshing) {
      try {
        const token = await withQueueTimeout(
          new Promise<string>((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          }),
        );
        original.headers.set('Authorization', `Bearer ${token}`);
        return http(original);
      } catch (queueErr) {
        return Promise.reject(queueErr);
      }
    } else {
      original._retry = true;
      isRefreshing = true;
      try {
        // Dùng instance `http` (đã có timeout 30s) thay vì raw axios.
        const { data } = await http.post<{ success: true; data: { accessToken: string; refreshToken: string } }>(
          '/auth/refresh',
          { refreshToken: localStorage.getItem('refresh_token') },
        );
        localStorage.setItem('access_token', data.data.accessToken);
        localStorage.setItem('refresh_token', data.data.refreshToken);
        processQueue(null, data.data.accessToken);
        original.headers.set('Authorization', `Bearer ${data.data.accessToken}`);
        return http(original);
      } catch (refreshErr) {
        processQueue(refreshErr);
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        const onCallback = window.location.pathname.startsWith('/auth/callback/');
        if (!onCallback) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    // ─── Unwrap BE error body → HttpError ────────────────────────────
    // Mọi non-2xx response đều đi qua đây. Axios default error.message là
    // "Request failed with status code <X>" — không hữu ích. BE đã trả
    // { error: { code, message } } trong body — lấy ra dùng.
    const httpErr = buildHttpErrorFromAxios(error);
    if (httpErr) return Promise.reject(httpErr);

    // Fallback (không có body) — giữ nguyên axios error để debug.
    return Promise.reject(error);
  },
);
