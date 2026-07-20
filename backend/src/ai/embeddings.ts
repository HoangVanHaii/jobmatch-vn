/**
 * Embedding factory — cache theo text_hash
 */
import crypto from 'crypto';
import { redis } from '../config/redis';
import { embeddingProvider } from '../config/ai';
import { logger } from '../config/logger';

const CACHE_TTL = 60 * 60 * 24 * 7; // 7 ngày

const hashText = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

export const embedWithCache = async (text: string): Promise<number[]> => {
  const hash = hashText(text);
  const cacheKey = `embedding:${hash}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    logger.debug({ hash }, 'Embedding cache hit');
    return JSON.parse(cached);
  }
  const result = await embeddingProvider.embed(text);
  const vector = Array.isArray(result) ? result[0].vector : result.vector;
  await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(vector));
  return vector;
};