-- ============================================================================
-- 0026a — Mở rộng enum `company_member_status` với các value mới.
--
-- Tại sao file riêng:
--   PostgreSQL constraint: new enum value added inside a transaction chỉ
--   usable SAU khi transaction commit. Migration runner wrap trong BEGIN/COMMIT,
--   nên nếu file 0026_company_members_invite_lifecycle.sql (file sau) chạy
--   UPDATE với status='pending' / 'active' / etc. TRONG cùng transaction với
--   ALTER TYPE ADD VALUE — sẽ fail với lỗi 55P04 "unsafe use of new value".
--
--   Workaround: tách thành 2 file. File này chỉ ALTER TYPE → commit → values
--   sẵn sàng. File sau dùng values mới trong transaction mới — OK.
--
-- Idempotent — chạy nhiều lần OK nhờ IF NOT EXISTS.
-- ============================================================================

ALTER TYPE company_member_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE company_member_status ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE company_member_status ADD VALUE IF NOT EXISTS 'declined';
ALTER TYPE company_member_status ADD VALUE IF NOT EXISTS 'removed';
ALTER TYPE company_member_status ADD VALUE IF NOT EXISTS 'left';
ALTER TYPE company_member_status ADD VALUE IF NOT EXISTS 'auto_cancelled';
