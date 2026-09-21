-- =========================================================================
-- 0035 — notification_type: thêm 3 giá trị cho interview feature
--
-- Lý do:
--   Khi HR tạo/cập nhật/hủy lịch phỏng vấn → cần notify candidate realtime:
--     1. interview_scheduled: candidate nhận ngay khi HR tạo lịch mới
--     2. interview_updated:   candidate nhận khi HR đổi giờ, link, người phỏng vấn
--     3. interview_cancelled: candidate nhận khi HR hủy lịch
--
-- Enum hiện tại (sau 0032):
--   company_invite | company | job_match | message | system |
--   application_new | application_match_ready | application_withdrawn
-- Thêm:
--   interview_scheduled | interview_updated | interview_cancelled
--
-- Apply:
--   Get-Content backend/src/db/migrations/0035_notification_type_interview.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
-- =========================================================================

-- IF NOT EXISTS để idempotent nếu re-apply.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'notification_type' AND e.enumlabel = 'interview_scheduled'
    ) THEN
        ALTER TYPE notification_type ADD VALUE 'interview_scheduled';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'notification_type' AND e.enumlabel = 'interview_updated'
    ) THEN
        ALTER TYPE notification_type ADD VALUE 'interview_updated';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'notification_type' AND e.enumlabel = 'interview_cancelled'
    ) THEN
        ALTER TYPE notification_type ADD VALUE 'interview_cancelled';
    END IF;
END
$$;

