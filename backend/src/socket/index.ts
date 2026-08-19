import { Server as HttpServer } from 'http';
import { Server as IOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis } from '../config/redis';
import { socketAuth } from '../middleware/socketAuth';
import { chatHandler } from './chat.handler';
import { logger } from '../config/logger';
import { setNotificationGateway } from './notificationGateway';

export const setupSocket = (server: HttpServer): IOServer => {
  const io = new IOServer(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
    },
  });

  // Redis adapter — scale horizontal
  io.adapter(createAdapter(redis, redis.duplicate()));

  // Auth middleware
  io.use(socketAuth);

  setNotificationGateway(io);  
    
  io.on('connection', (socket) => {
    const userId = (socket as any).user?.userId;
    logger.info({ socketId: socket.id, userId }, 'Socket connected');

    if (userId) {
      socket.join(`user:${userId}`);
    }

    chatHandler(io, socket);

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Socket disconnected');
    });
  });

  return io;
};