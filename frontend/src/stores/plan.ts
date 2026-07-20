/**
 * Plan store — quota tracking
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export type PlanCode = 'free' | 'light' | 'pro';

interface Plan {
  id: string;
  code: PlanCode;
  name: string;
  priceVnd: number;
  durationDays: number;
  features: Record<string, number>;
}

interface Usage {
  feature: string;
  used: number;
  limit: number;
}

export const usePlanStore = defineStore('plan', () => {
  const currentPlan = ref<Plan | null>(null);
  const usage = ref<Usage[]>([]);

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

  const isPro = (): boolean => currentPlan.value?.code === 'pro';
  const isLight = (): boolean => currentPlan.value?.code === 'light';

  return { currentPlan, usage, hasQuota, remaining, isPro, isLight };
});