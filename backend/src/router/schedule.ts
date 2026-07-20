/**
 * Schedule / Interview router — Phase 3
 */
import { Router } from 'express';
import { auth, employerOnly, optionalAuth, candidateOrEmployer } from '../middleware/auth';
import { interviewService } from '../service/interview.service';

export const scheduleRouter = Router();

// HR xem availability của interviewer
scheduleRouter.get('/availability/:interviewerId', auth, employerOnly, async (_req, res, next) => {
  try {
    // TODO: query interviewer_availability
    res.json({ success: true, data: [] });
  } catch (err) { next(err); }
});

// HR tạo interview
scheduleRouter.post('/interview', auth, employerOnly, async (req, res, next) => {
  try {
    const result = await interviewService.create(req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// Ứng viên xác nhận (public via token)
scheduleRouter.get('/interview/confirm', optionalAuth, async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false });
    // TODO: trả thông tin interview cho ứng viên xem
    res.json({ success: true, data: null });
  } catch (err) { next(err); }
});

scheduleRouter.post('/interview/confirm', async (req, res, next) => {
  try {
    const { token, action } = req.body as { token: string; action: 'confirm' | 'reschedule' | 'cancel' };
    await interviewService.confirm(token, action);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// HR cancel
scheduleRouter.post('/interview/:id/cancel', auth, employerOnly, async (req, res, next) => {
  try {
    await interviewService.confirm(req.params.id, 'cancel');
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Interviewer nộp feedback
scheduleRouter.post('/interview/:id/feedback', auth, async (req, res, next) => {
  try {
    await interviewService.submitFeedback(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) { next(err); }
});