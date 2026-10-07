-- 0044: Thêm value 'reference_verified' vào enum notification_type.
--
-- Bối cảnh: luồng reference verification (nhánh feat/apply_n8n_for_reference_verify)
-- — khi referee submit form xác minh, employer (postedBy) nhận notification
-- bell + socket event 'reference:verified' để ReferencesModal refresh tức thì.
--
-- Lưu ý PG12+: ALTER TYPE ... ADD VALUE không được dùng value mới trong cùng
-- transaction — file này chỉ có 1 statement nên an toàn.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'reference_verified';
