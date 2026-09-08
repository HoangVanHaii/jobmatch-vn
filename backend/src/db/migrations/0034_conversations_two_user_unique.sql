-- 0034_conversations_two_user_unique.sql
--
-- Đổi ràng buộc conversations từ unique 3-cột (user_a, user_b, job_id)
-- sang unique 2-cột (user_a, user_b) — 2 user chỉ có 1 conversation duy nhất
-- bất kể job. Lý do:
--
--   1. UX: candidate ↔ recruiter chỉ cần 1 luồng chat duy nhất, không cần tách
--      theo từng job. Tránh phải nhảy qua nhiều room khi apply nhiều job cùng
--      công ty.
--   2. Đơn giản hoá unique constraint — không còn edge case NULL job_id +
--      nullsNotDistinct (xem memory conversations-unique-constraint-caveat).
--
-- ⚠️ BREAKING CHANGE cho data hiện có:
--   - Nếu trước đó có duplicate `(A, B, job-1)` + `(A, B, job-2)` → unique mới
--     sẽ vi phạm. Vì user chấp nhận TRUNCATE messages để đổi schema.
--   - job_id column DROP hoàn toàn — không còn FK sang jobs, không còn index.
--   - chat_messages.conversationId FK giữ nguyên, chỉ data liên quan bị xoá.
--
-- Nếu sau này muốn gắn job context lại: lưu job đầu tiên vào `notifications.payload`
-- hoặc metadata của chat_messages, không FK cứng.

-- Bước 1: xoá toàn bộ conversations + chat_messages (CASCADE).
TRUNCATE TABLE conversations CASCADE;

-- Bước 2: drop index/column liên quan jobId.
DROP INDEX IF EXISTS uq_conversations_pair_job;
DROP INDEX IF EXISTS idx_conversations_job;

-- Bước 3: drop cột job_id (đã được truncate, không có row nào giữ FK).
ALTER TABLE conversations DROP COLUMN IF EXISTS job_id;

-- Bước 4: tạo unique mới — 2 user chỉ có 1 conversation duy nhất.
-- user_a, user_b là NOT NULL nên không cần nullsNotDistinct.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_pair
  ON conversations (user_a, user_b);

-- Giữ nguyên check constraint ck_conversations_distinct_users (đã có sẵn).

-- Bước 5 (idempotent cho re-run): không tạo lại index cũ nếu re-run.
