/**
 * Socket.IO auth middleware
 */
import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { JwtPayload } from './auth';

export const socketAuth = (socket: Socket, next: (err?: Error) => void): void => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Missing auth token'));
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    (socket as any).user = payload;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
};