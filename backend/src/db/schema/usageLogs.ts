import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { subscriptions } from './billing';

export const usageLogs = pgTable(
  'usage_logs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /**
     * Subscription scope — NULL cho free tier (chưa mua gói).
     * Service tự lookup qua `planService.getMyCurrentPlan`.
     */
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
    feature: text('feature').notNull(),
    /**
     * Tổng số lượt đã dùng cho (user, sub, feature).
     * Tăng qua `usageLogService.createOrIncrementUsage` (atomic + quota check).
     */
    count: integer('count').notNull().default(0),
    /**
     * Tổng LLM tokens tiêu thụ. Chỉ tăng khi LLM thành công.
     */
    token: integer('token').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userFeaturePeriodIdx: index('idx_usage_user_feature_period').on(t.userId, t.feature, t.createdAt),
    subscriptionIdx: index('idx_usage_subscription').on(t.subscriptionId),
  }),
);

export const auditLogs = pgTable('audit_logs', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  diff: jsonb('diff').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});