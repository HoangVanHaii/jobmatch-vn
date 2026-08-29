-- Migration0016: enforce unique order_code trên payments.
--
-- Trước đây orderCode được generate từ Date.now() % 1_000_000_000 (millisecond resolution)
-- → 2 request POST /payments trong cùng millisecond sẽ có cùng orderCode.
-- App code đã retry trên Postgres error 23505 (5 attempts) — DB constraint là defense in depth:
--   - Chặn duplicate ngay tại DB (bất kể app code bug/bypass).
--   - PayOS nhận 2 paymentLink cùng orderCode → trả lỗi ambiguous → user bị stuck.
--
-- Lưu ý: CREATE UNIQUE INDEX sẽ FAIL nếu DB đã có row trùng orderCode (do race trước đây).
-- Nếu migration fail khi deploy, chạy:
--   SELECT order_code, COUNT(*) FROM payments GROUP BY order_code HAVING COUNT(*) > 1;
-- → xử lý thủ công (giữ row 'pending' mới nhất, set các row còn lại status='failed', payosTxnId=null)
-- rồi chạy lại migration này.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_order_code
  ON payments(order_code)
  WHERE order_code IS NOT NULL;