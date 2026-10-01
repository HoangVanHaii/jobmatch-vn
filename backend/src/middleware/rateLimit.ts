import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../config/redis';

const createRedisStore = (prefix: string) =>
  new RedisStore({
    sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as Promise<any>,
    prefix: `rl:${prefix}:`, // Ví dụ: rl:oauth:, rl:otp:, rl:admin:
  });

/**
 * Audit 2026-09-28 follow-up (C5 FIX):
 *   Tách rate limit config thành 2 nhóm theo security sensitivity.
 *
 *   - NON_SENSITIVE: passOnStoreError=true (fail-open). Nếu Redis lỗi, request vẫn
 *     pass qua. Áp cho: global rate limiter, admin, job write, chatbot.
 *     Trade-off: UX hơn nhưng mất protection khi Redis sập.
 *
 *   - SENSITIVE: passOnStoreError=false (fail-closed). Nếu Redis lỗi, request bị
 *     reject với 500. Áp cho: login (brute-force defense), forgot-password
 *     (email enumeration timing + email-bomb), OTP routes (chống email bomb,
 *     brute-force OTP). Trade-off: UX kém khi Redis sập nhưng SECURITY đặt trên UX
 *     cho các endpoint nhạy cảm này.
 *
 *   Lý do cần fail-closed: nếu attacker có khả năng DoS Redis (qua network/
 *   resource exhaustion), fail-open sẽ mở toàn bộ OTP/login → brute-force không
 *   giới hạn. Fail-closed yêu cầu attacker vượt qua cả Redis DoS MỚI tới được
 *   endpoint → tăng cost attack đáng kể.
 *
 *   Lưu ý: errorHandler hiện tại trả 500 cho store errors. Sensitive endpoint
 *   khi Redis lỗi → user thấy "Internal Server Error" + retry → acceptable vì
 *   đây là system-wide incident, không phải user-induced.
 */
const baseConfig = {
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
};

/**
 * Config fail-CLOSED cho endpoint nhạy cảm.
 * KHÔNG dùng cho endpoint public/costly — đó là `baseConfig`.
 */
const sensitiveConfig = {
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: false,
};

export const rateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('global'),
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  /**
   * fix HIGH #1 (2026-10-01): /webhooks/* ra khỏi global limiter.
   *
   * Webhook PayOS dùng chung bucket 100 req/60s/IP với TOÀN BỘ user traffic
   * —burst user hợp lệ có thể đẩy bucket đầy → request của PayOS ăn 429 →
   * delivery chậm/mất, payment kẹt 'pending' dù user đã trả tiền. Webhook
   * đã được bảo vệ bằng signature verification (SDK) nên không cần rate
   * limit chống abuse; limiter riêng rất rộng không thêm giá trị.
   *
   * req.path tại middleware app-level là full path (vd /api/v1/webhooks/payos).
   * Thứ tự middleware không đổi (rateLimiter vẫn sau body parsers) → cách
   * parse body + verify signature như cũ.
   */
  skip: (req) => req.path.startsWith('/api/v1/webhooks'),
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.' } },
});

export const oauthRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('oauth'),
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => `oauth:${req.ip}`,
  message: { success: false, error: { code: 'OAUTH_RATE_LIMITED', message: 'Quá nhiều lần thử đăng nhập OAuth. Vui lòng thử lại sau 1 phút.' } },
});

/**
 * S2 FIX: Tách otpRateLimiter thành 5 limiter riêng theo route, mỗi route có
 * bucket đếm độc lập.
 *
 * Lý do tách (regression risk):
 *   Trước đây 4 route (verify-otp, resend-otp, forgot-password, reset-password)
 *   share chung 1 bucket key `otp:${ip}`. User thao tác hợp lệ nhưng đa dạng
 *   (vd 3 request-otp + 3 resend-otp) sẽ bị block ở call thứ 4 dù mỗi route
 *   riêng chỉ mới 3 lần. Tương tự: forgot + reset share → spam 1 route có
 *   thể lock route kia vô tình.
 *
 *   Giờ mỗi route có bucket riêng (Redis prefix + key prefix khác nhau):
 *     - otp_request      → POST /auth/register/request-otp  (S2 FIX: mới thêm)
 *     - otp_verify       → POST /auth/register/verify-otp
 *     - otp_resend       → POST /auth/register/resend-otp
 *     - otp_forgot       → POST /auth/forgot-password
 *     - otp_reset        → POST /auth/reset-password
 *
 * Default max = 5 / 60s / IP cho mỗi route. Override qua tham số nếu cần.
 */
const createOtpRouteLimiter = (suffix: string, max = 5) =>
  rateLimit({
    ...sensitiveConfig, // C5 FIX: OTP routes = fail-CLOSED khi Redis lỗi
    store: createRedisStore(`otp_${suffix}`),
    windowMs: 60_000,
    max,
    keyGenerator: (req) => `otp_${suffix}:${req.ip}`,
    message: {
      success: false,
      error: {
        code: 'OTP_RATE_LIMITED',
        message: 'Quá nhiều yêu cầu gửi mã OTP. Vui lòng thử lại sau 1 phút.',
      },
    },
  });

/** S2 FIX: chống email-bomb qua /register/request-otp (trước đây KHÔNG có rate limit). */
export const otpRequestRateLimiter = createOtpRouteLimiter('request', 5);
export const otpVerifyRateLimiter = createOtpRouteLimiter('verify', 5);
export const otpResendRateLimiter = createOtpRouteLimiter('resend', 5);
export const otpForgotRateLimiter = createOtpRouteLimiter('forgot', 5);
export const otpResetRateLimiter = createOtpRouteLimiter('reset', 5);

/**
 * @deprecated Giữ export để không phá vỡ code ngoài đang import, nhưng KHÔNG
 * nên dùng cho route mới. Dùng 5 limiter riêng ở trên để tránh cross-route
 * interference. Bucket key cũ vẫn còn data Redis (TTL 60s) sẽ tự hết hạn.
 */
export const otpRateLimiter = otpVerifyRateLimiter;

// Tighter limit cho /auth/oauth/complete vì endpoint này có thể spam
// đổi role liên tục trong 10 phút pendingToken window. Tách khỏi
// oauthRateLimiter chung (10/min) để apply mức chặt hơn riêng.
export const oauthCompleteRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('oauth_complete'),
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) => `oauth_complete:${req.ip}`,
  message: { success: false, error: { code: 'OAUTH_COMPLETE_RATE_LIMITED', message: 'Quá nhiều yêu cầu hoàn tất đăng ký OAuth. Vui lòng thử lại sau 1 phút.' } },
});

// S2 FIX: Login rate limit — chặn brute-force password qua IP.
// 10 attempts / 5 phút / IP. Layer 1 defense (account-level lockout sẽ là layer 2).
export const loginRateLimiter = rateLimit({
  ...sensitiveConfig, // C5 FIX: login = fail-CLOSED khi Redis lỗi
  store: createRedisStore('login'),
  windowMs: 5 * 60 * 1000, // 5 phút (giảm từ 15 để UX tốt hơn, vẫn chặn brute-force)
  max: 10,
  keyGenerator: (req) => `login:${req.ip}`,
  message: {
    success: false,
    error: {
      code: 'LOGIN_RATE_LIMITED',
      message: 'Quá nhiều lần đăng nhập từ IP này. Vui lòng thử lại sau 5 phút.',
    },
  },
});

export const adminRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('admin'),
  windowMs: 60_000,
  // Tăng từ 20 → 40 req/phút/user vì admin page có nhiều action
  // (filter, search debounce, status change → refetch + counts).
  max: 40,
  keyGenerator: (req: any) => `admin:${req.user?.userId || req.ip}`,
  message: { success: false, error: { code: 'ADMIN_RATE_LIMITED', message: 'Quá nhiều yêu cầu admin. Vui lòng thử lại sau 1 phút.' } },
});

export const jobWriteRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('job_write'),
  windowMs: 60_000,
  max: 20,
  keyGenerator: (req) => `job_write:${req.ip}`,
  message: { success: false, error: { code: 'JOB_WRITE_RATE_LIMITED', message: 'Quá nhiều yêu cầu tạo/sửa job. Vui lòng thử lại sau 1 phút.' } },
});

export const cvAiRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('cv_ai'),
  windowMs: 60_000,
  // Override qua env khi chạy E2E (vd: CV_AI_RATE_LIMIT_MAX=1000).
  // Mặc định 3 req/phút/user để chặn abuse trong production.
  max: parseInt(process.env.CV_AI_RATE_LIMIT_MAX || '3', 10),
  keyGenerator: (req: any) => `cv_ai:${req.user?.userId || req.ip}`,
  message: { success: false, error: { code: 'CV_AI_RATE_LIMITED', message: 'Quá nhiều yêu cầu AI CV. Vui lòng thử lại sau 1 phút.' } },
});
export const cvWriteRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('cv_write'),
  windowMs: 60_000,
  // Override qua env khi chạy E2E (vd: CV_WRITE_RATE_LIMIT_MAX=1000).
  // Mặc định 20 req/phút/user để chặn spam edit UI.
  max: parseInt(process.env.CV_WRITE_RATE_LIMIT_MAX || '20', 10),
  keyGenerator: (req) => `cv_write:${req.user?.userId || req.ip}`,
  message: { success: false, error: { code: 'CV_WRITE_RATE_LIMITED', message: 'Quá nhiều yêu cầu sửa CV. Vui lòng thử lại sau 1 phút.' } },
});

/**
 * CV download-pdf (Playwright render) — 5 lần/phút/user.
 *
 * Lý do riêng (khác `cvWriteRateLimiter`):
 *   - Endpoint này gọi Playwright + Chromium để render vector PDF.
 *     Mỗi request chiếm 1 instance từ pool (~5-30s CPU/RAM).
 *   - `cvWriteRateLimiter` (20/phút) cho phép 20 lần render/phút → dễ
 *     exhaust Chromium pool (semaphore 2 hiện tại) → block user khác.
 *   - 5/phút/user là đủ dùng thực tế: user hiếm khi tải CV của mình
 *     >5 lần/phút; nếu cần export nhiều → UI có thể gom batch.
 *
 * Lý do key theo user (không IP):
 *   - User đã authenticate → dùng `userId` chính xác hơn IP (NAT/shared IP).
 *   - Fallback IP chỉ khi thiếu userId (edge case, defense in depth).
 *
 * Lưu ý: rate limit này chỉ bảo vệ endpoint BE `/download-pdf`.
 * Upload CV download (FE fetch thẳng MinIO) bypass hoàn toàn → cần
 * throttle ở FE layer ([useCvDownload.ts](../../frontend/src/composables/useCvDownload.ts)).
 */
export const cvDownloadRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('cv_download'),
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req: any) => `cv_download:${req.user?.userId || req.ip}`,
  message: { success: false, error: { code: 'CV_DOWNLOAD_RATE_LIMITED', message: 'Bạn tải CV quá nhiều. Vui lòng thử lại sau 1 phút.' } },
});

// Chatbot (JobMatch AI) — 10 lượt/phút/user; chỉ áp cho POST /chatbot/sessions/:id/turn.
export const chatbotRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('chatbot'),
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req: any) => `chatbot:${req.user?.userId || req.ip}`,
  message: { success: false, error: { code: 'CHATBOT_RATE_LIMITED', message: 'Bạn đã gửi quá nhiều câu hỏi, thử lại sau ít phút.' } },
});