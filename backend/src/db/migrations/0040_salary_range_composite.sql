-- ============================================================================
-- 0040: Composite index `(salary_min, salary_max)` — thay thế single-column
-- index `idx_jobs_salary_min_histogram` từ migration 0039.
--
-- Lý do composite > 2 single:
--   - Query aggregate histogram `width_bucket(salary_min, ...)` vẫn dùng leading
--     column `salary_min` của composite index → OK.
--   - Query filter range `WHERE salary_min >= X AND salary_max <= Y` dùng cả
--     2 column → OK (sau này thêm FE range slider).
--   - Trade-off: index hơi lớn hơn 1 chút so với single, nhưng vẫn partial
--     (chỉ scan job `status='live'`).
--
-- Drop index cũ vì composite đã bao phủ use case của nó (leading column) →
-- tránh duplicate storage + write overhead.
-- ============================================================================

DROP INDEX IF EXISTS idx_jobs_salary_min_histogram;

CREATE INDEX IF NOT EXISTS idx_jobs_salary_range
  ON jobs (salary_min, salary_max)
  WHERE status = 'live';
