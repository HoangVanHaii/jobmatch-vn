-- ============================================================================
-- 0039: Partial index trên `jobs.salary_min` cho Salary histogram aggregate.
--
-- Use case: JobSearchView salary histogram query `COUNT(*) GROUP BY width_bucket(...)`
-- (xem job.service.ts hoặc FE aggregate). B-tree trên salary_min cho phép scan
-- range nhanh và dùng được cho index-only scan khi filter `status='live'`.
--
-- Partial index vì:
--   - Chỉ filter job `status='live'` (draft/ai_flagged/closed không cần thiết
--     cho histogram user-facing).
--   - Index nhỏ hơn, write nhanh hơn.
--
-- Lưu ý: salary_min NULL có nghĩa employer không set lương tối thiểu → vẫn
-- đếm được trong bucket tương ứng nếu query dùng COALESCE. Index không loại
-- trừ NULL (b-tree index default include NULLs).
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_jobs_salary_min_histogram
  ON jobs (salary_min)
  WHERE status = 'live';
