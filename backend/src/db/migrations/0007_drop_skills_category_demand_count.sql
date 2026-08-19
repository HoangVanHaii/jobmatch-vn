-- ============================================================================
-- 0007_drop_skills_category_demand_count.sql
-- Drop `category` và `demand_count` khỏi bảng `skills`.
--
-- Lý do: skill master data chỉ cần name/slug/status. `category` là string tự do
-- không chuẩn hoá, `demand_count` là field hệ thống nhưng hiện chưa có job nào
-- thực sự consume (sẽ tính qua COUNT(job_skills) khi cần → luôn đúng).
--
-- Idempotent: dùng IF EXISTS để chạy lại an toàn.
-- Thứ tự: drop index trước → drop column (index phụ thuộc column).
--
-- CÁCH CHẠY:
--   1) Tất cả migration (Node, đứng từ backend/):
--        cd backend && npm run db:migrate
--
--   2) Riêng file này qua psql (Git Bash):
--        Get-Content backend/src/db/migrations/0007_drop_skills_category_demand_count.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
--
--   3) DB mới (volume trống) — container tự chạy file này (no-op nhờ IF EXISTS):
--        docker compose down -v && docker compose up -d postgres
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS idx_skills_demand;
ALTER TABLE skills DROP COLUMN IF EXISTS category;
ALTER TABLE skills DROP COLUMN IF EXISTS demand_count;

COMMIT;