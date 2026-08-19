
-- Apply:
--   Get-Content backend/src/db/migrations/0012_cvs_template_id_max_5.sql `
--     | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
-- ============================================================================

BEGIN;

-- Xoá CHECK cũ (idempotent)
ALTER TABLE cvs DROP CONSTRAINT IF EXISTS cvs_template_id_range;

-- Thêm CHECK mới với range 1-3 (NULL luôn pass qua CHECK trong Postgres)
ALTER TABLE cvs
  ADD CONSTRAINT cvs_template_id_range CHECK (
    template_id IS NULL OR (template_id BETWEEN 1 AND 5)
  );

COMMIT;
