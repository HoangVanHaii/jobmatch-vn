/**
 * useInsight composable — fetch + cache search insight
 */
import { ref } from 'vue';
import { http } from '@services/http';

interface Insight {
  jobCount: number;
  salaryMedian: { min: number; max: number } | null;
  topSkills: Array<{ name: string; count: number }>;
  topCompanies: Array<{ id: string; name: string; logoUrl: string; jobCount: number }>;
}

export const useInsight = () => {
  const data = ref<Insight | null>(null);
  const loading = ref(false);

  const fetch = async (keyword: string): Promise<Insight | null> => {
    if (!keyword) return null;
    loading.value = true;
    try {
      const res = await http.get('/search/insight', { params: { keyword } });
      data.value = res.data.data;
      return res.data.data;
    } catch { return null; }
    finally { loading.value = false; }
  };

  return { data, loading, fetch };
};