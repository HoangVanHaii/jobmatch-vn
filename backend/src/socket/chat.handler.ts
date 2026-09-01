import { Server as IOServer, Socket } from 'socket.io';
import { logger } from '../config/logger';
import { chatService } from '../service/chat.service';
import { notificationService } from '../service/notification.service';
import { MessagePayload, ReadPayload } from '../interface/chat';

export const chatHandler = (io: IOServer, socket: Socket): void => {
  // Join conversation room
  socket.on('chat:join', async (conversationId: string) => {
    const userId = (socket as any).user?.userId;
    try {
      const conv = await chatService.getById(conversationId);
      if (!conv) return socket.emit('chat:error', { code: 'NOT_FOUND' });
      const isMember = conv.userA === userId || conv.userB === userId;
      if (!isMember) return socket.emit('chat:error', { code: 'NOT_MEMBER' });
      socket.join(`conversation:${conversationId}`);
      logger.debug({ conversationId, userId }, 'Joined conversation');
      
    } catch (error) {
      logger.error({ error }, 'chat:join failed');
      socket.emit('chat:error', { code: 'INTERNAL' });
    }
    return;
  });

  // Send message
  socket.on('chat:message', async (data: MessagePayload) => {
    const userId = (socket as any).user?.userId;
    if (!data?.conversationId || !data?.content?.trim()) {
      return socket.emit('chat:error', { code: 'INVALID_PAYLOAD', message: 'Thiếu conversationId hoặc content' });
    }
    const content = data.content.trim();
    if (content.length > 5000) {
      return socket.emit('chat:error', { code: 'CONTENT_TOO_LONG' });
    }
    try {
      const conv = await chatService.getById(data.conversationId);
      const isMember = conv.userA === userId || conv.userB === userId
      if (!isMember) return socket.emit('chat:error', { code: 'NOT_MEMBER' });
      const peerId = conv.userA === userId ? conv.userB : conv.userA
      console.log(peerId);
      const message = await chatService.saveMessage(data, userId);

      io.to(`conversation:${data.conversationId}`).emit('chat:message', {
        id: message.id,
        conversationId: data.conversationId,
        senderId: userId,
        content: data.content,
        createdAt: message.createdAt,
        tempId: data.tempId
      });

      io.to(`user:${peerId}`).emit('chat:new', {
        conversationId: data.conversationId,
        lastMessage: {
          id: message.id,
          senderId: userId,
          content,
          createdAt: message.createdAt,
        },
      });
      // 8. notification nếu peer không trong room
      const inRoom = (await io.in(`conversation:${data.conversationId}`).fetchSockets())
        .some(s => (s as any).user?.userId === peerId);
      if (!inRoom) {
        await notificationService.create({
          userId: peerId,
          type: 'message',
          title: 'Tin nhắn mới',
          payload: { conversationId: data.conversationId, messageId: message.id },
        });
      }
    } catch (error) {
      logger.error({
        message: (error as any).message,
        code: (error as any).code,
        detail: (error as any).detail,
        position: (error as any).position,
      }, 'chat:message failed');
      socket.emit('chat:error', { code: 'INTERNAL' });
    }
    return;
  });

  // Typing indicator
  socket.on('chat:typing', (data: { conversationId: string; isTyping: boolean }) => {
    socket.to(`conversation:${data.conversationId}`).emit('chat:typing', {
      userId: (socket as any).user?.userId,
      conversationId: data.conversationId,
      isTyping: data.isTyping,
    });
  });

  // Read receipt
  socket.on('chat:read', async (data: ReadPayload) => {
    const userId = (socket as any).user?.userId;
    if (!userId) return;

    try {
      const conv = await chatService.getById(data.conversationId);
      if (!conv) return socket.emit('chat:error', { code: 'NOT_FOUND' });
      const isMember = conv.userA === userId || conv.userB === userId;
      if (!isMember) return socket.emit('chat:error', { code: 'NOT_MEMBER' });

      // 2. Update DB — set read_at cho tin của peer
      const readAt = await chatService.markAtRead(data, userId)

      // 3. Broadcast cho peer kia (sender gốc của messages) để UI update tick ✓✓.
      //    Lưu ý: `io.to(user:X).emit` GỬI TỚI MỌI socket của peer kia (kể cả đang
      //    ở device khác). Socket nhận tự filter userId === auth.user ở useChat.onRead
      //    nên việc broadcast tới cả 2 chiều không gây loop.
      const peerId = conv.userA === userId ? conv.userB : conv.userA;

      const readPayload = {
        userId,
        conversationId: data.conversationId,
        readAt: readAt.toISOString(),
        lastReadMessageId: data.lastReadMessageId,
      };

      // 3a. Conv room — cho client đang mở conv này (markRead tick update ngay).
      //     `socket.to(...)` loại trừ sender (người đọc) — đúng vì họ đã đọc rồi.
      socket.to(`conversation:${data.conversationId}`).emit('chat:read', readPayload);

      // 3b. User-personal room — quan trọng: nếu peer kia KHÔNG đang mở conv
      //     này (đang ở /chat sidebar hoặc conv khác), broadcast conv-room sẽ
      //     miss. user-personal room đảm bảo socket của họ LUÔN nhận được event
      //     này. Khi mở lại conv sau, fetchMessages sẽ lấy readAt từ DB (đã được
      //     cập nhật ở step 2) → ✓✓ hiển thị.
      io.to(`user:${peerId}`).emit('chat:read', readPayload);
    } catch (err) {
      logger.error({ err }, 'chat:read failed');
    }
    return;
  });
};