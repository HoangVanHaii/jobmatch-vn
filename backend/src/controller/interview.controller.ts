/**
 * Interview controller — Phần 1: HR/Employer
 *
 * Endpoints mount tại `/api/v1/interviews` (xem router/interview.ts).
 */
import { Request, Response, NextFunction } from 'express';
import { interviewService } from '../service/interview.service';
import { googleCalendarService } from '../service/googleCalendar.service';
import { env } from '../config/env';
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
      const { status, interviewType, applicationId, interviewerId, startDate, endDate, page, limit } = req.query as unknown as ListInterviewQuery;

      const result = await interviewService.list(userId, role, {
        status,
        interviewType,
        applicationId,
        interviewerId,
        startDate,
        endDate,
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

  // --------------------------------------------------------------------------
  // Google Calendar Integration
  // --------------------------------------------------------------------------

  getCalendarConnectUrl: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : undefined;
      const url = googleCalendarService.getConnectUrl(userId, returnTo);
      res.json({ success: true, data: { url } });
    } catch (err) {
      next(err);
    }
  },

  handleCalendarCallback: async (req: Request, res: Response): Promise<void> => {
    const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173';
    try {
      const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

      if (error) {
        console.error('Calendar OAuth error:', error);
        res.redirect(`${frontendUrl}/employer/settings?tab=dich-vu&calendar_error=${encodeURIComponent(error)}`);
        return;
      }

      if (!code || !state) {
        res.redirect(`${frontendUrl}/employer/settings?tab=dich-vu&calendar_error=missing_code_or_state`);
        return;
      }

      const { returnTo } = await googleCalendarService.handleCallback(code, state);
      const targetPath = returnTo || '/employer/settings?tab=dich-vu';
      const separator = targetPath.includes('?') ? '&' : '?';
      res.redirect(`${frontendUrl}${targetPath}${separator}calendar_connected=success`);
    } catch (err: any) {
      const msg = err?.message || 'connect_failed';
      console.error('Calendar OAuth error:', msg);
      res.redirect(`${frontendUrl}/employer/settings?tab=dich-vu&calendar_error=${encodeURIComponent(msg)}`);
    }
  },

  getCalendarStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const data = await googleCalendarService.getStatus(userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  disconnectCalendar: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      await googleCalendarService.disconnect(userId);
      res.json({ success: true, message: 'Đã hủy kết nối Google Calendar' });
    } catch (err) {
      next(err);
    }
  },

  getBusyTimes: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');

      const dateStr = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().split('T')[0];
      const startOfDay = new Date(`${dateStr}T00:00:00+07:00`);
      const endOfDay = new Date(`${dateStr}T23:59:59+07:00`);

      const busyTimes = await googleCalendarService.getBusyTimes({
        userId,
        timeMin: startOfDay,
        timeMax: endOfDay,
      });

      res.json({ success: true, data: { busyTimes } });
    } catch (err) {
      next(err);
    }
  },

  // --------------------------------------------------------------------------
  // Public Token Controllers
  // --------------------------------------------------------------------------

  getPublicByToken: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.query.token as string;
      const data = await interviewService.getPublicByToken(token);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  respondPublicByToken: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, action, reason, proposedTime } = req.body;
      const result = await interviewService.respondPublicByToken({
        token,
        action,
        reason,
        proposedTime,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
};