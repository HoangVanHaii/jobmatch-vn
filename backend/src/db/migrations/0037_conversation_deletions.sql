-- 0037_conversation_deletions.sql
-- Bảng per-user soft delete cho conversation — mỗi user có thể "xoá khỏi
-- sidebar của mình" mà KHÔNG ảnh hưởng tới peer.
--
-- Quyết định thiết kế:
--   - Bảng riêng (user_id, conversation_id) thay vì thêm cột deleted_by_user_a
--     / deleted_by_user_b vào conversations:
--       + Conversation có 2 user → không thể đặt 1 cột deletedAt (sẽ ambiguous).
--       + Per-user state = mỗi user có deletion state riêng → row riêng.
--   - Composite PK (user_id, conversation_id) → idempotent UPSERT, không cần
--     explicit unique index.
--   - ON DELETE CASCADE 2 chiều: nếu conversation bị xoá thật (admin moderation
--     hoặc 2 user đồng thuận xoá sau này), row này tự dọn. Nếu user bị xoá,
--     row này cũng đi.
--   - `deleted_at` lưu timestamp để có thể sort/audit sau (vd "xoá 3 ngày trước").
--   - KHÔNG xoá chat_messages / chat_attachments — peer vẫn giữ data của họ.
--
-- Use case:
--   1. User click icon recycle bin ở ConversationItem.vue (hover).
--   2. FE gọi DELETE /conversations/:id → service INSERT row này (idempotent).
--   3. Service.list() LEFT JOIN + filter `deleted_at IS NULL` → conv biến mất
--      khỏi sidebar của user đó.
--   4. Peer không bị ảnh hưởng — vẫn thấy conversation bình thường.

CREATE TABLE IF NOT EXISTS conversation_deletions (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  deleted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, conversation_id)
);

-- Index phục vụ filter khi list sidebar — query WHERE user_id = ? AND deleted_at IS NOT NULL
-- chỉ để kiểm tra "conv này đã bị xoá chưa". Filter chính là LEFT JOIN + IS NULL.
CREATE INDEX IF NOT EXISTS idx_conversation_deletions_user
  ON conversation_deletions (user_id);
