-- 0046: Thêm cột message cho bảng notifications (TEXT, nullable, không default).
--
-- Bối cảnh: Backend sinh sẵn câu hiển thị (snapshot lúc thông báo xảy ra)
-- và lưu vào cột message. FE ưu tiên dùng message, fallback formatSummary cho dòng cũ.
-- Tìm kiếm chuyển sang title + message.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message text;

