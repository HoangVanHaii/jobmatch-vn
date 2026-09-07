import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../config/redis';

const createRedisStore = (prefix: string) =>
  new RedisStore({
    sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as Promise<any>,
    prefix: `rl:${prefix}:`, // Ví dụ: rl:oauth:, rl:otp:, rl:admin:
  });

const baseConfig = {
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true, 
};

export const rateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('global'),
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
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

export const otpRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('otp'),
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) => `otp:${req.ip}`,
  message: { success: false, error: { code: 'OTP_RATE_LIMITED', message: 'Quá nhiều yêu cầu gửi mã OTP. Vui lòng thử lại sau 1 phút.' } },
});

// S2 FIX: Login rate limit — chặn brute-force password qua IP.
// 10 attempts / 5 phút / IP. Layer 1 defense (account-level lockout sẽ là layer 2).
export const loginRateLimiter = rateLimit({
  ...baseConfig,
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
  max: 20,
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
  max: 3,
  keyGenerator: (req: any) => `cv_ai:${req.user?.userId || req.ip}`,
  message: { success: false, error: { code: 'CV_AI_RATE_LIMITED', message: 'Quá nhiều yêu cầu AI CV. Vui lòng thử lại sau 1 phút.' } },
});
export const cvWriteRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('cv_write'),
  windowMs: 60_000,
  max: 20,
  keyGenerator: (req) => `cv_write:${req.user?.userId || req.ip}`,
  message: { success: false, error: { code: 'CV_WRITE_RATE_LIMITED', message: 'Quá nhiều yêu cầu sửa CV. Vui lòng thử lại sau 1 phút.' } },
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