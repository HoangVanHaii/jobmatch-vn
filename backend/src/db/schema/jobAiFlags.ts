import { pgTable, uuid, text, index } from 'drizzle-orm/pg-core';
import { jobAiScans } from './jobAiScans';
import { flagSeverityEnum } from './enums';

/**
 * 1 scan có N flags — mỗi vấn đề phát hiện được (vi phạm pháp luật lao động,
 * nội dung không phù hợp,...) tạo 1 record.
 */
export const jobAiFlags = pgTable('job_ai_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  scanId: uuid('scan_id').notNull().references(() => jobAiScans.id, { onDelete: 'cascade' }),
  severity: flagSeverityEnum('severity').notNull(),
  category: text('category').notNull(),
  field: text('field').notNull(), // title | description | requirements
  quote: text('quote').notNull(),
  reasoning: text('reasoning').notNull(),
  suggestion: text('suggestion'),
  lawRef: text('law_ref'),
}, (t) => ({
  scanIdx: index('idx_job_ai_flags_scan').on(t.scanId),
}));