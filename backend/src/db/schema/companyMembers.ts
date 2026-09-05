import { pgTable, uuid, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { users } from './users';
import { companyMemberRoleEnum, companyMemberStatusEnum } from './enums';

/**
 * company_members — 1 row duy nhất per (company_id, user_id), reuse qua mọi
 * vòng đời invite (pending → active/declined → removed/left/auto_cancelled).
 *
 * Status lifecycle:
 *   pending → active           (user accept)
 *   pending → declined         (user decline)
 *   pending → auto_cancelled   (user accept invite khác — invite này bị huỷ)
 *   active  → removed          (owner xoá)
 *   active  → left             (user tự rời)
 *
 * Business rules:
 *   - UNIQUE (company_id, user_id): 1 user × 1 row per company, reuse lifecycle.
 *   - Partial unique index `uniq_active_owner_per_company`: 1 active owner duy
 *     nhất / company (BE check thêm ở code nhưng index là lớp chốt cuối chống race).
 *   - Soft delete — không bao giờ DELETE row, chỉ UPDATE status.
 *   - 1 user CHỈ active ở 1 công ty tại 1 thời điểm (check ở code khi accept).
 */
export const companyMembers = pgTable(
  'company_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: companyMemberRoleEnum('role').notNull().default('member'),
    status: companyMemberStatusEnum('status').notNull().default('pending'),
    /** User đã gửi lời mời — NULL cho owner tự tạo hoặc row cũ. */
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    /** Lần cuối user phản hồi invite (accept/decline/auto_cancel) — NULL nếu chưa phản hồi. */
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    /** Lần membership kết thúc (removed/left) — NULL khi đang active/pending. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** 1 row duy nhất per (company_id, user_id) — reuse lifecycle. */
    uniqCompanyUser: uniqueIndex('uniq_company_members_company_user').on(
      t.companyId,
      t.userId,
    ),
    /** Index cho query list members theo company + status. */
    companyStatusIdx: index('idx_company_members_company_status').on(
      t.companyId,
      t.status,
    ),
    /** Index cho query "user X đang active ở company nào" / "user X có pending invite ở đâu". */
    userStatusIdx: index('idx_company_members_user_status').on(t.userId, t.status),
    /** Business rule "1 active owner duy nhất" — partial unique index là lớp bảo vệ cuối cùng. */
    oneActiveOwner: uniqueIndex('uniq_active_owner_per_company')
      .on(t.companyId)
      .where(sql`role = 'owner' AND status = 'active'`),
    /** Index cho query "owner A đã mời ai" / audit. */
    invitedByIdx: index('idx_company_members_invited_by')
      .on(t.invitedBy)
      .where(sql`invited_by IS NOT NULL`),
  }),
);

/** Inferred row type — dùng cho service return values. */
export type CompanyMemberRow = typeof companyMembers.$inferSelect;
export type CompanyMemberInsert = typeof companyMembers.$inferInsert;
