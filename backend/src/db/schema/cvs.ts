import {
  pgTable, uuid, text, boolean, timestamp, jsonb, index, integer,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { cvStatusEnum, cvSourceEnum } from './enums';
import type { AiAnalysis } from '../../interface/cv';

/**
 * CV của candidate — 2 loại:
 * - source='upload': fileUrl + fileType, parsedData điền bởi worker (status: pending → parsing → ready).
 * - source='direct': templateId 1-5 bắt buộc, parsedData user nhập tay qua form (status='ready' ngay).
 *
 * 'deleted' = soft delete (API list/get của owner ẩn row), giữ row + fileUrl cho cleanup sau.
 */
export const cvs = pgTable('cvs', {
  id: uuid('id').primaryKey().defaultRandom(),
  candidateId: uuid('candidate_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  fileUrl: text('file_url'),
  fileType: text('file_type'),
  isPrimary: boolean('is_primary').notNull().default(false),
  status: cvStatusEnum('status').notNull().default('pending'),
  source: cvSourceEnum('source').notNull().default('upload'),
  templateId: integer('template_id'),
  parsedData: jsonb('parsed_data').$type<{
    name?: string;
    email?: string;
    phone?: string;
    // URL fields cho phép null: PATCH semantics (RFC 7396) — null = xoá field.
    portfolio?: string | null;
    github?: string | null;
    linkedin?: string | null;
    facebook?: string | null;
    avatarUrl?: string | null;
    summary?: string;
    education?: Array<Record<string, unknown>>;
    experience?: Array<Record<string, unknown>>;
    skills?: string[];
    languages?: Array<Record<string, unknown>>;
    projects?: Array<Record<string, unknown>>;
    certifications?: Array<Record<string, unknown>>;
  }>(),
  ai_analysis: jsonb('ai_analysis').$type<AiAnalysis>(),
  scoreUpdatedAt: timestamp('score_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  candidateIdx: index('idx_cvs_candidate').on(t.candidateId),
  parsedDataIdx: index('idx_cvs_parsed_data').using('gin', t.parsedData),
}));
