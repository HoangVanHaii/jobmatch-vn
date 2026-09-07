import { Request, Response, NextFunction } from 'express';
import { applicationService } from '../service/application.service';
import { AppError } from '../middleware/errorHandler';

export const applicationController = {
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { jobId, cvId, coverLetter } = req.body as {
        jobId: string;
        cvId: string;
        coverLetter?: string;
      };
      const result = await applicationService.create({ jobId, cvId, coverLetter }, userId);
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  listMine: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { status, page, limit } = req.query as {
        status?: string;
        page?: number;
        limit?: number;
      };
      const result = await applicationService.listMine(userId, {
        status: status as any,
        page,
        limit,
      });
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;
      if (!userId || !role) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { id } = req.params as { id: string };
      const result = await applicationService.getById(id, userId, role);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  listByJob: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;
      if (!userId || !role) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { jobId } = req.params as { jobId: string };
      const { status, page, limit } = req.query as {
        status?: string;
        page?: number;
        limit?: number;
      };
      const result = await applicationService.listByJob(jobId, userId, role as any, {
        status: status as any,
        page,
        limit,
      });
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  listByCompany: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;
      if (!userId || !role) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { status, jobId, page, limit } = req.query as {
        status?: string;
        jobId?: string;
        page?: number;
        limit?: number;
      };
      const result = await applicationService.listByCompany(userId, role as any, {
        status: status as any,
        jobId,
        page,
        limit,
      });
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  updateStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;
      if (!userId || !role) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { id } = req.params as { id: string };
      const { status, stage } = req.body as { status: string; stage?: string };
      const result = await applicationService.updateStatus(id, userId, role as any, status as any, stage);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  recomputeMatch: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;
      if (!userId || !role) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { id } = req.params as { id: string };
      const result = await applicationService.recomputeMatch(id, userId, role as any);
      res.status(202).json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  withdraw: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { id } = req.params as { id: string };
      const result = await applicationService.withdraw(id, userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },
};
