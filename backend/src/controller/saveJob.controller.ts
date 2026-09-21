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

  /**
   * GET /saved-jobs/ids — chỉ trả về `jobId[]` user đã lưu (KHÔNG join jobs,
   * KHÔNG trả full SavedJobItem). Dùng cho client cần build Set<string> để
   * render bookmark icon — response nhỏ hơn nhiều so với `/saved-jobs` (chỉ
   * `["uuid1", "uuid2", ...]` thay vì nested objects).
   *
   * Auth required, không cần filter (nếu sau muốn filter thì thêm query param).
   * Return max `limit` IDs (default 100) — set lớn hơn chia batch.
   */
  listIds: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const ids = await savedJobService.listIds(userId, limit);
      res.json({ success: true, data: ids });
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