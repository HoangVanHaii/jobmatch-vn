import { Request, Response, NextFunction } from 'express';
import { subscriptionService } from '../service/subscription.service';
import type { SubscriptionListItem } from '../interface/subscription';
import type { AdminUpdateSubscriptionPayload } from '../interface/subscription';
import type { SubscriptionListQuery } from '../middleware/subscription';

/**
 * Subscription controller — expose subscription operations cho user đang đăng nhập.
 *
 * Hiện chỉ có listMine (lịch sử subscription của user).
 * Admin list/get chưa cần (chưa có dashboard subscriptions).
 */
export const subscriptionController = {
    /**
     * GET /subscriptions/me?page=&limit=&status= — Lịch sử subscription của user hiện tại.
     *
     * Dùng cho BillingHistoryView section 3.
     * Convert Date → ISO string trước khi trả về (JSON serialization safety).
     *
     * Query params đã validate qua `subscriptionListQuerySchema` ở router —
     * đảm bảo page/limit là số dương, status (optional) thuộc enum pg.
     *
     * `status` được forward xuống service — service apply "effective status"
     * filter ở SQL layer (xem subscription.service.buildStatusWhere).
     */
    listMine: async (
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const userId = req.user!.userId;
            const { page, limit, status } = req.query as unknown as SubscriptionListQuery;

            // Convert page → offset (chuẩn SQL/REST mà service yêu cầu).
            const offset = (page - 1) * limit;
            const { data, total, page: currentPage } =
                await subscriptionService.listByUser(userId, offset, limit, status);

            const items: SubscriptionListItem[] = data.map((s) => ({
                ...s,
                startedAt: s.startedAt.toISOString(),
                expiresAt: s.expiresAt.toISOString(),
                createdAt: s.createdAt.toISOString(),
            }));

            res.json({
                success: true,
                data: items,
                pagination: {
                    page: currentPage,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            });
        } catch (err) {
            next(err);
        }
    },

    /**
     * GET /subscriptions/:id — chi tiết 1 subscription.
     * - Auth required (auth middleware applied globally).
     * - Ownership: user chỉ thấy subscription của mình (admin xem được tất cả).
     */
    getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params.id as string;
            const userId = req.user!.userId;
            const isAdmin = req.user!.role === 'admin';

            const data = await subscriptionService.getById(id, userId, isAdmin);

            res.json({
                success: true,
                data: {
                    ...data,
                    startedAt: data.startedAt.toISOString(),
                    expiresAt: data.expiresAt.toISOString(),
                    createdAt: data.createdAt.toISOString(),
                },
            });
        } catch (err) { next(err); }
    },

    /**
     * GET /subscriptions — Admin list tất cả subscriptions (filter + pagination).
     * Query params: page, limit, status?, userId?, planId?
     */
    list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const filters = req.query as unknown as SubscriptionListQuery;
            const offset = (filters.page - 1) * filters.limit;
            const { data, total } = await subscriptionService.list({
                offset,
                limit: filters.limit,
                status: filters.status,
                userId: filters.userId,
                planId: filters.planId,
            });

            res.json({
                success: true,
                data: data.map((s) => ({
                    ...s,
                    startedAt: s.startedAt.toISOString(),
                    expiresAt: s.expiresAt.toISOString(),
                    createdAt: s.createdAt.toISOString(),
                })),
                pagination: {
                    page: filters.page,
                    limit: filters.limit,
                    total,
                    totalPages: Math.ceil(total / filters.limit),
                },
            });
        } catch (err) { next(err); }
    },

    /**
     * PATCH /subscriptions/:id — Admin update 1 subscription.
     * Body: { status?, expiresAt?, autoRenew? } (at least 1 field).
     */
    update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params.id as string;
            const payload = req.body as AdminUpdateSubscriptionPayload;

            const data = await subscriptionService.adminUpdate(id, payload);

            res.json({
                success: true,
                data: {
                    ...data,
                    startedAt: data.startedAt.toISOString(),
                    expiresAt: data.expiresAt.toISOString(),
                    createdAt: data.createdAt.toISOString(),
                },
            });
        } catch (err) { next(err); }
    },
};