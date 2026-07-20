import { Router } from 'express';
import { auth, adminOnly } from '../middleware/auth';
import { db } from '../config/database';
import { users, jobs, companies, subscriptions, payments } from '../db/schema';
import { sql } from 'drizzle-orm';

export const adminRouter = Router();
adminRouter.use(auth, adminOnly);

// Stats
adminRouter.get('/stats', async (_req, res, next) => {
  try {
    const [{ count: userCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const [{ count: jobCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(jobs);
    const [{ count: companyCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(companies);
    res.json({ success: true, data: { userCount, jobCount, companyCount } });
  } catch (err) { next(err); }
});

// Users
adminRouter.get('/users', async (_req, res, next) => {
  try {
    const rows = await db.query.users.findMany({ limit: 50 });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

adminRouter.patch('/users/:id/ban', async (req, res, next) => {
  try {
    // TODO
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Pending jobs
adminRouter.get('/jobs/pending', async (_req, res, next) => {
  try {
    const rows = await db.query.jobs.findMany({ where: (j, { eq }) => eq(j.status, 'pending') });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

adminRouter.patch('/jobs/:id/approve', async (req, res, next) => {
  try {
    // TODO
    res.json({ success: true });
  } catch (err) { next(err); }
});