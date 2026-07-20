import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const aiChatSessions = pgTable('ai_chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  messages: jsonb('messages').default([]).$type<Array<{ role: string; content: string; toolCalls?: unknown[]; ts: string }>>().notNull(),
  context: jsonb('context').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('idx_ai_chat_user').on(t.userId, t.updatedAt),
  messagesIdx: index('idx_ai_chat_messages').using('gin', t.messages),
}));