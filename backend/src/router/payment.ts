import { Router } from 'express';
import { auth } from '../middleware/auth';
import { db } from '../config/database';
import { plans } from '../db/schema';

export const paymentRouter = Router();

paymentRouter.get('/plans', async (_req, res, next) => {
  try {
    const rows = await db.query.plans.findMany({ where: (p, { eq }) => eq(p.isActive, true) });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

paymentRouter.post('/subscriptions/checkout', auth, async (_req, res) => {
  // TODO: tạo PayOS order
  res.json({ success: true, data: { checkoutUrl: 'https://pay.payos.vn/...' } });
});

paymentRouter.get('/subscriptions/me', auth, async (_req, res) => {
  res.json({ success: true, data: null });
});

paymentRouter.post('/subscriptions/cancel', auth, async (_req, res) => {
  res.json({ success: true });
});