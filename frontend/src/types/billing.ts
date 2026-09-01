/**
 * Billing types — shared cho BillingHistoryView.
 *
 * - `PlanUsage` mirror backend `PlanUsage` (backend/src/interface/plan.ts).
 * - `SubscriptionHistoryItem` mirror backend `SubscriptionWithPlan` trong
 *   subscription.service.ts, sau khi controller convert Date → ISO string.
 *
 * `usage` chứa cả quota từ bảng có sẵn (cvs/applications) + từ `usage_logs`
 * (AI features) — backend query GROUP BY feature trong sub period.
 */
import type { Plan } from './plan';

/**
 * Quota key — đồng bộ 1-1 với `plans.features` JSONB trong backend + CountableQuotaKey.
 * Phải khớp với key BE trả về từ GET /plans/me/usage.
 *
 *  - `apply`           ← applications (candidate đã apply bao nhiêu job)
 *  - `job_post`        ← jobs.posted_by (đã đăng bao nhiêu job)
 *  - `ai_cv_parsed`    ← usage_logs (cvParse worker)
 *  - `ai_cv_analysis`  ← usage_logs (cvAnalysis worker)
 *  - `job_generation`  ← usage_logs (generateDraft)
 */
export type CountableQuotaKey =
    | 'apply'
    | 'job_post'
    | 'ai_cv_parsed'
    | 'ai_cv_analysis'
    | 'job_generation';

export interface QuotaUsageItem {
    key: CountableQuotaKey;
    used: number;
    /** Tổng LLM tokens đã dùng (chỉ AI features; = 0 với non-AI). */
    tokens: number;
    limit: number;
    unlimited: boolean;
}

export interface PlanUsage {
    plan: Plan | null;
    subscriptionId: string | null;
    expiresAt: string | null;
    remainingDays: number | null;
    usage: QuotaUsageItem[];
}

export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'pending';

export interface SubscriptionHistoryItem {
    id: string;
    userId: string;
    planId: string;
    planCode: string;
    planName: string;
    planDurationDays: number;
    priceVnd: string;
    status: SubscriptionStatus;
    startedAt: string;
    expiresAt: string;
    payosOrderId: string | null;
    autoRenew: boolean;
    /** Tổng LLM tokens đã dùng trong sub period (sum usage_logs.token). */
    totalTokens: number;
    createdAt: string;
}

/**
 * PATCH /subscriptions/:id (admin) payload.
 * At least one field required — backend validates via .refine().
 */
export interface AdminUpdateSubscriptionPayload {
    status?: SubscriptionStatus;
    expiresAt?: string;
    autoRenew?: boolean;
}
