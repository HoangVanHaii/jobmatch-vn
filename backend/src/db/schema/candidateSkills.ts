/**
 * candidate_skills — bảng gán skill cho candidate (user) chứ không gán cho CV.
 *
 * Quan hệ:
 *   - candidate_skills.candidate_id → users.id  (ON DELETE CASCADE)
 *   - candidate_skills.skill_id     → skills.id
 *
 * Lý do chọn per-candidate (không per-cv):
 *   - Đơn giản hoá dữ liệu: user add skill 1 lần, dùng cho mọi CV.
 *   - Phù hợp khi user có 1 CV (free tier) hoặc nhiều CV nhưng cùng
 *     một hồ sơ năng lực (light/pro tier).
 *   - Profile view + recommendation engine dễ aggregate.
 *
 * Constraint:
 *   - PK (candidate_id, skill_id): một candidate không thể có cùng 1 skill
 *     2 lần.
 *   - level: INT với CHECK 1..5 (DB enforce, service cũng validate để trả
 *     AppError 400 rõ ràng thay vì 500 khi vi phạm).
 *
 * File này tách riêng khỏi `skills.ts` (master + job_skills) và `cvs.ts`
 * (CV) vì logic business của candidate_skills là về quan hệ user ↔ skill,
 * không thuộc về master data. Việc tách cũng tránh import vòng giữa
 * schema và controller/service.
 */
import {
  pgTable,
  uuid,
  integer,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { skills } from './skills';
import { users } from './users';

export const candidateSkills = pgTable(
  'candidate_skills',
  {
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
    level: integer('level'),
  },
  (t) => [
    primaryKey({ columns: [t.candidateId, t.skillId] }),
    check('candidate_skills_level_check', sql`${t.level} BETWEEN 1 AND 5`),
  ],
);

export type CandidateSkill = typeof candidateSkills.$inferSelect;
export type NewCandidateSkill = typeof candidateSkills.$inferInsert;