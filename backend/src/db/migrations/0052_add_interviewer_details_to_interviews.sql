-- ============================================================================
-- 0052: Thêm `interviewer_name` và `interviewer_email` vào bảng `interviews`
-- Hỗ trợ chỉ định người phỏng vấn tùy biến / Tech Lead / thành viên chuyên môn
-- không bắt buộc phải có tài khoản trong hệ thống JobMatch VN.
-- ============================================================================

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS interviewer_name TEXT,
  ADD COLUMN IF NOT EXISTS interviewer_email TEXT;

