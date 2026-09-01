import { Router } from 'express';
import { auth, adminOnly } from '../middleware/auth';
import { adminRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { subscriptionController } from '../controller/subscription.controller';
import {
  subscriptionListQuerySchema,
  subscriptionIdParamsSchema,
  adminUpdateSubscriptionSchema,
} from '../middleware/subscription';

/**
 * Subscription router — mounted tại /api/v1/subscriptions (xem router/index.ts).
 *
 * Tất cả routes require auth (candidate/employer/admin đều có thể xem sub của mình).
 *
 * Routes:
 *   GET  /me?page=&limit=&status=     — Lịch sử subscription của user.
 *   GET  /:id                         — Chi tiết 1 subscription (ownership).
 *   GET  /    [admin]                 — List tất cả (filter + pagination).
 *   PATCH /:id  [admin]               — Cập nhật (extend expiry, force cancel, toggle autoRenew).
 */
export const subscriptionRouter = Router();

subscriptionRouter.use(auth);

// IMPORTANT: `/me` MUST be registered BEFORE `/:id` — Express matches top-down,
// nếu `/:id` đứng trước thì `/me` sẽ bị capture bởi param route (sai UUID → 400).
subscriptionRouter.get(
    '/me',
    validate(subscriptionListQuerySchema, 'query'),
    subscriptionController.listMine,
);

// 1. GET /subscriptions/:id — chi tiết (user xem của mình, admin xem tất cả)
//    Mount AFTER /me (so /me doesn't get captured by /:id).
subscriptionRouter.get(
    '/:id',
    validate(subscriptionIdParamsSchema, 'params'),
    subscriptionController.getById,
);

// 2. GET /subscriptions — admin list
subscriptionRouter.get(
    '/',
    adminOnly,
    adminRateLimiter,
    validate(subscriptionListQuerySchema, 'query'),
    subscriptionController.list,
);

// 3. PATCH /subscriptions/:id — admin update
subscriptionRouter.patch(
    '/:id',
    adminOnly,
    adminRateLimiter,
    validate(subscriptionIdParamsSchema, 'params'),
    validate(adminUpdateSubscriptionSchema),
    subscriptionController.update,
);