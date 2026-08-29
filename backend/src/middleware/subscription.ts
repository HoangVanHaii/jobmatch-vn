import { z } from 'zod';

/**
 * Query schema cho `GET /subscriptions/me`.
 *
 * Status filter (optional): lọc theo `subscription_status` pg enum
 * (active / expired / cancelled / pending). Hữu ích cho:
 *   - FE filter "Đang dùng" (active) / "Lịch sử" (cancelled+expired)
 *   - Admin dashboard sau này
 *
 * Pagination:
 *   - `page` mặc định 1, `limit` mặc định 20, max 100 (giống paymentListQuerySchema).
 *   - Dùng `z.coerce.number()` để query string (string) → number tự động.
 */
export const subscriptionListQuerySchema = z.object({
    status: z
        .enum(['active', 'expired', 'cancelled', 'pending'])
        .optional(),
    userId: z.string().uuid().optional(),
    planId: z.string().uuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});

export type SubscriptionListQuery = z.infer<typeof subscriptionListQuerySchema>;

/**
 * Params schema cho `GET /subscriptions/:id` (future — nếu thêm).
 * Định nghĩa sẵn để dùng khi mở rộng admin list/get subscription.
 */
export const subscriptionIdParamsSchema = z.object({
    id: z.string().uuid({ message: 'Invalid subscription id (must be UUID)' }),
});

/**
 * Body schema cho `PATCH /subscriptions/:id` (admin only).
 *
 * Dùng cho CS tool: extend expiry, force cancel, toggle autoRenew.
 *
 * `.strict()` → không chấp nhận extra fields (admin gửi nhầm key sẽ bị 400).
 * `.refine(...)` → bắt buộc ít nhất 1 field — admin gọi PATCH trống là 400
 *   (tránh UPDATE với empty SET — không có tác dụng nhưng vẫn touch row).
 */
export const adminUpdateSubscriptionSchema = z
    .object({
        status: z.enum(['active', 'expired', 'cancelled', 'pending']).optional(),
        expiresAt: z.string().datetime({ message: 'expiresAt phải là ISO datetime string' }).optional(),
        autoRenew: z.boolean().optional(),
    })
    .strict()
    .refine(
        (data) => Object.keys(data).length > 0,
        { message: 'Phải cung cấp ít nhất 1 field để cập nhật' },
    );

export type AdminUpdateSubscriptionBody = z.infer<typeof adminUpdateSubscriptionSchema>;