/**
 * candidateSkill router — mounted at /me/skills (xem router/index.ts).
 *
 * Resource shape (toàn bộ là self-service — candidateId LUÔN từ JWT):
 *   - GET    /                       list skills của chính mình (auth)
 *   - GET    /:skillId               chi tiết 1 candidate_skill của mình
 *   - POST   /                       tạo (biết sẵn skillId)
 *   - POST   /by-name                tạo bằng name (lookup + insert idempotent)
 *   - PATCH  /:skillId               đổi level
 *   - DELETE /:skillId               xoá
 *
 * Authorization:
 *   - Tất cả routes yêu cầu `auth` (JWT bắt buộc) — không có optionalAuth.
 *   - candidateId KHÔNG có trong URL hay body. Controller tự lấy từ req.user.userId.
 *   - Nếu token sai / hết hạn → middleware auth throw 401 trước khi vào controller.
 *
 * Route order:
 *   /by-name mount TRƯỚC /:skillId để Express match chính xác "/by-name"
 *   thay vì nhận `by-name` làm :skillId (gây 400 invalid UUID).
 */
import { Router } from 'express';
import { auth } from '../middleware/auth';
import {
  validateAddCandidateSkillByName,
  validateCreateCandidateSkill,
  validateSkillIdParam,
  validateUpdateCandidateSkill,
} from '../middleware/candidateSkill';
import { candidateSkillController } from '../controller/candidateSkill.controller';

/** Sub-router — không mergeParams vì không có :candidateId. */
export const candidateSkillRouter = Router();

// --- Read (cần auth) ---
candidateSkillRouter.get(
  '/',
  auth,
  candidateSkillController.list,
);
candidateSkillRouter.get(
  '/:skillId',
  auth,
  validateSkillIdParam,
  candidateSkillController.getById,
);

// --- Write (cần auth, candidateId từ req.user.userId) ---
// /by-name đặt TRƯỚC /:skillId để Express match đúng.
candidateSkillRouter.post(
  '/by-name',
  auth,
  validateAddCandidateSkillByName,
  candidateSkillController.addByName,
);
candidateSkillRouter.post(
  '/',
  auth,
  validateCreateCandidateSkill,
  candidateSkillController.create,
);
candidateSkillRouter.patch(
  '/:skillId',
  auth,
  validateSkillIdParam,
  validateUpdateCandidateSkill,
  candidateSkillController.update,
);
candidateSkillRouter.delete(
  '/:skillId',
  auth,
  validateSkillIdParam,
  candidateSkillController.remove,
);