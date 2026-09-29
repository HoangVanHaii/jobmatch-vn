-- ============================================================================
-- 0041: Thêm cover_url + metadata JSONB cho candidate profile.
--
-- Use case:
--   - cover_url: ảnh bìa hiển thị ở đầu trang profile candidate (mockup Facebook-style).
--     Upload qua /uploads/image, lưu URL vào DB.
--   - metadata: trường linh hoạt cho profile candidate (school, work, v.v.). Dùng JSONB
--     để mở rộng mà không cần migration mới mỗi khi thêm field.
--
-- Default '{}' cho metadata để an toàn với code cũ chưa set field.
-- ============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
