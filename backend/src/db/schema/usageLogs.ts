import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const usageLogs = pgTable('usage_logs', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull().references(() => users.id),
  feature: text('feature').notNull(),
  count: integer('count').default(1),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userFeaturePeriodIdx: index('idx_usage_user_feature_period').on(t.userId, t.feature, t.createdAt),
}));

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