import { eq, and, sql } from "drizzle-orm";
import { db } from "../config/database";
import { usageLogs } from "../db/schema/usageLogs";
import { logger } from "../config/logger";
import { planService } from "./plan.service";

/**
 * Parse limit value từ plan.features JSON.
 *
 * Quy tắc:
 *   - -1               → unlimited
 *   - number > 0       → limit
 *   - undefined/0/...  → 0 (block)
 */
function resolveFeatureLimit(
    features: Record<string, unknown>,
    feature: string,
): number {
    const raw = features[feature];
    if (raw === -1) return -1;
    if (typeof raw === "number" && raw > 0) return raw;
    return 0;
}

/**
 * Atomic create-or-increment trong transaction đã mở.
 *
 * Phải được gọi SAU khi đã acquire advisory lock trong cùng transaction.
 *
 * @returns true nếu reserve OK, false nếu quota exceeded.
 */
async function incrementUsageRow(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
    subscriptionId: string | null,
    feature: string,
    limit: number,
): Promise<boolean> {
    const subCondition = subscriptionId
        ? eq(usageLogs.subscriptionId, subscriptionId)
        : sql`${usageLogs.subscriptionId} IS NULL`;

    const [existing] = await tx
        .select({
            id: usageLogs.id,
            count: usageLogs.count,
        })
        .from(usageLogs)
        .where(
            and(
                eq(usageLogs.userId, userId),
                subCondition,
                eq(usageLogs.feature, feature),
            ),
        )
        .limit(1);

    // Row đã có → UPDATE count + 1 (kèm quota check).
    if (existing) {
        const currentCount = existing.count ?? 0;
        const nextCount = currentCount + 1;

        if (limit !== -1 && nextCount > limit) {
            return false;
        }

        await tx
            .update(usageLogs)
            .set({
                count: nextCount,
            })
            .where(eq(usageLogs.id, existing.id));

        return true;
    }

    // Chưa có row → INSERT count=1, token=0.
    await tx.insert(usageLogs).values({
        userId,
        subscriptionId,
        feature,
        count: 1,
        token: 0,
    });

    return true;
}

export const usageLogService = {
    /**
     * Atomic "create if not exists, else increment count".
     *
     * Return boolean:
     *   - true  → reserve quota OK → caller tiếp tục gọi LLM.
     *   - false → không thể reserve → caller KHÔNG gọi LLM.
     *
     * Race-safe:
     *   pg_advisory_xact_lock(hashtext(userId || ':' || feature))
     *
     * Các request cùng (userId, feature) sẽ được serialize.
     * Request thứ 2 sẽ CHỜ request thứ 1 commit/rollback,
     * không bị từ chối.
     *
     * Lock tự động được giải phóng khi transaction kết thúc.
     */
    createOrIncrementUsage: async (
        userId: string,
        feature: string,
    ): Promise<boolean> => {
        // 1. Lookup current plan + subscription.
        const current = await planService.getMyCurrentPlan(userId);
        if (!current) return false;

        const subscriptionId = current.subscriptionId;
        if (!subscriptionId) return false;

        // 2. Parse limit.
        const limit = resolveFeatureLimit(
            current.plan.features as Record<string, unknown>,
            feature,
        );
        if (limit === 0) return false;

        // 3. Transaction + advisory lock.
        return await db.transaction(async (tx) => {
            /**
             * Advisory transaction lock.
             *
             * Cùng userId + feature:
             *   Request A → lấy lock → xử lý → commit → nhả lock
             *   Request B → CHỜ A xong → lấy lock → xử lý tiếp
             *
             * Khác user hoặc khác feature:
             *   Không ảnh hưởng nhau.
             */
            const lockKey = sql`hashtext(${userId} || ':' || ${feature})`;
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

            // 4. Sau khi đã có lock mới đọc/increment usage.
            return incrementUsageRow(tx, userId, subscriptionId, feature, limit);
        });
    },

    /**
     * INSERT row mới với token = X, hoặc UPDATE token += X trên row đã có.
     *
     * Dùng sau khi LLM call thành công — ghi nhận số LLM tokens đã tiêu thụ.
     *
     * Flow:
     *   1. Lookup subscriptionId từ plan.
     *   2. Transaction + advisory lock (cùng pattern với createOrIncrementUsage).
     *   3. SELECT row (user, sub, feature):
     *        - Có   → UPDATE token = token + tokenUsed.
     *        - Chưa → INSERT count=1, token=tokenUsed.
     *
     * Lưu ý:
     *   - KHÔNG tăng count ở đây — count đã được tăng bởi `createOrIncrementUsage`
     *     trước khi gọi LLM. Nếu row chưa tồn tại (worker gọi thiếu flow) → INSERT
     *     count=1 (coi như 1 lượt "missed reserve" + ghi nhận token).
     *   - tokenUsed <= 0 → no-op (tránh UPDATE rỗng).
     */
    insertOrIncrementToken: async (
        userId: string,
        feature: string,
        tokenUsed: number,
    ): Promise<void> => {
        if (tokenUsed <= 0) return;

        const current = await planService.getMyCurrentPlan(userId);
        if (!current) {
            return;
        }

        const subscriptionId = current.subscriptionId;

        await db.transaction(async (tx) => {
            // Advisory lock — serialize với createOrIncrementUsage cùng (user, feature).
            const lockKey = sql`hashtext(${userId} || ':' || ${feature})`;
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

            const subCondition = subscriptionId
                ? eq(usageLogs.subscriptionId, subscriptionId)
                : sql`${usageLogs.subscriptionId} IS NULL`;

            const [existing] = await tx
                .select({ id: usageLogs.id })
                .from(usageLogs)
                .where(
                    and(
                        eq(usageLogs.userId, userId),
                        subCondition,
                        eq(usageLogs.feature, feature),
                    ),
                )
                .limit(1);

            if (existing) {
                // Row đã có (đã được tạo bởi createOrIncrementUsage trước LLM)
                // → chỉ cộng token, KHÔNG đụng count.
                await tx
                    .update(usageLogs)
                    .set({ token: sql`${usageLogs.token} + ${tokenUsed}` })
                    .where(eq(usageLogs.id, existing.id));
                return;
            }

            // Row chưa có (worker gọi thiếu createOrIncrementUsage) → INSERT mới.
            await tx.insert(usageLogs).values({
                userId,
                subscriptionId,
                feature,
                count: 1,
                token: tokenUsed,
            });
        });
    },

    /**
     * Rollback 1 lượt count khi LLM call thất bại SAU khi `createOrIncrementUsage`
     * đã reserve thành công.
     *
     * Flow khuyến nghị trong worker:
     *   1. `createOrIncrementUsage` → true  (count + 1)
     *   2. LLM call → throw
     *   3. catch block → `decrementCount`   (count - 1, hoàn lại slot)
     *   4. throw tiếp để BullMQ retry / fail job
     *
     * Race-safe:
     *   pg_advisory_xact_lock(hashtext(userId || ':' || feature))
     *   Cùng key với `createOrIncrementUsage` → serialize chặt.
     *
     * No-op khi:
     *   - User chưa có current plan (worker gọi sai flow).
     *   - Row (user, sub, feature) chưa tồn tại (worker quên `createOrIncrementUsage`,
     *     hoặc `createOrIncrementUsage` trả về false vì quota exceeded).
     *   - count = 0 (tránh âm — defensive).
     *
     * Lưu ý:
     *   - KHÔNG đụng vào `token` (token chỉ tăng khi LLM success).
     *   - KHÔNG throw — lỗi rollback phải được log nhưng không được nuốt
     *     error gốc của LLM.
     */
    decrementCount: async (
        userId: string,
        feature: string,
    ): Promise<void> => {
        const current = await planService.getMyCurrentPlan(userId);
        if (!current) {
            logger.warn({ userId, feature }, "decrementCount: no current plan, skipping");
            return;
        }

        const subscriptionId = current.subscriptionId;

        await db.transaction(async (tx) => {
            // Cùng lock key với createOrIncrementUsage — serialize chặt.
            const lockKey = sql`hashtext(${userId} || ':' || ${feature})`;
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

            const subCondition = subscriptionId
                ? eq(usageLogs.subscriptionId, subscriptionId)
                : sql`${usageLogs.subscriptionId} IS NULL`;

            const [existing] = await tx
                .select({ id: usageLogs.id, count: usageLogs.count })
                .from(usageLogs)
                .where(
                    and(
                        eq(usageLogs.userId, userId),
                        subCondition,
                        eq(usageLogs.feature, feature),
                    ),
                )
                .limit(1);

            // Row chưa có → createOrIncrementUsage không từng chạy / trả false.
            if (!existing) return;

            const currentCount = existing.count ?? 0;
            // count = 0 → không decrement âm (defensive).
            if (currentCount <= 0) {
                logger.warn(
                    { userId, feature, count: currentCount },
                    "decrementCount: count already 0, skipping",
                );
                return;
            }

            await tx
                .update(usageLogs)
                .set({ count: sql`${usageLogs.count} - 1` })
                .where(eq(usageLogs.id, existing.id));
        });
    },


};