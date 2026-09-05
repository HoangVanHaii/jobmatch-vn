--Get-Content backend/src/db/migrations/0017_payments_update_at.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1

-- Idempotent: ADD COLUMN IF NOT EXISTS — PG 9.6+ native support.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;