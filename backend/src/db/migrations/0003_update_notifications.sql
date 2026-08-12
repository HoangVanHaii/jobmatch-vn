-- ============================================================================
-- 0003_update_notifications.sql
-- Cải thiện bảng notifications:
--   1. Tạo ENUM notification_type (idempotent)
--   2. Drop cột body, rename data → payload, NOT NULL, default
--   3. Convert type TEXT → ENUM
--   4. Title VARCHAR(255)
--   5. Recreate index
--
-- File này DBeaver-friendly: mọi ALTER được wrap trong DO block
-- có check điều kiện, nên chạy nhiều lần hoặc chạy trên DB đã
-- update đều pass (no-op).
-- Chạy sau 0000/0001/0002 trên DB đã có bảng notifications cấu trúc cũ.
--
-- CÁCH CHẠY:
--   1) Chạy tất cả migration (Node, đứng từ thư mục backend/):
--        cd backend && npm run db:migrate
--      (script scripts/migrate.ts sẽ apply file *.sql theo thứ tự alphabet)
--
--   2) Chạy riêng file này qua psql trong Docker (PowerShell hoặc Git Bash đều dùng được, copy 1 dòng):
--        Get-Content backend/src/db/migrations/0003_update_notifications.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
--
--   3) DB mới (volume trống) — container tự chạy tất cả file trong
--      ./backend/src/db/migrations theo thứ tự alphabet:
--        docker compose down -v && docker compose up -d postgres
-- ============================================================================

BEGIN;

-- 1. Tạo ENUM notification_type (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE notification_type AS ENUM (
      'company_invite',
      'job_match',
      'message',
      'system'
    );
  END IF;
END $$;

-- 2. Pre-flight: chặn nếu title có row > 255 ký tự
DO $$
DECLARE max_title_len INT;
BEGIN
  SELECT max(length(title)) INTO max_title_len FROM notifications;
  IF max_title_len IS NOT NULL AND max_title_len > 255 THEN
    RAISE EXCEPTION 'notifications.title có row > 255 ký tự (max=%)', max_title_len;
  END IF;
END $$;

-- 3. Pre-flight: chặn nếu có type không nằm trong enum
DO $$
DECLARE bad_type TEXT;
BEGIN
  SELECT type INTO bad_type
  FROM notifications
  WHERE type NOT IN ('company_invite','job_match','message','system')
  LIMIT 1;
  IF bad_type IS NOT NULL THEN
    RAISE EXCEPTION 'notifications.type có giá trị không hợp lệ: %', bad_type;
  END IF;
END $$;

-- 4. Drop index cũ + cột body (idempotent)
DROP INDEX IF EXISTS idx_notifications_data;
DROP INDEX IF EXISTS idx_notifications_user_unread;
ALTER TABLE notifications DROP COLUMN IF EXISTS body;

-- 5. Rename data → payload (idempotent — skip nếu đã rename)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'data'
  ) THEN
    ALTER TABLE notifications RENAME COLUMN data TO payload;
  END IF;
END $$;

-- 6. Set NOT NULL cho payload (idempotent — chạy nhiều lần OK)
UPDATE notifications SET payload = '{}'::jsonb WHERE payload IS NULL;
ALTER TABLE notifications ALTER COLUMN payload SET DEFAULT '{}'::jsonb;
ALTER TABLE notifications ALTER COLUMN payload SET NOT NULL;

-- 7. Title VARCHAR(255) (idempotent — no-op nếu đã là VARCHAR)
ALTER TABLE notifications ALTER COLUMN title TYPE VARCHAR(255);

-- 8. Convert type TEXT → ENUM (idempotent — skip nếu đã là ENUM)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications'
      AND column_name = 'type'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE notifications
      ALTER COLUMN type TYPE notification_type USING type::notification_type;
  END IF;
END $$;

-- 9. Recreate indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_payload
  ON notifications USING GIN (payload);

COMMIT;
