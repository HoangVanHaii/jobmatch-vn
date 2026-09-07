-- =========================================================================
-- 0023 — Thêm cột `failure_reason` cho `cvs` để phân biệt nguyên nhân failed
--
-- Apply:
--   Get-Content backend/src/db/migrations/0023_cvs_failure_reason.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1

-- =========================================================================

-- Wrap để idempotent (skip nếu column đã tồn tại).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cvs' AND column_name = 'failure_reason'
  ) THEN
    ALTER TABLE cvs ADD COLUMN failure_reason TEXT;
  END IF;
END
$$;

-- Index để debug: liệt kê các CV fail theo reason (admin/report).
CREATE INDEX IF NOT EXISTS idx_cvs_failure_reason
  ON cvs(failure_reason)
  WHERE failure_reason IS NOT NULL;
