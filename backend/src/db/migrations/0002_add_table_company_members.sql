-- ============================================================================
-- 0002_add_table_company_members.sql
-- Tạo bảng company_members + 2 ENUM (company_member_role, company_member_status).
-- Dùng IF NOT EXISTS nên idempotent — chạy nhiều lần vẫn OK.
-- Chạy sau 0000 + 0001.
--
-- CÁCH CHẠY:
--   1) Chạy tất cả migration (Node, đứng từ thư mục backend/):
--        cd backend && npm run db:migrate
--      (script scripts/migrate.ts sẽ apply file *.sql theo thứ tự alphabet)
--
--   2) Chạy riêng file này qua psql trong Docker (PowerShell hoặc Git Bash đều dùng được, copy 1 dòng):
--        Get-Content backend/src/db/migrations/0002_add_table_company_members.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
--
--   3) DB mới (volume trống) — container tự chạy tất cả file trong
--      ./backend/src/db/migrations theo thứ tự alphabet:
--        docker compose down -v && docker compose up -d postgres
-- ============================================================================

-- PostgreSQL KHÔNG hỗ trợ `CREATE TYPE IF NOT EXISTS` natively (chỉ CREATE TABLE
-- có). Idempotent qua DO block bắt exception `duplicate_object` (code 42710).
-- Cú pháp này chạy OK trên mọi PG ≥ 9.0 (kể cả 16).
DO $$ BEGIN
  CREATE TYPE company_member_role AS ENUM ('owner', 'member');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE company_member_status AS ENUM ('active', 'invited', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS company_members (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        company_member_role NOT NULL,
  status      company_member_status NOT NULL DEFAULT 'active',
  joined_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_company_members_user ON company_members(user_id);
