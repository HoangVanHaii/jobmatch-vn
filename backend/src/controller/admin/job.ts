/**
 * Admin Job controller — endpoint dành riêng cho Admin.
 * Bypass ownership check (admin có thể thao tác trên MỌI job).
 * POST /admin/jobs/.../resubmit dùng route cũ (POST /jobs/:id/resubmit)
 * đã có logic admin-only check.
 */
import { Request, Response, NextFunction } from 'express';
import { jobService } from '../../service/job.service';
import { JobListQuery } from '../../middleware/job';
import { JobStatus } from '../../interface/job';

export const adminJobController = {
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = req.query as unknown as JobListQuery;
      const { data, total } = await jobService.listAll(filters);
      res.json({
        success: true,
        data,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit) || 1,
        },
      });
    } catch (err) { next(err); }
  },

  counts: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await jobService.countByStatus();
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await jobService.getById(req.params.id as string);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /**
   * PATCH /admin/jobs/:id/status — admin override status.
   * Cho phép đổi bất kỳ status nào (kể cả live → closed để force-close job).
   */
  changeStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { status } = req.body as { status: JobStatus };
      await jobService.changeStatusAdmin(id, status);
      res.json({ success: true, message: `Đã cập nhật trạng thái job thành ${status}` });
    } catch (err) { next(err); }
  },
};
