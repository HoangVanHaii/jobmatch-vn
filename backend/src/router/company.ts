import { Router } from 'express';
import { auth } from '../middleware/auth';
import { db } from '../config/database';
import { companies } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';

export const companyRouter = Router();

companyRouter.get('/:id', async (req, res, next) => {
  try {
    const company = await db.query.companies.findFirst({ where: eq(companies.id, req.params.id) });
    if (!company) throw new AppError(404, 'NOT_FOUND', 'Company not found');
    res.json({ success: true, data: company });
  } catch (err) { next(err); }
});

companyRouter.post('/', auth, async (req, res, next) => {
  try {
    const [company] = await db.insert(companies).values(req.body).returning();
    res.status(201).json({ success: true, data: company });
  } catch (err) { next(err); }
});

companyRouter.patch('/:id', auth, async (req, res, next) => {
  try {
    const [company] = await db.update(companies).set(req.body).where(eq(companies.id, req.params.id)).returning();
    res.json({ success: true, data: company });
  } catch (err) { next(err); }
});