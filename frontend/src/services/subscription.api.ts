/**
 * Subscription API client — wrapper quanh http axios instance.
 *
 * Hiện chỉ có `listMine` (lịch sử subscription của user hiện tại).
 * Tái sử dụng pattern từ services/payment.api.ts và services/plan.api.ts.
 */
import { http } from './http';
import type { ApiResponse, Pagination } from '@/types/plan';
import type {
  SubscriptionHistoryItem,
  SubscriptionStatus,
  AdminUpdateSubscriptionPayload,
} from '@/types/billing';

export const subscriptionApi = {
  /**
   * GET /subscriptions/me?page=&limit= — Lịch sử subscription của user
   * (DESC theo startedAt). Dùng cho BillingHistoryView section 3.
   *
   * `status` filter optional — dùng để hiển thị tab "Đang dùng" / "Hết hạn" / ...
   */
  listMine: async (
    page = 1,
    limit = 20,
    status?: SubscriptionStatus,
  ): Promise<{ data: SubscriptionHistoryItem[]; pagination: Pagination }> => {
    const { data } = await http.get<ApiResponse<SubscriptionHistoryItem[]>>(
      '/subscriptions/me',
      { params: { page, limit, ...(status ? { status } : {}) } },
    );
    return {
      data: data.data,
      pagination: data.pagination!,
    };
  },

  /**
   * GET /subscriptions — Admin: list all subscriptions (filter + pagination).
   * Mirrors paymentApi.list() pattern.
   */
  list: async (
    params: {
      page?: number;
      limit?: number;
      status?: SubscriptionStatus;
      userId?: string;
      planId?: string;
    } = {},
  ): Promise<{ data: SubscriptionHistoryItem[]; pagination: Pagination }> => {
    const { data } = await http.get<ApiResponse<SubscriptionHistoryItem[]>>(
      '/subscriptions',
      { params },
    );
    return {
      data: data.data,
      pagination: data.pagination!,
    };
  },

  /**
   * GET /subscriptions/:id — Get 1 subscription detail.
   * - User: only their own subscription (BE returns 403 otherwise)
   * - Admin: any subscription
   */
  getById: async (id: string): Promise<SubscriptionHistoryItem> => {
    const { data } = await http.get<ApiResponse<SubscriptionHistoryItem>>(`/subscriptions/${id}`);
    return data.data;
  },

  /**
   * PATCH /subscriptions/:id — Admin: update a subscription.
   * Use cases: CS extension, force-cancel, autoRenew toggle.
   * At least 1 field required (BE validates).
   */
  update: async (
    id: string,
    payload: AdminUpdateSubscriptionPayload,
  ): Promise<SubscriptionHistoryItem> => {
    const { data } = await http.patch<ApiResponse<SubscriptionHistoryItem>>(
      `/subscriptions/${id}`,
      payload,
    );
    return data.data;
  },
};
