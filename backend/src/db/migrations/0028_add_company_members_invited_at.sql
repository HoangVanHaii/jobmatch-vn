-- ============================================================================
-- 0028 — Thêm cột `invited_at` bị THIẾU trong migration 0027.
--
-- Tại sao file này tồn tại:
--   Migration 0027_company_members_invite_lifecycle.sql ban đầu THIẾU dòng
--   `ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
--   Drizzle schema mới có `invitedAt: timestamp('invited_at', ...)` nên Drizzle
--   generate SELECT có `invited_at` → query fail với lỗi:
--     `column company_members.invited_at does not exist` (code 42703).
--
-- Fix:
--   - Thêm cột `invited_at` (NOT NULL DEFAULT now()) — fill existing rows bằng
--     timestamp hiện tại (legacy rows không có data gốc để preserve).
--   - Nếu có cột `joined_at` cũ (legacy) thì backfill từ đó cho các row cũ.
--
-- Idempotent — chạy nhiều lần OK.
-- ============================================================================

ALTER TABLE company_members
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill từ joined_at cũ (nếu có) cho các row được tạo TRƯỚC migration 0027.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_members' AND column_name = 'joined_at'
  ) THEN
    -- Cột joined_at cũ vẫn còn (chưa drop). Copy giá trị cho row cũ
    -- (idempotent: nếu đã copy rồi thì skip vì WHERE không match)
    UPDATE company_members
    SET invited_at = joined_at
    WHERE invited_at = now() + interval '0 seconds'
      AND joined_at IS NOT NULL
      AND joined_at < now();  -- chỉ copy nếu joined_at cũ hơn now() (row legacy)
  END IF;
END $$;
