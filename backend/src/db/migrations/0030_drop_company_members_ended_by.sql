-- ============================================================================
-- 0030: Drop column ended_by khỏi company_members.
--
-- Cột ended_by (thêm ở migration 0027) ban đầu dùng để audit "ai đã kết
-- thúc membership này". Theo thiết kế mới: không cần biết owner nào đã
-- remove, chỉ cần biết membership đã kết thúc lúc nào (ended_at) là đủ.
-- Việc ghi nhận "ai xoá" overlap với notification `system` đã emit cho user
-- bị remove/leave, nên cột này dư thừa.
--
-- Drizzle schema đã được cập nhật để bỏ cột này (xem
-- src/db/schema/companyMembers.ts). Migration này áp dụng tương ứng cho DB.
-- ============================================================================

ALTER TABLE company_members DROP COLUMN IF EXISTS ended_by;
