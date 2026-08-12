import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { notificationTypeEnum } from './enums';

/**
 * Bảng notifications — lưu thông báo cho user.
 * Cấu trúc khớp với DB sau migration 0003_update_notifications.sql.
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userCreatedIdx: index('idx_notifications_user_created').on(t.userId, t.createdAt),
  payloadIdx: index('idx_notifications_payload').using('gin', t.payload),
}));
