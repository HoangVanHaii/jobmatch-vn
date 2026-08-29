--Get-Content backend/src/db/migrations/0020_usage_logs_add_subscription_and_token_drop_metadata.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1

ALTER TABLE usage_logs
  ADD COLUMN subscription_id UUID REFERENCES subscriptions(id);

ALTER TABLE usage_logs
  ADD COLUMN token INTEGER NOT NULL DEFAULT 0;

ALTER TABLE usage_logs DROP COLUMN metadata;

ALTER TABLE usage_logs ALTER COLUMN count SET DEFAULT 0;
