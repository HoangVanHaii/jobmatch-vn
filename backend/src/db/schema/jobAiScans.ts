import { pgTable, uuid, text, numeric, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';
import { scanVerdictEnum } from './enums';

export const jobAiScans = pgTable('job_ai_scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  verdict: scanVerdictEnum('verdict').notNull(),
  score: numeric('score', { precision: 3, scale: 2 }), // 0.00–1.00
  model: text('model').notNull(),
  rawResponse: jsonb('raw_response').$type<Record<string, unknown>>(),
  scannedAt: timestamp('scanned_at', { withTimezone: true }).defaultNow().notNull(),
  scannedBy: text('scanned_by').notNull().default('system'), // 'system' | userId
}, (t) => ({
  jobScannedAtIdx: index('idx_job_ai_scans_job').on(t.jobId, t.scannedAt.desc()),
}));