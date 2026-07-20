/**
 * Redis client — cache + BullMQ + Socket.IO adapter
 */
import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required cho BullMQ
  enableReadyCheck: true,
});

redis.on('connect', () => logger.info('✅ Redis connected'));
redis.on('error', (err) => logger.error({ err }, 'Redis error'));

export const disconnectRedis = async (): Promise<void> => {
  await redis.quit();
  logger.info('Redis disconnected');
};