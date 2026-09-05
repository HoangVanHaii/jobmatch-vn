import { pgTable, uuid, integer, numeric, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { applications } from './applications';

export const aiTests = pgTable('ai_tests', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull(),
  testType: text('test_type').notNull(), // 'iq' | 'english'
  level: text('level'),
  questions: jsonb('questions').$type<Array<{
    id: string;
    type: string;
    question: string;
    options?: string[];
    correctAnswer?: string;
    points: number;
  }>>().notNull(),
  totalPoints: integer('total_points').notNull(),
  durationMin: integer('duration_min').notNull(),
  passingScore: numeric('passing_score', { precision: 5, scale: 2 }).default('60'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  jobIdx: index('idx_ai_tests_job').on(t.jobId, t.testType),
}));

export const testAssignments = pgTable('test_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => applications.id),
  testId: uuid('test_id').notNull().references(() => aiTests.id),
  accessToken: text('access_token').notNull().unique(),
  status: text('status').default('pending'),
  answers: jsonb('answers').$type<Record<string, any>>(),
  score: numeric('score', { precision: 5, scale: 2 }),
  feedback: jsonb('feedback').$type<Record<string, any>>(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});