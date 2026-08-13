/**
 * Skills — API types/interfaces (input/output contract)
 *
 * File này CHỈ chứa TypeScript types/interfaces mô tả dữ liệu API vào/ra.
 * KHÔNG chứa Zod schema, validation rule, hay validation middleware.
 *
 * - Model type `Skill` derive từ Drizzle schema (DB shape) — dùng cho service return.
 * - Mỗi endpoint có 1 response interface riêng (1 API = 1 response type).
 * - Input types được khai báo tường minh (KHÔNG dùng `z.infer`) để giữ
 *   `interface` độc lập với `middleware`.
 */
import type { skills } from '../db/schema/skills';

/** Model Skill (1 dòng trong bảng skills) — derive từ Drizzle schema */
export type Skill = typeof skills.$inferSelect;

/**
 * Body của POST /skills.
 * Chỉ gồm name + slug; status mặc định 'active' (DB default).
 */
export interface CreateSkillInput {
  name: string;
  slug: string;
}

/**
 * Body PATCH /skills/:skillId (tất cả field optional).
 * Hiện chỉ cho phép đổi name/slug; status chỉ đổi qua soft-delete riêng.
 */
export interface UpdateSkillInput {
  name?: string;
  slug?: string;
}

/** Params /skills/:skillId */
export interface SkillIdParam {
  skillId: string;
}

/** Params /skills/slug/:slug */
export interface SkillSlugParam {
  slug: string;
}

/**
 * Response của POST /skills (tạo mới).
 * Trả về Skill vừa tạo, status 201.
 */
export type CreateSkillResponse = Skill;

/**
 * Response của PATCH /skills/:skillId (cập nhật info).
 * Trả về Skill sau khi update.
 */
export type UpdateSkillResponse = Skill;

/**
 * Response của GET /skills/:skillId và GET /skills/slug/:slug.
 */
export type GetSkillResponse = Skill;