/**
 * JWT auth middleware — verify access token, gắn req.user
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from './errorHandler';

export interface JwtPayload {
  userId: string;
  role: 'candidate' | 'employer' | 'admin';
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const auth = (req: Request, _res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header'));
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch (err) {
    next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
};

export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    req.user = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as JwtPayload;
  } catch {/* ignore */}
  next();
};