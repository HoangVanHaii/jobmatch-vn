import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { userRoleEnum, userStatusEnum } from './enums';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  role: userRoleEnum('role').notNull(),
  status: userStatusEnum('status').default('pending').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
}, (t) => ({
  roleIdx: index('idx_users_role').on(t.role),
}));

export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  phone: text('phone'),
  location: jsonb('location').$type<{ city?: string; district?: string; lat?: number; lng?: number }>(),
  social: jsonb('social').$type<{ linkedin?: string; github?: string; portfolio?: string }>(),
  preferences: jsonb('preferences').$type<Record<string, unknown>>(),
});