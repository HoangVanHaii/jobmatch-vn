-- 0042: Thêm cột description cho plans
--
-- Mô tả marketing ngắn hiển thị trên card bảng giá
-- (candidate/PricingView.vue). Nullable — row cũ chưa có nội dung,
-- seed-plans.ts sẽ đổ dữ liệu sau khi migrate.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS description text;
