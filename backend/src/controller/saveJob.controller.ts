/**
 * SavedJob controller — handler cho /saved-jobs
 */
import { Request, Response, NextFunction } from 'express';
import { savedJobService } from '../service/savedJob.service';
import type { SavedJobListQuery } from '../middleware/savedJob';

export const savedJobController = {
  /** GET /saved-jobs — list job đã lưu, có filter + pagination */
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const filters = req.query as unknown as SavedJobListQuery;

      const result = await savedJobService.list(userId, filters);

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /** POST /saved-jobs — lưu 1 job */
  save: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { jobId } = req.body as { jobId: string };

      const row = await savedJobService.save(userId, jobId);

      res.status(201).json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },

  /** DELETE /saved-jobs/:jobId — bỏ lưu 1 job */
  unsave: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { jobId } = req.params as { jobId: string };

      await savedJobService.unsave(userId, jobId);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};