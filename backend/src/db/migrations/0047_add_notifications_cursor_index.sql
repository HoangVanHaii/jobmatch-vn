-- 0047: Index cho cursor pagination của bảng notifications.
--
-- Bối cảnh:
-- Query danh sách notifications phân trang theo cursor:
--   ORDER BY date_trunc('millisecond', created_at, 'UTC') DESC, id DESC
--   WHERE user_id = $1 AND (createdAtMs < $2 OR (createdAtMs = $2 AND id < $3))
--
-- Lưu ý kỹ thuật & IMMUTABILITY:
-- 1. Trong PostgreSQL, hàm 2 tham số `date_trunc(text, timestamp with time zone)` có
--    volatility là STABLE (do phụ thuộc timezone phiên làm việc đối với các đơn vị thời gian như day/month).
--    Do đó nếu dùng 2 tham số, PostgreSQL sẽ ném lỗi:
--      ERROR: functions in index expression must be marked IMMUTABLE
-- 2. Hàm 3 tham số `date_trunc(text, timestamp with time zone, text)` với timezone tường minh ('UTC')
--    được PostgreSQL catalog đánh dấu IMMUTABLE (provolatile = 'i').
--    Biểu thức `date_trunc('millisecond', created_at, 'UTC')` khớp chính xác 100% với `createdAtMs`
--    trong notification.service.ts và chuẩn hóa đúng độ chính xác millisecond của JavaScript Date ISO string.
-- 3. Script migrate.ts bọc mỗi file trong transaction BEGIN/COMMIT nên file này dùng `CREATE INDEX IF NOT EXISTS`.
--    Với môi trường production có bảng notifications lớn, DBA có thể cân nhắc chạy tay riêng ngoài transaction
--    với lệnh `CREATE INDEX CONCURRENTLY IF NOT EXISTS`.

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, (date_trunc('millisecond', created_at, 'UTC')) DESC, id DESC);

