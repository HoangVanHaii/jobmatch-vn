import type { InferSelectModel } from 'drizzle-orm';
import { usageLogs } from '../db/schema/usageLogs';

/**
 * Row gốc của bảng usage_logs.
 */
export type UsageLog = InferSelectModel<typeof usageLogs>;

/**
 * Params cho `addToken` — cộng token thực tế sau khi LLM thành công.
 */
export interface AddTokenParams {
  userId: string;
  subscriptionId: string | null;
  feature: string;
  tokenUsed: number;
}

/**
 * Snapshot quota 1 feature của user — dùng cho middleware check + FE display.
 */
export interface FeatureUsage {
  feature: string;
  used: number;
  limit: number;
  unlimited: boolean;
  remaining: number | null;
}
