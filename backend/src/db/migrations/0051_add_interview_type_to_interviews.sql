-- ============================================================================
-- 0051: Thêm cột `interview_type` vào bảng `interviews`
-- Hỗ trợ phân loại các vòng phỏng vấn (screening, technical, coding,
-- system_design, hr, culture_fit, panel, final, other).
-- Mặc định: 'technical' để tương thích ngược với dữ liệu cũ.
-- ============================================================================

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS interview_type TEXT NOT NULL DEFAULT 'technical';

CREATE INDEX IF NOT EXISTS idx_interviews_type ON interviews(interview_type);

