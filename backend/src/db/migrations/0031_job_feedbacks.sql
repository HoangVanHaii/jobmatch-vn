-- ============================================================================
-- 0031: Tạo bảng `job_feedbacks` — đánh giá (rating + comment) của candidate
-- sau khi đã apply job.
--
-- Nghiệp vụ (enforce cả ở app service):
--   - Mỗi candidate chỉ có 1 feedback / job (unique job_id + candidate_id).
--     Service dùng ON CONFLICT để upsert khi candidate sửa rating/comment.
--   - Cascade FK: job xoá → xoá feedback; user xoá → xoá feedback.
--   - rating 1-5 được validate ở zod + service (DB chỉ CHECK tối thiểu để
--     tránh bug khi insert trực tiếp).
--
-- Indexes:
--   - (job_id, created_at DESC) cho query list feedback theo job.
--   - (candidate_id) cho query "feedback của tôi cho job X".
--   - unique (job_id, candidate_id) cho upsert + integrity.
-- ============================================================================

CREATE TABLE IF NOT EXISTS job_feedbacks
(
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_feedbacks_job
    ON job_feedbacks(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_feedbacks_candidate
    ON job_feedbacks(candidate_id);

-- Unique constraint cho upsert (xem service.jobFeedback.upsert).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uniq_job_feedback_candidate'
    ) THEN
        ALTER TABLE job_feedbacks
            ADD CONSTRAINT uniq_job_feedback_candidate
            UNIQUE (job_id, candidate_id);
    END IF;
END $$;
