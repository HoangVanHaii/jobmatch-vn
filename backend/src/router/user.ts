import { Router } from 'express';
import { auth } from '../middleware/auth';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { authService } from '../service/auth.service';
import { searchUsersQuerySchema } from '../middleware/user';
import { validate } from '../middleware/validate';

export const userRouter = Router();

userRouter.use(auth);

userRouter.get('/me', async (req, res, next) => {
  try {
    const user = await db.query.users.findFirst({ where: eq(users.id, req.user!.userId) });
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
    res.json({ success: true, data: { id: user.id, email: user.email, role: user.role, status: user.status, metadata: user.metadata } });
  } catch (err) { next(err); }
});

userRouter.patch('/me', async (req, res, next) => {
  try {
    // TODO: validate input
    const [user] = await db.update(users).set({ updatedAt: new Date() }).where(eq(users.id, req.user!.userId)).returning();
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

userRouter.get('/me/usage', async (req, res, next) => {
  try {
    // TODO: query usage_logs + plan.features
    res.json({ success: true, data: { usage: {}, quota: {} } });
  } catch (err) { next(err); }
});

/**
 * GET /users/search?q=&limit= — tìm user theo fullName để start chat.
 *
 * Response shape (id + fullName + avatarUrl + role only — không leak email/status/metadata).
 * Filter backend: exclude self, active status, chưa soft-delete. Sort theo fullName ASC.
 *
 * Auth: bắt buộc (router.use(auth) phía trên).
 */
userRouter.get(
  '/search',
  validate(searchUsersQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { q, limit } = req.query as unknown as { q: string; limit: number };
      const results = await authService.searchUsers(req.user!.userId, q, limit);
      res.json({ success: true, data: results });
    } catch (err) { next(err); }
  },
);