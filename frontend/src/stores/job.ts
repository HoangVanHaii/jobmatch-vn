/**
 * Job Pinia store — state cho trang `/candidate/viec-lam`.
 *
 * Pattern y hệt `useCvStore`:
 *   - jobApi: gọi HTTP, trả AxiosResponse (xem services/job.api.ts).
 *   - store (file này): unwrap, giữ state (items, total, page, loading, error, query).
 *   - UI (JobsView) chỉ đọc state + gọi action.
 *
 * Phạm vi phase này: CHỈ phục vụ trang listing candidate. Detail page dùng
 * fetch trực tiếp jobApi.detail (không qua store) — không có state shared
 * giữa list và detail nên không cần cache chung.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { jobApi } from '@services/job.api';
import type { JobListItem, ListJobQuery } from '@/types/job';

export const useJobStore = defineStore('job', () => {
  // --- State ---
  const items = ref<JobListItem[]>([]);
  const total = ref(0);
  const page = ref(1);
  /**
   * 12 jobs/trang — phù hợp grid 3 cột trên desktop (4 rows) hoặc 2 cột
   * trên tablet (6 rows). Lớn hơn CV (8) vì card job rộng hơn card CV.
   */
  const pageSize = ref(12);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** Filter/search hiện tại. Pagination tách riêng ở `page`/`pageSize`. */
  const query = ref<ListJobQuery>({});

  // --- Computed ---
  const totalPages = computed(() =>
    total.value === 0 ? 1 : Math.ceil(total.value / pageSize.value),
  );

  // --- Helpers ---
  const setError = (e: unknown): void => {
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  };

  // --- Actions ---

  /**
   * Fetch danh sách job theo `query` hiện tại + page chỉ định.
   *
   * @param newQuery — merge vào query hiện tại (null/undefined key sẽ giữ nguyên
   *   giá trị cũ). Muốn xoá 1 filter → truyền key đó = undefined.
   * @param pageNum — page muốn load (1-based). Mặc định giữ page hiện tại.
   *
   * Anti-race:
   *   - KHÔNG skip khi `loading.value` — skip im lặng dễ gây UI stuck khi
   *     user navigate rồi quay lại. (Trước đây có `if (loading.value) return`
   *     nhưng nó nuốt request mới mà không báo lỗi.)
   *   - Dùng `latestSeq` để đảm bảo CHỈ response của request CUỐI CÙNG được
   *     apply lên state. Request cũ về sau sẽ bị discard.
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
      const { data } = await jobApi.list({
        ...query.value,
        page: targetPage,
        limit: pageSize.value,
      });
      // Nếu có request mới hơn → bỏ qua response cũ.
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

  /** Reset toàn bộ filter + về trang 1. Không gọi API — caller tự fetchList sau. */
  const resetFilters = (): void => {
    query.value = {};
    page.value = 1;
  };

  /** Set 1 filter cụ thể (key bất kỳ trong ListJobQuery), reset về trang 1. */
  const setFilter = <K extends keyof ListJobQuery>(
    key: K,
    value: ListJobQuery[K] | undefined,
  ): void => {
    query.value = { ...query.value, [key]: value };
    page.value = 1;
  };

  return {
    // state
    items,
    total,
    page,
    pageSize,
    loading,
    error,
    query,
    // computed
    totalPages,
    // actions
    fetchList,
    resetFilters,
    setFilter,
  };
});