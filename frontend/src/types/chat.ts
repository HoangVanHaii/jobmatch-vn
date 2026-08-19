/**
 * Chat types — đồng bộ với backend (interface/chat.ts).
 * Frontend dùng làm contract khi gọi chatApi + socket events.
 */

/** Role của peer (cho hiển thị avatar label) */
export type PeerRole = 'candidate' | 'employer' | 'admin';

/** Snapshot peer — service JOIN từ users + user_profiles. */
export interface ConversationPeer {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: PeerRole;
}

/** Conversation + peer + unread count (response shape cho GET /conversations). */
export interface ConversationWithPeer {
  id: string;
  jobId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdAt: string;
  peer: ConversationPeer;
  unreadCount: number;
}

/** Kết quả phân trang (cursor-based). */
export interface ConversationListResult {
  items: ConversationWithPeer[];
  nextCursor: string | null;
}

/** Query GET /conversations */
export interface ListConversationsQuery {
  cursor?: string;
  limit?: number;
}

/** Body POST /conversations */
export interface CreateConversationInput {
  peerUserId: string;
  jobId?: string | null;
}

/** 1 dòng trong bảng chat_messages. */
export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
  /**
   * Local-only marker dùng để reconcile optimistic message với server echo.
   * - Khi mới gửi: `id === tempId` (placeholder), `tempId` set để reconcile tìm được.
   * - Sau khi server confirm: `id` = real uuid, `tempId` vẫn còn (để debug/trace).
   * - Server không bao giờ set field này — chỉ echo lại `tempId` qua socket.
   */
  tempId?: string;
}

/** Response GET /conversations/:id/messages */
export interface MessageListResult {
  items: ChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Query GET /conversations/:id/messages */
export interface ListMessagesQuery {
  cursor?: string;
  limit?: number;
}

/** Body POST /conversations/:id/messages */
export interface SendMessageInput {
  content: string;
  tempId?: string;
}

// =========================================================================
// Socket event payloads (client ↔ server)
// =========================================================================

/** Body emit `chat:message` từ client */
export interface ChatMessagePayload {
  conversationId: string;
  content: string;
  tempId?: string;
}

/** Server broadcast `chat:message` về client */
export interface ChatMessageBroadcast extends ChatMessage {
  tempId?: string;
}

/** Server push `chat:new` (sidebar update) */
export interface ChatNewPayload {
  conversationId: string;
  lastMessage: {
    id: string;
    senderId: string;
    content: string;
    createdAt: string;
  };
}

/** Body emit `chat:read` */
export interface ChatReadPayload {
  conversationId: string;
  lastReadMessageId: string;
}

/** Server broadcast `chat:read` về peer */
export interface ChatReadBroadcast {
  userId: string;
  conversationId: string;
  readAt: string;
  lastReadMessageId?: string;
}

/** Body emit `chat:typing` */
export interface ChatTypingPayload {
  conversationId: string;
  isTyping: boolean;
}

/** Server broadcast `chat:typing` */
export interface ChatTypingBroadcast {
  userId: string;
  conversationId: string;
  isTyping: boolean;
}