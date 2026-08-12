/**
 * Job controller — HTTP layer.
 * Validate/body đã được middleware/validate() chuẩn hóa; controller chỉ
 * destructure req.user, gọi service, trả JSON shape `{success, data?, message?}`.
 */
import { Request, Response, NextFunction } from 'express';
import { jobService } from '../service/job.service';
import { JobListQuery } from '../middleware/job';

export const jobController = {
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = req.query as unknown as JobListQuery;
      const data = await jobService.list(filters);
      res.json({ success: true, data, pagination: { page: filters.page, limit: filters.limit } });
    } catch (err) { next(err); }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await jobService.getById(req.params.id as string);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await jobService.create(userId, req.body);
      res.status(201).json({ success: true, data });
    } catch (err) { next(err); }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await jobService.update(userId, req.params.id as string, req.body);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  delete: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      await jobService.delete(userId, req.params.id as string);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  getMatches: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await jobService.getMatches(userId, req.params.id as string);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },
} as const;
