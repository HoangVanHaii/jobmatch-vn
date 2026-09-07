-- ============================================================================
-- 0025 — Thêm cột `invited_by` cho `company_members`
--
-- Lý do: cần biết ai là người mời 1 user vào công ty để hiển thị "Mời bởi <tên>"
-- trên UI (vd CompanyView empty state khi user chưa thuộc công ty nào).
-- Trước đó inviteBy chỉ lưu trong notification.payload — không thể query
-- được từ bảng company_members.
--
-- Cột nullable: các row cũ không có thông tin inviter, để NULL là chính xác.
-- Khi user mới được mời (sau migration), service sẽ set column này.
--
-- CÁCH CHẠY:
--   1) Qua Node (tự động pick up file mới theo alphabet):
--        cd backend && npm run db:migrate
--
--   2) Hoặc chạy tay qua psql trong Docker:
--        Get-Content backend/src/db/migrations/0025_company_members_invited_by.sql `
--          | docker exec -i jobmatch_postgres psql -U jobmatch -d jobmatch_vn -v ON_ERROR_STOP=1
-- ============================================================================

ALTER TABLE company_members
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_company_members_invited_by
  ON company_members(invited_by);
