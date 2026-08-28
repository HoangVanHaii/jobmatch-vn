
import { db } from '../config/database';
import { plans, subscriptions, applications, jobs, usageLogs } from '../db/schema';
import { eq, sql, desc, asc, and, gte, lte } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { subscriptionService } from './subscription.service';
import type { Plan, PlanUsage, QuotaUsageItem, CountableQuotaKey } from '../interface/plan';
import type { PlanCreateBody, PlanUpdateBody, PlanListQuery } from '../middleware/plan';

/**
 * Whitelist các quota key biết cách count.
 *
 * `plans.features` JSONB có thể chứa key khác (vd: boolean flags) — chỉ loop
 * qua các key trong whitelist này, mỗi key đã biết nguồn count.
 */
const COUNTABLE_KEYS: CountableQuotaKey[] = [
    'apply',
    'job_post',
    'ai_cv_parsed',
    'ai_cv_analysis',
    'job_generation',
];

const AI_KEYS: ReadonlySet<CountableQuotaKey> = new Set([
    'ai_cv_parsed',
    'ai_cv_analysis',
    'job_generation',
]);

export const planService = {

  list: async (filters: PlanListQuery): Promise<{ data: Plan[]; total: number }> => {
    const conditions = filters.includeInactive ? undefined : eq(plans.isActive, true);

    const [data, [{ total }]] = await Promise.all([
      db
        .select({
          id: plans.id,
          code: plans.code,
          name: plans.name,
          priceVnd: plans.priceVnd,
          durationDays: plans.durationDays,
          features: plans.features,
          isActive: plans.isActive,
        })
        .from(plans)
        .where(conditions)
        .orderBy(asc(plans.priceVnd), asc(plans.durationDays))
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit),

      db.select({ total: sql<number>`count(*)::int` }).from(plans).where(conditions),
    ]);

    return { data, total };
  },

  getById: async (id: string, isAdmin = false): Promise<Plan> => {
    const [row] = await db
      .select({
        id: plans.id,
        code: plans.code,
        name: plans.name,
        priceVnd: plans.priceVnd,
        durationDays: plans.durationDays,
        features: plans.features,
        isActive: plans.isActive,
      })
      .from(plans)
      .where(eq(plans.id, id))
      .limit(1);

    if (!row) {
      throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan không tồn tại');
    }
    if (row.isActive === false && !isAdmin) {
      throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan không tồn tại');
    }
    return row;
  },

  create: async (body: PlanCreateBody): Promise<Plan> => {
    const [existing] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.code, body.code))
      .limit(1);
    if (existing) {
      throw new AppError(409, 'PLAN_CODE_EXISTS', `Plan code "${body.code}" đã tồn tại`);
    }

    const [created] = await db
      .insert(plans)
      .values({
        code: body.code,
        name: body.name,
        priceVnd: String(body.priceVnd),
        durationDays: body.durationDays,
        features: body.features,
        isActive: body.isActive ?? true,
      })
      .returning({
        id: plans.id,
        code: plans.code,
        name: plans.name,
        priceVnd: plans.priceVnd,
        durationDays: plans.durationDays,
        features: plans.features,
        isActive: plans.isActive,
      });

    return created;
  },

  update: async (id: string, body: PlanUpdateBody): Promise<Plan> => {
    // Check plan tồn tại
    const [existing] = await db
      .select({ id: plans.id, code: plans.code })
      .from(plans)
      .where(eq(plans.id, id))
      .limit(1);
    if (!existing) {
      throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan không tồn tại');
    }

    if (body.code && body.code !== existing.code) {
      const [dup] = await db
        .select({ id: plans.id })
        .from(plans)
        .where(eq(plans.code, body.code))
        .limit(1);
      if (dup) {
        throw new AppError(409, 'PLAN_CODE_EXISTS', `Plan code "${body.code}" đã tồn tại`);
      }
    }

    const updatePayload: Partial<typeof plans.$inferInsert> = {};
    if (body.code !== undefined) updatePayload.code = body.code;
    if (body.name !== undefined) updatePayload.name = body.name;
    if (body.priceVnd !== undefined) updatePayload.priceVnd = String(body.priceVnd);
    if (body.durationDays !== undefined) updatePayload.durationDays = body.durationDays;
    if (body.features !== undefined) updatePayload.features = body.features;
    if (body.isActive !== undefined) updatePayload.isActive = body.isActive;

    const [updated] = await db
      .update(plans)
      .set(updatePayload)
      .where(eq(plans.id, id))
      .returning({
        id: plans.id,
        code: plans.code,
        name: plans.name,
        priceVnd: plans.priceVnd,
        durationDays: plans.durationDays,
        features: plans.features,
        isActive: plans.isActive,
      });

    return updated;
  },

  /**
   * DELETE /plans/:id — soft delete (admin only).
   *
   * Lý do dùng soft delete:
   * - Bảng `subscriptions` có FK `plan_id REFERENCES plans(id)` ON DELETE
   *   (xem src/db/migrations/0000_init.sql:335) → DELETE vật lý sẽ fail với
   *   foreign_key_violation nếu có subscription đang tham chiếu.
   * - Plan inactive vẫn cần giữ để tra cứu lịch sử subscription cũ.
   *
   * Hành vi:
   * - Nếu còn subscription đang active (status='active' và expires_at > now())
   *   → từ chối xoá, throw 409. Admin phải đợi hết hạn hoặc hủy sub trước.
   * - Nếu không còn sub active nào → set isActive=false.
   */
  softDelete: async (id: string): Promise<void> => {
    const [existing] = await db
      .select({ id: plans.id, code: plans.code })
      .from(plans)
      .where(eq(plans.id, id))
      .limit(1);
    if (!existing) {
      throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan không tồn tại');
    }

    const [{ activeCount }] = await db
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.planId, id),
          eq(subscriptions.status, 'active'),
          sql`${subscriptions.expiresAt} > now()`,
        ),
      );

    if (activeCount > 0) {
      throw new AppError(
        409,
        'PLAN_HAS_ACTIVE_SUBSCRIPTIONS',
        `Không thể deactivate plan vì đang có ${activeCount} subscription còn hiệu lực. ` +
          `Hãy đợi hết hạn hoặc hủy subscription trước.`,
      );
    }

    await db.update(plans).set({ isActive: false }).where(eq(plans.id, id));
    },
    checkPlanTx: async(
        tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
        planId: string,
        ): Promise<{ id: string; name: string; priceVnd: string; durationDays: number }> => {
        const [plan] = await tx
            .select({
                id: plans.id,
                name: plans.name,
                priceVnd: plans.priceVnd,
                durationDays: plans.durationDays,
                isActive: plans.isActive,
            })
            .from(plans)
            .where(eq(plans.id, planId))
            .limit(1);

        if (!plan || plan.isActive === false) {
            throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan không tồn tại hoặc đã ngừng bán');
        }
        return plan;
    },

    /**
     * Lấy plan hiện tại của user (active subscription chưa hết hạn).
     *
     * Flow:
     *   0. Lazy sync: UPDATE rows có status='active' nhưng đã quá hạn → status='expired'.
     *      Đảm bảo DB khớp với thời gian (cùng pattern với syncExpiredStatus bên subscription.service,
     *      nhưng áp dụng ở đây vì đây là single-row query).
     *   1. Query paid sub active: status='active' AND expires_at > now().
     *      Nếu tìm được → return paid plan (ưu tiên).
     *   2. Nếu KHÔNG có paid sub active → fallback gọi
     *      `subscriptionService.refreshFreeSubscriptionForUser(userId)` để:
     *         (a) re-activate free sub cũ (status='cancelled' / 'expired' do paid trước đó),
     *         (b) reset dates + usage_logs nếu free sub đã hết hạn.
     *      Sau đó re-query → return free sub nếu tìm được.
     *   3. Trả về null nếu user không có paid và cũng không có free sub (caller phải INSERT).
     *
     * Nếu có nhiều subscription active (multi-buy edge case), lấy cái có expiresAt xa nhất.
     *
     * Query paid: subscription WHERE user_id = ? AND status = 'active' AND expires_at > now()
     *             ORDER BY expires_at DESC LIMIT 1
     *             JOIN plans để lấy thông tin plan (code, name, features, ...)
     */
    getMyCurrentPlan: async (
        userId: string,
    ): Promise<{
        plan: Plan;
        subscriptionId: string;
        expiresAt: string;
    } | null> => {
        // Lazy sync: rows có status='active' nhưng đã quá hạn → UPDATE thành 'expired'.
        // Đảm bảo DB status khớp với thời gian (tránh dirty data khi không có cron sweeper).
        // Cùng pattern với syncExpiredStatus() ở subscription.service.ts nhưng áp dụng
        // trước SELECT thay vì sau — vì đây là single-row query, không có danh sách để sync.
        // An toàn với free sub vì:
        //   - Free sub past expiry sẽ được re-active bởi refreshFreeSubscriptionForUser
        //     trong fallback block dưới (nếu không có paid active).
        await db
            .update(subscriptions)
            .set({ status: 'expired' })
            .where(
                and(
                    eq(subscriptions.userId, userId),
                    eq(subscriptions.status, 'active'),
                    sql`${subscriptions.expiresAt} < now()`,
                ),
            );

        const [row] = await db
            .select({
                subscriptionId: subscriptions.id,
                expiresAt: subscriptions.expiresAt,
                plan: {
                    id: plans.id,
                    code: plans.code,
                    name: plans.name,
                    priceVnd: plans.priceVnd,
                    durationDays: plans.durationDays,
                    features: plans.features,
                    isActive: plans.isActive,
                },
            })
            .from(subscriptions)
            .innerJoin(plans, eq(subscriptions.planId, plans.id))
            .where(
                and(
                    eq(subscriptions.userId, userId),
                    eq(subscriptions.status, 'active'),
                    sql`${subscriptions.expiresAt} > now()`,
                ),
            )
            .orderBy(desc(subscriptions.expiresAt))
            .limit(1);

        if (!row) {
            // User không có paid sub active → thử refresh free sub.
            const refreshedSubId = await subscriptionService.refreshFreeSubscriptionForUser(userId);
            if (!refreshedSubId) return null;

            // Re-query với sub vừa refresh (cùng shape với query ban đầu).
            const [refreshedRow] = await db
                .select({
                    subscriptionId: subscriptions.id,
                    expiresAt: subscriptions.expiresAt,
                    plan: {
                        id: plans.id,
                        code: plans.code,
                        name: plans.name,
                        priceVnd: plans.priceVnd,
                        durationDays: plans.durationDays,
                        features: plans.features,
                        isActive: plans.isActive,
                    },
                })
                .from(subscriptions)
                .innerJoin(plans, eq(subscriptions.planId, plans.id))
                .where(eq(subscriptions.id, refreshedSubId))
                .limit(1);

            if (!refreshedRow) return null;

            return {
                plan: refreshedRow.plan as Plan,
                subscriptionId: refreshedRow.subscriptionId,
                expiresAt: refreshedRow.expiresAt.toISOString(),
            };
        }

        return {
            plan: row.plan as Plan,
            subscriptionId: row.subscriptionId,
            expiresAt: row.expiresAt.toISOString(),
        };
    },

    /**
     * Lấy plan hiện tại + quota usage + remainingDays cho BillingHistoryView.
     *
     * Quota count từ nhiều nguồn (key → source):
     *  - `apply`           ← COUNT(*) FROM applications WHERE candidate_id = ?
     *  - `job_post`        ← COUNT(*) FROM jobs WHERE posted_by = ?
     *  - `ai_cv_parsed`    ← usage_logs GROUP BY feature (sum count + sum token) trong sub period
     *  - `ai_cv_analysis`  ← usage_logs (như trên)
     *  - `job_generation`  ← usage_logs (như trên)
     *
     * Sub period: từ `sub.startedAt` đến `sub.expiresAt`. Chỉ count rows của
     * sub hiện tại → nếu user mua gói mới, count reset theo sub mới.
     *
     * Behavior:
     *  - Không có sub active → trả plan=null, usage=[] (user đang ở free tier).
     *  - Có sub active → đếm song song 3 nguồn (Promise.all), với mỗi key trong
     *    COUNTABLE_KEYS có trong `plan.features` → tạo QuotaUsageItem.
     *  - AI feature có usage_logs nhưng plan không define limit → vẫn push
     *    (limit=0, unlimited=false) để user thấy được đã dùng bao nhiêu token.
     *  - `remainingDays` floor về ngày, tối thiểu 0 (không âm khi đã hết hạn).
     */
    getMyPlanUsage: async (userId: string): Promise<PlanUsage> => {
        const current = await planService.getMyCurrentPlan(userId);
        if (!current) {
            return {
                plan: null,
                subscriptionId: null,
                expiresAt: null,
                remainingDays: null,
                usage: [],
            };
        }

        // Sub period dùng cho usage_logs query.
        // Lấy startedAt từ subscription — fallback now() nếu lý do nào đó missing.
        const subStart = await (async (): Promise<Date> => {
            const [row] = await db
                .select({ startedAt: subscriptions.startedAt })
                .from(subscriptions)
                .where(eq(subscriptions.id, current.subscriptionId))
                .limit(1);
            return row?.startedAt ?? new Date();
        })();
        const subEnd = new Date(current.expiresAt);

        // Parallel: app count + job count + usage_logs aggregate
        const [appRows, jobRows, aiRows] = await Promise.all([
            db
                .select({ appCount: sql<number>`count(*)::int` })
                .from(applications)
                .where(eq(applications.candidateId, userId)),
            db
                .select({ jobCount: sql<number>`count(*)::int` })
                .from(jobs)
                .where(eq(jobs.postedBy, userId)),
            // AI usage: GROUP BY feature → sum count + sum token trong sub period.
            db
                .select({
                    feature: usageLogs.feature,
                    totalCount: sql<number>`COALESCE(SUM(${usageLogs.count}), 0)::int`,
                    totalTokens: sql<number>`COALESCE(SUM(${usageLogs.token}), 0)::int`,
                })
                .from(usageLogs)
                .where(
                    and(
                        eq(usageLogs.userId, userId),
                        eq(usageLogs.subscriptionId, current.subscriptionId),
                        gte(usageLogs.createdAt, subStart),
                        lte(usageLogs.createdAt, subEnd),
                    ),
                )
                .groupBy(usageLogs.feature),
        ]);

        const appCount = Number(appRows[0]?.appCount ?? 0);
        const jobCount = Number(jobRows[0]?.jobCount ?? 0);

        const features = current.plan.features as Record<string, unknown>;
        const usage: QuotaUsageItem[] = [];

        // 1. Loop qua whitelist COUNTABLE_KEYS — chỉ key có trong plan.features mới push.
        for (const quotaKey of COUNTABLE_KEYS) {
            const limit = features[quotaKey];
            if (typeof limit !== 'number') continue;

            let used = 0;
            let tokens = 0;
            if (quotaKey === 'apply') {
                used = appCount;
            } else if (quotaKey === 'job_post') {
                used = jobCount;
            } else {
                // ai_cv_parsed / ai_cv_analysis / job_generation
                const aiMatch = aiRows.find((r) => r.feature === quotaKey);
                used = Number(aiMatch?.totalCount ?? 0);
                tokens = Number(aiMatch?.totalTokens ?? 0);
            }

            usage.push({
                key: quotaKey,
                used,
                tokens,
                limit,
                unlimited: limit === -1,
            });
        }

        // 2. AI features có usage_logs nhưng plan KHÔNG define limit
        //    → vẫn push (limit=0) để user thấy usage thật (đã dùng bao nhiêu token).
        const alreadyPushedKeys = new Set(usage.map((u) => u.key));
        for (const row of aiRows) {
            const key = row.feature as CountableQuotaKey;
            if (alreadyPushedKeys.has(key)) continue;
            if (!AI_KEYS.has(key)) continue;
            usage.push({
                key,
                used: Number(row.totalCount),
                tokens: Number(row.totalTokens),
                limit: 0,
                unlimited: false,
            });
        }

        const expiresAtMs = new Date(current.expiresAt).getTime();
        const remainingDays = Math.max(
            0,
            Math.floor((expiresAtMs - Date.now()) / 86_400_000),
        );

        return {
            plan: current.plan,
            subscriptionId: current.subscriptionId,
            expiresAt: current.expiresAt,
            remainingDays,
            usage,
        };
    },

};
