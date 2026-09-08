/**
 * Admin Jobs store — Pinia state cho trang /admin/jobs.
 *
 * Filter + search chạy trên SERVER (BE nhận q, status, level, type, sort, page, limit).
 * setFilter thay đổi → reset page 1 + refetch. page watch → refetch.
 */
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { adminJobApi, type AdminJobSort, type AdminJobCounts } from '@/services/adminJob.api';
import type { JobListItem } from '@/types/job';
import { jobStatusLabel } from '@/utils/format';
import { useToastStore } from './toast';

export type JobStatusFilter = 'all' | JobListItem['status'];

export interface AdminJobFilters {
  q: string;
  status: JobStatusFilter;
  jobLevel: '' | JobListItem['jobLevel'];
  jobType: '' | JobListItem['jobType'];
  sort: AdminJobSort;
}

const DEFAULT_FILTERS: AdminJobFilters = {
  q: '',
  status: 'all',
  jobLevel: '',
  jobType: '',
  sort: 'newest',
};

export const useAdminJobsStore = defineStore('adminJobs', () => {
  const jobs = ref<JobListItem[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const page = ref(1);
  const pageSize = ref(20);
  const total = ref(0);
  const counts = ref<AdminJobCounts | null>(null);
  const filters = ref<AdminJobFilters>({ ...DEFAULT_FILTERS });

  const paged = computed(() => jobs.value);

  const canGoNext = computed(() => page.value * pageSize.value < total.value);
  const canGoPrev = computed(() => page.value > 1);

  async function refetch(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const statusArr = filters.value.status === 'all' ? undefined : [filters.value.status];
      const res = await adminJobApi.list({
        page: page.value,
        limit: pageSize.value,
        search: filters.value.q || undefined,
        status: statusArr,
        jobLevel: filters.value.jobLevel || undefined,
        jobType: filters.value.jobType || undefined,
        sort: filters.value.sort,
      });
      jobs.value = res.data.data;
      total.value = res.data.pagination.total;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Không tải được danh sách job';
      error.value = msg;
      jobs.value = [];
      total.value = 0;
    } finally {
      loading.value = false;
    }
  }

  async function fetchCounts(): Promise<void> {
    try {
      const res = await adminJobApi.counts();
      counts.value = res.data;
    } catch {
      counts.value = null;
    }
  }

  async function changeStatus(jobId: string, status: JobListItem['status']): Promise<boolean> {
    const toast = useToastStore();
    try {
      await adminJobApi.changeStatus(jobId, status);
      // Refetch TRƯỚC khi toast success — nếu refetch fail, user sẽ thấy toast error
      // thay vì "thành công" trong khi UI vẫn hiển thị status cũ.
      try {
        await Promise.all([refetch(), fetchCounts()]);
      } catch {
        toast.error('Cập nhật trạng thái thành công nhưng không tải lại được danh sách');
        return true; // API change vẫn OK
      }
      toast.success(`Đã cập nhật trạng thái job thành "${jobStatusLabel(status)}"`);
      return true;
    } catch (e) {
      toast.error('Cập nhật trạng thái thất bại');
      return false;
    }
  }

  function setFilter<K extends keyof AdminJobFilters>(key: K, value: AdminJobFilters[K]): void {
    const before = filters.value[key];
    filters.value[key] = value;
    if (before !== value) {
      page.value = 1;
      refetch();
    }
  }

  function resetFilters(): void {
    filters.value = { ...DEFAULT_FILTERS };
    page.value = 1;
    refetch();
  }

  /** Đổi trang (từ AdminPagination emit update:page). Bound chỉ khi p >= 1. */
  function goToPage(p: number): void {
    if (p >= 1) page.value = p;
  }

  watch(page, () => refetch());

  return {
    jobs, loading, error, page, pageSize, total, counts, filters,
    paged, canGoNext, canGoPrev,
    refetch, fetchCounts, changeStatus, setFilter, resetFilters, goToPage,
  };
});
