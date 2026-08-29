
import { Router } from 'express';
import { auth, adminOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { adminRateLimiter } from '../middleware/rateLimit';
import { paymentController } from '../controller/payment.controller';
import {
  createPaymentSchema,
  orderCodeParamsSchema,
  paymentIdParamsSchema,
  paymentListQuerySchema,
} from '../middleware/payment';

export const paymentRouter = Router();

paymentRouter.use(auth);

paymentRouter.get(
    '/me',
    validate(paymentListQuerySchema, 'query'),
    paymentController.listMine,
);

paymentRouter.post(
    '/',
    validate(createPaymentSchema),
    paymentController.create,
);

paymentRouter.get(
    '/by-order/:orderCode',
    validate(orderCodeParamsSchema, 'params'),
    paymentController.getByOrderCode,
);

paymentRouter.get(
    '/:id',
    validate(paymentIdParamsSchema, 'params'),
    paymentController.getById,
);

paymentRouter.post(
    '/:id/cancel',
    validate(paymentIdParamsSchema, 'params'),
    paymentController.cancel,
);

paymentRouter.get(
    '/',
    adminOnly,
    adminRateLimiter,
    validate(paymentListQuerySchema, 'query'),
    paymentController.list,
);
