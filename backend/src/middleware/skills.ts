/**
 * Skills middleware — Zod schemas + validation middleware.
 *
 * File này chỉ chịu trách nhiệm validation input cho Skills:
 *   - Khai báo Zod schemas.
 *   - Compose validation middleware từ generic `validate()` ở `middleware/validate.ts`.
 *
 * Quy ước đặt tên:
 *   - `<useCase>Schema`   → Zod schema
 *   - `validate<UseCase>` → middleware (export cho router dùng)
 *
 * Input types (`CreateSkillInput`, ...) và response types nằm ở
 * `interface/skills.ts` — interface và middleware tách trách nhiệm độc lập.
 */
import { z } from 'zod';
import { validate } from './validate';

/** Tạo skill — body của POST /skills. Chỉ có name + slug. */
export const createSkillSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().min(2).max(200),
});

/** Cập nhật skill — PATCH /skills/:skillId (tất cả field optional) */
export const updateSkillSchema = createSkillSchema.partial();

/** Params /skills/:skillId — validate UUID */
export const skillIdParamSchema = z.object({
  skillId: z.string().uuid(),
});

/** Params /skills/slug/:slug — validate non-empty string */
export const skillSlugParamSchema = z.object({
  slug: z.string().trim().min(1).max(200),
});

/**
 * Validation middleware — compose từ generic `validate()`.
 * Dùng ở router/skills.ts.
 */
export const validateCreateSkill = validate(createSkillSchema, 'body');
export const validateUpdateSkill = validate(updateSkillSchema, 'body');
export const validateSkillIdParam = validate(skillIdParamSchema, 'params');
export const validateSkillSlugParam = validate(skillSlugParamSchema, 'params');