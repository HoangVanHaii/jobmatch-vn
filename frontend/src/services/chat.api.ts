/**
 * Chat API — tầng giao tiếp với backend /api/v1/messages.
 *
 * Format theo pattern notification.api.ts: trả AxiosResponse, KHÔNG unwrap
 * ở đây. Nơi gọi tự destruct `const { data } = await ...` rồi lấy `data.data`.
 *
 * Endpoint backend (router message.ts):
 *   POST /conversations                 tạo hoặc lấy conversation với peer
 *   GET  /conversations                 list sidebar (cursor + peer + unread)
 *   GET  /conversations/:id/messages    list messages trong conv (cursor)
 *   POST /conversations/:id/messages    REST fallback cho socket (TODO)
 *   POST /conversations/:id/read        mark read (TODO)
 *
 * Lỗi 401 đã do interceptor trong http.ts tự refresh token; các lỗi khác
 * tự reject để store catch.
 */
import { http } from './http';
import type {
  ConversationListResult,
  ConversationWithPeer,
  CreateConversationInput,
  ListConversationsQuery,
  ListMessagesQuery,
  ListAttachmentsParams,
  MessageListResult,
  AttachmentListResult,
  SendMessageInput,
  ChatMessage,
} from '@/types/chat';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const chatApi = {
  /** POST /conversations — tạo hoặc lấy conversation với peer (kèm jobId optional) */
  createOrGet: (data: CreateConversationInput) =>
    http.post<ApiResponse<ConversationWithPeer>>('/messages/conversations', data),

  /** GET /conversations — sidebar (cursor, limit) */
  list: (params?: ListConversationsQuery) =>
    http.get<ApiResponse<ConversationListResult>>('/messages/conversations', { params }),

  /** GET /conversations/:id/messages — messages trong conv (cursor, limit) */
  listMessages: (conversationId: string, params?: ListMessagesQuery) =>
    http.get<ApiResponse<MessageListResult>>(`/messages/conversations/${conversationId}/messages`, { params }),

  /**
   * GET /conversations/:id/attachments — tất cả ảnh + file trong conv
   * (load all, không paginate). Filter optional theo `kind` ('image' | 'file').
   * Dùng cho side panel "Ảnh & File" — group by date ở FE.
   */
  listAttachments: (conversationId: string, params?: ListAttachmentsParams) =>
    http.get<ApiResponse<AttachmentListResult>>(`/messages/conversations/${conversationId}/attachments`, { params }),

  /** POST /conversations/:id/messages — REST fallback cho socket */
  sendMessage: (conversationId: string, data: SendMessageInput) =>
    http.post<ApiResponse<ChatMessage>>(`/messages/conversations/${conversationId}/messages`, data),

  /**
   * DELETE /conversations/:id — per-user soft delete (xoá khỏi sidebar của mình).
   * Peer KHÔNG bị ảnh hưởng. Idempotent — gọi nhiều lần vẫn 200 OK.
   */
  deleteConversation: (conversationId: string) =>
    http.delete<ApiResponse<{ id: string }>>(`/messages/conversations/${conversationId}`),
};