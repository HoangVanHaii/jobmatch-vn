-- 0046: Chuyển remote_ok (boolean) sang work_type ('remote', 'onsite', 'hybrid')

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_type') THEN
    CREATE TYPE work_type AS ENUM ('remote', 'onsite', 'hybrid');
  END IF;
END $$;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_type work_type DEFAULT 'onsite' NOT NULL;

-- Migrate dữ liệu cũ: nếu remote_ok = true thì 'remote', ngược lại 'onsite'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'remote_ok'
  ) THEN
    UPDATE jobs
    SET work_type = CASE WHEN remote_ok = true THEN 'remote'::work_type ELSE 'onsite'::work_type END;

    ALTER TABLE jobs DROP COLUMN remote_ok;
  END IF;
END $$;

