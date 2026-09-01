/**
 * Plan store — Pinia store cho Plans.
 *
 * Tách làm 2 nhóm state:
 * - `publicState`: danh sách plans user thường thấy (chỉ active) — dùng cho trang pricing.
 * - `adminState`: danh sách plans admin thấy (cả inactive) — dùng cho admin dashboard.
 *
 * Convention state: `data | null`, `loading | null | 'success' | 'error'` (giống cách
 * project đang dùng error message).
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { planApi } from '@/services/plan.api';
import type { Plan, PlanCreatePayload, PlanUpdatePayload } from '@/types/plan';

export type PlanCode = 'free' | 'light' | 'pro' | string;

// ---- Internal types ----
interface Usage {
  feature: string;
  used: number;
  limit: number;
}

// ---- Store ----
export const usePlanStore = defineStore('plan', () => {
  // ============ Public state (pricing page) ============
  const plans = ref<Plan[]>([]);
  const publicLoading = ref(false);
  const publicError = ref<string | null>(null);

  // ============ Admin state (admin dashboard) ============
  const adminPlans = ref<Plan[]>([]);
  const adminTotal = ref(0);
  const adminLoading = ref(false);
  const adminError = ref<string | null>(null);

  // ============ Subscription/usage state (giữ từ store cũ để không phá callers) ============
  const currentPlan = ref<Plan | null>(null);
  const currentPlanExpiresAt = ref<string | null>(null);
  const usage = ref<Usage[]>([]);

  // ============ Computed ============
  const activePlans = computed(() => plans.value.filter((p) => p.isActive !== false));
  const isLoading = computed(() => publicLoading.value || adminLoading.value);

  // ============ Helpers ============
  const hasQuota = (feature: string): boolean => {
    const u = usage.value.find((x) => x.feature === feature);
    if (!u) return true;
    return u.limit === -1 || u.used < u.limit;
  };

  const remaining = (feature: string): number => {
    const u = usage.value.find((x) => x.feature === feature);
    if (!u) return -1;
    return u.limit === -1 ? -1 : Math.max(0, u.limit - u.used);
  };

  /**
   * Fetch plan hiện tại user đang dùng (active subscription).
   * - Set `currentPlan = null` nếu user chưa mua gói / sub hết hạn.
   * - Gọi sau khi login, và sau khi thanh toán thành công.
   */
  const fetchMyPlan = async (): Promise<void> => {
    try {
      const data = await planApi.getMyPlan();
      currentPlan.value = data?.plan ?? null;
      currentPlanExpiresAt.value = data?.expiresAt ?? null;
    } catch (err) {
      // Không throw — caller có thể ignore lỗi (user chưa login chẳng hạn)
      currentPlan.value = null;
      currentPlanExpiresAt.value = null;
    }
  };

  // ============ Actions: Public ============
  /**
   * Load danh sách plans cho user thường (chỉ active).
   */
  const fetchPublicPlans = async (): Promise<void> => {
    publicLoading.value = true;
    publicError.value = null;
    try {
      const { data } = await planApi.list({});
      plans.value = data;
    } catch (err: any) {
      publicError.value = err?.response?.data?.error?.message ?? 'Lỗi tải danh sách plan';
      throw err;
    } finally {
      publicLoading.value = false;
    }
  };

  // ============ Actions: Admin ============
  /**
   * Admin: load tất cả plans (bao gồm inactive).
   */
  const fetchAdminPlans = async (params: { page?: number; limit?: number } = {}): Promise<void> => {
    adminLoading.value = true;
    adminError.value = null;
    try {
      const { data, pagination } = await planApi.list({
        includeInactive: true,
        page: params.page ?? 1,
        limit: params.limit ?? 50,
      });
      adminPlans.value = data;
      adminTotal.value = pagination.total;
    } catch (err: any) {
      adminError.value = err?.response?.data?.error?.message ?? 'Lỗi tải danh sách plan';
      throw err;
    } finally {
      adminLoading.value = false;
    }
  };

  const createPlan = async (payload: PlanCreatePayload): Promise<Plan> => {
    const created = await planApi.create(payload);
    // Refresh list admin để có data mới nhất
    await fetchAdminPlans();
    return created;
  };

  const updatePlan = async (id: string, payload: PlanUpdatePayload): Promise<Plan> => {
    const updated = await planApi.update(id, payload);
    // Update in-place trong admin list
    const idx = adminPlans.value.findIndex((p) => p.id === id);
    if (idx !== -1) adminPlans.value[idx] = updated;
    // Update trong public list nếu có
    const pubIdx = plans.value.findIndex((p) => p.id === id);
    if (pubIdx !== -1) plans.value[pubIdx] = updated;
    return updated;
  };

  const deletePlan = async (id: string): Promise<void> => {
    await planApi.remove(id);
    // Soft delete: cập nhật isActive=false in-place thay vì xoá khỏi list
    // (admin vẫn cần thấy để biết plan nào đã bị deactivate)
    const idx = adminPlans.value.findIndex((p) => p.id === id);
    if (idx !== -1) adminPlans.value[idx] = { ...adminPlans.value[idx], isActive: false };
    // Xoá khỏi public list (user thường không thấy plan inactive)
    plans.value = plans.value.filter((p) => p.id !== id);
  };

  const reset = (): void => {
    plans.value = [];
    adminPlans.value = [];
    adminTotal.value = 0;
    publicError.value = null;
    adminError.value = null;
  };

  return {
    // State
    plans,
    adminPlans,
    adminTotal,
    publicLoading,
    publicError,
    adminLoading,
    adminError,
    currentPlan,
    currentPlanExpiresAt,
    usage,
    // Computed
    activePlans,
    isLoading,
    // Helpers (giữ cho backward-compat)
    hasQuota,
    remaining,
    // Actions
    fetchPublicPlans,
    fetchMyPlan,
    fetchAdminPlans,
    createPlan,
    updatePlan,
    deletePlan,
    reset,
  };
});
