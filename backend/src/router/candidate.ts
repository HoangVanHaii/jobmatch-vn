/**
 * Candidate router — endpoints dành riêng cho role='candidate'.
 *
 * Mount: /candidates (xem router/index.ts).
 * Middleware: auth + candidateOnly (chỉ role=candidate mới qua được).
 */
import { Router } from 'express';
import { auth, candidateOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { updateCandidateProfileSchema } from '../middleware/user';
import { candidateController } from '../controller/candidate.controller';

export const candidateRouter = Router();
candidateRouter.use(auth, candidateOnly);

/**
 * Profile.
 *
 * - GET /candidates/profile — đọc profile (email + fullName + phone + location + social + preferences).
 * - PATCH /candidates/profile — partial update (validate qua zod schema).
 *
 * Endpoint này KHÔNG đụng email / role / status / avatar — các field đó có
 * flow riêng (verify-otp, admin, change-avatar).
 */
candidateRouter.get('/profile', candidateController.getProfile);
candidateRouter.patch(
  '/profile',
  validate(updateCandidateProfileSchema, 'body'),
  candidateController.updateProfile,
);

/**
 * Recommended jobs — placeholder cho Phase 3 (AI matching). Hiện trả mảng rỗng
 * để FE không vỡ.
 */
candidateRouter.get('/jobs/recommended', (_req, res) => res.json({ success: true, data: [] }));
