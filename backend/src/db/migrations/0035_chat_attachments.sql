-- 0035_chat_attachments.sql
-- Thêm bảng chat_attachments để hỗ trợ gửi ảnh trong chat (paste clipboard +
-- file picker). Migration 0034 bỏ jobId ở conversations; migration này mở
-- rộng message schema theo hướng rich content.
--
-- Quyết định thiết kế:
--   - Bảng riêng (1:N message → attachment) thay vì JSONB inline:
--       + Sau này dễ thêm preview/thumbnail/moderation mà không sửa schema
--         chat_messages.
--       + Match pattern Telegram/WhatsApp/Messenger.
--   - ON DELETE CASCADE: xoá message thì attachment đi theo (khi admin
--     moderation hoặc user withdraw).
--   - kind IN ('image','file') enum check để rõ ràng; phase 1 chỉ 'image'
--     nhưng schema sẵn sàng mở rộng.
--   - width/height nullable: phase 1 đo sau upload (chưa implement); để null
--     để FE dùng intrinsic size từ <img> tag.

CREATE TABLE IF NOT EXISTS chat_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  key          TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0),
  width        INTEGER,
  height       INTEGER,
  kind         TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'file')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
  ON chat_attachments (message_id);
