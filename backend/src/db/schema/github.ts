import { pgTable, uuid, text, boolean, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

export const githubLookups = pgTable('github_lookups', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  exists: boolean('exists').notNull(),
  profileData: jsonb('profile_data').$type<{
    exists: boolean;
    has_activity?: boolean;
    public_repos?: number;
    followers?: number;
    following?: number;
    top_repos?: Array<{ name: string; stars: number; language: string; url: string }>;
    languages?: Record<string, number>;
    bio?: string;
    created_at?: string;
  }>(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});