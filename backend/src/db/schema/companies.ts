import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { companyStatusEnum } from './enums';

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  coverUrl: text('cover_url'),
  description: text('description'),
  industry: text('industry'),
  sizeRange: text('size_range'),
  website: text('website'),
  status: companyStatusEnum('status').default('active').notNull(),
  social: jsonb('social').$type<Record<string, string>>(),
  address: jsonb('address').$type<Record<string, unknown>>(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
}, (t) => ({
  industryIdx: index('idx_companies_industry').on(t.industry),
  metadataIdx: index('idx_companies_metadata').using('gin', t.metadata),
}));