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
  const counts = ref<{ mine: number; company: number }>({ mine: 0, company: 0 });

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
    if (newQuery) {
      const merged = { ...query.value, ...newQuery };
      for (const key of Object.keys(merged) as (keyof ListJobQuery)[]) {
        if (merged[key] === undefined) {
          delete merged[key];
        }
      }
      query.value = merged;
    }
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
      if (
        !data ||
        !Array.isArray(data.data) ||
        typeof data.pagination?.total !== 'number'
      ) {
        throw new Error('Dữ liệu phản hồi không hợp lệ');
      }
      items.value = data.data;
      total.value = data.pagination.total;
      if (data.counts) {
        counts.value = data.counts;
      }
    } catch (e) {
      if (seq !== latestSeq) return;
      setError(e);
      items.value = [];
      total.value = 0;
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
    counts,
    totalPages,
    fetchList,
    resetFilters,
  };
});