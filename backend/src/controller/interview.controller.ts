/**
 * Interview controller — Phần 1: HR/Employer
 *
 * Endpoints mount tại `/api/v1/interviews` (xem router/interview.ts).
 */
import { Request, Response, NextFunction } from 'express';
import { interviewService } from '../service/interview.service';
import { AppError } from '../middleware/errorHandler';
import type {
  CreateInterviewBody,
  UpdateInterviewBody,
  CancelInterviewBody,
  FeedbackBody,
  ListInterviewQuery,
  ListCandidateInterviewQuery,
  RejectInterviewBody,
} from '../middleware/interview';

export const interviewController = {
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const role = req.user!.role as 'employer' | 'admin';
      const body = req.body as CreateInterviewBody;

      const result = await interviewService.create(body, userId, role);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const role = req.user!.role as 'employer' | 'admin';
      const { status, applicationId, interviewerId, page, limit } = req.query as unknown as ListInterviewQuery;

      const result = await interviewService.list(userId, role, {
        status,
        applicationId,
        interviewerId,
        page: page ?? 1,
        limit: limit ?? 20,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const role = req.user!.role as 'employer' | 'admin';
      const { id } = req.params as { id: string };

      const result = await interviewService.getById(id, userId, role);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const role = req.user!.role as 'employer' | 'admin';
      const { id } = req.params as { id: string };
      const body = req.body as UpdateInterviewBody;

      const result = await interviewService.update(id, body, userId, role);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  cancel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const role = req.user!.role as 'employer' | 'admin';
      const { id } = req.params as { id: string };
      const { cancelReason } = req.body as CancelInterviewBody;

      const result = await interviewService.cancel(id, cancelReason, userId, role);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  submitFeedback: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const role = req.user!.role as 'employer' | 'admin';
      const { id } = req.params as { id: string };
      const feedback = req.body as FeedbackBody;

      const result = await interviewService.submitFeedback(id, feedback, userId, role);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  // --------------------------------------------------------------------------
  // Candidate-side
  // --------------------------------------------------------------------------

  listMy: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const { upcoming, page, limit } = req.query as unknown as ListCandidateInterviewQuery;

      const result = await interviewService.listByCandidate(userId, { upcoming, page, limit });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  getDetail: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      
      const interviewId = req.params.id as string;
      const data = await interviewService.getDetailByCandidate(interviewId, userId);
      
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  confirm: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const { id } = req.params as { id: string };

      const result = await interviewService.confirm(id, userId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  reject: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const { id } = req.params as { id: string };
      const { reason } = req.body as RejectInterviewBody;

      const result = await interviewService.reject(id, userId, reason);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
};