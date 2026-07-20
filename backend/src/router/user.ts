import { Router } from 'express';
import { auth } from '../middleware/auth';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';

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