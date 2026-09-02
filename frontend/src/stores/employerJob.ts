/**
 * Employer job Pinia store — share state danh sách job của employer hiện tại.
 *
 * Pattern y hệt `useJobStore` của candidate:
 *   - `items`, `total`, `page`, `pageSize`, `loading`, `error`, `query`
 *   - `fetchList(newQuery?, pageNum?)` — gọi `jobApi.listByCompany` (filter
 *     companyId được backend tự resolve từ session user).
 *   - Race-safe với `latestSeq` — bỏ qua response cũ khi có request mới.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { jobApi } from '@services/job.api';
import type { JobListItem, ListJobQuery } from '@/types/job';

export const useEmployerJobStore = defineStore('employerJob', () => {
  const items = ref<JobListItem[]>([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(12);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const query = ref<ListJobQuery>({});

  const totalPages = computed(() =>
    total.value === 0 ? 1 : Math.ceil(total.value / pageSize.value),
  );

  const setError = (e: unknown): void => {
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  };

  /**
   * Race-safe: tăng `latestSeq` trước mỗi request; chỉ apply response của
   * request mới nhất. Tránh stale data khi user gõ search nhanh.
   */
  let latestSeq = 0;

  const fetchList = async (
    newQuery?: ListJobQuery,
    pageNum?: number,
  ): Promise<void> => {
    const seq = ++latestSeq;
    if (newQuery) query.value = { ...query.value, ...newQuery };
    const targetPage = pageNum ?? page.value;
    page.value = targetPage;
    loading.value = true;
    error.value = null;
    try {
      const { data } = await jobApi.listByCompany({
        ...query.value,
        page: targetPage,
        limit: pageSize.value,
      });
      if (seq !== latestSeq) return;
      items.value = data.data;
      total.value = data.pagination.total;
    } catch (e) {
      if (seq !== latestSeq) return;
      setError(e);
    } finally {
      if (seq === latestSeq) loading.value = false;
    }
  };

  const resetFilters = (): void => {
    query.value = {};
    page.value = 1;
  };

  return {
    items,
    total,
    page,
    pageSize,
    loading,
    error,
    query,
    totalPages,
    fetchList,
    resetFilters,
  };
});