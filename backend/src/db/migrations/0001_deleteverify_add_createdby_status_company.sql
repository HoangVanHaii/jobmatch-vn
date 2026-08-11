-- ============================================================================
-- 0001_deleteverify_add_createdby_status_company.sql
-- Companies (branch migration tổng hợp):
--   1) Bỏ cơ chế verify ad-hoc (verified_at / verified_by)
--   2) Thêm cột created_by (UUID tham chiếu users.id - user tạo company)
--   3) Thêm status (lifecycle: active/banned/removed)
--      thay thế cơ chế verify ad-hoc bằng lifecycle status.
-- Dùng IF EXISTS / IF NOT EXISTS (+ DO block cho CREATE TYPE) để chạy an toàn
-- trên cả DB cũ còn trường verify lẫn DB init mới (0000_init.sql đã reflect created_by).
-- Chạy tay trên DB đang chạy, hoặc tự động khi init volume mới.
--
-- CÁCH CHẠY:
--   1) Chạy tất cả migration (Node, đứng từ thư mục backend/):
--        cd backend && npm run db:migrate
--      (script scripts/migrate.ts sẽ apply file *.sql theo thứ tự alphabet)
--
--   2) Chạy riêng file này qua psql trong Docker (PowerShell hoặc Git Bash đều dùng được, copy 1 dòng):
--        Get-Content backend/src/db/migrations/0001_deleteverify_add_createdby_status_company.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
--
--   3) DB mới (volume trống) — container tự chạy tất cả file trong
--      ./backend/src/db/migrations theo thứ tự alphabet:
--        docker compose down -v && docker compose up -d postgres
-- ============================================================================

-- 1) Bỏ cơ chế verify ad-hoc
ALTER TABLE companies DROP COLUMN IF EXISTS verified_at;
ALTER TABLE companies DROP COLUMN IF EXISTS verified_by;

-- 2) Thêm created_by
ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- 3) Thêm status (lifecycle thay thế verify)
DO $$ BEGIN
  CREATE TYPE company_status AS ENUM ('active', 'banned', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS status company_status NOT NULL DEFAULT 'active';

-- Backfill: dòng đã tồn tại đánh dấu 'active' để dữ liệu hiện tại vẫn visible
UPDATE companies SET status = 'active';

CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
