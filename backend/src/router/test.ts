/**
 * AI Test router — Phase 3
 */
import { Router } from 'express';
import { auth, employerOnly, optionalAuth } from '../middleware/auth';
import { aiTestService } from '../service/aiTest.service';

export const testRouter = Router();

// HR generate test cho JD
testRouter.post('/generate', auth, employerOnly, async (req, res, next) => {
  try {
    const { jobId, testType, level } = req.body as { jobId: string; testType: 'iq' | 'english'; level?: string };
    const testId = await aiTestService.generate(jobId, testType, level);
    res.json({ success: true, data: { testId } });
  } catch (err) { next(err); }
});

// HR assign test cho application
testRouter.post('/assign', auth, employerOnly, async (req, res, next) => {
  try {
    const { applicationId, testId } = req.body;
    const token = await aiTestService.assign(applicationId, testId);
    res.json({ success: true, data: { token } });
  } catch (err) { next(err); }
});

// Ứng viên lấy câu hỏi (public via token)
testRouter.get('/take/:token', optionalAuth, async (req, res, next) => {
  try {
    const data = await aiTestService.getQuestions(req.params.token);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// Ứng viên nộp bài
testRouter.post('/submit/:token', async (req, res, next) => {
  try {
    const { answers } = req.body as { answers: Record<string, any> };
    const result = await aiTestService.submit(req.params.token, answers);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// Xem kết quả
testRouter.get('/result/:assignmentId', auth, async (req, res, next) => {
  try {
    // TODO: query test_assignments
    res.json({ success: true, data: null });
  } catch (err) { next(err); }
});