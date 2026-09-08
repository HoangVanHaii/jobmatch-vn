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

/**
 * Conversation + peer + unread count (response shape cho GET /conversations).
 *
 * Backend migration 0034: bỏ `jobId` (2-user unique).
 */
export interface ConversationWithPeer {
  id: string;
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

/**
 * Body POST /conversations
 *
 * Backend migration 0034: 2-user unique → bỏ `jobId` param. 2 user chỉ có
 * 1 conversation duy nhất bất kể job (trước đây mỗi job = 1 conv riêng).
 * Nếu cần truy ngữ cảnh job, lưu vào metadata của message đầu tiên hoặc
 * notification.payload — không FK cứng.
 */
export interface CreateConversationInput {
  peerUserId: string;
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
  /**
   * Attachments đính kèm (ảnh phase 1). Optional — message text-only sẽ
   * undefined hoặc array rỗng. FE render inline ảnh trong bubble dựa vào
   * đây. Shape match với BE `ClientAttachmentMeta` (strip `key`).
   */
  attachments?: ChatAttachment[];
}

/**
 * 1 attachment (ảnh/file) của message. Shape khớp với BE
 * `ClientAttachmentMeta` — không có `key` (BE-only).
 *
 * `name` là tên file gốc (cho Content-Disposition + hiển thị); BE trả về
 * qua buildContentDisposition → parse ở upload.service. Phase 1 (ảnh) có
 * thể không set `name` (fallback filename từ URL).
 */
export interface ChatAttachment {
  url: string;
  mime: string;
  sizeBytes: number;
  name?: string | null;
  width?: number | null;
  height?: number | null;
  kind?: 'image' | 'file';
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

// ---- GET /conversations/:id/attachments -------------------------------------

/**
 * Attachment + context (messageId, senderId, createdAt) cho side panel
 * "Ảnh & File". `createdAt` copy từ message cha để FE group by date hiển thị
 * header "Hôm nay / Hôm qua / dd/mm/yyyy".
 */
export interface ChatAttachmentWithContext extends ChatAttachment {
  messageId: string;
  senderId: string;
  createdAt: string;
}

/** Query GET /conversations/:id/attachments */
export interface ListAttachmentsParams {
  kind?: 'image' | 'file';
}

/** Response GET /conversations/:id/attachments */
export interface AttachmentListResult {
  items: ChatAttachmentWithContext[];
}

/** Body POST /conversations/:id/messages */
export interface SendMessageInput {
  content: string;
  tempId?: string;
  /**
   * Attachments đính kèm — phải upload trước qua `POST /uploads/image`
   * (folder='chat') rồi truyền `url` + `key` + `mime` + `sizeBytes` ở đây.
   * Phase 1: chỉ image. Service validate mime prefix `image/`.
   */
  attachments?: ChatAttachment[];
}

/**
 * Attachment shape khi upload qua `POST /uploads/image` — response trả về
 * `UploadResult` (xem services/upload.api.ts). Khi gửi kèm message, FE
 * map `size → sizeBytes` để khớp BE shape.
 */
export interface ChatAttachmentDraft {
  url: string;
  key: string;
  mime: string;
  sizeBytes: number;
  name?: string | null;
  width?: number | null;
  height?: number | null;
  kind?: 'image' | 'file';
}

// =========================================================================
// Socket event payloads (client ↔ server)
// =========================================================================

/** Body emit `chat:message` từ client */
export interface ChatMessagePayload {
  conversationId: string;
  content: string;
  tempId?: string;
  attachments?: ChatAttachmentDraft[];
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
    attachments?: ChatAttachment[];
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