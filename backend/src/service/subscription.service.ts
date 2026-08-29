import { db } from '../config/database';
import { subscriptions, plans, usageLogs } from '../db/schema';
import { eq, and, or, sql, desc, inArray, type SQL } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { planService } from './plan.service';
import { logger } from '../config/logger';
import type {
    Subscription,
    NewSubscription,
    SubscriptionStatus,
    SubscriptionWithPlan,
    AdminUpdateSubscriptionPayload,
} from '../interface/subscription';

export type { Subscription, NewSubscription };

/**
 * Resolve subscription status có tính đến `expiresAt` so với thời điểm hiện tại.
 *
 * Tại sao cần:
 *   - KHÔNG có cron job tự UPDATE `status='expired'` khi subscription hết hạn.
 *     Row vẫn giữ `status='active'` cho tới khi user mua gói mới (lúc đó
 *     `subscriptionService.create` cancel mọi sub active cũ).
 *   - Nếu không normalize ở query layer → FE (BillingHistoryView) sẽ hiển thị
 *     "Đang dùng" cho subscription đã hết hạn từ lâu → UX sai.
 *
 * Đây là soft check phía query — KHÔNG ghi DB. Đảm bảo nguồn dữ liệu đơn
 * nhất (DB là source of truth, nhưng expired-by-time là derived state).
 *
 * Áp dụng:
 *   - listByUser() — section "Lịch sử subscription" của BillingHistoryView
 *   - (Mở rộng) admin list nếu cần
 *
 * KHÔNG áp dụng:
 *   - getMyCurrentPlan đã filter `expires_at > now()` ở SQL → đã loại trừ.
 *   - payment.status (độc lập với thời gian, chỉ đổi qua PayOS webhook).
 */
function resolveSubscriptionStatus(
    status: SubscriptionStatus,
    expiresAt: Date,
): SubscriptionStatus {
    if (status === 'active' && expiresAt.getTime() < Date.now()) {
        return 'expired';
    }
    return status;
}

/**
 * Sync derived status từ JS xuống DB: ghi `status='expired'` cho rows đã hết
 * hạn nhưng DB vẫn còn `'active'`.
 *
 * Lazy update — chỉ chạm rows trong `rows` input (thường là 1 page của listByUser).
 * Cost thấy, không cần cron job. Self-healing: rows ở page khác sẽ tự update
 * ở request tới khi user scroll.
 *
 * Soft fail: nếu UPDATE lỗi, log warn. Caller vẫn trả data đúng nhờ
 * `resolveSubscriptionStatus` ở JS layer (xem listByUser).
 */
async function syncExpiredStatus(
    rows: Subscription[],
    userId: string,
): Promise<void> {
    const expiredIds = rows
        .filter(
            (row) =>
                row.status === 'active' &&
                row.expiresAt.getTime() < Date.now(),
        )
        .map((row) => row.id);

    if (expiredIds.length === 0) return;

    try {
        await db
            .update(subscriptions)
            .set({ status: 'expired' })
            .where(inArray(subscriptions.id, expiredIds));
    } catch (err) {
        logger.warn(
            { err, expiredIds, userId },
            'Lazy update expired subscriptions failed',
        );
    }
}

/**
 * Build WHERE clause cho status filter, áp dụng "effective status" ở SQL layer.
 *
 * Tại sao cần helper:
 *   - `resolveSubscriptionStatus` ở JS layer rewrite `active + expires_at<now`
 *     thành `expired` cho response.
 *   - Nếu WHERE chỉ filter raw `subscriptions.status`, các bug sau xảy ra:
 *     (1) `?status=active` → trả rows mà response hiển thị là `expired`
 *         (vì đã hết hạn nhưng DB chưa lazy sync).
 *     (2) `?status=expired` → bỏ sót rows có DB.status='active' nhưng time đã qua.
 *   - Fix: WHERE dùng "effective status" — replicate rule của
 *     `resolveSubscriptionStatus` ở SQL layer với so sánh `now()`.
 *
 * Áp dụng cho: `listByUser`, `list` (admin).
 *
 * Lưu ý: khi syncExpiredStatus lazy update chạy SAU fetch, rows 'active' hết hạn
 * sẽ dần được UPDATE thành 'expired' trong DB → các request sau sẽ match
 * case 1 thay vì case 2 trong expanded predicate.
 */
function buildStatusWhere(status: SubscriptionStatus): SQL {
    if (status === 'active') {
        return and(
            eq(subscriptions.status, 'active'),
            sql`${subscriptions.expiresAt} > now()`,
        )!;
    }
    if (status === 'expired') {
        return or(
            eq(subscriptions.status, 'expired'),
            and(
                eq(subscriptions.status, 'active'),
                sql`${subscriptions.expiresAt} <= now()`,
            ),
        )!;
    }
    // 'cancelled' / 'pending' — DB status là source of truth (không có rule thời gian)
    return eq(subscriptions.status, status);
}


export const subscriptionService = {
    /**
     * Tạo / chuyển subscription cho user sau khi payment thành công.
     *
     * Hành vi (đơn giản — mọi payment đều tạo row mới):
     * 1. UPDATE mọi sub active của user → status='cancelled'
     *    (bất kể cùng plan hay khác plan — luôn reset để mua lại từ đầu)
     * 2. INSERT sub mới với status='active', startedAt=now(), expiresAt=now()+durationDays
     *
     * Phân biệt status:
     * - 'cancelled' = user chủ động mua lại (có payment mới) — code này set
     * - 'expired'   = hết hạn tự nhiên (chưa có payment mới) — background job (nếu có)
     * - 'active'    = đang dùng
     * - 'pending'   = chờ kích hoạt (chưa dùng)
     *
     * @param tx          Drizzle transaction handle
     * @param userId      User mua gói
     * @param planId      Plan được mua
     * @param payosOrderId  orderCode từ PayOS (dùng cho audit)
     * @returns           Subscription mới (active) của user sau khi xử lý
     */
    create: async (
        tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
        userId: string,
        planId: string,
        payosOrderId: string,
    ): Promise<Subscription> => {
        const plan = await planService.checkPlanTx(tx, planId);

        // 1. Cancel mọi sub active hiện tại (cùng plan hay khác đều cancel).
        //    Giữ row làm lịch sử — expiresAt giữ nguyên giá trị gốc.
        await tx
            .update(subscriptions)
            .set({ status: 'cancelled' })
            .where(
                and(
                    eq(subscriptions.userId, userId),
                    eq(subscriptions.status, 'active'),
                    sql`${subscriptions.expiresAt} > now()`,
                ),
            );

        // 2. INSERT sub mới
        const startedAt = new Date();
        const expiresAt = new Date(startedAt);
        expiresAt.setDate(expiresAt.getDate() + plan.durationDays);

        const [newSub] = await tx
            .insert(subscriptions)
            .values({
                userId,
                planId,
                status: 'active',
                startedAt,
                expiresAt,
                payosOrderId,
                autoRenew: false,
            })
            .returning();
        return newSub;
    },

    /**
     * Refresh free subscription cho user (dùng khi user không có paid sub active).
     *
     * Business rule: "đang dùng paid thì KHÔNG đụng free". Free chỉ active khi paid
     * không còn active nữa (user hủy paid / paid hết hạn / admin force-cancel).
     *
     * Flow:
     *   0. Safety check: nếu user còn paid sub active → return null ngay.
     *      (Đảm bảo không vô tình re-activate free trong khi paid vẫn đang dùng.)
     *   1. Pick free plan từ bảng `plans` (by code='free') → lấy plan_id + duration_days.
     *      Nếu chưa có free plan → return null (không tạo plan runtime — phải seed trước).
     *   2. Tìm free sub gần nhất của user (ORDER BY started_at DESC).
     *      Nếu chưa có → return null (caller quyết định flow tiếp — vd: signup hook
     *      tạo free sub đầu tiên).
     *   3. UPDATE dựa trên thời hạn:
     *      - ĐÃ HẾT HẠN (expires_at <= now):
     *          + Set lại `started_at = now`, `expires_at = now + duration_days`.
     *          + Set `status = 'active'`.
     *          + DELETE tất cả usage_logs của sub này (reset count + token về 0 cho kỳ mới).
     *          → Tất cả trong 1 transaction để atomic.
     *      - CÒN HẠN nhưng status khác 'active' (vd: 'cancelled' do user vừa mua paid,
     *        paid giờ đã hết hạn → quay về free sub):
     *          + Chỉ set `status = 'active'`, KHÔNG reset dates / usage.
     *
     * @param userId - User cần refresh free sub.
     * @returns      - SubscriptionId sau refresh, hoặc null nếu:
     *                  - User còn paid sub active (safety).
     *                  - Free plan chưa seed.
     *                  - User chưa có free sub (caller phải INSERT trước).
     */
    refreshFreeSubscriptionForUser: async (
        userId: string,
    ): Promise<string | null> => {
        // 0. Safety: nếu user còn paid sub active → KHÔNG refresh free.
        //    Rule: "đang dùng paid thì KHÔNG đụng free" — user phải hủy paid trước.
        const hasActivePaid = await db
            .select({ id: subscriptions.id })
            .from(subscriptions)
            .innerJoin(plans, eq(subscriptions.planId, plans.id))
            .where(
                and(
                    eq(subscriptions.userId, userId),
                    eq(subscriptions.status, 'active'),
                    sql`${subscriptions.expiresAt} > now()`,
                    sql`${plans.code} != 'free'`,
                ),
            )
            .limit(1);

        if (hasActivePaid.length > 0) return null;

        // 1. Pick free plan.
        const [freePlan] = await db
            .select({ id: plans.id, durationDays: plans.durationDays })
            .from(plans)
            .where(eq(plans.code, 'free'))
            .limit(1);
        if (!freePlan) return null;

        // 2. Tìm free sub gần nhất.
        const [sub] = await db
            .select({
                id: subscriptions.id,
                status: subscriptions.status,
                expiresAt: subscriptions.expiresAt,
            })
            .from(subscriptions)
            .where(
                and(
                    eq(subscriptions.userId, userId),
                    eq(subscriptions.planId, freePlan.id),
                ),
            )
            .orderBy(desc(subscriptions.startedAt))
            .limit(1);

        if (!sub) return null;

        // 3. UPDATE status nếu cần.
        const isPastExpiry = new Date(sub.expiresAt).getTime() <= Date.now();

        if (isPastExpiry) {
            // Hết hạn → reset startedAt + expiresAt, set status='active',
            // reset count + token trong usage_logs của sub này.
            const startedAt = new Date();
            const expiresAt = new Date(startedAt);
            expiresAt.setDate(expiresAt.getDate() + freePlan.durationDays);

            await db.transaction(async (tx) => {
                await tx
                    .update(subscriptions)
                    .set({ status: 'active', startedAt, expiresAt })
                    .where(eq(subscriptions.id, sub.id));

                // Reset usage_logs của sub này (count + token = 0 cho kỳ mới).
                await tx
                    .delete(usageLogs)
                    .where(eq(usageLogs.subscriptionId, sub.id));
            });
        } else if (sub.status !== 'active') {
            // Còn hạn trong tháng nhưng status khác 'active'
            // (vd: 'cancelled' do trước đó user mua paid, paid giờ hết hạn)
            // → chỉ cần set lại 'active', KHÔNG reset dates / usage.
            await db
                .update(subscriptions)
                .set({ status: 'active' })
                .where(eq(subscriptions.id, sub.id));
        }

        return sub.id;
    },

    /**
     * Insert free subscription MỚI cho user (gọi từ signup hook).
     *
     * Flow:
     *   1. Pick free plan từ bảng `plans` (by code='free') → lấy plan_id + duration_days.
     *      Nếu chưa có free plan → throw 500 FREE_PLAN_NOT_CONFIGURED
     *      (caller phải đảm bảo free plan đã được seed trước).
     *   2. INSERT subscription mới:
     *      - userId, planId = free plan id
     *      - status = 'active'
     *      - startedAt = now
     *      - expiresAt = now + duration_days
     *      - payosOrderId = null (không qua PayOS)
     *      - autoRenew = false (free không tự gia hạn)
     *   3. Return subscription row mới tạo.
     *
     * Use case:
     *   - **Signup hook** (auth.service / auth.controller): insert free sub đầu tiên
     *     ngay khi user tạo tài khoản thành công. Đây là entry point duy nhất
     *     để user có quyền dùng app (vì free sub cần tồn tại trước khi user
     *     gọi feature đầu tiên).
     *
     * KHÔNG dùng cho:
     *   - "Re-insert" nếu user đã có free sub (dùng `refreshFreeSubscriptionForUser`).
     *   - Refresh status (dùng `refreshFreeSubscriptionForUser`).
     *
     * Lưu ý:
     *   - Hàm này KHÔNG check xem user đã có free sub chưa → caller phải đảm bảo
     *     gọi đúng1 lần ở signup (không gọi lại ở login, etc.).
     *   - Nếu gọi 2 lần cho cùng user, sẽ có 2 free sub rows. Migration
     *     partial unique index `idx_one_active_free_sub_per_user` (nếu có)
     *     sẽ chặn row thứ2 nếu cả2 đều active.
     */
    insertFreeSubscriptionForUser: async (
        userId: string,
    ): Promise<Subscription> => {
        // 1. Pick free plan từ plans table.
        const [freePlan] = await db
            .select({ id: plans.id, durationDays: plans.durationDays })
            .from(plans)
            .where(eq(plans.code, 'free'))
            .limit(1);

        if (!freePlan) {
            throw new AppError(
                500,
                'FREE_PLAN_NOT_CONFIGURED',
                'Free plan chưa được seed trong bảng plans. Cần insert (code="free") trước.',
            );
        }

        // 2. INSERT free sub mới.
        const startedAt = new Date();
        const expiresAt = new Date(startedAt);
        expiresAt.setDate(expiresAt.getDate() + freePlan.durationDays);

        const [newSub] = await db
            .insert(subscriptions)
            .values({
                userId,
                planId: freePlan.id,
                status: 'active',
                startedAt,
                expiresAt,
                payosOrderId: null,
                autoRenew: false,
            })
            .returning();

        return newSub;
    },

    /**
     * Lấy lịch sử subscription của user (DESC theo startedAt) + pagination.
     *
     * INNER JOIN plans vì `subscriptions.plan_id` là FK NOT NULL → mọi sub
     * đều PHẢI có plan. (Khác với payments.plan_id nullable — xem payment.service.list.)
     *
     * Pagination theo `offset + limit` (chuẩn SQL/REST) thay vì `page`:
     *   - Controller sẽ convert `page → offset` trước khi gọi.
     *   - Service trả thêm `page` (derived từ offset) để controller gắn
     *     vào response shape backward-compat với FE.
     *
     * Status filter (optional):
     *   - Áp dụng `buildStatusWhere(status)` ở SQL layer (effective status,
     *     không chỉ raw DB status). Xem buildStatusWhere doc để biết lý do.
     *   - Response vẫn normalize qua `resolveSubscriptionStatus` để consistent UX.
     *
     * Status normalization:
     *   Sau khi query, transform status qua `resolveSubscriptionStatus`
     *   (active + expiresAt < now → 'expired'). Xem helper doc để biết lý do.
     *
     * Dùng cho:
     *   - GET /subscriptions/me (Candidate BillingHistoryView)
     */
    listByUser: async (
        userId: string,
        offset: number,
        limit: number,
        status?: SubscriptionStatus,
    ): Promise<{ data: SubscriptionWithPlan[]; total: number; page: number }> => {
        const conditions = [eq(subscriptions.userId, userId)];
        if (status) conditions.push(buildStatusWhere(status));
        const whereClause = and(...conditions)!;

        const [data, [{ total }], tokenSums] = await Promise.all([
            db
                .select({
                    id: subscriptions.id,
                    userId: subscriptions.userId,
                    planId: subscriptions.planId,
                    status: subscriptions.status,
                    startedAt: subscriptions.startedAt,
                    expiresAt: subscriptions.expiresAt,
                    payosOrderId: subscriptions.payosOrderId,
                    autoRenew: subscriptions.autoRenew,
                    createdAt: subscriptions.createdAt,
                    planCode: plans.code,
                    planName: plans.name,
                    planDurationDays: plans.durationDays,
                    priceVnd: plans.priceVnd,
                })
                .from(subscriptions)
                .innerJoin(plans, eq(subscriptions.planId, plans.id))
                .where(whereClause)
                .orderBy(desc(subscriptions.startedAt))
                .limit(limit)
                .offset(offset),
            db
                .select({ total: sql<number>`count(*)::int` })
                .from(subscriptions)
                .where(whereClause),
            // Tổng tokens per subscription — GROUP BY usage_logs.subscription_id.
            // Worker ghi usage_logs.subscription_id tại thời điểm chạy LLM
            // (lookup qua planService.getMyCurrentPlan), nên mỗi usage_log
            // đã được gán đúng period. Không cần filter theo (startedAt, expiresAt)
            // ở đây — JOIN key (subscriptionId) đã đảm bảo scope.
            // Loại bỏ NULL subscription_id (free tier / trước khi mua gói).
            db
                .select({
                    subscriptionId: usageLogs.subscriptionId,
                    totalTokens: sql<number>`COALESCE(SUM(${usageLogs.token}), 0)::int`,
                })
                .from(usageLogs)
                .where(
                    and(
                        eq(usageLogs.userId, userId),
                        sql`${usageLogs.subscriptionId} IS NOT NULL`,
                    ),
                )
                .groupBy(usageLogs.subscriptionId),
        ]);

        // Build token lookup map (id → totalTokens).
        const tokenMap = new Map<string, number>();
        for (const t of tokenSums) {
            if (t.subscriptionId) {
                tokenMap.set(t.subscriptionId, Number(t.totalTokens));
            }
        }

        // Lazy update expired rows trong page → DB, sau đó normalize cho response.
        await syncExpiredStatus(data, userId);

        const normalized = data.map((row) => ({
            ...row,
            totalTokens: tokenMap.get(row.id) ?? 0,
            status: resolveSubscriptionStatus(row.status, row.expiresAt),
        })) as SubscriptionWithPlan[];

        const page = Math.floor(offset / limit) + 1;
        return { data: normalized, total, page };
    },

    /**
     * Lấy chi tiết 1 subscription.
     * @param id        Subscription UUID
     * @param userId    User đang request (req.user.userId)
     * @param isAdmin   true nếu req.user.role === 'admin' (bypass ownership check)
     *
     * Ownership: user chỉ thấy subscription của mình (row.userId === userId).
     * Admin thấy tất cả (không check ownership).
     *
     * Throw:
     *   404 SUBSCRIPTION_NOT_FOUND — row không tồn tại
     *   403 FORBIDDEN — user không phải owner và không phải admin
     *
     * Status normalization: apply resolveSubscriptionStatus (active + expiresAt < now → expired)
     * Lazy DB sync: chạy syncExpiredStatus để self-heal expired rows.
     */
    getById: async (
        id: string,
        userId: string,
        isAdmin: boolean,
    ): Promise<SubscriptionWithPlan> => {
        const [row] = await db
            .select({
                id: subscriptions.id,
                userId: subscriptions.userId,
                planId: subscriptions.planId,
                status: subscriptions.status,
                startedAt: subscriptions.startedAt,
                expiresAt: subscriptions.expiresAt,
                payosOrderId: subscriptions.payosOrderId,
                autoRenew: subscriptions.autoRenew,
                createdAt: subscriptions.createdAt,
                planCode: plans.code,
                planName: plans.name,
                planDurationDays: plans.durationDays,
                priceVnd: plans.priceVnd,
            })
            .from(subscriptions)
            .innerJoin(plans, eq(subscriptions.planId, plans.id))
            .where(eq(subscriptions.id, id))
            .limit(1);

        if (!row) {
            throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription không tồn tại');
        }

        if (!isAdmin && row.userId !== userId) {
            throw new AppError(
                403, 'FORBIDDEN',
                'Bạn không có quyền xem subscription này',
            );
        }

        // Self-heal DB (sync expired) + normalize response status
        await syncExpiredStatus([row as Subscription], row.userId);
        const normalized: SubscriptionWithPlan = {
            ...row,
            status: resolveSubscriptionStatus(row.status as SubscriptionStatus, row.expiresAt),
        } as SubscriptionWithPlan;

        return normalized;
    },

    /**
     * Admin list tất cả subscriptions (filter + pagination).
     *
     * @param filters.offset   Pagination offset
     * @param filters.limit    Page size (1..100)
     * @param filters.status   Optional: filter bằng "effective status" — áp dụng buildStatusWhere
     *                         (status='active'+còn hạn hoặc status='expired' kể cả khi DB
     *                         vẫn còn 'active' nhưng time đã qua). Xem buildStatusWhere doc.
     * @param filters.userId   Optional: filter by user
     * @param filters.planId   Optional: filter by plan
     *
     * Return: { data: SubscriptionWithPlan[], total: number }
     *
     * Status normalization: rows returned có status normalized qua resolveSubscriptionStatus
     *   (response luôn nhất quán — nếu DB row là 'active' nhưng đã hết hạn, response
     *   trả về 'expired').
     *
     * Lazy DB sync: syncExpiredStatus updates DB self-healing cho page hiện tại.
     *
     * Lưu ý quan trọng về filter status:
     *   Filter diễn ra ở SQL layer bằng "effective status" (buildStatusWhere) — không
     *   phải raw DB status. Đảm bảo user lọc `?status=active` chỉ thấy rows thực sự
     *   còn hạn; lọc `?status=expired` thấy cả rows đã sync lẫn rows active-nhưng-quá-hạn
     *   (chưa được lazy sync).
     */
    list: async (filters: {
        offset: number;
        limit: number;
        status?: SubscriptionStatus;
        userId?: string;
        planId?: string;
    }): Promise<{ data: SubscriptionWithPlan[]; total: number }> => {
        const conditions = [];
        if (filters.status) conditions.push(buildStatusWhere(filters.status));
        if (filters.userId) conditions.push(eq(subscriptions.userId, filters.userId));
        if (filters.planId) conditions.push(eq(subscriptions.planId, filters.planId));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [data, [{ total }]] = await Promise.all([
            db
                .select({
                    id: subscriptions.id,
                    userId: subscriptions.userId,
                    planId: subscriptions.planId,
                    status: subscriptions.status,
                    startedAt: subscriptions.startedAt,
                    expiresAt: subscriptions.expiresAt,
                    payosOrderId: subscriptions.payosOrderId,
                    autoRenew: subscriptions.autoRenew,
                    createdAt: subscriptions.createdAt,
                    planCode: plans.code,
                    planName: plans.name,
                    planDurationDays: plans.durationDays,
                    priceVnd: plans.priceVnd,
                })
                .from(subscriptions)
                .innerJoin(plans, eq(subscriptions.planId, plans.id))
                .where(whereClause)
                .orderBy(desc(subscriptions.startedAt))
                .limit(filters.limit)
                .offset(filters.offset),
            db
                .select({ total: sql<number>`count(*)::int` })
                .from(subscriptions)
                .where(whereClause),
        ]);

        if (data.length > 0) {
            // Lazy sync + normalize. Use first userId seen (or 'admin' tag) for logger.
            const sampleUserId = filters.userId ?? data[0].userId;
            await syncExpiredStatus(data as Subscription[], sampleUserId);
        }

        const normalized = data.map((row) => ({
            ...row,
            status: resolveSubscriptionStatus(row.status as SubscriptionStatus, row.expiresAt),
        })) as SubscriptionWithPlan[];

        return { data: normalized, total };
    },

    /**
     * Admin cập nhật 1 subscription — dùng cho CS tool (extend expiry, force cancel, toggle autoRenew).
     *
     * @param id       Subscription UUID
     * @param payload  Partial update — chỉ fields nào có thì update.
     *                 - status: SubscriptionStatus — chỉ forward transitions (cancelled là terminal)
     *                 - expiresAt: ISO string → parse thành Date
     *                 - autoRenew: boolean
     *
     * Throw:
     *   404 SUBSCRIPTION_NOT_FOUND — row không tồn tại
     *   409 INVALID_STATUS_TRANSITION — cố chuyển từ 'cancelled' sang status khác
     *
     * Side effects:
     *   - Nếu status chuyển sang 'cancelled' và expiresAt > now → có thể touch row khác (không làm ở đây)
     *   - KHÔNG tự động cancel/close các subscription khác của user
     */
    adminUpdate: async (
        id: string,
        payload: AdminUpdateSubscriptionPayload,
    ): Promise<SubscriptionWithPlan> => {
        const [existing] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.id, id))
            .limit(1);

        if (!existing) {
            throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription không tồn tại');
        }

        if (existing.status === 'cancelled' && payload.status && payload.status !== 'cancelled') {
            throw new AppError(
                409, 'INVALID_STATUS_TRANSITION',
                `Không thể chuyển từ 'cancelled' sang '${payload.status}'. Subscription đã hủy là terminal.`,
            );
        }

        const updateValues: Partial<Subscription> = {};
        if (payload.status !== undefined) updateValues.status = payload.status;
        if (payload.expiresAt !== undefined) updateValues.expiresAt = new Date(payload.expiresAt);
        if (payload.autoRenew !== undefined) updateValues.autoRenew = payload.autoRenew;

        if (Object.keys(updateValues).length === 0) {
            // Nothing to update — return existing as-is (normalized)
            await syncExpiredStatus([existing], existing.userId);
            const normalized: SubscriptionWithPlan = {
                ...existing,
                planCode: '', planName: '', planDurationDays: 0, priceVnd: '0',
                totalTokens: 0,
                status: resolveSubscriptionStatus(existing.status, existing.expiresAt),
            };
            return normalized;  // caller-side: still return shape consistent
        }

        const [updated] = await db
            .update(subscriptions)
            .set(updateValues)
            .where(eq(subscriptions.id, id))
            .returning();

        await syncExpiredStatus([updated], updated.userId);
        const normalized: SubscriptionWithPlan = {
            ...updated,
            planCode: '', planName: '', planDurationDays: 0, priceVnd: '0',
            totalTokens: 0,
            status: resolveSubscriptionStatus(updated.status as SubscriptionStatus, updated.expiresAt),
        };

        // Re-join plans to enrich (avoid extra query for plan fields)
        const [withPlan] = await db
            .select({
                planCode: plans.code,
                planName: plans.name,
                planDurationDays: plans.durationDays,
                priceVnd: plans.priceVnd,
            })
            .from(plans)
            .where(eq(plans.id, updated.planId))
            .limit(1);

        return { ...normalized, ...withPlan } as SubscriptionWithPlan;
    },
};