/**
 * Chat broadcast helpers — tách logic phát realtime message ra khỏi socket
 * handler + REST controller để DRY.
 *
 * Hai caller:
 *   1. `socket/chat.handler.ts:27` — khi user emit `chat:message` qua socket.
 *   2. `controller/message.ts:send` — khi mini composer (vd JobDetailView)
 *      gửi qua REST POST /conversations/:id/messages (sync fallback).
 *
 * Cả hai cùng làm: broadcast `chat:message` tới conv-room, broadcast
 * `chat:new` tới peer personal-room, optional notification nếu peer
 * không có socket nào trong conv-room.
 *
 * Server bắt buộc share IO instance (qua `app.set('io', io)` ở server.ts).
 */

import { Server as IOServer } from 'socket.io';
import { notificationService } from '../service/notification.service';
import { logger } from '../config/logger';
import type { ClientAttachmentMeta, Message } from '../interface/chat';

interface ChatMessageBroadcastPayload {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  /** Optional — chỉ set khi caller gửi qua socket emit (echo về client). */
  tempId?: string;
  /**
   * Attachments đính kèm (vd. ảnh). Empty/missing = message chỉ có text.
   * FE render inline ảnh trong bubble dựa vào đây.
   */
  attachments?: ClientAttachmentMeta[];
}

interface ChatNewBroadcastPayload {
  conversationId: string;
  lastMessage: {
    id: string;
    senderId: string;
    content: string;
    createdAt: string;
    attachments?: ClientAttachmentMeta[];
  };
}

/**
 * Phát 1 message mới tới:
 *   1. Conv-room `conversation:${id}` — mọi socket đang open conv này (cả 2 chiều).
 *   2. Peer personal-room `user:${peerId}` — để sidebar/notification update.
 *
 * KHÔNG dùng `socket.to(...)` ở đây vì caller không phải socket — chỉ có `io`.
 *
 * `attachments` optional — phase 1 là ảnh paste từ clipboard / upload.
 */
export const broadcastMessageReceived = (
  io: IOServer,
  conv: { id: string; userA: string; userB: string },
  message: Message,
  senderId: string,
  tempId?: string,
  attachments: ClientAttachmentMeta[] = [],
): { peerId: string } => {
  const peerId = conv.userA === senderId ? conv.userB : conv.userA;

  // content (notNull) + createdAt (defaultNow().notNull()) + id (defaultRandom)
  // ở schema → runtime luôn có. TS mark optional vì derive từ $inferInsert;
  // dùng `!` non-null assertion.
  const content = message.content!;
  const createdAtIso = message.createdAt!.toISOString();
  const messageId = message.id!;

  const msgPayload: ChatMessageBroadcastPayload = {
    id: messageId,
    conversationId: conv.id,
    senderId,
    content,
    createdAt: createdAtIso,
    tempId,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
  io.to(`conversation:${conv.id}`).emit('chat:message', msgPayload);

  const newPayload: ChatNewBroadcastPayload = {
    conversationId: conv.id,
    lastMessage: {
      id: messageId,
      senderId,
      content,
      createdAt: createdAtIso,
      attachments: attachments.length > 0 ? attachments : undefined,
    },
  };
  io.to(`user:${senderId}`).emit('chat:new', newPayload);
  io.to(`user:${peerId}`).emit('chat:new', newPayload);

  return { peerId };
};

/**
 * Nếu peer KHÔNG có socket nào đang join conv-room → tạo notification row
 * để bell icon FE pick up. Peer đang trong conv thì socket đã đủ rồi.
 *
 * Trả về `true` nếu đã tạo notification, `false` nếu skip.
 */
export const notifyPeerIfNotInRoom = async (
  io: IOServer,
  conversationId: string,
  peerId: string,
  message: Message,
): Promise<boolean> => {
  const sockets = await io.in(`conversation:${conversationId}`).fetchSockets();
  const inRoom = sockets.some((s) => (s as unknown as { user?: { userId?: string } }).user?.userId === peerId);
  if (inRoom) return false;

  try {
    await notificationService.create({
      userId: peerId,
      type: 'message',
      title: 'Tin nhắn mới',
      payload: { conversationId, messageId: message.id },
    });
    return true;
  } catch (err) {
    logger.error({ err, conversationId, peerId }, 'chat notify failed');
    return false;
  }
};
