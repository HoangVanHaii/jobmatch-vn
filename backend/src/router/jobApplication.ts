import { Router } from 'express';
import { auth } from '../middleware/auth';
import { db } from '../config/database';
import { applications } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';

export const jobApplicationRouter = Router();
jobApplicationRouter.use(auth);

// Apply
jobApplicationRouter.post('/', async (req, res, next) => {
  try {
    const [app] = await db.insert(applications).values({
      ...req.body,
      candidateId: req.user!.userId,
    }).returning();
    res.status(201).json({ success: true, data: app });
  } catch (err) { next(err); }
});

// My applications
jobApplicationRouter.get('/me', async (req, res, next) => {
  try {
    const rows = await db.query.applications.findMany({
      where: eq(applications.candidateId, req.user!.userId),
      orderBy: [desc(applications.appliedAt)],
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// Update status (employer)
jobApplicationRouter.patch('/:id/status', async (req, res, next) => {
  try {
    const [app] = await db.update(applications)
      .set({ status: req.body.status, stage: req.body.stage, updatedAt: new Date() })
      .where(eq(applications.id, req.params.id))
      .returning();
    if (!app) throw new AppError(404, 'NOT_FOUND', 'Application not found');
    res.json({ success: true, data: app });
  } catch (err) { next(err); }
});