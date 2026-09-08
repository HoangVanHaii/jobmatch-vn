/**
 * Admin Jobs router — endpoints dành riêng cho admin.
 * Mount tại /admin/jobs.
 *
 * Lưu ý: BẮT BUỘC dùng `validate(jobListQuerySchema, 'query')` cho GET /
 * vì service dùng `inArray(jobs.status, filters.status)` — nếu không parse,
 * `req.query.status` là string 'live' thay vì array ['live'] → inArray throw → 500.
 */
import { Router } from 'express';
import { auth } from '../../middleware/auth';
import { adminRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { jobListQuerySchema } from '../../middleware/job';
import { adminJobController } from '../../controller/admin/job';

export const adminJobRouter = Router();

adminJobRouter.use(auth);
adminJobRouter.use(adminRateLimiter);

adminJobRouter.get('/', validate(jobListQuerySchema, 'query'), adminJobController.list);
adminJobRouter.get('/counts', adminJobController.counts);
adminJobRouter.get('/:id', adminJobController.getById);
adminJobRouter.patch('/:id/status', adminJobController.changeStatus);
