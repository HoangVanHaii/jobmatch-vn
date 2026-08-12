-- ============================================================================
-- 0004_unique_active_owner_per_company.sql
-- Partial UNIQUE index: mỗi company chỉ có tối đa 1 (role='owner', status='active').
-- Lớp bảo vệ CUỐI CÙNG cho business rule "1 active owner duy nhất" — chống race
-- condition mà application-level check (countOwners) không cover được (TOCTOU).
--
-- Idempotent: migrate.ts re-run toàn bộ file mỗi lần → dùng IF NOT EXISTS + DO block.
-- Chạy sau 0000/0001/0002/0003.
--
-- CÁCH CHẠY:
--   1) Chạy tất cả migration (Node, đứng từ thư mục backend/):
--        cd backend && npm run db:migrate
--      (script scripts/migrate.ts sẽ apply file *.sql theo thứ tự alphabet)
--
--   2) Chạy riêng file này qua psql trong Docker (PowerShell hoặc Git Bash đều dùng được, copy 1 dòng):
--        Get-Content backend/src/db/migrations/0004_unique_active_owner_per_company.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
--
--   3) DB mới (volume trống) — container tự chạy tất cả file trong
--      ./backend/src/db/migrations theo thứ tự alphabet:
--        docker compose down -v && docker compose up -d postgres
-- ============================================================================

BEGIN;

-- Pre-flight: chặn nếu đã có company có >1 active owner (dữ liệu lỗi từ trước).
-- Không tự sửa data — báo rõ để admin dọn tay trước khi tạo index.
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT company_id
    FROM company_members
    WHERE role = 'owner' AND status = 'active'
    GROUP BY company_id
    HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Phát hiện % company có nhiều hơn 1 active owner — không thể tạo unique index. Hãy dọn dữ liệu trước khi migrate.', dup_count;
  END IF;
END $$;

-- Partial unique index (chỉ index row owner active → 1 company tối đa 1 row như vậy)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_members_one_active_owner
  ON company_members (company_id)
  WHERE role = 'owner' AND status = 'active';

COMMIT;
