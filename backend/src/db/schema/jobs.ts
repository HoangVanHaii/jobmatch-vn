import { pgTable, uuid, text, integer, numeric, boolean, timestamp, jsonb, index, customType } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { users } from './users';
import { jobStatusEnum, jobLevelEnum, jobTypeEnum } from './enums';

const tsvector = customType<{ data: string }>({ dataType() { return 'tsvector'; } });

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  postedBy: uuid('posted_by').notNull().references(() => users.id),
  title: text('title').notNull(),
  slug: text('slug'),
  description: text('description').notNull(),
  requirements: text('requirements'),
  benefits: text('benefits'),
  jobLevel: jobLevelEnum('job_level'),
  jobType: jobTypeEnum('job_type'),
  industry: text('industry'),
  salaryMin: numeric('salary_min', { precision: 15, scale: 0 }),
  salaryMax: numeric('salary_max', { precision: 15, scale: 0 }),
  salaryCurrency: text('salary_currency').default('VND'),
  salaryVisible: boolean('salary_visible').default(true),
  location: jsonb('location').$type<{ city?: string; district?: string; address?: string; lat?: number; lng?: number }>(),
  remoteOk: boolean('remote_ok').default(false),
  experienceYearsMin: integer('experience_years_min'),
  experienceYearsMax: integer('experience_years_max'),
  deadline: timestamp('deadline', { withTimezone: true }),
  status: jobStatusEnum('status').default('draft').notNull(),
  featured: boolean('featured').default(false),
  featuredUntil: timestamp('featured_until', { withTimezone: true }),
  viewsCount: integer('views_count').default(0).notNull(),
  appliesCount: integer('applies_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  extraData: jsonb('extra_data').default({}).$type<Record<string, unknown>>(),
  searchTsv: tsvector('search_tsv'),
}, (t) => ({
  companyIdx: index('idx_jobs_company').on(t.companyId),
  statusCreatedIdx: index('idx_jobs_status_created').on(t.status, t.createdAt),
  locationIdx: index('idx_jobs_location').using('gin', t.location),
  extraIdx: index('idx_jobs_extra_data').using('gin', t.extraData),
}));