--Get-Content backend/src/db/migrations/0018_payment_add_expired_status.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1

ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'expired';
