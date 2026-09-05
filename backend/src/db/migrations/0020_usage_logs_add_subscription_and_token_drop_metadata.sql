--Get-Content backend/src/db/migrations/0020_usage_logs_add_subscription_and_token_drop_metadata.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1

-- Idempotent:
--   1. ADD COLUMN IF NOT EXISTS — PG 9.6+ native
--   2. ADD COLUMN IF NOT EXISTS — PG 9.6+ native
--   3. DROP COLUMN IF EXISTS  — PG native
--   4. ALTER COLUMN SET DEFAULT không có IF NOT EXISTS — wrap DO block
--      check pg_catalog.pg_attrdef xem default đã tồn tại chưa.

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES subscriptions(id);

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS token INTEGER NOT NULL DEFAULT 0;

ALTER TABLE usage_logs
  DROP COLUMN IF EXISTS metadata;

-- Set default cho `count` chỉ khi chưa có (tránh overwrite default user đã custom).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attrdef ad
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
    JOIN pg_catalog.pg_class c
      ON c.oid = ad.adrelid
    JOIN pg_catalog.pg_namespace n
      ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'usage_logs'
      AND a.attname = 'count'
  ) THEN
    ALTER TABLE usage_logs ALTER COLUMN count SET DEFAULT 0;
  END IF;
END $$;