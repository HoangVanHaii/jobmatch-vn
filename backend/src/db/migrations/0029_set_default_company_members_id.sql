-- ============================================================================
-- 0029 — Set DEFAULT cho column `id` của `company_members`.
--
-- Tại sao file này tồn tại:
--   Migration 0027 THIẾU dòng `ALTER COLUMN id SET DEFAULT gen_random_uuid()`.
--   Drizzle schema có `defaultRandom()` nhưng chỉ dùng cho CREATE TABLE — migration
--   ADD COLUMN không tự set default. Khi application INSERT mà không specify id →
--   DB không có default → NULL → vi phạm PK constraint → error 23502.
--
--   Migration 0028 fix column `invited_at` nhưng cũng không sửa id (vì IDE linter
--   warning). File này fix riêng cột `id`.
--
-- Idempotent — chạy nhiều lần OK.
-- ============================================================================

ALTER TABLE company_members
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
