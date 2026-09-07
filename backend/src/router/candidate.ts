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
import { generateCoverLetterBodySchema } from '../middleware/coverLetter';
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
 * POST /candidates/me/cover-letter — sinh cover letter sync qua Gemini.
 *
 * Body: { jobId, cvId? }. cvId optional → nếu có sẽ cá nhân hoá theo CV.
 * Đặt dưới candidate router vì:
 *   - Chỉ candidate mới được xin cover letter (employer không cần).
 *   - Tận dụng candidateOnly middleware (đã mount ở trên).
 *   - Sync LLM call (không qua queue) — latency ~3-5s, chấp nhận được cho use-case 1 lần / apply.
 */
candidateRouter.post(
  '/me/cover-letter',
  validate(generateCoverLetterBodySchema, 'body'),
  candidateController.generateCoverLetter,
);

/**
 * Recommended jobs — placeholder cho Phase 3 (AI matching). Hiện trả mảng rỗng
 * để FE không vỡ.
 */
candidateRouter.get('/jobs/recommended', (_req, res) => res.json({ success: true, data: [] }));
