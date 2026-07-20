/**
 * Auth controller — register, login, refresh, logout
 */
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { signAccessToken, signRefreshToken, verifyRefreshToken, revokeRefreshToken } from '../utils/jwt';
import { logger } from '../config/logger';

export const authController = {
  register: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password, fullName, role } = req.body as { email: string; password: string; fullName: string; role: 'candidate' | 'employer' };
      const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (existing) throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered');

      const passwordHash = await bcrypt.hash(password, 12);
      const [user] = await db.insert(users).values({ email, passwordHash, role, metadata: {} }).returning();
      // TODO: create profile, send verification email

      const payload = { userId: user.id, role: user.role as any, email: user.email };
      res.status(201).json({
        success: true,
        data: {
          user: { id: user.id, email: user.email, role: user.role },
          accessToken: signAccessToken(payload),
          refreshToken: signRefreshToken(payload),
        },
      });
    } catch (err) { next(err); }
  },

  login: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (!user || !user.passwordHash) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      const payload = { userId: user.id, role: user.role as any, email: user.email };
      res.json({
        success: true,
        data: {
          user: { id: user.id, email: user.email, role: user.role },
          accessToken: signAccessToken(payload),
          refreshToken: signRefreshToken(payload),
        },
      });
    } catch (err) { next(err); }
  },

  refresh: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body as { refreshToken: string };
      const payload = await verifyRefreshToken(refreshToken);
      await revokeRefreshToken(refreshToken);
      const newPayload = { userId: payload.userId, role: payload.role, email: payload.email };
      res.json({
        success: true,
        data: {
          accessToken: signAccessToken(newPayload),
          refreshToken: signRefreshToken(newPayload),
        },
      });
    } catch (err) { next(err); }
  },

  logout: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body as { refreshToken: string };
      if (refreshToken) await revokeRefreshToken(refreshToken);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  forgotPassword: async (_req: Request, res: Response): Promise<void> => {
    // TODO: send reset email
    res.json({ success: true, message: 'If email exists, reset link has been sent' });
  },

  resetPassword: async (_req: Request, res: Response): Promise<void> => {
    // TODO: validate token, hash new password
    res.json({ success: true });
  },
};