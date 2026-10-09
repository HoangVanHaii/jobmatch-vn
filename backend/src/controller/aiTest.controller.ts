/**
 * AI test controller — employer endpoints (auth) + public candidate
 * endpoints (token-based). Pattern mirror referenceVerify.controller.
 */
import { Request, Response, NextFunction } from 'express';
import { aiTestService } from '../service/aiTest.service';
import { AppError } from '../middleware/errorHandler';

export const aiTestController = {
  generate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { jobId, testType } = req.body as { jobId: string; testType: 'iq' | 'english' };
      const data = await aiTestService.generateOrReuse({
        jobId,
        testType,
        employerId: userId,
        employerRole: req.user?.role ?? 'employer',
      });
      res.status(201).json({ success: true, data });
    } catch (err) { next(err); }
  },

  /** GET /job/:jobId — danh sách đề của job. */
  listForJob: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { jobId } = req.params as { jobId: string };
      const data = await aiTestService.listTestsForJob(
        jobId,
        userId,
        req.user?.role ?? 'employer',
      );
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /** GET /my/application/:applicationId — candidate xem test assignments của mình. */
  listMyAssignments: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { applicationId } = req.params as { applicationId: string };
      const data = await aiTestService.listAssignmentsForCandidate(applicationId, userId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /** GET /:testId — review đề đầy đủ (kèm đáp án). Employer owns job. */
  getTestDetail: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { testId } = req.params as { testId: string };
      const data = await aiTestService.getTestDetail(testId, userId, req.user?.role ?? 'employer');
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /** GET /application/:applicationId — assignments của application. */
  listAssignments: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { applicationId } = req.params as { applicationId: string };
      const data = await aiTestService.listAssignmentsForApplication(
        applicationId,
        userId,
        req.user?.role ?? 'employer',
      );
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /** GET /assignment/:assignmentId — chi tiết bài làm (đề + answers + điểm). */
  getAssignmentDetail: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { assignmentId } = req.params as { assignmentId: string };
      const data = await aiTestService.getAssignmentDetail(
        assignmentId,
        userId,
        req.user?.role ?? 'employer',
      );
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /** POST /assign — giao bài cho ứng viên + n8n gửi email. */
  assign: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { applicationId, testId } = req.body as { applicationId: string; testId: string };
      const data = await aiTestService.assignTest(
        { applicationId, testId },
        userId,
        req.user?.role ?? 'employer',
      );
      res.status(201).json({ success: true, data });
    } catch (err) { next(err); }
  },

  /** GET /public/:token — candidate mở link, lấy đề đã strip đáp án. */
  getPublicTest: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.params as { token: string };
      const data = await aiTestService.getPublicTest(token);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /** POST /public/:token/answer — autosave 1 câu (candidate chọn đáp án). */
  saveAnswer: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.params as { token: string };
      const { questionId, answer } = req.body as { questionId?: string; answer?: string };
      if (!questionId || typeof answer !== 'string') {
        throw new AppError(400, 'VALIDATION_ERROR', 'Cần questionId + answer');
      }
      await aiTestService.saveAnswer(token, questionId, answer);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  /** POST /public/:token/submit — candidate nộp bài. */
  submit: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.params as { token: string };
      const { answers } = req.body as { answers?: Record<string, string> };
      if (!answers || typeof answers !== 'object') {
        throw new AppError(400, 'VALIDATION_ERROR', 'answers phải là object {questionId: answer}');
      }
      // Anti-cheat MVP: log IP nộp bài.
      const ip = req.ip;
      const data = await aiTestService.submitTest(token, answers, ip);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },
};
