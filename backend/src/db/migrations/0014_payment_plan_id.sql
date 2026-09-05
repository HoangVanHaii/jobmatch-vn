-- ============================================================================
-- Migration: 0001_payment_plan_id
-- Mục đích: Thêm cột plan_id vào bảng payments.
--   - Bảng `payments` ban đầu chỉ lưu user_id + subscription_id.
--   - Webhook từ PayOS cần biết user mua PLAN NÀO để tạo subscription.
--   - subscription_id lúc tạo payment là NULL (chưa có sub), nên không query được.
--   - → Thêm plan_id, FK tới plans(id).
--Get-Content backend/src/db/migrations/0014_payment_plan_id.sql | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1

-- Chạy: psql / scripts/migrate.ts tự động pick up file này.
--
-- Idempotent:
--   - ADD COLUMN IF NOT EXISTS: PG 9.6+ native support
--   - CREATE INDEX IF NOT EXISTS: PG native support
-- ============================================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id),
  ADD COLUMN IF NOT EXISTS order_code TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_plan ON payments(plan_id);