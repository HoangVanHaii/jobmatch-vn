-- 0048: Chuyển đổi cột description của bảng plans sang jsonb
--
-- Cho phép lưu trữ mô tả đa vai trò { candidate: "...", employer: "..." }
-- Dữ liệu cũ được bảo lưu sang key "candidate"
ALTER TABLE plans
  ALTER COLUMN description TYPE jsonb
  USING CASE
    WHEN description IS NULL THEN NULL
    ELSE jsonb_build_object('candidate', description, 'employer', '')
  END;

