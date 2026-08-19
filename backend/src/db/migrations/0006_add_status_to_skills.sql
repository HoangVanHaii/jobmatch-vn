-- ============================================================================
-- 0006_add_status_to_skills.sql
-- Thêm cột `status` cho bảng `skills` để hỗ trợ soft delete.
--
-- Skill master data do admin quản lý — thay vì DELETE row (mất khả năng audit /
-- restore), set status='deleted' và ẩn khỏi các API list/get. Database UNIQUE
-- trên `name` / `slug` vẫn giữ → không thể tạo skill mới trùng name/slug với
-- skill đã soft-delete (giữ ổn định URL/identifier).
--
-- Idempotent: dùng IF NOT EXISTS + DO block để chạy lại an toàn.
-- Chạy sau 0000/0001/.../0005.
--
-- CÁCH CHẠY:
--   1) Chạy tất cả migration (Node, đứng từ thư mục backend/):
--        cd backend && npm run db:migrate
--      (script scripts/migrate.ts sẽ apply file *.sql theo thứ tự alphabet)
--
--   2) Chạy riêng file này qua psql trong Docker (PowerShell hoặc Git Bash đều dùng được, copy 1 dòng):
--        Get-Content backend/src/db/migrations/0006_add_status_to_skills.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
--
--   3) DB mới (volume trống) — container tự chạy tất cả file trong
--      ./backend/src/db/migrations theo thứ tự alphabet:
--        docker compose down -v && docker compose up -d postgres
-- ============================================================================

BEGIN;

-- 1) Tạo enum type (idempotent — dùng DO block vì CREATE TYPE không hỗ trợ IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'skill_status') THEN
    CREATE TYPE skill_status AS ENUM ('active', 'deleted');
  END IF;
END $$;

-- 2) Thêm cột status (default 'active' cho row hiện hữu)
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS status skill_status NOT NULL DEFAULT 'active';

-- 3) Index hỗ trợ filter nhanh theo status (API list/get lọc status='active')
CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);

COMMIT;