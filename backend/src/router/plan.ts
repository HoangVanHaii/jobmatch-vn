/**
 * Plan router — gộp public + admin CRUD vào 1 file (flat structure).
 *
 * Mounted tại /api/v1/plans (xem router/index.ts).
 *
 * Public routes (auth required):
 *   GET    /         → list plans
 *   GET    /:id      → chi tiết plan
 *
 * Admin only (auth + adminOnly + adminRateLimiter):
 *   POST   /         → tạo plan
 *   PATCH  /:id      → cập nhật
 *   DELETE /:id      → soft delete
 */
import { Router } from 'express';
import { auth, adminOnly } from '../middleware/auth';
import { adminRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { planController } from '../controller/plan.controller';
import {
  planListQuerySchema,
  planIdParamsSchema,
  planCreateSchema,
  planUpdateSchema,
} from '../middleware/plan';

export const planRouter = Router();

planRouter.use(auth);

planRouter.get(
  '/',
  validate(planListQuerySchema, 'query'),
  planController.list,
);

// GET /me — phải đặt TRƯỚC /:id để Express match "me" thay vì :id
planRouter.get('/me', planController.getMyPlan);

// GET /me/usage — quota + remainingDays cho BillingHistoryView. Cũng đặt TRƯỚC /:id.
planRouter.get('/me/usage', planController.getMyUsage);

planRouter.get(
  '/:id',
  validate(planIdParamsSchema, 'params'),
  planController.getById,
);

// ============ Admin only ============
planRouter.post(
  '/',
  adminOnly,
  adminRateLimiter,
  validate(planCreateSchema),
  planController.create,
);

planRouter.patch(
  '/:id',
  adminOnly,
  adminRateLimiter,
  validate(planIdParamsSchema, 'params'),
  validate(planUpdateSchema),
  planController.update,
);

planRouter.delete(
  '/:id',
  adminOnly,
  adminRateLimiter,
  validate(planIdParamsSchema, 'params'),
  planController.remove,
);
