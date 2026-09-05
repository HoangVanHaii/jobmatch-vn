-- ============================================================================
-- 0013_rename_ai_score.sql
-- Rename column `cvs.ai_score` → `cvs.ai_analysis` (đổi tên cho khớp với
-- backend rename: AI scoring giờ gộp vào AI analysis).
--
-- Idempotent: chỉ rename khi column `ai_score` còn tồn tại. Nếu đã rename
-- rồi (column giờ tên `ai_analysis`) thì skip — không lỗi.
--
-- PostgreSQL không hỗ trợ `ALTER TABLE ... RENAME COLUMN IF NOT EXISTS`,
-- nên dùng DO block check information_schema.
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cvs'
      AND column_name = 'ai_score'
  ) THEN
    ALTER TABLE cvs RENAME COLUMN ai_score TO ai_analysis;
  END IF;
END $$;