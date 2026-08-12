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
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});

export const oauthRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('oauth'),
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => `oauth:${req.ip}`,
  message: { success: false, error: { code: 'OAUTH_RATE_LIMITED', message: 'Too many OAuth attempts' } },
});

export const otpRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('otp'),
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) => `otp:${req.ip}`,
  message: { success: false, error: { code: 'OTP_RATE_LIMITED', message: 'Too many OTP requests' } },
});

export const adminRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('admin'),
  windowMs: 60_000,
  max: 20,
  keyGenerator: (req: any) => `admin:${req.user?.userId || req.ip}`,
  message: { success: false, error: { code: 'ADMIN_RATE_LIMITED', message: 'Too many admin requests' } },
});

export const jobWriteRateLimiter = rateLimit({
  ...baseConfig,
  store: createRedisStore('job_write'),
  windowMs: 60_000,
  max: 20,
  keyGenerator: (req) => `job_write:${req.ip}`,
  message: { success: false, error: { code: 'JOB_WRITE_RATE_LIMITED', message: 'Too many job write requests' } },
});