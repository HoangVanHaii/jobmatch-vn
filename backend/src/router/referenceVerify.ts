/**
 * Reference verification router — mount tại `/api/v1/references`.
 *
 * Endpoints:
 *   Employer (auth + ownership trong service):
 *   - GET  /application/:applicationId         list referees (source từ CV + verifications)
 *   - POST /application/:applicationId/send    gửi email xác minh qua n8n
 *
 *   Public (referee — token trong URL là proof-of-access, KHÔNG JWT):
 *   - GET  /public/:token          thông tin để render form confirm/decline
 *   - POST /public/:token/submit   referee xác nhận / từ chối
 *
 * Router này KHÔNG dùng `router.use(auth)` — auth per-route cho employer
 * endpoints vì 2 endpoints public phía dưới phục vụ referee (người ngoài,
 * không có tài khoản).
 */
import { Router } from 'express';
import { z } from 'zod';
import { auth, employerOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { referenceVerifyController } from '../controller/referenceVerify.controller';

export const referenceVerifyRouter = Router();

const sendVerificationBodySchema = z.object({
  refereeName: z.string().trim().min(1).max(200),
  refereeEmail: z.string().trim().email().max(320),
  relationship: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
});

const submitBodySchema = z.object({
  confirmed: z.boolean(),
  notes: z.string().trim().max(2000).optional(),
});

// ----------------------------------------------------------------------------
// Employer endpoints
// ----------------------------------------------------------------------------

referenceVerifyRouter.get(
  '/application/:applicationId',
  auth,
  employerOnly,
  validate(z.object({ applicationId: z.string().uuid() }), 'params'),
  referenceVerifyController.listForApplication,
);

referenceVerifyRouter.post(
  '/application/:applicationId/send',
  auth,
  employerOnly,
  validate(z.object({ applicationId: z.string().uuid() }), 'params'),
  validate(sendVerificationBodySchema),
  referenceVerifyController.send,
);

// ----------------------------------------------------------------------------
// Public endpoints (referee)
// ----------------------------------------------------------------------------

// Token là hex 64 ký tự (32 bytes) — validate format để rác không chạm DB query.
const tokenParamSchema = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) });

referenceVerifyRouter.get(
  '/public/:token',
  validate(tokenParamSchema, 'params'),
  referenceVerifyController.getByToken,
);

referenceVerifyRouter.post(
  '/public/:token/submit',
  validate(tokenParamSchema, 'params'),
  validate(submitBodySchema),
  referenceVerifyController.submit,
);
