import { Router } from 'express';
import { auth } from '../middleware/auth';
import { db } from '../config/database';
import { notifications } from '../db/schema';
import { eq, desc, isNull, and } from 'drizzle-orm';

export const notificationRouter = Router();
notificationRouter.use(auth);

notificationRouter.get('/', async (req, res, next) => {
  try {
    const rows = await db.query.notifications.findMany({
      where: eq(notifications.userId, req.user!.userId),
      orderBy: [desc(notifications.createdAt)],
      limit: 50,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

notificationRouter.patch('/:id/read', async (req, res, next) => {
  try {
    const [n] = await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.id, req.params.id), eq(notifications.userId, req.user!.userId))).returning();
    res.json({ success: true, data: n });
  } catch (err) { next(err); }
});

notificationRouter.post('/read-all', async (req, res, next) => {
  try {
    await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.userId, req.user!.userId), isNull(notifications.readAt)));
    res.json({ success: true });
  } catch (err) { next(err); }
});