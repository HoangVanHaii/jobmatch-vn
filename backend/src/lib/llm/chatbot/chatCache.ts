/**
 * Redis cache cho intent classification (bước 1).
 *
 * Key:    chatbot:intent:<sessionId>:<sha256(question + sorted(ids))>
 * Value:  JSON { types: ChatType[], confidence: number }
 * TTL:    INTENT_CACHE_TTL_SECONDS (default 300s = 5 phút — doc §3.1)
 *
 * Đổi picker (jobIds/cvIds) → key đổi → cache miss → reclassify.
 * Redis fail → fallback "no cache" (không throw) — passOnStoreError pattern.
 */
import crypto from 'crypto';
import { redis } from '../../../config/redis';
import { logger } from '../../../config/logger';
import type { ChatType } from './types';

export const INTENT_CACHE_TTL_SECONDS = 300;

export interface CachedIntent {
  types: ChatType[];
  confidence: number;
}

/**
 * Tạo cache key deterministic từ sessionId + question + sorted ids.
 * SHA-256 đủ dùng (chỉ cần uniqueness, không cần cryptographic).
 */
export const buildIntentCacheKey = (
  sessionId: string,
  question: string,
  jobIds: readonly string[],
  cvIds: readonly string[],
): string => {
  const sortedJobs = [...jobIds].sort().join(',');
  const sortedCvs = [...cvIds].sort().join(',');
  const hash = crypto
    .createHash('sha256')
    .update(`${question.trim()}|${sortedJobs}|${sortedCvs}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `chatbot:intent:${sessionId}:${hash}`;
};

export const getCachedIntent = async (
  key: string,
): Promise<CachedIntent | null> => {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedIntent;
  } catch (err) {
    logger.warn({ err, key }, '[chatCache] get failed — falling back to no cache');
    return null;
  }
};

export const setCachedIntent = async (
  key: string,
  value: CachedIntent,
): Promise<void> => {
  try {
    await redis.setex(key, INTENT_CACHE_TTL_SECONDS, JSON.stringify(value));
  } catch (err) {
    // passOnStoreError: cache miss là OK, không throw để flow LLM chạy tiếp
    logger.warn({ err, key }, '[chatCache] set failed — flow continues without cache');
  }
};
