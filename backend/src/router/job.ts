/**
 * Job router — y hệt pattern router/auth.ts:
 *   optionalAuth | auth → employerOnly → jobWriteRateLimiter → validate → controller.method
 */
import { Router } from 'express';
import { auth, optionalAuth, employerOnly, adminOnly } from '../middleware/auth';
import { jobWriteRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { jobController } from '../controller/job.controller';
import {
  jobListQuerySchema,
  jobCreateSchema,
  jobUpdateSchema,
  jobIdParamsSchema,
  jobGenerateSchema,
  jobSearchQuerySchema,
  jobSemanticSearchQuerySchema,
} from '../middleware/job';

export const jobRouter = Router();

jobRouter.get('/search/semantic', optionalAuth, validate(jobSemanticSearchQuerySchema, 'query'), jobController.searchSemantic);
jobRouter.get('/search', optionalAuth, validate(jobSearchQuerySchema, 'query'), jobController.searchByKeyWord);
jobRouter.get('/company', optionalAuth, validate(jobListQuerySchema, 'query'), jobController.listOfCompany);
jobRouter.get('/', optionalAuth, validate(jobListQuerySchema, 'query'), jobController.list);
jobRouter.get('/:id', optionalAuth, validate(jobIdParamsSchema, 'params'), jobController.getById);


jobRouter.post(
  '/',
  auth,
  employerOnly,
  jobWriteRateLimiter,
  validate(jobCreateSchema),
  jobController.create,
);

jobRouter.post(
  '/generate',
  auth,
  employerOnly,
  jobWriteRateLimiter,
  validate(jobGenerateSchema),
  jobController.generate,
);

jobRouter.patch(
  '/:id',
  auth,
  employerOnly,
  jobWriteRateLimiter,
  validate(jobIdParamsSchema, 'params'),
  validate(jobUpdateSchema),
  jobController.update,
);

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

// Employer submit job để AI scan (status: draft|ai_flagged → ai_scanning)
jobRouter.post(
  '/:id/submit',
  auth,
  employerOnly,
  jobWriteRateLimiter,
  validate(jobIdParamsSchema, 'params'),
  jobController.submit,
);

// Admin force re-scan (không check status)
jobRouter.post(
  '/:id/resubmit',
  auth,
  adminOnly,
  jobWriteRateLimiter,
  validate(jobIdParamsSchema, 'params'),
  jobController.resubmit,
);

// Employer xem scan mới nhất + flags (chỉ chủ job; admin bypass)
jobRouter.get(
  '/:id/scan-result',
  auth,
  employerOnly,
  validate(jobIdParamsSchema, 'params'),
  jobController.getScanResult,
);

jobRouter.post(
  '/:id/export',
  auth,
  employerOnly,
  validate(jobIdParamsSchema, 'params'),
  jobController.requestExportApplications,
);