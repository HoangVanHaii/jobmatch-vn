
--   2) Riêng file này qua psql (Git Bash / PowerShell):
--        Get-Content backend/src/db/migrations/0011_cvs_source_and_template_id.sql `
--          | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1

BEGIN;

-- (1a) Tạo enum cv_source (idempotent — DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cv_source') THEN
    CREATE TYPE cv_source AS ENUM ('upload', 'direct');
  END IF;
END $$;

-- (1b) Thêm cột source.
--      Default 'upload' cho row hiện hữu (tất cả từ parseCvFile → upload).
--      Application code (cvService.create) sẽ explicit set 'direct'
--      cho CV tạo trên web.
ALTER TABLE cvs
  ADD COLUMN IF NOT EXISTS source cv_source NOT NULL DEFAULT 'upload';

-- (2) Thêm cột template_id.
--     Nullable (CV upload có template_id = NULL).
--     CHECK1..5 áp dụng khi giá trị không NULL (CHECK constraint ở Postgres
--     tự động bỏ qua nếu column nullable — NULL pass qua mọi CHECK).
ALTER TABLE cvs
  ADD COLUMN IF NOT EXISTS template_id INTEGER
  CHECK (template_id IS NULL OR (template_id BETWEEN 1 AND 5));

-- (3) Partial index cho filter CV direct (admin/report query nếu cần sau).
CREATE INDEX IF NOT EXISTS idx_cvs_source_direct
  ON cvs(candidate_id)
  WHERE source = 'direct';

COMMIT;
