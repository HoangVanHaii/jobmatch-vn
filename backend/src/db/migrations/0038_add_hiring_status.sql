-- ============================================================================
-- 0038: Thêm enum `hiring_status` + cột `jobs.hiring_status` — dùng để FE
-- render badge "Urgently Hiring" / "Actively Hiring" trên JobSearchView.
--
-- Lý do thêm cột (thay vì compute FE từ deadline/engagement):
--   - `urgent` có thể do employer chủ động đánh dấu (vd chiến dịch tuyển gấp),
--     KHÔNG chỉ phụ thuộc deadline.
--   - `active` là manual flag — employer tuyên bố đang tuyển tích cực, không
--     suy ra từ `appliesCount` / `viewsCount` (data có thể chưa cập nhật).
--   - Tách logic UI ra khỏi DB giúp employer điều khiển trực tiếp.
--
-- Default = 'normal' để tất cả job hiện tại (chưa set) đều fallback về
-- không-badge, tránh breaking change cho UI.
--
-- Use case:
--   1. Employer tạo/sửa job → chọn hiring_status từ dropdown (urgent/active/normal).
--   2. FE JobSearchView đọc trực tiếp `hiring_status` từ list API, render badge.
--   3. Có thể filter `WHERE hiring_status = 'urgent'` để làm trang "Hot jobs".
-- ============================================================================

-- 1. Tạo enum type (idempotent với IF NOT EXISTS — Postgres 9.6+ không support
--    trực tiếp, dùng DO block để check).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hiring_status') THEN
    CREATE TYPE hiring_status AS ENUM ('urgent', 'active', 'normal');
  END IF;
END $$;

-- 2. Thêm cột `hiring_status` vào bảng `jobs`. Dùng IF NOT EXISTS để migration
--    có thể chạy lại nhiều lần mà không lỗi (vd khi re-run script).
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS hiring_status hiring_status NOT NULL DEFAULT 'normal';

-- 3. Index phục vụ filter "Urgently Hiring" / "Actively Hiring" trên list —
--    query `WHERE status = 'live' AND hiring_status = 'urgent'` thường xuyên
--    chạy ở trang chủ. Partial index để nhỏ + nhanh hơn index full.
CREATE INDEX IF NOT EXISTS idx_jobs_hiring_status
  ON jobs (hiring_status)
  WHERE status = 'live' AND hiring_status <> 'normal';
