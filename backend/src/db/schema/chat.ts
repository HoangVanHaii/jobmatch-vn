import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { jobs } from './jobs';


export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userA: uuid('user_a').notNull().references(() => users.id),
    userB: uuid('user_b').notNull().references(() => users.id),
    jobId: uuid('job_id').references(() => jobs.id),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastMessagePreview: text('last_message_preview'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Luôn query "WHERE user_a = me OR user_b = me" + sort last_message_at desc.
    userAIdx: index('idx_conversations_user_a').on(t.userA, t.lastMessageAt),
    userBIdx: index('idx_conversations_user_b').on(t.userB, t.lastMessageAt),
    // Lookup theo job.
    jobIdx: index('idx_conversations_job').on(t.jobId),
    // 1 cặp user (đã chuẩn hoá) + cùng job = 1 conversation duy nhất.
    // jobId = NULL vẫn áp dụng nhờ nullsNotDistinct (pg 15+).
    pairJobUnique: uniqueIndex('uq_conversations_pair_job')
      .on(t.userA, t.userB, t.jobId)
      .with({ nullsNotDistinct: true }),
    // user_a ≠ user_b; service luôn sort nhưng DB thêm check để chắc.
    distinctUsers: check('ck_conversations_distinct_users', sql`${t.userA} <> ${t.userB}`),
  }),
);


export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').notNull().references(() => users.id),
    content: text('content').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => ({
    // Cursor pagination: ORDER BY created_at DESC, id DESC.
    convoIdx: index('idx_chat_messages_convo').on(t.conversationId, t.createdAt),
    // Lookup "tin nhắn chưa đọc của peer trong conv".
    unreadIdx: index('idx_chat_messages_unread').on(t.conversationId, t.readAt),
    senderIdx: index('idx_chat_messages_sender').on(t.senderId, t.createdAt),
  }),
);

