import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { applications } from './applications';

export const referenceVerifications = pgTable('reference_verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  refereeName: text('referee_name').notNull(),
  refereeEmail: text('referee_email').notNull(),
  refereePhone: text('referee_phone'),
  relationship: text('relationship'),
  company: text('company'),
  duration: text('duration'),
  verificationToken: text('verification_token').notNull().unique(),
  status: text('status').default('pending'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  response: jsonb('response').$type<{ confirmed: boolean; notes?: string }>(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  appIdx: index('idx_ref_app').on(t.applicationId),
  tokenIdx: index('idx_ref_token').on(t.verificationToken),
  statusIdx: index('idx_ref_status').on(t.status, t.expiresAt),
}));