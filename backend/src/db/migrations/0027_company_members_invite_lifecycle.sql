-- ============================================================================
-- 0027 — Redesign `company_members` table cho full invite lifecycle (PHẦN 2).
--
-- PHẦN 1 (0026_add_company_member_status_enum.sql) đã chạy riêng trước —
-- chỉ ALTER TYPE để commit enum values mới. File này dùng các value đó
-- (status='pending', 'active', ...) trong UPDATE — không bị lỗi 55P04.
--
-- Lifecycle status (single row reused cho mỗi (company_id, user_id)):
--   pending → user accept → active
--   pending → user decline → declined
--   pending → user accept invite khác → auto_cancelled
--   active  → owner xoá → removed
--   active  → user tự rời → left
--
-- Quy tắc business:
--   - 1 row duy nhất per (company_id, user_id) — reuse qua mọi vòng đời.
--   - 1 user CHỈ active ở 1 công ty tại 1 thời điểm (enforced bằng partial
--     unique index WHERE status='active' — owner thì ép thêm role='owner').
--   - Soft delete — không bao giờ DELETE row, chỉ UPDATE status.
--
-- Thay đổi so với schema cũ:
--   - PK đổi từ composite (company_id, user_id) → đơn (id).
--   - UNIQUE constraint (company_id, user_id) riêng.
--   - Thêm columns: responded_at, ended_at, ended_by, updated_at.
--   - Partial unique index đổi tên: uniq_company_members_one_active_owner
--     → uniq_active_owner_per_company.
--
-- Backfill data cũ:
--   - status='invited' → status='pending' (set responded_at=NULL vì chưa
--     phản hồi).
--   - status='inactive' → status='removed' (best guess — không phân biệt được
--     decline vs remove vs leave với data cũ).
--
-- IDEMPOTENT — chạy nhiều lần OK:
--   - ADD COLUMN IF NOT EXISTS     (PG 9.6+)
--   - DROP CONSTRAINT/INDEX IF EXISTS
--   - CREATE INDEX IF NOT EXISTS
--   - DROP + ADD pattern cho PK/UNIQUE constraint (DROP trước nếu tồn tại → ADD lại)
-- ============================================================================

-- ============================================================================
-- 1. Đổi PK từ composite → đơn (id) — DROP + ADD pattern
-- ============================================================================
ALTER TABLE company_members DROP CONSTRAINT IF EXISTS company_members_pkey CASCADE;

ALTER TABLE company_members ADD COLUMN IF NOT EXISTS id UUID;

-- Backfill id cho row cũ (defensive — tránh NULL trước khi set PK)
UPDATE company_members SET id = gen_random_uuid() WHERE id IS NULL;

-- Set DEFAULT cho id — CẦN THIẾT cho INSERT mới qua application code (Drizzle
-- không tự set default khi build câu lệnh INSERT — phải dựa vào DB default).
-- Lưu ý: IDE SQL parser có thể warning "syntax near SET" do nhầm với một số
-- parser không support function call trong DEFAULT. PG bản 13+ vẫn chạy đúng —
-- xem https://www.postgresql.org/docs/current/sql-altertable.html
ALTER TABLE company_members ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Đặt PK mới — DROP + ADD pattern: chạy nhiều lần đều OK vì DROP trước.
ALTER TABLE company_members DROP CONSTRAINT IF EXISTS company_members_pkey;
ALTER TABLE company_members ADD CONSTRAINT company_members_pkey PRIMARY KEY (id);

-- ============================================================================
-- 2. Thêm UNIQUE (company_id, user_id) — ràng buộc 1 user × 1 row per company
-- ============================================================================
ALTER TABLE company_members DROP CONSTRAINT IF EXISTS uniq_company_members_company_user;
ALTER TABLE company_members
  ADD CONSTRAINT uniq_company_members_company_user UNIQUE (company_id, user_id);

-- (Status enum đã được mở rộng ở 0026_add_company_member_status_enum.sql —
--  không cần ALTER TYPE ở đây.)

-- ============================================================================
-- 3. Thêm columns mới cho audit lifecycle
-- ============================================================================
ALTER TABLE company_members
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE company_members
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

ALTER TABLE company_members
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

ALTER TABLE company_members
  ADD COLUMN IF NOT EXISTS ended_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE company_members
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ============================================================================
-- 4. Backfill status cũ (UPDATE idempotent — WHERE không match thì no-op)
-- ============================================================================
UPDATE company_members SET status = 'pending', responded_at = NULL WHERE status = 'invited';
UPDATE company_members
  SET status = 'removed',
      ended_at = COALESCE(ended_at, now()),
      updated_at = now()
WHERE status = 'inactive';

-- ============================================================================
-- 5. Replace partial unique index cho 1 active owner / company
-- ============================================================================
DROP INDEX IF EXISTS uniq_company_members_one_active_owner;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_owner_per_company
  ON company_members(company_id)
  WHERE role = 'owner' AND status = 'active';

-- ============================================================================
-- 6. Indexes cho query performance
-- ============================================================================
DROP INDEX IF EXISTS idx_company_members_user;
DROP INDEX IF EXISTS idx_company_members_invited_by;

CREATE INDEX IF NOT EXISTS idx_company_members_company_status
  ON company_members(company_id, status);

CREATE INDEX IF NOT EXISTS idx_company_members_user_status
  ON company_members(user_id, status);

CREATE INDEX IF NOT EXISTS idx_company_members_invited_by
  ON company_members(invited_by)
  WHERE invited_by IS NOT NULL;
