/**
 * useQuota composable — check quota trước khi call AI
 */
import { usePlanStore } from '@stores/plan';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';

export const useQuota = () => {
  const planStore = usePlanStore();
  const { currentPlan, usage } = storeToRefs(planStore);
  const router = useRouter();

  const requireQuota = (feature: string): boolean => {
    if (!planStore.hasQuota(feature)) {
      router.push({ name: 'pricing', query: { reason: feature } });
      return false;
    }
    return true;
  };

  return { currentPlan, usage, hasQuota: planStore.hasQuota, remaining: planStore.remaining, requireQuota };
};