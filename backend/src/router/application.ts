/**
 * Application router — mount tại `/api/v1/applications` (xem router/index.ts).
 *
 * Endpoints:
 *   - POST   /                       candidate apply job
 *   - GET    /me                     candidate list applications của mình
 *   - GET    /job/:jobId             employer list applications của 1 job
 *   - GET    /company                employer list applications của các company mình là member
 *   - PATCH  /:id/status             employer đổi status application
 *   - POST   /:id/recompute-match    employer yêu cầu chấm lại AI match (khi aiMatchScore=NULL)
 *   - PATCH  /:id/withdraw           candidate rút đơn ứng tuyển
 *
 * Middleware chain:
 *   - `auth` đầu tiên cho toàn router (mọi endpoint đều cần đăng nhập).
 *   - `candidateOnly` / `employerOnly` per-route cho role check.
 *   - `validate` per-route cho Zod validation (params / body / query riêng biệt).
 *
 * Thứ tự middleware quan trọng: auth → role → validate → controller.
 * Nếu sai thứ tự (vd validate trước auth), error handler không có req.user sẽ crash.
 *
 * Thứ tự route cũng quan trọng: các route cụ thể (`/me`, `/job/:jobId`, `/company`)
 * phải khai báo TRƯỚC `/:id/...` để Express không interpret "me"/"job" làm `:id`.
 */
import { Router } from 'express';
import { auth, candidateOnly, employerOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createApplicationBodySchema,
  jobIdParamSchema,
  applicationIdParamSchema,
  listApplicationQuerySchema,
  updateStatusBodySchema,
} from '../middleware/application';
import { applicationController } from '../controller/application.controller';

export const applicationRouter = Router();

// Toàn bộ router cần auth — candidate lẫn employer đều phải đăng nhập.
applicationRouter.use(auth);

// ----------------------------------------------------------------------------
// Candidate endpoints (role: candidate)
// ----------------------------------------------------------------------------

/**
 * POST / — candidate apply job.
 * Body: { jobId, cvId?, coverLetter? }
 */
applicationRouter.post(
  '/',
  candidateOnly,
  validate(createApplicationBodySchema),
  applicationController.create,
);

/**
 * GET /me — candidate list applications của mình.
 * Query: ?status=&page=&limit=
 *
 * Đặt TRƯỚC `/:id/status` để Express match đúng `/me` thay vì interpret `me`
 * làm `:id` (Express match path theo thứ tự khai báo).
 */
applicationRouter.get(
  '/me',
  candidateOnly,
  validate(listApplicationQuerySchema, 'query'),
  applicationController.listMine,
);

/**
 * PATCH /:id/withdraw — candidate rút đơn ứng tuyển.
 * Body: rỗng.
 *
 * Khai báo TRƯỚC `/:id/status` để Express match đúng `/withdraw` segment
 * thay vì interpret "withdraw" làm status value (z.enum sẽ reject nhưng
 * match theo pattern thì ambiguous).
 */
applicationRouter.patch(
  '/:id/withdraw',
  candidateOnly,
  validate(applicationIdParamSchema, 'params'),
  applicationController.withdraw,
);

// ----------------------------------------------------------------------------
// Employer endpoints (role: employer hoặc admin)
// ----------------------------------------------------------------------------

/**
 * GET /job/:jobId — employer list applications cho 1 job.
 * Phải match TRƯỚC `/:id/status` (cùng pattern với /me).
 */
applicationRouter.get(
  '/job/:jobId',
  employerOnly,
  validate(jobIdParamSchema, 'params'),
  validate(listApplicationQuerySchema, 'query'),
  applicationController.listByJob,
);

/**
 * GET /company — employer list applications của TẤT CẢ companies mình là member.
 * Query: ?status=&jobId=&page=&limit=
 */
applicationRouter.get(
  '/company',
  employerOnly,
  validate(listApplicationQuerySchema, 'query'),
  applicationController.listByCompany,
);

/**
 * PATCH /:id/status — employer đổi status.
 * Body: { status, stage? }
 */
applicationRouter.patch(
  '/:id/status',
  employerOnly,
  validate(applicationIdParamSchema, 'params'),
  validate(updateStatusBodySchema),
  applicationController.updateStatus,
);

/**
 * POST /:id/recompute-match — employer yêu cầu chấm lại AI match.
 * Body: rỗng.
 *
 * Use case: aiMatchScore = NULL (candidate hết quota lúc apply / queue down lúc đó).
 * Endpoint này enqueue lại job cv-match — worker sẽ chấm lại với quota charge cho candidate.
 */
applicationRouter.post(
  '/:id/recompute-match',
  employerOnly,
  validate(applicationIdParamSchema, 'params'),
  applicationController.recomputeMatch,
);

/**
 * GET /:id — xem detail 1 application (candidate hoặc employer).
 *
 * Đặt CUỐI cùng để không nuốt các route cụ thể hơn (`/me`, `/job/:jobId`,
 * `/company`, `/:id/status`, `/:id/recompute-match`, `/:id/withdraw`).
 *
 * Auth: middleware `auth` toàn router + auth scoping trong service.
 * Không cần `candidateOnly`/`employerOnly` ở đây — cả 2 role đều truy cập
 * được (mỗi role có scope riêng trong service).
 */
applicationRouter.get(
  '/:id',
  validate(applicationIdParamSchema, 'params'),
  applicationController.getById,
);
