import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  uniqueIndex,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';


export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userA: uuid('user_a').notNull().references(() => users.id),
    userB: uuid('user_b').notNull().references(() => users.id),
    /**
     * Last message timestamp — sort sidebar DESC + dùng cho cursor filter.
     * NULL cho conv vừa tạo, chưa có message.
     */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastMessagePreview: text('last_message_preview'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Luôn query "WHERE user_a = me OR user_b = me" + sort last_message_at desc.
    userAIdx: index('idx_conversations_user_a').on(t.userA, t.lastMessageAt),
    userBIdx: index('idx_conversations_user_b').on(t.userB, t.lastMessageAt),
    /**
     * Unique 2 user, không kèm job_id — migration 0034 đổi từ
     * (user_a, user_b, job_id) sang (user_a, user_b). 2 user chỉ có 1
     * conversation duy nhất, bất kể job.
     */
    pairUnique: uniqueIndex('uq_conversations_pair').on(t.userA, t.userB),
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

/**
 * chat_attachments — file/ảnh đính kèm message. Migration 0035 thêm bảng
 * này để hỗ trợ gửi ảnh trong chat (paste từ clipboard, upload file picker).
 *
 * Quyết định thiết kế:
 *   - Bảng riêng thay vì nhét JSON vào `chat_messages.metadata` — cho phép
 *     sau này mở rộng thêm preview/thumbnail/moderation mà không phá schema
 *     message. Cũng match pattern của Telegram/WhatsApp.
 *   - ON DELETE CASCADE theo message_id → xoá message thì attachments đi
 *     theo, tránh orphan rows khi admin moderation.
 *   - `width`/`height` optional — chỉ set cho image. Service đo bằng
 *     `image-size` lib khi upload (chưa làm — phase 2; phase 1 để null).
 *   - `kind` enum ('image'|'file') để FE render đúng (ảnh inline vs file
 *     download link). Phase 1 chỉ 'image' nhưng column sẵn sàng cho tương lai.
 */
export const chatAttachments = pgTable(
  'chat_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** S3/MinIO key (vd `uploads/{userId}/chat/2025-09/{uuid}-{name}.jpg`) — dùng để DELETE. */
    key: text('key').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /**
     * Tên file gốc (cho Content-Disposition + hiển thị ở client).
     * Phase 1 (image) optional; phase 2 (file) FE sẽ gửi kèm.
     */
    name: text('name'),
    width: integer('width'),
    height: integer('height'),
    /** Phase 1 chỉ 'image'. Phase 2 mở rộng 'file' (PDF/DOCX/...). */
    kind: text('kind').notNull().default('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    msgIdx: index('idx_chat_attachments_message').on(t.messageId),
  }),
);

/**
 * conversation_deletions — per-user soft delete cho conversation.
 *
 * Mỗi user có thể "xoá khỏi sidebar của mình" mà KHÔNG ảnh hưởng tới peer.
 * Composite PK (user_id, conversation_id) → idempotent UPSERT, không cần
 * explicit unique index. Xem migration 0037 để biết lý do tách bảng riêng.
 */
export const conversationDeletions = pgTable(
  'conversation_deletions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.conversationId] }),
    userIdx: index('idx_conversation_deletions_user').on(t.userId),
  }),
);

