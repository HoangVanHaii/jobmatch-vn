-- =========================================================================
-- 0025 — notification_type: thêm 2 giá trị cho application flow
--
-- Lý do:
--   Khi candidate apply → cần 2 notification:
--     1. EMPLOYER (postedBy) biết "có 1 đơn apply mới" để refresh tab ứng tuyển
--        realtime. Bắn NGAY khi application insert, không đợi matching (queue có
--        thể down → employer vẫn cần biết có người apply).
--     2. CANDIDATE biết "AI matching xong" để render điểm + reasoning.
--        Bắn SAU khi worker chấm xong (success hoặc quota_exceeded).
--
-- Enum hiện tại: company_invite | job_match | message | system
-- Thêm:         application_new  | application_match_ready
--
-- Apply:
--   Get-Content backend/src/db/migrations/0025_notification_type_applications.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
-- =========================================================================

-- IF NOT EXISTS để idempotent nếu re-apply.
-- PostgreSQL không có ADD VALUE IF NOT EXISTS trên enum phải dùng cách này.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'notification_type' AND e.enumlabel = 'application_new'
    ) THEN
        ALTER TYPE notification_type ADD VALUE 'application_new';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'notification_type' AND e.enumlabel = 'application_match_ready'
    ) THEN
        ALTER TYPE notification_type ADD VALUE 'application_match_ready';
    END IF;
END
$$;
