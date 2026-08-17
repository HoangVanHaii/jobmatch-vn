import { pgTable, uuid, text, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const cvs = pgTable('cvs', {
  id: uuid('id').primaryKey().defaultRandom(),
  candidateId: uuid('candidate_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  fileUrl: text('file_url'),
  fileType: text('file_type'),
  isPrimary: boolean('is_primary').default(false),
  parsedData: jsonb('parsed_data').$type<{
    name?: string;
    email?: string;
    phone?: string;
    summary?: string;
    education?: Array<Record<string, unknown>>;
    experience?: Array<Record<string, unknown>>;
    skills?: string[];
    languages?: Array<Record<string, unknown>>;
    projects?: Array<Record<string, unknown>>;
    certifications?: Array<Record<string, unknown>>;
  }>(),
  aiScore: jsonb('ai_score').$type<{
    total: number;
    breakdown?: Record<string, number>;
    strengths?: string[];
    weaknesses?: string[];
    suggestions?: string[];
    missingKeywords?: string[];
  }>(),
  scoreUpdatedAt: timestamp('score_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  candidateIdx: index('idx_cvs_candidate').on(t.candidateId),
  parsedDataIdx: index('idx_cvs_parsed_data').using('gin', t.parsedData),
}));