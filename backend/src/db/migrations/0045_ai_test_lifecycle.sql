-- 0045: Bổ sung lifecycle cho AI test (Phase 3 — generate/assign flow).
--
-- Bối cảnh: luồng "HR giao bài test" cần phân biệt đề đang sinh (Gemini chạy
-- nền qua BullMQ) với đề đã HR review xong (sẵn sàng giao). Schema cũ thiếu:
--   1. ai_tests.status        — lifecycle generating → ready (| failed)
--   2. ai_tests.created_by    — audit: employer nào yêu cầu sinh đề
--   3. ai_tests.job_id FK     — bảng quên FK tới jobs (row mồ côi khi xoá job)
--   4. test_assignments idx   — lookup assignment theo test đang full-scan
--   5. graded_at              — tách thời điểm NỘP vs thời điểm CHẤM XONG
--                               (essay do Gemini chấm trễ hơn submit)
--   6. ip_address, flags      — anti-cheat MVP: log IP làm bài + cờ nghi ngờ
--                               (làm quá nhanh/perfect, IP trùng nhau...)

-- Default 'ready' cho row cũ (nếu có) — row mới do service set 'generating'.
ALTER TABLE ai_tests ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
ALTER TABLE ai_tests ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);

-- Row đang 'generating' chưa có đề → questions/total_points/duration_min
-- phải nullable (điền khi worker xong).
ALTER TABLE ai_tests ALTER COLUMN questions DROP NOT NULL;
ALTER TABLE ai_tests ALTER COLUMN total_points DROP NOT NULL;
ALTER TABLE ai_tests ALTER COLUMN duration_min DROP NOT NULL;

-- FK job — dùng NOT VALID để không khoá bảng lâu nếu data xấu; VALIDATE sau.
ALTER TABLE ai_tests ADD CONSTRAINT fk_ai_tests_job
  FOREIGN KEY (job_id) REFERENCES jobs(id) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_test_assignments_test ON test_assignments (test_id);

ALTER TABLE test_assignments ADD COLUMN IF NOT EXISTS graded_at timestamptz;
ALTER TABLE test_assignments ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE test_assignments ADD COLUMN IF NOT EXISTS flags jsonb;
