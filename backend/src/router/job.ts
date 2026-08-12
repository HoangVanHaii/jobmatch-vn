/**
 * Job router — y hệt pattern router/auth.ts:
 *   optionalAuth | auth → employerOnly → jobWriteRateLimiter → validate → controller.method
 */
import { Router } from 'express';
import { auth, optionalAuth, employerOnly } from '../middleware/auth';
import { jobWriteRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { jobController } from '../controller/job.controller';
import {
  jobListQuerySchema,
  jobCreateSchema,
  jobUpdateSchema,
  jobIdParamsSchema,
} from '../middleware/job';

export const jobRouter = Router();

// Public — list job live (search/filter/pagination ở query)
jobRouter.get('/', optionalAuth, validate(jobListQuerySchema, 'query'), jobController.list);

// Public — chi tiết + auto +1 views_count (atomic ở service)
jobRouter.get('/:id', optionalAuth, validate(jobIdParamsSchema, 'params'), jobController.getById);

// Employer tạo job
jobRouter.post(
  '/',
  auth,
  employerOnly,
  jobWriteRateLimiter,
  validate(jobCreateSchema),
  jobController.create,
);

// Employer cập nhật (ownership check ở service)
jobRouter.patch(
  '/:id',
  auth,
  employerOnly,
  jobWriteRateLimiter,
  validate(jobIdParamsSchema, 'params'),
  validate(jobUpdateSchema),
  jobController.update,
);

// Employer xóa (hard delete; cascade applications/job_skills)
jobRouter.delete(
  '/:id',
  auth,
  employerOnly,
  jobWriteRateLimiter,
  validate(jobIdParamsSchema, 'params'),
  jobController.delete,
);

// Employer xem top ứng viên match (stub — sort theo ai_match_score)
jobRouter.get(
  '/:id/matches',
  auth,
  employerOnly,
  validate(jobIdParamsSchema, 'params'),
  jobController.getMatches,
);
