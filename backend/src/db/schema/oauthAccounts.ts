import { pgTable, uuid, text, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { oauthProviderEnum } from './enums';

export const oauthAccounts = pgTable('oauth_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: oauthProviderEnum('provider').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  providerEmail: text('provider_email'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  scopes: text('scopes').array(),
  rawProfile: jsonb('raw_profile').$type<Record<string, unknown>>(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (t) => ({
  userIdx: index('idx_oauth_user').on(t.userId),
  providerEmailIdx: index('idx_oauth_provider_email').on(t.provider, t.providerEmail),
  uniqProviderUser: unique('uniq_oauth_provider_user').on(t.provider, t.providerUserId),
}));