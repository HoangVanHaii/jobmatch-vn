-- 0043: Business rule "1 user chỉ có 1 subscription active" xuống DB level.
--
-- Trước đây rule này chỉ enforce bằng app code (subscriptionService.create
-- cancel mọi sub active trước khi INSERT) → race condition: 2 webhook
-- PAYOS song song cùng orderCode có thể tạo 2 subscription active cho
-- cùng user (xem audit HIGH #1, 2026-10-01).
--
-- Partial unique index — KHÔNG dùng now()/expires_at trong predicate vì
-- now() là STABLE, Postgres từ chối trong index predicate (chỉ chấp nhận
-- IMMUTABLE). Chỉ định năng trên status là đủ: 2 row 'active' cùng user
-- là vi phạm, bất kể expires_at.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- QUAN TRỌNG: index sẽ FAIL nếu DB đã có user có >1 sub 'active'
-- (giống case migration 0016 với order_code). Pre-check bên dưới RAISE
-- EXCEPTION để chặn migration chạy nửa chừng.

-- ============================================================================
-- Pre-check: chặn migration nếu còn dữ liệu trùng (RAISE EXCEPTION)
-- ============================================================================
DO $$
DECLARE
    dup_users int;
BEGIN
    SELECT count(*) INTO dup_users
    FROM (
        SELECT user_id
        FROM subscriptions
        WHERE status = 'active'
        GROUP BY user_id
        HAVING count(*) > 1
    ) d;

    IF dup_users > 0 THEN
        RAISE EXCEPTION
            'uniq_one_active_sub_per_user: % user(s) có >1 subscription active. '
            || 'Chạy SQL dọn bên dưới (bỏ comment) rồi migration lại.',
            dup_users
            USING HINT = 'Xem phần "SQL dọn dữ liệu" trong file migration này';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_active_sub_per_user
    ON subscriptions (user_id)
    WHERE status = 'active';

-- ============================================================================
-- SQL dọn dữ liệu (CHỈ dùng khi pre-check fail — mặc định được comment để
-- migration không tự ý sửa dữ liệu; admin review + chạy tay).
--
-- Giữ sub MỚI NHẤT theo created_at (tie-break started_at) của mỗi user,
-- cancel phần còn lại. Khớp với cách getMyCurrentPlan chọn sub
-- (ORDER BY expires_at DESC — sub mới nhất có expiresAt xa nhất).
--
-- Bước 1 — xem trước các user bị ảnh hưởng:
--   SELECT user_id, count(*),
--          string_agg(id::text, ' | ' ORDER BY created_at) AS sub_ids
--   FROM subscriptions
--   WHERE status = 'active'
--   GROUP BY user_id HAVING count(*) > 1;
--
-- Bước 2 — dọn (giữ mới nhất):
--   UPDATE subscriptions s
--   SET status = 'cancelled'
--   WHERE s.status = 'active'
--     AND s.id <> (
--       SELECT newest.id FROM subscriptions newest
--       WHERE newest.user_id = s.user_id
--         AND newest.status = 'active'
--       ORDER BY newest.created_at DESC, newest.started_at DESC
--       LIMIT 1
--     );
--
-- Bước 3 — chạy lại migration này.
--
-- Side effect cần biết sau khi index active:
--   - refreshFreeSubscriptionForUser bootstrap race (2 request cùng insert
--     free sub đầu tiên) → request thua ăn 23505 → log 'bootstrap insert
--     failed', return null → request tới tự retry. Đây chính là fix cho
--     race được ghi nhận trong comment code cũ ("case hiếm và vô hại").
--   - adminUpdate subscription status→'active' khi user còn sub active
--     khác sẽ bị 23505 (trước đây tạo multi-active ngầm). CS phải cancel
--     sub cũ trước — đúng business.
-- ============================================================================
