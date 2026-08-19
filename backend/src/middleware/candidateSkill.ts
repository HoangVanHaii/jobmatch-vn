/**
 * candidateSkill middleware — Zod schemas + validation middleware.
 *
 * Lưu ý sau refactor:
 *   - KHÔNG còn :candidateId trong URL → không cần validate param candidateId.
 *   - :skillId vẫn còn ở route /:skillId → cần validate UUID.
 *   - Body schemas giữ nguyên (skillId, name, level).
 */
import { z } from 'zod';
import { validate } from './validate';

/**
 * Body của POST /me/skills.
 * skillId bắt buộc, level optional (1..5).
 * KHÔNG có candidateId — lấy từ req.user.userId.
 */
export const createCandidateSkillSchema = z.object({
  skillId: z.string().uuid(),
  level: z.number().int().min(1).max(5).optional(),
});

/**
 * Body của POST /me/skills/by-name.
 * Lookup skill theo name (case-insensitive) rồi insert idempotent.
 */
export const addCandidateSkillByNameSchema = z.object({
  name: z.string().trim().min(1).max(200),
  level: z.number().int().min(1).max(5).optional(),
});

/**
 * Body PATCH /me/skills/:skillId.
 * Hiện chỉ hỗ trợ đổi level (1..5).
 */
export const updateCandidateSkillSchema = z.object({
  level: z.number().int().min(1).max(5).optional(),
});

/** Params /me/skills/:skillId — validate skillId UUID */
export const skillIdParamSchema = z.object({
  skillId: z.string().uuid(),
});

/**
 * Validation middleware — compose từ generic `validate()`.
 * Dùng ở router/candidateSkill.ts.
 */
export const validateCreateCandidateSkill = validate(
  createCandidateSkillSchema,
  'body',
);
export const validateAddCandidateSkillByName = validate(
  addCandidateSkillByNameSchema,
  'body',
);
export const validateUpdateCandidateSkill = validate(
  updateCandidateSkillSchema,
  'body',
);
export const validateSkillIdParam = validate(
  skillIdParamSchema,
  'params',
);