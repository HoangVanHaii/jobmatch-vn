import type { conversations, chatMessages, chatAttachments } from '../db/schema/chat';

// =========================================================================
// Model types (derive từ Drizzle)
// =========================================================================

/** 1 dòng trong bảng `conversations` */
export type Conversation = typeof conversations.$inferSelect;

/** Payload để insert 1 message mới (dùng cho service.saveMessage) */
export type Message = typeof chatMessages.$inferInsert;

/** 1 row trong `chat_attachments` — Drizzle infer select. */
export type ChatAttachment = typeof chatAttachments.$inferSelect;

/**
 * Thông tin metadata cho 1 attachment gửi kèm message.
 *
 * `key` (S3/MinIO key) chỉ cần ở BE — dùng để DELETE sau này qua
 * `DELETE /uploads?key=...`. Khi broadcast/persist response trả về client,
 * service strip `key` ra → chỉ giữ `url + mime + size + dimensions + kind`.
 *
 * `width`/`height` optional — phase 1 đo sau khi upload (FE có thể gửi kèm
 * nếu muốn tiết kiệm 1 query); phase 2 dùng `image-size` lib ở BE.
 */
export interface AttachmentMeta {
  url: string;
  key: string;
  mime: string;
  sizeBytes: number;
  /**
   * Tên file gốc (cho Content-Disposition + hiển thị ở client). Optional —
   * phase 1 (image) có thể không set vì URL đã chứa tên; phase 2 (file
   * non-image) thì BẮT BUỘC để client biết file name khi download.
   *
   * Type `string | null` (không phải `string | undefined`) để khớp với
   * drizzle return khi cột TEXT nullable trong DB — tránh cast khắp nơi.
   */
  name?: string | null;
  width?: number | null;
  height?: number | null;
  kind?: 'image' | 'file';
}

/**
 * Shape client nhận được qua socket broadcast + REST response — KHÔNG bao
 * gồm `key`. Service `listMessages` map DB row → `ClientAttachmentMeta`
 * trước khi trả về.
 */
export type ClientAttachmentMeta = Omit<AttachmentMeta, 'key'>;

// =========================================================================
// Socket payload (client → server)
// =========================================================================

/** Body emit `chat:message` từ client */
export interface MessagePayload {
  tempId?: string;
  conversationId: string;
  content: string;
  /**
   * Attachments đính kèm (vd. ảnh paste từ clipboard). Mỗi entry là metadata
   * trỏ tới file đã upload sẵn qua `POST /uploads/image`; BE chỉ lưu row
   * tham chiếu, KHÔNG đọc lại từ URL.
   *
   * Phase 1: chỉ image. Service validate `mime` thuộc image/* khi insert
   * attachments.
   */
  attachments?: AttachmentMeta[];
}

/**
 * Body POST /conversations/:id/messages — REST sync fallback.
 *
 * `tempId` optional — caller (FE) gửi kèm để reconcile optimistic UI; BE
 * echo lại qua socket `chat:message` broadcast.
 *
 * `attachments` cùng shape với socket `MessagePayload.attachments`.
 */
export interface SendMessageBody {
  content: string;
  tempId?: string;
  attachments?: AttachmentMeta[];
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
 *
 * Schema 0034 đã drop cột `jobId` (unique 2-user) — không còn jobContext
 * ở conv. Job liên quan được track qua notification payload (nếu cần).
 */
export interface ConversationWithPeer {
  id: Conversation['id'];
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
  /**
   * Attachments của message (ảnh/file). Optional trong response — service
   * `listMessages` luôn include, nhưng để optional để tương thích
   * forward/backward khi schema mở rộng.
   */
  attachments?: ClientAttachmentMeta[];
}

// =========================================================================
// Params
// =========================================================================

/** Params /conversations/:id/... */
export interface ConversationIdParam {
  id: string;
}

// ---- GET /conversations/:id/attachments -------------------------------------

/**
 * Query GET /conversations/:id/attachments?kind=image|file
 *
 * `kind` optional — không truyền = trả cả image + file (mixed). Filter ở DB
 * qua EXISTS subquery (không JOIN) để tránh duplicate row khi 1 message có
 * nhiều attachments.
 */
export interface ListAttachmentsQuery {
  kind?: 'image' | 'file';
}

/**
 * Attachment + ngữ cảnh (messageId, senderId, createdAt) để client group by
 * date và (tương lai) hiển thị "ai gửi". Không bao gồm `key` — same shape
 * với `ClientAttachmentMeta` để nhất quán với listMessages response.
 */
export interface AttachmentWithContext extends ClientAttachmentMeta {
  messageId: string;
  senderId: string;
  createdAt: string;
}

/**
 * Response GET /conversations/:id/attachments — load all, không paginate
 * (một conversation thường có vài chục attachments, đủ nhỏ để 1 lần fetch).
 * Sort DESC theo message.createdAt (mới nhất trước).
 */
export interface ListAttachmentsResponse {
  items: AttachmentWithContext[];
}