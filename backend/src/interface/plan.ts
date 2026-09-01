
export interface Plan {
  id: string;
  code: string;
  name: string;
  priceVnd: string;
  durationDays: number;
  features: Record<string, unknown>;
  isActive: boolean | null;
}

/**
 * Quota key — đồng bộ 1-1 với key trong `plans.features` JSONB.
 *
 * Source count:
 *  - `apply`           ← đếm từ `applications` (candidate đã apply bao nhiêu job)
 *  - `job_post`        ← đếm từ `jobs.posted_by` (user đã đăng bao nhiêu job)
 *  - `ai_cv_parsed`    ← cvParse.worker.ts ghi vào `usage_logs`
 *  - `ai_cv_analysis`  ← cvAnalysis.worker.ts ghi vào `usage_logs`
 *  - `job_generation`  ← job.service.generateDraft ghi vào `usage_logs`
 *
 * KHÔNG đổi key khi plan features đổi — nếu DB thêm feature mới cần count,
 * thêm literal vào union này + xử lý trong planService.getMyPlanUsage.
 */
export type CountableQuotaKey =
    | 'apply'
    | 'job_post'
    | 'ai_cv_parsed'
    | 'ai_cv_analysis'
    | 'job_generation';

/**
 * 1 quota item trong response của GET /plans/me/usage.
 *
 * Fields:
 *  - key:       quota identifier (xem CountableQuotaKey).
 *  - used:      số lượt đã dùng (count).
 *  - tokens:    tổng LLM tokens đã tiêu thụ (chỉ AI features; = 0 với non-AI).
 *  - limit:     giới hạn lượt. = -1 → unlimited.
 *  - unlimited: true nếu limit = -1 (FE render "Không giới hạn").
 */
export interface QuotaUsageItem {
    key: CountableQuotaKey;
    used: number;
    tokens: number;
    limit: number;
    unlimited: boolean;
}

/**
 * Response của GET /plans/me/usage — gộp current plan + quota + remainingDays.
 *
 * - `plan === null` → user chưa có sub active / đã hết hạn → đang ở free tier.
 * - `remainingDays === null` khi `plan === null`.
 * - `usage` chứa:
 *   - `cv_create`, `job_apply` — count từ bảng cvs/applications.
 *   - `ai_*` — count từ usage_logs (chỉ các feature key mà plan có limit).
 */
export interface PlanUsage {
    plan: Plan | null;
    subscriptionId: string | null;
    expiresAt: string | null;
    remainingDays: number | null;
    usage: QuotaUsageItem[];
}
