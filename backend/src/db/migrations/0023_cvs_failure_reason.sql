-- =========================================================================
-- 0023 — Thêm cột `failure_reason` cho `cvs` để phân biệt nguyên nhân failed
--
-- Apply:
--   Get-Content backend/src/db/migrations/0023_cvs_failure_reason.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1

-- =========================================================================

-- NULL = CV không ở trạng thái failed, hoặc đang pending/parsing/ready.
-- Khi status='failed' → reason phải được set (worker/changeStatus đảm bảo).
ALTER TABLE cvs
  ADD COLUMN failure_reason TEXT;

-- Index để debug: liệt kê các CV fail theo reason (admin/report).
CREATE INDEX idx_cvs_failure_reason
  ON cvs(failure_reason)
  WHERE failure_reason IS NOT NULL;