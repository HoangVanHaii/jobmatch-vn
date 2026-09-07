-- =========================================================================
-- 0024 — Applications: bỏ FK cv_id, đổi metadata → cv (snapshot)
--
-- Lý do:
--   - cvId là FK → cvs.id. Khi candidate sửa/xoá CV, application cũ reference
--     đến row có thể đã đổi parsedData hoặc bị xoá mềm → mất context "ứng viên
--     đã nộp cái gì".
--   - Fix: lúc apply, BE query CV theo cvId rồi COPY các field cần thiết
--     (title, fileUrl, candidateId, templateId, parsedData) vào cột jsonb `cv`.
--     Kể từ đó application self-contained, application cũ vẫn hiển thị đúng CV
--     tại thời điểm apply dù candidate edit/delete CV sau đó.
--
-- Apply:
--   Get-Content backend/src/db/migrations/0024_applications_snapshot.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1

-- =========================================================================

-- Wrap để idempotent trên DB mới (0000_init đã dùng schema đích).
DO $$
BEGIN
  -- Drop cv_id FK + column nếu vẫn còn (DB cũ trước snapshot strategy).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'cv_id'
  ) THEN
    ALTER TABLE applications DROP COLUMN cv_id;
  END IF;

  -- Rename metadata → cv nếu chưa được rename (DB cũ).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'metadata'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'cv'
  ) THEN
    ALTER TABLE applications RENAME COLUMN metadata TO cv;
  END IF;
END
$$;

-- Optional: nếu cột mới `cv` muốn index để query "ai có CV này snapshot không",
-- để sau khi cần. Hiện tại chỉ đọc row đã biết id → không cần index.
