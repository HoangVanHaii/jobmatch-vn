import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { isNull } from 'drizzle-orm'; // thêm import này


export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  data: jsonb('data').$type<Record<string, unknown>>(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userUnreadIdx: index('idx_notifications_user_unread').on(t.userId, t.createdAt).where(isNull(t.readAt)),
  dataIdx: index('idx_notifications_data').using('gin', t.data),
}));