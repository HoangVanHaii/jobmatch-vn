
import { Request, Response, NextFunction } from 'express';
import { planService } from '../service/plan.service';
import type { PlanListQuery, PlanCreateBody, PlanUpdateBody } from '../middleware/plan';

export const planController = {

  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = req.query as unknown as PlanListQuery;
      const isAdmin = req.user?.role === 'admin';
      
      const safeFilters: PlanListQuery = {
        ...filters,
        includeInactive: isAdmin ? filters.includeInactive : false,
      };

      const { data, total } = await planService.list(safeFilters);
      res.json({
        success: true,
        data,
        pagination: {
          page: safeFilters.page,
          limit: safeFilters.limit,
          total,
          totalPages: Math.ceil(total / safeFilters.limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },


  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const isAdmin = req.user?.role === 'admin';
      const data = await planService.getById(id, isAdmin);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /plans/me — Trả plan hiện tại của user đang đăng nhập.
   * Trả `{ data: null }` nếu user chưa mua gói / sub hết hạn → frontend biết đang ở free.
   */
  getMyPlan: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await planService.getMyCurrentPlan(userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /plans/me/usage — Plan hiện tại + quota usage (count từ cvs/applications) + remainingDays.
   * Dùng cho BillingHistoryView section 1+2.
   *
   * Trả `{ data: { plan: null, ... usage: [] } }` nếu user chưa có sub active.
   */
  getMyUsage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await planService.getMyPlanUsage(userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as PlanCreateBody;
      const data = await planService.create(body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const body = req.body as PlanUpdateBody;
      const data = await planService.update(id, body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },


  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      await planService.softDelete(id);
      res.json({ success: true, message: 'Plan đã được deactivate' });
    } catch (err) {
      next(err);
    }
  },
};
