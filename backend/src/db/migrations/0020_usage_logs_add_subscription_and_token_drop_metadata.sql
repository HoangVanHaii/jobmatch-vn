--Get-Content backend/src/db/migrations/0020_usage_logs_add_subscription_and_token_drop_metadata.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1

-- 0000_init.sql đã có sẵn cấu trúc usage_logs hiện đại (subscription_id, token,
-- count, không có metadata) nên các thao tác này trở nên redundant. Wrap để
-- idempotent: chỉ chạy khi DB chưa ở trạng thái mong muốn.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usage_logs' AND column_name = 'subscription_id'
  ) THEN
    ALTER TABLE usage_logs ADD COLUMN subscription_id UUID REFERENCES subscriptions(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usage_logs' AND column_name = 'token'
  ) THEN
    ALTER TABLE usage_logs ADD COLUMN token INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usage_logs' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE usage_logs DROP COLUMN metadata;
  END IF;

  -- Set DEFAULT cho count nếu chưa có.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usage_logs' AND column_name = 'count'
  ) THEN
    ALTER TABLE usage_logs ALTER COLUMN count SET DEFAULT 0;
  END IF;
END
$$;
