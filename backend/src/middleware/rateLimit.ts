/**
 * Rate limit — express-rate-limit + Redis store
 */
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../config/redis';

export const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as Promise<any>,
  }),
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});

export const oauthRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => `oauth:${req.ip}`,
  message: { success: false, error: { code: 'OAUTH_RATE_LIMITED', message: 'Too many OAuth attempts' } },
});