/**
 * Plan API client — wrapper quanh http axios instance.
 * Theo convention `*.api.ts` của project (xem services/job.api.ts).
 */
import { http } from './http';
import type {
  Plan,
  ApiResponse,
  PlanListParams,
  PlanCreatePayload,
  PlanUpdatePayload,
  Pagination,
} from '@/types/plan';
import type { PlanUsage } from '@/types/billing';

export const planApi = {
  /**
   * GET /plans — list plans.
   * User thường: chỉ thấy active.
   * Admin: truyền `includeInactive: true` để thấy tất cả.
   */
  list: async (params: PlanListParams = {}): Promise<{ data: Plan[]; pagination: Pagination }> => {
    const { data } = await http.get<ApiResponse<Plan[]>>('/plans', { params });
    return {
      data: data.data,
      pagination: data.pagination!,
    };
  },

  /**
   * GET /plans/:id — chi tiết 1 plan.
   */
  getById: async (id: string): Promise<Plan> => {
    const { data } = await http.get<ApiResponse<Plan>>(`/plans/${id}`);
    return data.data;
  },

  /**
   * GET /plans/me — Plan hiện tại của user đang đăng nhập.
   * Trả null nếu chưa mua gói / sub đã hết hạn → user đang ở free.
   */
  getMyPlan: async (): Promise<{
    plan: Plan;
    subscriptionId: string;
    expiresAt: string;
  } | null> => {
    const { data } = await http.get<ApiResponse<{
      plan: Plan;
      subscriptionId: string;
      expiresAt: string;
    } | null>>('/plans/me');
    return data.data;
  },

  /**
   * GET /plans/me/usage — Plan hiện tại + quota + remainingDays.
   * Dùng cho BillingHistoryView section 1+2.
   *
   * `plan === null` khi user chưa có sub active → usage cũng rỗng.
   * `remainingDays` floor về ngày, tối thiểu 0.
   */
  getMyUsage: async (): Promise<PlanUsage> => {
    const { data } = await http.get<ApiResponse<PlanUsage>>('/plans/me/usage');
    return data.data;
  },

  /**
   * POST /plans — admin only. Tạo plan mới.
   * (Backend gộp public + admin vào /plans, chỉ phân biệt qua middleware adminOnly.)
   */
  create: async (payload: PlanCreatePayload): Promise<Plan> => {
    const { data } = await http.post<ApiResponse<Plan>>('/plans', payload);
    return data.data;
  },

  /**
   * PATCH /plans/:id — admin only. Cập nhật plan.
   */
  update: async (id: string, payload: PlanUpdatePayload): Promise<Plan> => {
    const { data } = await http.patch<ApiResponse<Plan>>(`/plans/${id}`, payload);
    return data.data;
  },

  /**
   * DELETE /plans/:id — admin only. Soft delete (set isActive=false).
   */
  remove: async (id: string): Promise<void> => {
    await http.delete<ApiResponse<null>>(`/plans/${id}`);
  },
};
