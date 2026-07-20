/**
 * Notification realtime handler — push notification per user
 */
import { Server as IOServer, Socket } from 'socket.io';
import { logger } from '../config/logger';

export const notificationHandler = (io: IOServer, socket: Socket): void => {
  socket.on('notification:read', (data: { notificationId: string }) => {
    // TODO: mark as read in DB
    logger.debug({ notificationId: data.notificationId }, 'Notification marked as read');
  });
};

/** Helper — emit notification từ bất kỳ service nào */
export const emitNotification = (io: IOServer, userId: string, notification: unknown): void => {
  io.to(`user:${userId}`).emit('notification:new', notification);
};