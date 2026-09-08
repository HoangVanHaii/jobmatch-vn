import { pgTable, uuid, text, numeric, boolean, timestamp, jsonb, index, unique, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users';
import { jobs } from './jobs';
import { cvs } from './cvs';
import { applicationStatusEnum } from './enums';
import type { ApplicationCvSnapshot, ApplicationMatchReasoning } from '../../interface/application';

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  candidateId: uuid('candidate_id').notNull().references(() => users.id),
  jobId: uuid('job_id').notNull().references(() => jobs.id),
  /**
   * CV mà candidate dùng để apply. Required (NOT NULL) từ migration 0033.
   * Ràng buộc "1 CV - 1 job" thay cho "1 candidate - 1 job" — candidate có thể
   * apply cùng job bằng nhiều CV khác nhau, mỗi CV là 1 application riêng.
   * CASCADE: xoá CV → xoá application (application là snapshot 1 lần, không giữ
   * data mồ côi).
   */
  cvId: uuid('cv_id').notNull().references(() => cvs.id, { onDelete: 'cascade' }),
  cv: jsonb('cv').$type<ApplicationCvSnapshot>(),
  coverLetter: text('cover_letter'),
  status: applicationStatusEnum('status').default('pending').notNull(),
  stage: text('stage').default('new'),
  aiMatchScore: numeric('ai_match_score', { precision: 5, scale: 2 }),
  aiMatchReasoning: jsonb('ai_match_reasoning').$type<ApplicationMatchReasoning>(),
  isAnonymous: boolean('is_anonymous').default(false),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  viewedAt: timestamp('viewed_at', { withTimezone: true }),
}, (t) => ({
  jobStatusIdx: index('idx_applications_job_status').on(t.jobId, t.status),
  candidateIdx: index('idx_applications_candidate').on(t.candidateId, t.appliedAt),
  uniqCandidateJob: unique('uniq_cv_job').on(t.cvId, t.jobId),
}));

export const savedJobs = pgTable('saved_jobs', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  savedAt: timestamp('saved_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.jobId] }),
}));
