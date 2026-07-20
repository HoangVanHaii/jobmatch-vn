import { Router } from 'express';
import { auth, optionalAuth, employerOnly } from '../middleware/auth';
import { db } from '../config/database';
import { jobs } from '../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';

export const jobRouter = Router();

// Search + filter
jobRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { search, location, jobLevel, jobType, page = '1', limit = '20' } = req.query as Record<string, string>;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const conditions = [eq(jobs.status, 'live')];
    if (search) conditions.push(sql`${jobs.searchTsv} @@ plainto_tsquery('simple', ${search})`);
    if (jobLevel) conditions.push(eq(jobs.jobLevel, jobLevel as any));
    if (jobType) conditions.push(eq(jobs.jobType, jobType as any));

    const rows = await db.query.jobs.findMany({
      where: and(...conditions),
      orderBy: [desc(jobs.publishedAt)],
      limit: parseInt(limit, 10),
      offset,
    });
    res.json({ success: true, data: rows, pagination: { page: +page, limit: +limit } });
  } catch (err) { next(err); }
});

// Detail
jobRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, req.params.id) });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    // Increment view (fire and forget)
    db.update(jobs).set({ viewsCount: sql`${jobs.viewsCount} + 1` }).where(eq(jobs.id, job.id));
    res.json({ success: true, data: job });
  } catch (err) { next(err); }
});

// Create
jobRouter.post('/', auth, employerOnly, async (req, res, next) => {
  try {
    const [job] = await db.insert(jobs).values({ ...req.body, postedBy: req.user!.userId }).returning();
    res.status(201).json({ success: true, data: job });
  } catch (err) { next(err); }
});

// Update
jobRouter.patch('/:id', auth, employerOnly, async (req, res, next) => {
  try {
    const [job] = await db.update(jobs).set({ ...req.body, updatedAt: new Date() }).where(eq(jobs.id, req.params.id)).returning();
    res.json({ success: true, data: job });
  } catch (err) { next(err); }
});

// Delete
jobRouter.delete('/:id', auth, employerOnly, async (req, res, next) => {
  try {
    await db.delete(jobs).where(eq(jobs.id, req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// AI matches
jobRouter.get('/:id/matches', auth, employerOnly, async (req, res, next) => {
  try {
    // TODO: query applications.ai_match_score
    res.json({ success: true, data: [] });
  } catch (err) { next(err); }
});