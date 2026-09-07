import { pgTable, uuid, integer, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { jobs } from './jobs';

export const jobFeedbacks = pgTable(
  'job_feedbacks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jobIdx: index('idx_job_feedbacks_job').on(t.jobId, t.createdAt),
    candidateIdx: index('idx_job_feedbacks_candidate').on(t.candidateId),
    uniqPerCandidate: unique('uniq_job_feedback_candidate').on(t.jobId, t.candidateId),
  }),
);
