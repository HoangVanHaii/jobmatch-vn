-- ============================================================================
-- 0045: Backfill jobs.applies_count từ bảng applications (M-02 fix).
--
-- Lý do:
--   - Trước đây jobs.applies_count KHÔNG BAO GIỜ được tăng khi có application
--     mới (không có trigger, không có UPDATE trong applicationService.create)
--     → counter trên header job detail lệch với totalApplicants của chart
--     applicants-over-time (chart đếm trực tiếp từ bảng applications).
--   - Giờ create() tăng counter trong cùng transaction với INSERT application.
--
-- Semantics: applies_count = TỔNG lượt ứng tuyển (mọi status, kể cả
-- withdrawn/rejected) — khớp semantics của totalApplicants trong
-- getApplicantsOverTime. Không giảm khi withdraw/reject.
-- ============================================================================

UPDATE jobs j
SET applies_count = (
  SELECT count(*) FROM applications a WHERE a.job_id = j.id
)
WHERE j.applies_count <> (
  SELECT count(*) FROM applications a WHERE a.job_id = j.id
);
