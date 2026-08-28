import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { subscriptions } from '../db/schema';

/**
 * Mirror `subscription_status` pg enum (xem db/schema/enums.ts).
 * Dùng cho API response + helper normalize `resolveSubscriptionStatus`.
 */
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'pending';

/** Row thô từ bảng `subscriptions` (Drizzle InferSelectModel). */
export type Subscription = InferSelectModel<typeof subscriptions>;

/** Row insert vào bảng `subscriptions` (Drizzle InferInsertModel). */
export type NewSubscription = InferInsertModel<typeof subscriptions>;

/**
 * Subscription kèm thông tin plan (denormalized từ INNER JOIN plans).
 *
 * - Trả về Date object từ service layer (chưa serialize).
 * - Controller sẽ convert Date → ISO string trước khi response
 *   (xem `SubscriptionListItem` dưới đây).
 *
 * `totalTokens` được populate chỉ ở `subscriptionService.listByUser` (cho
 * section "Lịch sử subscription" của BillingHistoryView). Các methods khác
 * (`getById`, `admin list/update`) chưa cần → để mặc định 0 nếu undefined.
 */
export type SubscriptionWithPlan = Subscription & {
    planCode: string;
    planName: string;
    planDurationDays: number;
    priceVnd: string;
    totalTokens: number;
};

/**
 * Subscription trả về qua API (Date đã convert sang ISO string).
 * Dùng cho `GET /subscriptions/me` response.
 */
export type SubscriptionListItem = Omit<
    SubscriptionWithPlan,
    'startedAt' | 'expiresAt' | 'createdAt'
> & {
    startedAt: string;
    expiresAt: string;
    createdAt: string;
};

/**
 * Payload cho admin update 1 subscription (CS tool: extend expiry, force cancel, toggle autoRenew).
 *
 * - status:    Optional SubscriptionStatus. cancelled là terminal — không thể forward từ cancelled.
 * - expiresAt: Optional ISO string. Service sẽ parse sang Date.
 * - autoRenew: Optional boolean.
 *
 * Mọi fields optional — chỉ update fields nào có mặt.
 */
export interface AdminUpdateSubscriptionPayload {
    status?: SubscriptionStatus;
    expiresAt?: string;
    autoRenew?: boolean;
}