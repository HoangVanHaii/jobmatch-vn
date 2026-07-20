import { pgTable, uuid, text, numeric, boolean, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { jobs } from './jobs';
import { cvs } from './cvs';
import { applicationStatusEnum } from './enums';

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  candidateId: uuid('candidate_id').notNull().references(() => users.id),
  jobId: uuid('job_id').notNull().references(() => jobs.id),
  cvId: uuid('cv_id').references(() => cvs.id),
  coverLetter: text('cover_letter'),
  status: applicationStatusEnum('status').default('pending').notNull(),
  stage: text('stage').default('new'),
  aiMatchScore: numeric('ai_match_score', { precision: 5, scale: 2 }),
  aiMatchReasoning: jsonb('ai_match_reasoning').$type<{
    strengths?: string[];
    gaps?: string[];
    recommendation?: string;
  }>(),
  isAnonymous: boolean('is_anonymous').default(false),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  viewedAt: timestamp('viewed_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
}, (t) => ({
  jobStatusIdx: index('idx_applications_job_status').on(t.jobId, t.status),
  candidateIdx: index('idx_applications_candidate').on(t.candidateId, t.appliedAt),
  uniqCandidateJob: unique('uniq_candidate_job').on(t.candidateId, t.jobId),
}));

export const savedJobs = pgTable('saved_jobs', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  savedAt: timestamp('saved_at', { withTimezone: true }).defaultNow().notNull(),
});