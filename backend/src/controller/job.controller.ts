/**
 * Job controller — HTTP layer.
 * Validate/body đã được middleware/validate() chuẩn hóa; controller chỉ
 * destructure req.user, gọi service, trả JSON shape `{success, data?, message?}`.
 */
import { Request, Response, NextFunction } from 'express';
import { jobService } from '../service/job.service';
import { JobListQuery, JobSemanticSearchQuery } from '../middleware/job';

export const jobController = {
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = req.query as unknown as JobListQuery;
      const { data, total } = await jobService.list(filters);
      res.json({
        success: true,
        data,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
        }
      });
    } catch (err) { next(err); }
  },

  listOfCompany: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = req.query as unknown as JobListQuery;
      const companyId = req.params.companyId as string;
      const { data, total } = await jobService.list(filters, companyId);
      res.json({
        success: true,
        data,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
        }
      });
    } catch (err) { next(err); }
  },

  searchByKeyWord: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const keyword = req.query.keyword as string;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const { data, total } = await jobService.searchByKeyWord(keyword, page, limit);
      res.json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) { next(err); }
  },

  searchSemantic: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = req.query as unknown as JobSemanticSearchQuery;
      const { data } = await jobService.searchSemantic(filters);
      res.json({
        success: true,
        data,
        // semantic search không có "total" chính xác (threshold-based ranking)
        // nên chỉ trả data + limit
        meta: { query: filters.query, threshold: filters.threshold },
      });
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

  generate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const draft = await jobService.generateDraft(req.body);
      res.json({ success: true, data: draft });
    } catch (err) { next(err); }
  },

  submit: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const jobId = req.params.id as string;
      await jobService.submit(userId, jobId);
      res.json({ success: true, message: 'Job submitted for AI scan' });
    } catch (err) { next(err); }
  },

  resubmit: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobId = req.params.id as string;
      // Admin force re-scan (no ownership check needed)
      await jobService.forceScan(jobId);
      res.json({ success: true, message: 'Job queued for re-scan' });
    } catch (err) { next(err); }
  },

  getScanResult: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const role = req.user!.role;
      const jobId = req.params.id as string;
      const data = await jobService.getScanResult(userId, jobId, role);
      res.json({ success: true, data });
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
      await jobService.softDelete(userId, req.params.id as string);
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
