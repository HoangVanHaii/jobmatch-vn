import { pgTable, uuid, timestamp, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { users } from './users';
import { companyMemberRoleEnum, companyMemberStatusEnum } from './enums';

export const companyMembers = pgTable(
  'company_members',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: companyMemberRoleEnum('role').notNull(),
    status: companyMemberStatusEnum('status').default('active').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.userId] }),
    userIdx: index('idx_company_members_user').on(t.userId),
    // Business rule "1 active owner duy nhất" — partial unique index là lớp bảo vệ
    // cuối cùng (chống race condition mà countOwners() không cover được).
    oneActiveOwner: uniqueIndex('uniq_company_members_one_active_owner')
      .on(t.companyId)
      .where(sql`role = 'owner' AND status = 'active'`),
  }),
);
