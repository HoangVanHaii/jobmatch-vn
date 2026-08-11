-- ============================================================================
-- 0005_one_active_membership_per_user.sql
-- Partial UNIQUE index: mỗi user chỉ có tối đa 1 row với status active/inactive
-- (tức là 1 user chỉ thuộc 1 công ty "thật" — đang làm việc hoặc đã từng).
--
-- Lớp bảo vệ CUỐI CÙNG cho rule "1 user = 1 company" — chống race condition (TOCTOU)
-- mà app-level check (getMembership) không cover được (vd 2 request accept/create
-- chạy đồng thời cùng pass check rồi cùng ghi active).
--
-- KHÔNG xét 'invited' → user vẫn có thể nhận nhiều lời mời cùng lúc (chưa accept
-- thì chưa tính là "thuộc"). Quy định này khớp với getMembership ở service.
--
-- Idempotent: migrate.ts re-run toàn bộ file mỗi lần → dùng IF NOT EXISTS + DO block.
-- Chạy sau 0000/0001/0002/0003/0004.
--
-- CÁCH CHẠY:
--   1) Chạy tất cả migration (Node, đứng từ thư mục backend/):
--        cd backend && npm run db:migrate
--      (script scripts/migrate.ts sẽ apply file *.sql theo thứ tự alphabet)
--
--   2) Chạy riêng file này qua psql trong Docker (PowerShell hoặc Git Bash đều dùng được, copy 1 dòng):
--        Get-Content backend/src/db/migrations/0005_one_active_membership_per_user.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
--
--   3) DB mới (volume trống) — container tự chạy tất cả file trong
--      ./backend/src/db/migrations theo thứ tự alphabet:
--        docker compose down -v && docker compose up -d postgres
-- ============================================================================

BEGIN;

-- Pre-flight: chặn nếu đã có user thuộc >1 công ty (active/inactive).
-- Không tự sửa data — báo rõ để admin dọn tay trước khi tạo index.
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT user_id
    FROM company_members
    WHERE status IN ('active', 'inactive')
    GROUP BY user_id
    HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Phát hiện % user thuộc nhiều hơn 1 công ty (active/inactive) — không thể tạo unique index. Hãy dọn dữ liệu trước khi migrate.', dup_count;
  END IF;
END $$;

-- Partial unique index: 1 user tối đa 1 row active/inactive (= 1 công ty "thật").
-- Trùng kiểu với uniq_company_members_one_active_owner (0004) nhưng chặn theo user_id.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_members_one_active_membership
  ON company_members (user_id)
  WHERE status IN ('active', 'inactive');

COMMIT;
