import type { conversations, chatMessages } from '../db/schema/chat';

// =========================================================================
// Model types (derive từ Drizzle)
// =========================================================================

/** 1 dòng trong bảng `conversations` */
export type Conversation = typeof conversations.$inferSelect;

/** Payload để insert 1 message mới (dùng cho service.saveMessage) */
export type Message = typeof chatMessages.$inferInsert;

// =========================================================================
// Socket payload (client → server)
// =========================================================================

/** Body emit `chat:message` từ client */
export interface MessagePayload {
  tempId?: string;
  conversationId: string;
  content: string;
}

/** Body emit `chat:read` từ client */
export interface ReadPayload {
  conversationId: string;
  lastReadMessageId: string;
}

// =========================================================================
// Response shapes (server → client)
// =========================================================================

/**
 * Snapshot tối thiểu của peer — service JOIN từ `users` + `user_profiles`.
  * Service chỉ trả các field công khai, KHÔNG trả email/sensitive.
 */
export interface ConversationPeer {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: 'candidate' | 'employer' | 'admin';
}

/**
 * Conversation kèm peer (peer = user còn lại so với currentUser).
 * Build bằng cách: pick userA/userB, so với currentUserId → peer là user còn lại.
 */
export interface ConversationWithPeer {
  id: Conversation['id'];
  jobId: Conversation['jobId'];
  lastMessageAt: Conversation['lastMessageAt'];
  lastMessagePreview: Conversation['lastMessagePreview'];
  createdAt: Conversation['createdAt'];
  peer: ConversationPeer;
  /** Số message của peer chưa được currentUser đọc */
  unreadCount: number;
}

/** Cursor opaque dạng base64url(JSON{ t: ISO timestamp, i: uuid }) */
export type Cursor = string;

// ---- GET /conversations -----------------------------------------------------

/** Query GET /conversations?cursor=&limit= */
export interface ListConversationsQuery {
  cursor?: Cursor;
  /** default 20, max 100 */
  limit?: number;
}

/** Response GET /conversations — sort lastMessageAt DESC NULLS LAST */
export interface ListConversationsResponse {
  items: ConversationWithPeer[];
  /** null = hết. Client truyền lại vào query.cursor lần sau */
  nextCursor: Cursor | null;
}

// ---- GET /conversations/:id/messages ----------------------------------------

/** Query GET /conversations/:id/messages?cursor=&limit= */
export interface ListMessagesQuery {
  cursor?: Cursor;
  /** default 50, max 200 */
  limit?: number;
}

/**
 * Response GET /conversations/:id/messages
 * Items sort DESC theo (createdAt, id) — mới nhất trước.
 * Client tự reverse trước khi render để chat scroll xuống.
 */
export interface ListMessagesResponse {
  items: ChatMessageRow[];
  nextCursor: Cursor | null;
  /** Còn trang tiếp theo không — client dùng để biết có "Load older" không */
  hasMore: boolean;
}

/** 1 dòng trong bảng `chat_messages` */
export interface ChatMessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

// =========================================================================
// Params
// =========================================================================

/** Params /conversations/:id/... */
export interface ConversationIdParam {
  id: string;
}