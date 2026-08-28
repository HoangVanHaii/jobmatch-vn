/**
 * Service `billing` — query plans + active subscription.
 * Phase 1: chỉ read-only cho chatbot. Write/update flow đã ở paymentRouter.
 */
import { db } from '../config/database';
import { plans, subscriptions } from '../db/schema';
import { eq, and, desc, gt, sql } from 'drizzle-orm';

type Plan = typeof plans.$inferSelect;
type Subscription = typeof subscriptions.$inferSelect;

export const billingService = {
  /**
   * List các gói đang active (isActive=true) cho user xem.
   */
  listPlans: async (): Promise<Plan[]> => {
    return db.select().from(plans).where(eq(plans.isActive, true)).orderBy(plans.priceVnd);
  },

  /**
   * Lấy subscription active gần nhất của user (còn hạn).
   * Phase 1 chỉ cần active. Trả null nếu user chưa từng mua.
   */
  getActiveSubscriptionByUser: async (
    userId: string,
  ): Promise<(Subscription & { planCode: string; planName: string }) | null> => {
    const [row] = await db
      .select({
        sub: subscriptions,
        planCode: plans.code,
        planName: plans.name,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, 'active'),
          gt(subscriptions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(subscriptions.expiresAt))
      .limit(1);
    if (!row) return null;
    return { ...row.sub, planCode: row.planCode, planName: row.planName };
  },
};
