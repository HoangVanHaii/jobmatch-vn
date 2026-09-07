-- 0033_application_cv_id.sql
--
-- Đổi ràng buộc "1 candidate - 1 job" → "1 CV - 1 job".
-- Một candidate giờ có thể apply CÙNG 1 job với NHIỀU CV khác nhau (mỗi CV
-- là 1 application riêng, có status + điểm AI match độc lập).
--
-- Đây là breaking change về data:
--   - TRUNCATE applications vì cột cv_id không có trên row cũ, không backfill được.
--     Các bảng liên quan (notifications, test_assignments, ...) có ON DELETE CASCADE
--     hoặc không FK cứng nên truncate application là đủ.
--   - cv_id: NOT NULL + FK ON DELETE CASCADE (CV xoá → application xoá theo,
--     vì application là snapshot 1 lần, không nên "mồ côi").
--   - Bỏ unique cũ (candidate_id, job_id), thay bằng (cv_id, job_id).
--   - Giữ index (candidate_id, applied_at) cho query "candidate đã apply những gì".
--
-- Nếu cần giữ data cũ: phải backfill cv_id từ cv jsonb → tạo row cvs mới cho mỗi
-- snapshot. Hiện tại không làm vì cv snapshot không có id gốc.

TRUNCATE TABLE applications CASCADE;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS cv_id UUID NOT NULL REFERENCES cvs(id) ON DELETE CASCADE;

-- Drop MỌI tên có thể có của constraint cũ:
--   - `uniq_candidate_job`: Drizzle default nếu declare có tên.
--   - `applications_candidate_id_job_id_key`: Postgres auto-generated khi
--     init SQL dùng `UNIQUE(candidate_id, job_id)` không chỉ định tên.
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'applications'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%(candidate_id, job_id)%'
  LOOP
    EXECUTE format('ALTER TABLE applications DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniq_cv_job'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT uniq_cv_job UNIQUE (cv_id, job_id);
  END IF;
END $$;
