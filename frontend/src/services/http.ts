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
  /**
   * Axios v1+ mặc định serialize giá trị `undefined` thành literal string
   * `"undefined"` (vd `?jobType=undefined`) → backend Zod reject → 400.
   *
   * Custom serializer skip `undefined` để URL luôn clean (chỉ chứa key có
   * value thật). Ảnh hưởng toàn bộ app, không cần nhớ filter thủ công ở
   * từng call site.
   */
  paramsSerializer: {
    serialize: (params) => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value === undefined || value === null) continue;
        search.append(key, String(value));
      }
      return search.toString();
    },
  },
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

/**
 * Extract user-friendly error message từ bất kỳ error nào — HttpError, AxiosError,
 * Error thường, hoặc unknown.
 *
 * F4 FIX: trước đây các view đọc `e?.response?.data?.error?.message` (axios cũ) → sau
 * khi http.ts unwrap thành HttpError, .response là undefined → fallback generic
 * → user KHÔNG thấy message Tiếng Việt từ BE.
 *
 * Helper này đọc đúng:
 * - HttpError → .message (BE đã localize)
 * - AxiosError fallback → .response.data.error.message (chưa qua interceptor)
 * - Error thường → .message
 * - Unknown → fallback string
 *
 * Ví dụ:
 *   try { await auth.login(...) } catch (e) {
 *     error.value = extractErrorMessage(e, 'Đăng nhập thất bại');
 *   }
 */
/**
 * Lấy thông tin lỗi từ HttpError hoặc AxiosError body.
 * Ưu tiên field-level details (VD: { email: ['Email không đúng định dạng'] }) nếu có,
 * fallback envelope message.
 */
const getErrorInfo = (e: unknown): { message: string; details?: Record<string, unknown> } | null => {
  // HttpError (đã qua interceptor)
  if (e instanceof HttpError && e.message) {
    return { message: e.message, details: e.details as Record<string, unknown> | undefined };
  }
  // AxiosError fallback (chưa qua interceptor). Không đưa message kỹ thuật của
  // Axios ("Network Error", timeout, status code...) trực tiếp lên UI.
  if (axios.isAxiosError<ApiResponseEnvelope<unknown>>(e)) {
    const axiosErr = e as AxiosError<ApiResponseEnvelope<unknown>>;
    const errorBody = axiosErr.response?.data?.error;
    if (errorBody?.message) {
      return {
        message: errorBody.message,
        details: errorBody.details as Record<string, unknown> | undefined,
      };
    }
    return {
      message: axiosErr.response
        ? 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.'
        : 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại.',
    };
  }
  // Error thường
  if (e instanceof Error && e.message) {
    return { message: e.message };
  }
  return null;
};

/** Lấy message field-level đầu tiên (VD: "Email không đúng định dạng") để hiển thị cụ thể. */
const getFirstFieldError = (details: Record<string, unknown> | undefined): string | null => {
  if (!details) return null;
  for (const _field of Object.keys(details)) {
    const value = details[_field];
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      return value[0] as string;
    }
    if (typeof value === 'string') return value;
  }
  return null;
};

export const extractErrorMessage = (e: unknown, fallback: string): string => {
  const info = getErrorInfo(e);
  if (!info) return fallback;
  // Ưu tiên field-level message (cụ thể) > envelope message (chung)
  return getFirstFieldError(info.details) ?? info.message ?? fallback;
};

/** Extract error code tương tự extractErrorMessage. Trả empty string nếu không có. */
export const extractErrorCode = (e: unknown): string => {
  if (e instanceof HttpError && e.code) return e.code;
  if (e && typeof e === 'object' && 'response' in e) {
    const axiosErr = e as AxiosError<ApiResponseEnvelope<unknown>>;
    return axiosErr.response?.data?.error?.code ?? '';
  }
  return '';
};

// Request interceptor — attach access token
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

// Response interceptor — auto refresh on 401 + unwrap BE errors + envelope validation
http.interceptors.response.use(
  (r) => {
    // Envelope invariant: mọi 2xx response phải có `success: true` (hoặc
    // undefined cho backward compat). Nếu BE trả 2xx nhưng body.success === false
    // là vi phạm contract → ném HttpError để caller xử lý đồng nhất.
    // Trước đây axios mặc nhiên coi 2xx là OK → nếu có bug BE dạng này,
    // FE âm thầm fail không có stack trace.
    const body = r.data as { success?: boolean; error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined;
    if (body && typeof body === 'object' && body.success === false) {
      const errBody = body.error;
      if (errBody?.message) {
        return Promise.reject(
          new HttpError(
            r.status ?? 200,
            errBody.code ?? 'UNKNOWN',
            errBody.message,
            errBody.details,
          ),
        );
      }
    }
    return r;
  },
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // ─── 401 refresh flow (existing) ────────────────────────────────
    if (error.response?.status !== 401 || original._retry || original.url?.includes('/auth/')) {
      // Không refresh: nhảy xuống dưới để unwrap BE error.
    } else if (isRefreshing) {
      // Set _retry TRƯỚC khi xếp hàng: sau khi dequeue + retry, nếu request vẫn
      // 401 (token mới không được endpoint này chấp nhận) nó phải rơi xuống
      // nhánh unwrap + reject thay vì tự trở thành refresher mới → tránh vòng
      // lặp refresh trong session. (Refresher chính set _retry ở nhánh dưới.)
      original._retry = true;
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
        // Không có refresh token → session không thể phục hồi. Clear + reject
        // ngay, KHÔNG gọi /auth/refresh (body null chỉ nhận 400 từ
        // refreshSchema) và KHÔNG redirect — đang ở trang auth mà redirect về
        // chính nó sẽ full-reload → mount lại → 401 → lặp vô hạn (bug F5 /login).
        const storedRefresh = localStorage.getItem('refresh_token');
        if (!storedRefresh) {
          localStorage.removeItem('access_token');
          const noSession = new HttpError(
            401, 'NO_REFRESH_TOKEN', 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.',
          );
          processQueue(noSession);
          return Promise.reject(noSession);
        }
        // Dùng instance `http` (đã có timeout 30s) thay vì raw axios.
        const { data } = await http.post<{ success: true; data: { accessToken: string; refreshToken: string } }>(
          '/auth/refresh',
          { refreshToken: storedRefresh },
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
        // Đang ở trang auth (kể cả /login) thì KHÔNG redirect — assign
        // location.href trùng URL hiện tại vẫn trigger full reload → app mount
        // lại → 401 → refresh → redirect... thành reload loop (bug F5 /login).
        const onAuthPage = /^\/(login|register|verify-otp|forgot-password)/.test(window.location.pathname);
        if (!onCallback && !onAuthPage) {
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
