import { pgTable, uuid, text, integer, numeric, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { subscriptionStatusEnum, paymentStatusEnum } from './enums';

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  priceVnd: numeric('price_vnd', { precision: 15, scale: 0 }).notNull(),
  durationDays: integer('duration_days').notNull(),
  features: jsonb('features').$type<Record<string, unknown>>().notNull(),
  isActive: boolean('is_active').default(true),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  status: subscriptionStatusEnum('status').default('active').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  payosOrderId: text('payos_order_id'),
  autoRenew: boolean('auto_renew').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userActiveIdx: index('idx_subs_user_active').on(t.userId, t.expiresAt),
}));

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  planId: uuid('plan_id').references(() => plans.id),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
  amountVnd: numeric('amount_vnd', { precision: 15, scale: 0 }).notNull(),
  orderCode: text('order_code').notNull().unique(),
  payosTxnId: text('payos_txn_id'),
  status: paymentStatusEnum('status'),
  rawResponse: jsonb('raw_response').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /**
   * Timestamp cập nhật payment gần nhất (status transition: pending→paid/failed/cancelled).
   * App code SET thủ công (KHÔNG có trigger tự động).
   * NULL khi row chưa từng UPDATE sau khi INSERT.
   * Dùng cho ORDER BY: payment mới finalize sẽ nhảy lên top.
   * Xem migration 0017_payments_update_at.sql.
   */
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (t) => ({
  planIdx: index('idx_payments_plan').on(t.planId),
}));