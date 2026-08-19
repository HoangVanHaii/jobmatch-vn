-- Thêm 2 giá trị enum
ALTER TYPE job_status
ADD VALUE
IF NOT EXISTS 'ai_scanning';
ALTER TYPE job_status
ADD VALUE
IF NOT EXISTS 'ai_flagged';

-- Enum mới
CREATE TYPE scan_verdict AS ENUM
('approved', 'flagged');
CREATE TYPE flag_severity AS ENUM
('block', 'warn');

-- Bảng scan (1 job có N scan)
CREATE TABLE job_ai_scans
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    verdict scan_verdict NOT NULL,
    score NUMERIC(3,2),
    -- 0.00–1.00
    model TEXT NOT NULL,
    raw_response JSONB,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    scanned_by TEXT NOT NULL DEFAULT 'system'
    -- 'system' | userId
);
CREATE INDEX idx_job_ai_scans_job ON job_ai_scans(job_id, scanned_at DESC);

-- Bảng flags (1 scan có N flags)
CREATE TABLE job_ai_flags
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID NOT NULL REFERENCES job_ai_scans(id) ON DELETE CASCADE,
    severity flag_severity NOT NULL,
    category TEXT NOT NULL,
    field TEXT NOT NULL,
    -- title | description | requirements
    quote TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    suggestion TEXT,
    law_ref TEXT
);
CREATE INDEX idx_job_ai_flags_scan ON job_ai_flags(scan_id);
