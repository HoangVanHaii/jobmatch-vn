-- Migration 0047: Add assigned_to column to jobs table
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL;

-- Backfill dữ liệu hiện tại: job nào chưa có assigned_to thì mặc định là posted_by
UPDATE "jobs" SET "assigned_to" = "posted_by" WHERE "assigned_to" IS NULL;

-- Index phục vụ query lọc theo assigned_to
CREATE INDEX IF NOT EXISTS "idx_jobs_assigned_to" ON "jobs" ("assigned_to");

