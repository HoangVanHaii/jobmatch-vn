-- ============================================================================
-- 0010_cvs_status_and_isprimary_notnull.sql
-- (1) Thêm cột `status` (ENUM) cho bảng `cvs` để theo dõi lifecycle:
--       pending   - vừa upload, chờ parse
--       parsing   - worker đang parse
--       ready     - parse xong (parsedData populated)
--       failed    - parse fail (xem log để retry / xoá)
--       deleted   - soft delete (ẩn khỏi API list/get của owner)
--     Mặc định 'pending' cho row mới insert qua upload flow.
--
-- (2) Siết `is_primary` thành NOT NULL DEFAULT false.
--     Lý do: cột đã có default(false) từ trước (0000_init.sql) — chỉ là chưa
--     enforce NOT NULL. Về mặt ngữ nghĩa, mỗi CV "đang tồn tại" đều phải
--     rõ ràng primary hay không — không có chỗ cho NULL.
--     Trước khi ALTER, set default=false cho mọi row NULL hiện có (chỉ là
--     defensive — schema gốc đã default nên gần như không có NULL).
--
-- Idempotent:
--   - CREATE TYPE dùng DO block (CREATE TYPE không có IF NOT EXISTS).
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS (chạy lại nhiều lần OK).
--   - ALTER COLUMN SET NOT NULL chạy lại là no-op nếu đã NOT NULL.
--
-- CÁCH CHẠY:
--   1) Tất cả migration (Node, đứng từ backend/):
--        cd backend && npm run db:migrate
--      (scripts/migrate.ts pick file mới theo alphabet)
--
--   2) Riêng file này qua psql (Git Bash / PowerShell):
--        Get-Content backend/src/db/migrations/0010_cvs_status_and_isprimary_notnull.sql `
--          | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
--
--   3) DB mới (volume trống): docker entrypoint tự chạy 0000 → 0010 theo alphabet,
--      kết quả cuối cùng: cvs có status ENUM + is_primary NOT NULL DEFAULT false.
-- ============================================================================

BEGIN;

-- (1a) Tạo enum (idempotent — DO block vì CREATE TYPE không hỗ trợ IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cv_status') THEN
    CREATE TYPE cv_status AS ENUM ('pending', 'parsing', 'ready', 'failed', 'deleted');
  END IF;
END $$;

-- (1b) Thêm cột status.
--      Default 'pending' cho row mới upload (chưa parse xong).
--      Row hiện hữu: nếu parsedData IS NOT NULL → 'ready', ngược lại 'pending'.
ALTER TABLE cvs
  ADD COLUMN IF NOT EXISTS status cv_status NOT NULL DEFAULT 'pending';

-- Backfill row cũ đã parse xong từ trước (idempotent WHERE).
UPDATE cvs
  SET status = 'ready'
  WHERE status = 'pending'
    AND parsed_data IS NOT NULL;

-- (1c) Partial index hỗ trợ list-by-owner chỉ quét row "live"
--      (4 trạng thái đầu, loại trừ deleted). Composite (candidate_id, created_at DESC)
--      để query `WHERE candidate_id = $1 AND status != 'deleted' ORDER BY created_at DESC`
--      dùng index scan, không cần sort.
CREATE INDEX IF NOT EXISTS idx_cvs_owner_active
  ON cvs(candidate_id, created_at DESC)
  WHERE status <> 'deleted';

-- (2) Siết is_primary.
--     Bước defensive: set default false cho row NULL hiện có (schema cũ đã default
--     nên gần như không có NULL, nhưng thêm để an toàn nếu tay insert NULL).
UPDATE cvs
  SET is_primary = false
  WHERE is_primary IS NULL;

ALTER TABLE cvs
  ALTER COLUMN is_primary SET DEFAULT false,
  ALTER COLUMN is_primary SET NOT NULL;

COMMIT;

-- ============================================================================
-- NOTE về cập nhật Drizzle schema (làm thủ công SAU khi chạy migration):
--
--   File: backend/src/db/schema/cvs.ts
--   Trước:
--     isPrimary: boolean('is_primary').default(false),
--   Sau:
--     isPrimary: boolean('is_primary').notNull().default(false),
--
--   Và thêm cột mới (cùng thứ tự alphabet để diff dễ):
--     import { pgEnum } from 'drizzle-orm/pg-core';
--     export const cvStatusEnum = pgEnum('cv_status', [
--       'pending', 'parsing', 'ready', 'failed', 'deleted',
--     ]);
--
--     // Trong cvs table:
--     status: cvStatusEnum('status').notNull().default('pending'),
--
-- Lý do: Drizzle dùng `.notNull()` để generate type TS + migration. Nếu không
-- sửa thì drizzle-kit diff sẽ sinh lại migration "ngược" trong tương lai.
-- ============================================================================
