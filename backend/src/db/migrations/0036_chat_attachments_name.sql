-- 0036_chat_attachments_name.sql
-- Thêm cột `name` cho chat_attachments — lưu tên file gốc (để hiển thị ở
-- client + Content-Disposition khi download). Phase 1 (image) optional;
-- phase 2 (file non-image) bắt buộc.
--
-- ALTER TABLE thay vì recreate — giữ nguyên data + FK + index hiện có.

ALTER TABLE chat_attachments
  ADD COLUMN IF NOT EXISTS name TEXT;
