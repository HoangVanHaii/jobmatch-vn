import { pgTable, uuid, integer, numeric, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { applications } from './applications';
import { jobs } from './jobs';
import { users } from './users';

/**
 * AI test lifecycle (migration 0045):
 *   - generating: BullMQ job đang chạy Gemini sinh đề (chưa review được)
 *   - ready:      đề hoàn chỉnh — employer review + giao được
 *   - failed:     LLM lỗi sau attempts (FE hiện nút thử lại)
 * Row cũ trước migration → default 'ready'.
 */
export const aiTestStatuses = ['generating', 'ready', 'failed'] as const;

export const aiTests = pgTable('ai_tests', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull(),
  /** Employer yêu cầu sinh đề (audit + quota sau này). */
  createdBy: uuid('created_by').references(() => users.id),
  testType: text('test_type').notNull(), // 'iq' | 'english'
  level: text('level'),
  questions: jsonb('questions').$type<Array<{
    id: string;
    type: string;
    question: string;
    options?: string[];
    correctAnswer?: string;
    points: number;
  }>>(),
  totalPoints: integer('total_points').default(0),
  durationMin: integer('duration_min'),
  passingScore: numeric('passing_score', { precision: 5, scale: 2 }).default('60'),
  status: text('status').notNull().default('ready'),
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
  /** Thời điểm CHẤM XONG — tách khỏi submittedAt (essay Gemini chấm trễ). */
  gradedAt: timestamp('graded_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** Anti-cheat MVP: IP lúc làm bài + cờ nghi ngờ (làm quá nhanh, perfect
   *  score, IP trùng assignment khác...). Machine chỉ ĐÁNH DẤU, HR quyết. */
  ipAddress: text('ip_address'),
  flags: jsonb('flags').$type<string[]>(),
}, (t) => ({
  testIdx: index('idx_test_assignments_test').on(t.testId),
}));
