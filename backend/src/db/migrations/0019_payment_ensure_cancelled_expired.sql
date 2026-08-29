--Get-Content backend/src/db/migrations/0019_payment_ensure_cancelled_expired.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1


ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'expired';
