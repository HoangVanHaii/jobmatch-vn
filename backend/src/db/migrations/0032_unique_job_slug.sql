-- ============================================================================
-- 0032: Unique constraint cho `jobs.slug` để dùng làm URL param (SEO friendly).
--
-- Lý do:
--   - FE chuyển từ `/candidate/viec-lam/:id` (UUID) sang `/candidate/viec-lam/:slug`.
--   - Slug cần unique để route resolve đúng 1 job.
--   - Slug có thể NULL (job cũ chưa generate); dùng partial unique index
--     `WHERE slug IS NOT NULL` để không ép cũ phải có slug ngay.
--
-- Conflict handling:
--   - `job.service.slugify()` đã append 6 hex random → collision rate cực thấp
--     (~1/16M). Nếu vẫn trùng (insert/update), service sẽ retry với random
--     mới cho đến khi thành công (loop có giới hạn 5 lần để tránh infinite).
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uniq_jobs_slug
    ON jobs(slug)
    WHERE slug IS NOT NULL;
