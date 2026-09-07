-- =========================================================================
-- 0026 — notification_type: thêm application_withdrawn
--
-- Lý do:
--   Khi candidate rút đơn (PATCH /:id/withdraw, chỉ cho phép khi status
--   pending/viewed) → cần bắn notification cho employer (postedBy) để:
--     1. Bell realtime cho employer biết "ứng viên vừa rút đơn".
--     2. Dashboard đơn ứng tuyển auto refresh (xem FE ApplicationsView).
--
--   Vì sao cần notification riêng (không dùng 'system' chung):
--     - FE có thể filter type=application_withdrawn riêng để render icon/action
--       phù hợp (vd badge "đã rút" khác badge "có đơn mới").
--     - Phân biệt với 'application_new' trong notification list dropdown.
--
-- Enum hiện tại (sau 0025): company_invite | job_match | message | system |
--                          application_new | application_match_ready
-- Thêm:                application_withdrawn
--
-- Apply:
--   Get-Content backend/src/db/migrations/0026_notification_type_withdraw.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
-- =========================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'notification_type' AND e.enumlabel = 'application_withdrawn'
    ) THEN
        ALTER TYPE notification_type ADD VALUE 'application_withdrawn';
    END IF;
END
$$;
