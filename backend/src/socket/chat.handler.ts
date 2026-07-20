/**
 * Chat realtime handler — 1-1 chat giữa ứng viên và nhà tuyển dụng
 */
import { Server as IOServer, Socket } from 'socket.io';
import { logger } from '../config/logger';

export const chatHandler = (io: IOServer, socket: Socket): void => {
  // Join conversation room
  socket.on('chat:join', (conversationId: string) => {
    socket.join(`conversation:${conversationId}`);
    logger.debug({ conversationId, userId: (socket as any).user?.userId }, 'Joined conversation');
  });

  // Send message
  socket.on('chat:message', async (data: { conversationId: string; content: string }) => {
    const userId = (socket as any).user?.userId;
    // TODO: persist to DB, then broadcast
    io.to(`conversation:${data.conversationId}`).emit('chat:message', {
      conversationId: data.conversationId,
      senderId: userId,
      content: data.content,
      createdAt: new Date().toISOString(),
    });
  });

  // Typing indicator
  socket.on('chat:typing', (data: { conversationId: string; isTyping: boolean }) => {
    socket.to(`conversation:${data.conversationId}`).emit('chat:typing', {
      userId: (socket as any).user?.userId,
      isTyping: data.isTyping,
    });
  });

  // Read receipt
  socket.on('chat:read', (data: { conversationId: string }) => {
    socket.to(`conversation:${data.conversationId}`).emit('chat:read', {
      userId: (socket as any).user?.userId,
      readAt: new Date().toISOString(),
    });
  });
};