/**
 * Reference Verification router — Phase 2
 */
import { Router } from 'express';
import { auth, optionalAuth, employerOnly } from '../middleware/auth';
import { referenceVerifyService } from '../service/referenceVerify.service';
import { db } from '../config/database';
import { referenceVerifications } from '../db/schema';
import { eq } from 'drizzle-orm';

export const referenceRouter = Router();

// Lấy references của 1 application
referenceRouter.get('/application/:applicationId', auth, employerOnly, async (req, res, next) => {
  try {
    const refs = await db.query.referenceVerifications.findMany({
      where: eq(referenceVerifications.applicationId, req.params.applicationId),
    });
    res.json({ success: true, data: refs });
  } catch (err) { next(err); }
});

// Gửi email xác minh
referenceRouter.post('/:id/send', auth, employerOnly, async (req, res, next) => {
  try {
    await referenceVerifyService.sendVerification(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Người tham chiếu click link verify (public route, no auth)
referenceRouter.get('/verify', optionalAuth, async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, error: { code: 'MISSING_TOKEN' } });
    const ref = await db.query.referenceVerifications.findFirst({
      where: eq(referenceVerifications.verificationToken, String(token)),
    });
    if (!ref) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    res.json({ success: true, data: { refereeName: ref.refereeName, expiresAt: ref.expiresAt } });
  } catch (err) { next(err); }
});

referenceRouter.post('/verify', async (req, res, next) => {
  try {
    const { token, confirmed, notes } = req.body as { token: string; confirmed: boolean; notes?: string };
    await referenceVerifyService.respond(token, { confirmed, notes });
    res.json({ success: true });
  } catch (err) { next(err); }
});