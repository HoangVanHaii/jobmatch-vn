/**
 * AI test router — mount tại `/api/v1/ai-tests`.
 *
 * Employer (auth + ownership trong service):
 *   - POST /generate                        reuse-or-generate đề cho job
 *   - GET  /job/:jobId                      danh sách đề của job
 *   - GET  /:testId                         review đề đầy đủ (kèm đáp án)
 *   - GET  /application/:applicationId      assignments của application
 *   - POST /assign                          giao bài + n8n email
 *
 * Public (candidate làm bài qua /test/:token — token là proof-of-access):
 *   - GET  /public/:token          đề đã strip đáp án + shuffle
 *   - POST /public/:token/submit   nộp bài → chấm trắc nghiệm
 *
 * KHÔNG dùng router.use(auth) — public endpoints phải mở; employer
 * endpoints gắn auth per-route.
 */
import { Router } from 'express';
import { z } from 'zod';
import { auth, candidateOnly, employerOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { aiTestController } from '../controller/aiTest.controller';

export const aiTestRouter = Router();

const uuid = z.string().uuid();

// ----------------------------------------------------------------------------
// Employer endpoints
// ----------------------------------------------------------------------------

aiTestRouter.post(
  '/generate',
  auth,
  employerOnly,
  validate(z.object({ jobId: uuid, testType: z.enum(['iq', 'english']) })),
  aiTestController.generate,
);

aiTestRouter.get(
  '/job/:jobId',
  auth,
  employerOnly,
  validate(z.object({ jobId: uuid }), 'params'),
  aiTestController.listForJob,
);

aiTestRouter.get(
  '/application/:applicationId',
  auth,
  employerOnly,
  validate(z.object({ applicationId: uuid }), 'params'),
  aiTestController.listAssignments,
);

// Candidate xem test assignments của application mình — TRƯỚC '/:testId'.
aiTestRouter.get(
  '/my/application/:applicationId',
  auth,
  candidateOnly,
  validate(z.object({ applicationId: uuid }), 'params'),
  aiTestController.listMyAssignments,
);

// Chi tiết bài làm — TRƯỚC '/:testId' để 'assignment' không bị nuốt làm id.
aiTestRouter.get(
  '/assignment/:assignmentId',
  auth,
  employerOnly,
  validate(z.object({ assignmentId: uuid }), 'params'),
  aiTestController.getAssignmentDetail,
);

aiTestRouter.post(
  '/assign',
  auth,
  employerOnly,
  validate(z.object({ applicationId: uuid, testId: uuid })),
  aiTestController.assign,
);

// Đặt CUỐI employer group — '/:testId' nuốt mọi segment, các route cụ thể
// phải khai báo trước.
aiTestRouter.get(
  '/:testId',
  auth,
  employerOnly,
  validate(z.object({ testId: uuid }), 'params'),
  aiTestController.getTestDetail,
);

// ----------------------------------------------------------------------------
// Public endpoints (candidate)
// ----------------------------------------------------------------------------

// Token hex 64 ký tự — rác không chạm DB.
const tokenParam = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) });

aiTestRouter.get(
  '/public/:token',
  validate(tokenParam, 'params'),
  aiTestController.getPublicTest,
);

aiTestRouter.post(
  '/public/:token/answer',
  validate(tokenParam, 'params'),
  validate(z.object({ questionId: z.string().min(1), answer: z.string().max(500) })),
  aiTestController.saveAnswer,
);

aiTestRouter.post(
  '/public/:token/submit',
  validate(tokenParam, 'params'),
  validate(z.object({ answers: z.record(z.string()) })),
  aiTestController.submit,
);
