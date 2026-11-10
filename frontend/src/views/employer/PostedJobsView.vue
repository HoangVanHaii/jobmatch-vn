<script setup lang="ts">
/**
 * PostedJobsView — QUẢN LÝ TIN TUYỂN DỤNG DẠNG BẢNG (TABLE) CHÍNH THỨC.
 * Giao diện bảng 5 cột chuẩn SaaS tinh gọn:
 *  1. Tin tuyển dụng (Tên tin, địa điểm, hình thức làm việc, ngày đăng)
 *  2. Trạng thái (Badge trạng thái + thời hạn)
 *  3. Mức lương (Khoảng lương hoặc Thoả thuận)
 *  4. Ứng viên (Tổng số ứng viên, sortable, badge ứng viên mới)
 *  5. Thao tác (Nút Sửa + menu ...)
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Briefcase,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useEmployerJobStore } from '@stores/employerJob';
import { useDebounce } from '@composables/useDebounce';
import { useLocations } from '@composables/useLocations';
import { jobApi } from '@services/job.api';
import ConfirmModal from '@components/common/ConfirmModal.vue';
import EditJobModal from '@components/employer/EditJobModal.vue';
import CreateJobModal from '@components/employer/CreateJobModal.vue';
import { useToastStore } from '@stores/toast';
import { JOB_STATUS_LABELS } from '@/types/job';
import type { CompanyJobSortBy, JobListItem, JobLevel, JobStatus, JobType, WorkType } from '@/types/job';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const store = useEmployerJobStore();
const { items, total, page, pageSize, totalPages, loading, error, counts } = storeToRefs(store);
const toast = useToastStore();
const router = useRouter();
const route = useRoute();

/**
 * Cờ đánh dấu đã hoàn thành lượt fetch danh sách đầu tiên của lần mount này.
 * Giữ skeleton khớp bố cục thật trong lần tải đầu, tránh nháy trang trắng hoặc
 * rơi vào trạng thái rỗng tạm thời trước khi API phản hồi.
 */
const initialLoaded = ref(items.value.length > 0);

/**
 * Chu kỳ hiệu ứng khi dữ liệu danh sách thay đổi (filter, search, tab, sort, phân trang).
 * Xen kẽ hai bộ animation để kích hoạt lại CSS animation mà không cần unmount DOM.
 * Chỉ đảo animationCycle khi hoàn thành một lượt fetch (loading: true -> false)
 * và có dữ liệu, tránh đảo animation sớm giữa lúc tbody đang có opacity-60 gây nháy kép.
 */
const animationCycle = ref(0);
const rowAnimationClass = computed(() =>
  animationCycle.value % 2 === 0 ? 'pj-row-fade-a' : 'pj-row-fade-b',
);

watch(loading, (newLoading, oldLoading) => {
  if (oldLoading === true && newLoading === false && items.value.length > 0) {
    animationCycle.value++;
  }
});

/**
 * Số lượng hiển thị ổn định cho bộ đếm: chỉ cập nhật khi dữ liệu đã tải xong (!loading),
 * tránh aria-live thông báo lặp lại trong lúc đang tải.
 */
const displayedCount = ref({ count: items.value.length, total: total.value });
watch([items, total, loading], () => {
  if (!loading.value) {
    displayedCount.value = { count: items.value.length, total: total.value };
  }
}, { immediate: true });

/* ============================================================================
 * Scope Tabs (Của tôi / Của công ty)
 * ==========================================================================*/
type ScopeTab = 'mine' | 'company';
const activeTab = ref<ScopeTab>(
  route.query.tab === 'mine' ? 'mine' : 'company',
);

const switchTab = async (tab: ScopeTab): Promise<void> => {
  if (activeTab.value === tab && store.query.scope === (tab === 'mine' ? 'me' : 'company')) return;
  activeTab.value = tab;
  const scope = tab === 'mine' ? 'me' : 'company';
  void router.replace({
    query: {
      ...route.query,
      tab: tab === 'mine' ? 'mine' : undefined,
    },
  });
  await store.fetchList({ scope }, 1);
};

watch(
  () => route.query.tab,
  (newTab) => {
    const targetTab: ScopeTab = newTab === 'mine' ? 'mine' : 'company';
    if (activeTab.value !== targetTab) {
      activeTab.value = targetTab;
      const scope = targetTab === 'mine' ? 'me' : 'company';
      void store.fetchList({ scope }, 1);
    }
  },
);

/* ============================================================================
 * Search (debounced)
 * ==========================================================================*/
const searchInput = ref('');
const debouncedSearch = useDebounce(searchInput, 400);

/**
 * Cờ ngăn chặn watcher debouncedSearch phát sinh thêm request thừa
 * khi resetAllFilters đang gom việc làm mới bộ lọc thành 1 request duy nhất.
 */
const isResettingFilters = ref(false);
let resetFilterTimer: ReturnType<typeof setTimeout> | null = null;

watch(debouncedSearch, (q) => {
  if (isResettingFilters.value) return;
  void store.fetchList({ search: q.trim() || undefined }, 1);
});
const clearSearch = (): void => {
  searchInput.value = '';
};

/* ============================================================================
 * Filter dropdowns & Mobile Bottom Sheet
 * ==========================================================================*/
type DropdownKey = 'status' | 'location' | 'jobType' | 'jobLevel' | 'workType' | 'industry';
const openDropdown = ref<DropdownKey | null>(null);
const lastTriggerEl = ref<HTMLElement | null>(null);

const isMobileView = ref(false);
const updateMobileView = (): void => {
  if (typeof window !== 'undefined') {
    isMobileView.value = window.innerWidth < 640 || (window.innerHeight <= 500 && window.innerWidth <= 950);
  }
};

const filterScrollContainerRef = ref<HTMLElement | null>(null);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

const updateScrollIndicators = (): void => {
  const el = filterScrollContainerRef.value;
  if (!el) return;
  canScrollLeft.value = el.scrollLeft > 4;
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
};

const onFilterScroll = (): void => {
  updateScrollIndicators();
};

watch([openDropdown, isMobileView], async ([newDropdown, newIsMobile]) => {
  if (typeof document !== 'undefined') {
    if (newDropdown !== null && newIsMobile) {
      document.body.style.overflow = 'hidden';
      await nextTick();
      const sheet = document.querySelector('[data-filter-sheet]');
      const activeOption = sheet?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
        || sheet?.querySelector<HTMLElement>('[role="option"]');
      activeOption?.focus();
    } else {
      document.body.style.overflow = '';
    }
  }
});

const closeRowMenu = (): void => {
  if (activeRowMenuId.value !== null) {
    activeRowMenuId.value = null;
    lastTriggerEl.value?.focus();
    lastTriggerEl.value = null;
  }
};

const handleDocClick = (e: MouseEvent): void => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest('[data-filter-sheet]') || target.closest('[data-filter-backdrop]')) {
    return;
  }
  if (!target.closest('[data-dropdown]')) openDropdown.value = null;
  if (!target.closest('[data-row-menu]') && !target.closest('[data-teleported-menu]')) {
    closeRowMenu();
  }
};

const handleKeydown = (e: KeyboardEvent): void => {
  if (e.key !== 'Escape') return;
  // Khi một modal đang mở, Esc chỉ đóng modal, không đóng nhầm dropdown phía sau
  if (editModalOpen.value || createModalOpen.value || deleteConfirmId.value !== null) return;

  if (openDropdown.value !== null) {
    e.preventDefault();
    const trigger = lastTriggerEl.value;
    openDropdown.value = null;
    trigger?.focus();
    return;
  }
  if (activeRowMenuId.value !== null) {
    e.preventDefault();
    closeRowMenu();
  }
};

const handleSheetKeydown = (e: KeyboardEvent): void => {
  if (openDropdown.value === null || !isMobileView.value) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    const trigger = lastTriggerEl.value;
    openDropdown.value = null;
    trigger?.focus();
    return;
  }

  const sheet = document.querySelector('[data-filter-sheet]');
  if (!sheet) return;

  const focusable = Array.from(
    sheet.querySelectorAll<HTMLElement>('button, [role="option"], [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.hasAttribute('disabled') && window.getComputedStyle(el).display !== 'none');

  if (focusable.length === 0) return;

  const firstEl = focusable[0];
  const lastEl = focusable[focusable.length - 1];

  if (e.key === 'Tab') {
    if (e.shiftKey) {
      if (document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      }
    } else {
      if (document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    return;
  }

  // Di chuyển bằng phím mũi tên giữa các tuỳ chọn
  const options = Array.from(sheet.querySelectorAll<HTMLElement>('[role="option"]'));
  if (options.length === 0) return;

  const currentIndex = options.findIndex((opt) => opt === document.activeElement || opt.contains(document.activeElement));

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
    options[nextIndex]?.focus();
    options[nextIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
    options[prevIndex]?.focus();
    options[prevIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Home') {
    e.preventDefault();
    options[0]?.focus();
    options[0]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'End') {
    e.preventDefault();
    options[options.length - 1]?.focus();
    options[options.length - 1]?.scrollIntoView({ block: 'nearest' });
  }
};

const handleResize = (): void => {
  updateMobileView();
  updateScrollIndicators();
  closeRowMenu();
};

const handlePopState = (): void => {
  if (openDropdown.value !== null) {
    openDropdown.value = null;
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
  }
};

watch(() => route.fullPath, () => {
  if (openDropdown.value !== null) {
    openDropdown.value = null;
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
  }
});

onMounted(() => {
  updateMobileView();
  nextTick(() => updateScrollIndicators());
  document.addEventListener('click', handleDocClick);
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('scroll', closeRowMenu, { capture: true, passive: true });
  window.addEventListener('resize', handleResize, { passive: true });
  window.addEventListener('orientationchange', handleResize, { passive: true });
  window.addEventListener('popstate', handlePopState);
});
onUnmounted(() => {
  if (resetFilterTimer !== null) {
    clearTimeout(resetFilterTimer);
    resetFilterTimer = null;
  }
  document.removeEventListener('click', handleDocClick);
  document.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('scroll', closeRowMenu, { capture: true });
  window.removeEventListener('resize', handleResize);
  window.removeEventListener('orientationchange', handleResize);
  window.removeEventListener('popstate', handlePopState);
  if (typeof document !== 'undefined') {
    document.body.style.overflow = '';
  }
});

const toggleDropdown = (key: DropdownKey, e?: MouseEvent): void => {
  if (openDropdown.value === key) {
    openDropdown.value = null;
    lastTriggerEl.value = null;
  } else {
    openDropdown.value = key;
    activeRowMenuId.value = null;
    if (e?.currentTarget instanceof HTMLElement) {
      lastTriggerEl.value = e.currentTarget;
    }
  }
};

/* ============================================================================
 * Shared Status Labels & Options
 * ==========================================================================*/
const STATUS_LABELS = JOB_STATUS_LABELS;

/* Status */
const statusOptions: Array<{ value: JobStatus | null; label: string }> = [
  { value: null, label: 'Tất cả trạng thái' },
  { value: 'live', label: STATUS_LABELS.live },
  { value: 'pending', label: STATUS_LABELS.pending },
  { value: 'draft', label: STATUS_LABELS.draft },
  { value: 'ai_scanning', label: STATUS_LABELS.ai_scanning },
  { value: 'ai_flagged', label: STATUS_LABELS.ai_flagged },
  { value: 'expired', label: STATUS_LABELS.expired },
  { value: 'closed', label: STATUS_LABELS.closed },
];
const currentStatus = ref<JobStatus | null>(null);
const handleStatusSelect = (v: JobStatus | null): void => {
  currentStatus.value = v;
  openDropdown.value = null;
  void store.fetchList({ status: v ?? undefined }, 1);
};

/* Location */
const locations = useLocations();
const currentLocationCity = ref<string | null>(null);
const currentLocationDisplay = ref<string | null>(null);
const handleLocationSelect = (shortName: string | null, displayName?: string): void => {
  currentLocationCity.value = shortName;
  currentLocationDisplay.value = shortName ? (displayName ?? shortName) : null;
  openDropdown.value = null;
  void store.fetchList({ locationCity: shortName ?? undefined }, 1);
};

/* jobType */
const jobTypeOptions: Array<{ value: JobType | null; label: string }> = [
  { value: null, label: 'Tất cả loại hình' },
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'contract', label: 'Hợp đồng' },
  { value: 'internship', label: 'Thực tập' },
  { value: 'freelance', label: 'Freelance' },
];
const currentJobType = ref<JobType | null>(null);
const handleJobTypeSelect = (v: JobType | null): void => {
  currentJobType.value = v;
  openDropdown.value = null;
  void store.fetchList({ jobType: v ?? undefined }, 1);
};

/* jobLevel */
const jobLevelOptions: Array<{ value: JobLevel | null; label: string }> = [
  { value: null, label: 'Tất cả cấp bậc' },
  { value: 'intern', label: 'Intern' },
  { value: 'fresher', label: 'Fresher' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'manager', label: 'Manager' },
];
const currentJobLevel = ref<JobLevel | null>(null);
const handleJobLevelSelect = (v: JobLevel | null): void => {
  currentJobLevel.value = v;
  openDropdown.value = null;
  void store.fetchList({ jobLevel: v ?? undefined }, 1);
};

/* workType */
type WorkTypeValue = WorkType | null;
const workTypeOptions: Array<{ value: WorkTypeValue; label: string }> = [
  { value: null, label: 'Tất cả hình thức' },
  { value: 'onsite', label: 'Tại văn phòng' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Từ xa (Remote)' },
];
const currentWorkType = ref<WorkTypeValue>(null);
const handleWorkTypeSelect = (v: WorkTypeValue): void => {
  currentWorkType.value = v;
  openDropdown.value = null;
  void store.fetchList({ workType: v ?? undefined }, 1);
};

/* Industry */
const industries = ref<string[]>([]);
const industriesLoading = ref(false);
const industriesLoaded = ref(false);
const fetchIndustries = async (): Promise<void> => {
  if (industriesLoaded.value || industriesLoading.value) return;
  industriesLoading.value = true;
  try {
    const { data } = await jobApi.industries();
    industries.value = data.data ?? [];
    industriesLoaded.value = true;
  } catch {
    industries.value = [];
    industriesLoaded.value = true;
  } finally {
    industriesLoading.value = false;
  }
};
const currentIndustry = ref<string | null>(null);
const handleIndustrySelect = (v: string | null): void => {
  currentIndustry.value = v;
  openDropdown.value = null;
  void store.fetchList({ industry: v ?? undefined }, 1);
};

/* ============================================================================
 * Trigger Labels & Filter Display
 * ==========================================================================*/
const defaultLabels: Record<DropdownKey, string> = {
  status: 'Trạng thái',
  location: 'Địa điểm',
  jobType: 'Loại hình',
  jobLevel: 'Cấp bậc',
  workType: 'Hình thức',
  industry: 'Ngành nghề',
};

const currentMobileFilterTitle = computed(() => {
  if (!openDropdown.value) return '';
  return defaultLabels[openDropdown.value] || 'Bộ lọc';
});

interface FilterDisplay {
  hasValue: boolean;
  label: string;
  value?: string;
}

const currentTriggerLabel = (key: DropdownKey): string | null => {
  switch (key) {
    case 'status':
      if (currentStatus.value === null) return null;
      return statusOptions.find((o) => o.value === currentStatus.value)?.label ?? null;
    case 'location':
      return currentLocationDisplay.value;
    case 'jobType':
      if (currentJobType.value === null) return null;
      return jobTypeOptions.find((o) => o.value === currentJobType.value)?.label ?? null;
    case 'jobLevel':
      if (currentJobLevel.value === null) return null;
      return jobLevelOptions.find((o) => o.value === currentJobLevel.value)?.label ?? null;
    case 'workType':
      if (currentWorkType.value === null) return null;
      return workTypeOptions.find((o) => o.value === currentWorkType.value)?.label ?? null;
    case 'industry':
      return currentIndustry.value;
  }
};

const getFilterDisplay = (key: DropdownKey): FilterDisplay => {
  const current = currentTriggerLabel(key);
  if (!current) {
    return { hasValue: false, label: defaultLabels[key] };
  }
  return {
    hasValue: true,
    label: defaultLabels[key],
    value: current,
  };
};

const hasActiveFilter = computed(
  () =>
    searchInput.value.trim() !== '' ||
    currentStatus.value !== null ||
    currentLocationCity.value !== null ||
    currentJobType.value !== null ||
    currentJobLevel.value !== null ||
    currentWorkType.value !== null ||
    currentIndustry.value !== null,
);

const resetAllFilters = async (): Promise<void> => {
  if (isResettingFilters.value) return;
  isResettingFilters.value = true;
  if (resetFilterTimer !== null) {
    clearTimeout(resetFilterTimer);
    resetFilterTimer = null;
  }
  try {
    searchInput.value = '';
    currentStatus.value = null;
    currentLocationCity.value = null;
    currentLocationDisplay.value = null;
    currentJobType.value = null;
    currentJobLevel.value = null;
    currentWorkType.value = null;
    currentIndustry.value = null;
    store.resetFilters();
    const scope = activeTab.value === 'mine' ? 'me' : 'company';
    await store.fetchList(
      {
        scope,
        sortBy: sortColumn.value ?? undefined,
        sortOrder: sortColumn.value ? sortDirection.value : undefined,
      },
      1,
    );
  } finally {
    // Chặn request trùng lặp từ watcher debouncedSearch (400ms debounce)
    resetFilterTimer = setTimeout(() => {
      isResettingFilters.value = false;
      resetFilterTimer = null;
    }, 450);
  }
};

/* ============================================================================
 * Server-side Sorting
 * ==========================================================================*/
type SortColumn = CompanyJobSortBy;
const sortColumn = ref<SortColumn | null>(null);
const sortDirection = ref<'asc' | 'desc'>('desc');

const toggleSort = async (col: SortColumn): Promise<void> => {
  if (sortColumn.value === col) {
    if (sortDirection.value === 'desc') {
      sortDirection.value = 'asc';
    } else {
      // Đang asc -> về mặc định
      sortColumn.value = null;
      sortDirection.value = 'desc';
    }
  } else {
    sortColumn.value = col;
    sortDirection.value = 'desc';
  }

  await store.fetchList(
    {
      sortBy: sortColumn.value ?? undefined,
      sortOrder: sortColumn.value ? sortDirection.value : undefined,
    },
    1,
  );
};

/* ============================================================================
 * Row Item Helpers
 * ==========================================================================*/
interface StatusConfig {
  label: string;
  pillClass: string;
  dotClass: string;
}

const STATUS_CONFIG: Record<JobStatus, StatusConfig> = {
  live: { label: STATUS_LABELS.live, pillClass: 'bg-emerald-50 text-emerald-700', dotClass: 'bg-emerald-500' },
  pending: { label: STATUS_LABELS.pending, pillClass: 'bg-blue-50 text-blue-700', dotClass: 'bg-blue-500' },
  ai_scanning: { label: STATUS_LABELS.ai_scanning, pillClass: 'bg-violet-50 text-violet-700', dotClass: 'bg-violet-500' },
  ai_flagged: { label: STATUS_LABELS.ai_flagged, pillClass: 'bg-amber-50 text-amber-700', dotClass: 'bg-amber-500' },
  draft: { label: STATUS_LABELS.draft, pillClass: 'bg-gray-100 text-gray-600', dotClass: 'bg-gray-400' },
  expired: { label: STATUS_LABELS.expired, pillClass: 'bg-red-50 text-red-700', dotClass: 'bg-red-500' },
  closed: { label: STATUS_LABELS.closed, pillClass: 'bg-slate-100 text-slate-600', dotClass: 'bg-slate-400' },
};

const getStatusConfig = (status: JobStatus): StatusConfig =>
  STATUS_CONFIG[status] ?? STATUS_CONFIG.closed;

const getWorkTypeLabel = (job: JobListItem): string => {
  const m: Record<string, string> = {
    onsite: 'Tại văn phòng',
    hybrid: 'Hybrid',
    remote: 'Từ xa',
  };
  return job.workType ? m[job.workType] ?? job.workType : '';
};

const getLocationWorkTypeText = (job: JobListItem): string => {
  const city = job.location?.city ?? '';
  const wt = getWorkTypeLabel(job);
  if (city && wt) return `${city} · ${wt}`;
  return city || wt || 'Chưa cập nhật';
};

export interface SalaryDisplayInfo {
  label: string;
  isNegotiable: boolean;
  period: string;
}

const getPeriodLabel = (job: JobListItem): string => {
  const pc = ((job.paymentCycle || '') as string).toLowerCase().trim();
  switch (pc) {
    case 'hourly':
      return '/giờ';
    case 'daily':
      return '/ngày';
    case 'weekly':
      return '/tuần';
    case 'monthly':
      return '/tháng';
    case 'yearly':
      return '/năm';
    case 'contract':
      return '/dự án';
    default:
      return '';
  }
};

const parseSalaryVal = (s: unknown): number | null => {
  if (s === null || s === undefined) return null;
  if (typeof s === 'number') {
    return isNaN(s) || s < 0 ? null : s;
  }
  const str = String(s).trim();
  if (!str) return null;
  const num = Number(str.replace(/[^0-9.-]/g, ''));
  return isNaN(num) || num < 0 ? null : num;
};

const formatVNDSingle = (val: number): { text: string; isMillions: boolean } => {
  if (val >= 1_000_000) {
    const m = val / 1_000_000;
    const formatted = Number.isInteger(m)
      ? `${m}`
      : m.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
    return { text: formatted, isMillions: true };
  }
  return { text: `${val.toLocaleString('vi-VN')} đ`, isMillions: false };
};

const getSalaryText = (job: JobListItem): SalaryDisplayInfo => {
  if (!job.salaryVisible) {
    return { label: 'Thoả thuận', isNegotiable: true, period: '' };
  }

  let min = parseSalaryVal(job.salaryMin);
  let max = parseSalaryVal(job.salaryMax);

  if (min === null && max === null) {
    return { label: 'Thoả thuận', isNegotiable: true, period: '' };
  }

  // Dữ liệu lỗi: min > max -> hoán đổi
  if (min !== null && max !== null && min > max) {
    const tmp = min;
    min = max;
    max = tmp;
  }

  const currency = (job.salaryCurrency || 'VND').toUpperCase().trim();
  const period = getPeriodLabel(job);

  // Xử lý VND
  if (currency === 'VND' || !currency) {
    if (min !== null && max !== null) {
      if (min === max) {
        const single = formatVNDSingle(min);
        return {
          label: single.isMillions ? `${single.text} triệu` : single.text,
          isNegotiable: false,
          period,
        };
      }
      const minInfo = formatVNDSingle(min);
      const maxInfo = formatVNDSingle(max);
      if (minInfo.isMillions && maxInfo.isMillions) {
        return {
          label: `${minInfo.text} – ${maxInfo.text} triệu`,
          isNegotiable: false,
          period,
        };
      }
      return {
        label: `${min.toLocaleString('vi-VN')} – ${max.toLocaleString('vi-VN')} đ`,
        isNegotiable: false,
        period,
      };
    }
    if (min !== null) {
      const minInfo = formatVNDSingle(min);
      const minStr = minInfo.isMillions ? `${minInfo.text} triệu` : minInfo.text;
      return { label: `Từ ${minStr}`, isNegotiable: false, period };
    }
    const maxInfo = formatVNDSingle(max!);
    const maxStr = maxInfo.isMillions ? `${maxInfo.text} triệu` : maxInfo.text;
    return { label: `Đến ${maxStr}`, isNegotiable: false, period };
  }

  // Xử lý USD và các ngoại tệ khác
  const fmtCurr = (val: number): string => `${val.toLocaleString('vi-VN')} ${currency}`;
  if (min !== null && max !== null) {
    if (min === max) {
      return { label: fmtCurr(min), isNegotiable: false, period };
    }
    return {
      label: `${min.toLocaleString('vi-VN')} – ${max.toLocaleString('vi-VN')} ${currency}`,
      isNegotiable: false,
      period,
    };
  }
  if (min !== null) {
    return { label: `Từ ${fmtCurr(min)}`, isNegotiable: false, period };
  }
  return { label: `Đến ${fmtCurr(max!)}`, isNegotiable: false, period };
};

const getRemainingSubtext = (job: JobListItem): { text: string; class: string } | null => {
  // Chỉ trạng thái 'live' (Đang hiển thị) mới có dòng phụ hiển thị thời hạn còn lại
  if (job.status !== 'live') return null;

  const now = dayjs().startOf('day');
  if (job.deadline) {
    const deadlineDate = dayjs(job.deadline).startOf('day');
    const days = deadlineDate.diff(now, 'day');
    if (days < 0) return null; // Deadline đã qua: không hiển thị lặp "Đã hết hạn"
    if (days === 0) return { text: 'Hết hạn hôm nay', class: 'text-amber-600 font-medium' };
    if (days === 1) return { text: 'Còn 1 ngày', class: 'text-amber-600 font-medium' };
    return { text: `Còn ${days} ngày`, class: 'text-gray-500 font-normal' };
  }
  if (job.publishedAt) {
    const startDate = dayjs(job.publishedAt).startOf('day');
    const usedDays = now.diff(startDate, 'day');
    const remaining = Math.max(0, 30 - usedDays);
    if (remaining <= 0) return null;
    if (remaining === 1) return { text: 'Còn 1 ngày', class: 'text-amber-600 font-medium' };
    return { text: `Còn ${remaining} ngày`, class: 'text-gray-500 font-normal' };
  }
  return null;
};

const getPublishedTimeText = (job: JobListItem): string => {
  if (job.status === 'draft' || job.status === 'pending') return 'Chưa đăng';
  const time = job.publishedAt || job.createdAt;
  if (time) {
    return `Đăng ${dayjs(time).fromNow()}`;
  }
  return 'Chưa đăng';
};

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

const getVNDateParts = (d: Date | string | number): { year: number; month: number; day: number } | null => {
  const dateObj = typeof d === 'object' && d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.format(dateObj).split('-');
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),
    day: parseInt(parts[2], 10),
  };
};

const formatVNDate = (d: Date | string | number): string | null => {
  const parts = getVNDateParts(d);
  if (!parts) return null;
  const dd = String(parts.day).padStart(2, '0');
  const mm = String(parts.month).padStart(2, '0');
  return `${dd}/${mm}/${parts.year}`;
};

const diffDaysVN = (target: Date | string | number, now: Date = new Date()): number | null => {
  const targetParts = getVNDateParts(target);
  const nowParts = getVNDateParts(now);
  if (!targetParts || !nowParts) return null;

  const targetUtcDays = Math.floor(Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day) / 86400000);
  const nowUtcDays = Math.floor(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day) / 86400000);

  return targetUtcDays - nowUtcDays;
};

interface DeadlineInfo {
  formattedDate: string;
  dateClass: string;
  subtext: string | null;
  subtextClass: string;
  isExpired?: boolean;
}

const getDeadlineInfo = (deadline: Date | string | null | undefined): DeadlineInfo => {
  if (!deadline) {
    return {
      formattedDate: '—',
      dateClass: 'text-gray-500 font-normal',
      subtext: null,
      subtextClass: '',
      isExpired: false,
    };
  }
  const formattedDate = formatVNDate(deadline);
  if (!formattedDate) {
    return {
      formattedDate: '—',
      dateClass: 'text-gray-500 font-normal',
      subtext: null,
      subtextClass: '',
      isExpired: false,
    };
  }

  const diffDays = diffDaysVN(deadline);
  if (diffDays === null) {
    return {
      formattedDate: '—',
      dateClass: 'text-gray-500 font-normal',
      subtext: null,
      subtextClass: '',
      isExpired: false,
    };
  }

  // Đã hết hạn: chỉ ngày, màu đỏ. KHÔNG dòng "Đã hết hạn" (cột Trạng thái đã có chip).
  if (diffDays < 0) {
    return {
      formattedDate,
      dateClass: 'text-red-700 font-medium',
      subtext: null,
      subtextClass: '',
      isExpired: true,
    };
  }
  // Hôm nay: ngày + dòng phụ "Hết hạn hôm nay" màu cam.
  if (diffDays === 0) {
    return {
      formattedDate,
      dateClass: 'text-gray-800 font-medium',
      subtext: 'Hết hạn hôm nay',
      subtextClass: 'text-orange-700 font-medium',
      isExpired: false,
    };
  }
  // Còn 1–3 ngày: ngày + dòng phụ "Còn X ngày" màu cam.
  if (diffDays <= 3) {
    return {
      formattedDate,
      dateClass: 'text-gray-800 font-medium',
      subtext: diffDays === 1 ? 'Còn 1 ngày' : `Còn ${diffDays} ngày`,
      subtextClass: 'text-orange-700 font-medium',
      isExpired: false,
    };
  }
  // Còn ≥4 ngày: chỉ dòng ngày dd/MM/yyyy, màu chữ thường. KHÔNG có dòng "Còn X ngày".
  return {
    formattedDate,
    dateClass: 'text-gray-800 font-medium',
    subtext: null,
    subtextClass: '',
    isExpired: false,
  };
};

const getPublishedAtTitle = (publishedAt: Date | string | null | undefined): string | undefined => {
  if (!publishedAt) return undefined;
  const formatted = formatVNDate(publishedAt);
  if (!formatted) return undefined;
  return `Đăng ngày ${formatted}`;
};

const formatCount = (count: number | null | undefined): string => {
  if (count === null || count === undefined || typeof count !== 'number' || isNaN(count) || count < 0) {
    return '—';
  }
  return count.toLocaleString('vi-VN');
};

const formatViewsCount = formatCount;

const getNewAppliesCount = (job: JobListItem): number => {
  const item = job as unknown as Record<string, unknown>;
  const val = item.newAppliesCount ?? item.unreadAppliesCount ?? item.newApplies;
  return typeof val === 'number' ? val : 0;
};

/* ============================================================================
 * Action Buttons Config
 * ==========================================================================*/
interface ActionButtonConfig {
  label: string;
  classes: string;
  disabled?: boolean;
  badge?: number;
  badgeClass?: string;
  onClick: () => void;
}

const getActionButtonConfig = (job: JobListItem): ActionButtonConfig => {
  switch (job.status) {
    case 'expired':
      return {
        label: 'Gia hạn',
        classes: 'bg-primary-600 text-white hover:bg-primary-700',
        onClick: () => openEditModal(job.id),
      };
    case 'draft':
      return {
        label: 'Đăng tin',
        classes: 'bg-primary-600 text-white hover:bg-primary-700',
        onClick: () => openEditModal(job.id),
      };
    case 'closed':
      return {
        label: 'Mở lại',
        classes: 'border border-primary-600 text-primary-600 bg-white hover:bg-primary-50',
        onClick: () => openEditModal(job.id),
      };
    case 'ai_flagged':
      return {
        label: 'Xem lý do',
        classes: 'bg-amber-700 text-white hover:bg-amber-800',
        onClick: () => router.push(`/employer/jobs/${job.slug || job.id}`),
      };
    case 'ai_scanning':
      return {
        label: STATUS_LABELS.ai_scanning,
        classes: 'bg-violet-50 text-violet-600 border border-violet-200 cursor-not-allowed',
        disabled: true,
        onClick: () => {},
      };
    case 'pending':
      if (job.appliesCount === 0) {
        return {
          label: 'Xem ứng viên',
          classes: 'bg-gray-100 text-gray-400 cursor-not-allowed',
          disabled: true,
          badge: 0,
          badgeClass: 'bg-gray-200 text-gray-600',
          onClick: () => {},
        };
      }
      return {
        label: 'Xem ứng viên',
        classes: 'bg-primary-600 text-white hover:bg-primary-700',
        badge: job.appliesCount,
        badgeClass: 'bg-white/20 text-white',
        onClick: () => router.push({ path: '/employer/applications', query: { jobId: job.id } }),
      };
    case 'live':
    default:
      if (job.appliesCount === 0) {
        return {
          label: 'Xem ứng viên',
          classes: 'bg-gray-100 text-gray-400 cursor-not-allowed',
          disabled: true,
          badge: 0,
          badgeClass: 'bg-gray-200 text-gray-600',
          onClick: () => {},
        };
      }
      return {
        label: 'Xem ứng viên',
        classes: 'bg-primary-600 text-white hover:bg-primary-700',
        badge: job.appliesCount,
        badgeClass: 'bg-white/20 text-white',
        onClick: () => router.push({ path: '/employer/applications', query: { jobId: job.id } }),
      };
  }
};

/* ============================================================================
 * Row Menu Thao tác (...)
 * ==========================================================================*/
const activeRowMenuId = ref<string | null>(null);
const activeMenuJob = computed(() =>
  items.value.find((j) => j.id === activeRowMenuId.value) || null,
);
const rowMenuStyles = ref<Record<string, string>>({});
const rowMenuPlacement = ref<'top' | 'bottom'>('bottom');

const toggleRowMenu = async (jobId: string, e?: MouseEvent | KeyboardEvent): Promise<void> => {
  if (activeRowMenuId.value === jobId) {
    closeRowMenu();
  } else {
    activeRowMenuId.value = jobId;
    openDropdown.value = null;
    if (e?.currentTarget instanceof HTMLElement) {
      lastTriggerEl.value = e.currentTarget;
      const rect = e.currentTarget.getBoundingClientRect();
      const menuHeight = 220; // Chiều cao tối đa khi mở menu
      const spaceBelow = window.innerHeight - rect.bottom;
      const flipUp = spaceBelow < menuHeight && rect.top > menuHeight;
      rowMenuPlacement.value = flipUp ? 'top' : 'bottom';

      const styles: Record<string, string> = {
        position: 'fixed',
        zIndex: '60',
        right: `${Math.max(8, window.innerWidth - rect.right)}px`,
      };

      if (flipUp) {
        styles.bottom = `${Math.max(8, window.innerHeight - rect.top + 6)}px`;
        styles.top = 'auto';
      } else {
        styles.top = `${rect.bottom + 6}px`;
        styles.bottom = 'auto';
      }

      rowMenuStyles.value = styles;
    }

    await nextTick();
    const menuEl = document.querySelector('[data-teleported-menu]');
    const firstItem = menuEl?.querySelector('button:not(:disabled)') as HTMLButtonElement | null;
    firstItem?.focus();
  }
};

const handleMenuKeydown = (e: KeyboardEvent): void => {
  const menuEl = document.querySelector('[data-teleported-menu]');
  if (!menuEl) return;
  const items = Array.from(menuEl.querySelectorAll('button:not(:disabled)')) as HTMLButtonElement[];
  if (items.length === 0) return;

  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const nextIdx = (currentIndex + 1) % items.length;
    items[nextIdx]?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prevIdx = (currentIndex - 1 + items.length) % items.length;
    items[prevIdx]?.focus();
  } else if (e.key === 'Home') {
    e.preventDefault();
    items[0]?.focus();
  } else if (e.key === 'End') {
    e.preventDefault();
    items[items.length - 1]?.focus();
  } else if (e.key === 'Tab') {
    closeRowMenu();
    return;
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeRowMenu();
  }
};

const handleMenuAction = (action: 'view-applies' | 'publish' | 'reopen' | 'flagged-reason' | 'view-detail' | 'edit' | 'delete'): void => {
  if (!activeMenuJob.value) return;
  const job = activeMenuJob.value;
  const jobId = job.id;
  const slugOrId = job.slug || job.id;
  closeRowMenu();

  switch (action) {
    case 'view-applies':
      if (job.appliesCount > 0) {
        void router.push({ path: '/employer/applications', query: { jobId } });
      }
      break;
    case 'publish':
    case 'reopen':
    case 'edit':
      openEditModal(jobId);
      break;
    case 'flagged-reason':
    case 'view-detail':
      if (job) {
        navigateToDetail(job);
      } else {
        void router.push(`/employer/jobs/${slugOrId}`);
      }
      break;
    case 'delete':
      askDelete(jobId);
      break;
  }
};

/* ============================================================================
 * Modals & Actions
 * ==========================================================================*/
const deleteConfirmId = ref<string | null>(null);
const deleteConfirmTitle = ref<string>('');
const askDelete = (jobId: string): void => {
  activeRowMenuId.value = null;
  deleteConfirmId.value = jobId;
  deleteConfirmTitle.value = items.value.find((j) => j.id === jobId)?.title ?? '';
};
const cancelDelete = (): void => {
  deleteConfirmId.value = null;
};
const confirmDeleteAction = async (): Promise<void> => {
  const id = deleteConfirmId.value;
  if (!id) return;
  deleteConfirmId.value = null;
  try {
    await jobApi.delete(id);
    toast.push({ variant: 'success', title: 'Đã xoá job', body: deleteConfirmTitle.value });
    await store.fetchList(undefined, page.value);
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Xoá thất bại',
      body: e instanceof Error ? e.message : 'Vui lòng thử lại',
    });
  }
};

const editModalJobId = ref<string | null>(null);
const editModalOpen = ref(false);
const openEditModal = (jobId: string): void => {
  activeRowMenuId.value = null;
  editModalJobId.value = jobId;
  editModalOpen.value = true;
};
const onEditSaved = async (): Promise<void> => {
  await store.fetchList(undefined, page.value);
};

const createModalOpen = ref(false);
const openCreateModal = (): void => {
  createModalOpen.value = true;
};
const onJobCreated = async (_newJobId: string): Promise<void> => {
  await store.fetchList();
};

interface PaginationItem {
  type: 'page' | 'ellipsis';
  value: number | string;
  key: string;
}

const paginationItems = computed<PaginationItem[]>(() => {
  const tp = totalPages.value;
  const cp = page.value;
  if (tp <= 7) {
    return Array.from({ length: tp }, (_, i) => ({
      type: 'page' as const,
      value: i + 1,
      key: `page-${i + 1}`,
    }));
  }

  const result: PaginationItem[] = [];
  result.push({ type: 'page', value: 1, key: 'page-1' });

  const left = Math.max(2, cp - 1);
  const right = Math.min(tp - 1, cp + 1);

  if (left > 2) {
    result.push({ type: 'ellipsis', value: '...', key: 'ellipsis-left' });
  }

  for (let p = left; p <= right; p++) {
    result.push({ type: 'page', value: p, key: `page-${p}` });
  }

  if (right < tp - 1) {
    result.push({ type: 'ellipsis', value: '...', key: 'ellipsis-right' });
  }

  result.push({ type: 'page', value: tp, key: `page-${tp}` });
  return result;
});

const goToPage = async (p: number): Promise<void> => {
  const target = Math.min(Math.max(1, p), totalPages.value);
  if (target === page.value) return;
  await store.fetchList(undefined, target);
};

const retryFetch = async (): Promise<void> => {
  try {
    await store.fetchList(undefined, page.value);
  } finally {
    initialLoaded.value = true;
  }
};

const isDesktopView = ref(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
const updateScreenSize = (): void => {
  if (typeof window !== 'undefined') {
    isDesktopView.value = window.innerWidth >= 768;
  }
};

const navigateToDetail = (job: JobListItem): void => {
  const targetId = job.slug || job.id;
  void router.push({
    name: 'employer-job-detail',
    params: { id: targetId },
  });
};

/* ============================================================================
 * Lifecycle
 * ==========================================================================*/
onMounted(async () => {
  const initialScope = activeTab.value === 'mine' ? 'me' : 'company';
  if (items.value.length === 0) {
    try {
      await store.fetchList({ scope: initialScope }, 1);
    } finally {
      initialLoaded.value = true;
    }
  } else {
    initialLoaded.value = true;
  }
  void fetchIndustries();
  void locations.fetch();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateScreenSize);
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateScreenSize);
  }
});
</script>

<template>
  <div class="w-full min-h-full flex-1 bg-white p-4 sm:p-6 lg:p-8 font-poppins">
    <div class="w-full max-w-7xl mx-auto">
      <!-- ============ Header Trang + 2 Tab Phân loại ============ -->
      <header class="mb-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 class="text-[22px] font-semibold text-gray-900 tracking-tight leading-tight">
              Việc làm đã đăng
            </h1>
            <p class="text-sm text-gray-500 mt-1">
              Quản lý các tin tuyển dụng của bạn và công ty
            </p>
          </div>
          <button
            type="button"
            class="h-10 px-4 rounded-lg bg-[#5b4eea] text-white hover:bg-primary-700 transition inline-flex items-center justify-center gap-2 text-sm font-semibold w-full sm:w-auto shrink-0 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            @click="openCreateModal"
          >
            <Plus class="w-4 h-4" />
            <span>Đăng tin mới</span>
          </button>
        </div>

        <!-- Khu vực 2 Tab: Của công ty / Của tôi (Đồng bộ phong cách ApplicationsView) -->
        <div class="mt-4 flex items-center" role="tablist" aria-label="Phạm vi tin tuyển dụng">
          <div class="inline-flex h-8 overflow-hidden rounded-md border border-[#e3e8ef] bg-white">
            <!-- Tab Của công ty (Bên trái) -->
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'company'"
              class="flex h-full items-center px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              :class="activeTab === 'company'
                ? 'bg-[#1769e8] text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'"
              @click="switchTab('company')"
            >
              <span>Của công ty</span>
              <span
                class="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] transition-colors leading-none"
                :class="activeTab === 'company'
                  ? 'bg-white/20 text-white font-semibold'
                  : 'bg-slate-100 text-slate-500 font-medium'"
              >
                {{ counts.company }}
              </span>
            </button>

            <!-- Tab Của tôi (Bên phải) -->
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'mine'"
              class="flex h-full items-center px-3 text-[12px] font-medium transition-colors border-l border-[#e3e8ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              :class="activeTab === 'mine'
                ? 'bg-[#1769e8] text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'"
              @click="switchTab('mine')"
            >
              <span>Của tôi</span>
              <span
                class="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] transition-colors leading-none"
                :class="activeTab === 'mine'
                  ? 'bg-white/20 text-white font-semibold'
                  : 'bg-slate-100 text-slate-500 font-medium'"
              >
                {{ counts.mine }}
              </span>
            </button>
          </div>
        </div>
      </header>

      <!-- ============ Thanh công cụ (Toolbar đồng bộ) ============ -->
      <div class="flex flex-col xl:flex-row xl:items-start gap-3">
        <!-- Ô tìm kiếm (thu gọn w-64 ở xl để nhường không gian cho 6 bộ lọc) -->
        <div class="relative w-full sm:w-80 xl:w-64 shrink-0">
          <Search
            class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            aria-hidden="true"
          />
          <input
            v-model="searchInput"
            type="text"
            placeholder="Tìm theo tiêu đề tin..."
            aria-label="Tìm theo tiêu đề tin tuyển dụng"
            class="w-full h-10 pl-10 pr-10 text-sm rounded-lg border border-gray-200 bg-white placeholder:text-sm placeholder:text-gray-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition"
          />
          <button
            v-if="searchInput"
            type="button"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-label="Xoá từ khoá tìm kiếm"
            @click="clearSearch"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Nhóm bộ lọc (Dropdowns) -->
        <div class="relative flex-1 min-w-0">
          <!-- Fade indicator bên trái khi đã cuộn sang phải -->
          <div
            v-show="canScrollLeft"
            class="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white to-transparent z-10 sm:hidden transition-opacity"
            aria-hidden="true"
          />

          <!-- Khung cuộn ngang -->
          <div
            ref="filterScrollContainerRef"
            data-dropdown
            class="flex items-center gap-2 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0 flex-nowrap sm:flex-wrap flex-1 scroll-smooth [-webkit-overflow-scrolling:touch]"
            @scroll.passive="onFilterScroll"
          >
            <!-- 1. Trạng thái -->
            <div data-dropdown class="relative shrink-0">
              <button
                type="button"
                class="h-10 px-3 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 shrink-0"
                :class="getFilterDisplay('status').hasValue
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
                :aria-expanded="openDropdown === 'status'"
                :aria-haspopup="isMobileView ? 'dialog' : 'listbox'"
                :aria-controls="isMobileView ? 'mobile-filter-sheet' : 'dropdown-status'"
                aria-label="Lọc theo trạng thái"
                @click="toggleDropdown('status', $event)"
              >
                <span>{{ getFilterDisplay('status').label }}</span>
                <template v-if="getFilterDisplay('status').hasValue">
                  <span class="text-primary-300">·</span>
                  <span class="max-w-[110px] truncate">{{ getFilterDisplay('status').value }}</span>
                  <span
                    role="button"
                    tabindex="0"
                    class="p-0.5 -mr-1 rounded hover:bg-primary-100 text-primary-500 hover:text-primary-700 focus:outline-none focus:ring-1 focus:ring-primary-400 transition inline-flex items-center"
                    aria-label="Bỏ lọc theo trạng thái"
                    @click.stop="handleStatusSelect(null)"
                    @keydown.enter.stop.prevent="handleStatusSelect(null)"
                    @keydown.space.stop.prevent="handleStatusSelect(null)"
                  >
                    <X class="w-3.5 h-3.5" />
                  </span>
                </template>
                <ChevronDown
                  class="w-4 h-4 shrink-0 transition"
                  :class="getFilterDisplay('status').hasValue ? 'text-primary-500' : 'text-gray-400'"
                />
              </button>
              <div
                v-if="openDropdown === 'status' && !isMobileView"
                id="dropdown-status"
                role="listbox"
                aria-label="Danh sách trạng thái"
                class="absolute left-0 top-full mt-1.5 z-30 w-48 rounded-lg border border-gray-200 bg-white shadow-md py-1"
                @click.stop
              >
                <template v-for="(opt, idx) in statusOptions" :key="opt.label">
                  <button
                    type="button"
                    role="option"
                    :aria-selected="currentStatus === opt.value"
                    class="w-full h-9 px-3 text-sm text-left hover:bg-gray-50 flex items-center justify-between transition focus-visible:outline-none focus-visible:bg-gray-50"
                    :class="currentStatus === opt.value ? 'text-primary-700 font-medium bg-primary-50/50' : 'text-gray-700'"
                    @click="handleStatusSelect(opt.value)"
                  >
                    <span>{{ opt.label }}</span>
                    <Check v-if="currentStatus === opt.value" class="w-4 h-4 text-primary-600 shrink-0" />
                  </button>
                  <div v-if="idx === 0 && statusOptions.length > 1" class="h-px bg-gray-100 my-1" />
                </template>
              </div>
            </div>

            <!-- 2. Địa điểm -->
            <div data-dropdown class="relative shrink-0">
              <button
                type="button"
                class="h-10 px-3 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 shrink-0"
                :class="getFilterDisplay('location').hasValue
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
                :aria-expanded="openDropdown === 'location'"
                :aria-haspopup="isMobileView ? 'dialog' : 'listbox'"
                :aria-controls="isMobileView ? 'mobile-filter-sheet' : 'dropdown-location'"
                aria-label="Lọc theo địa điểm"
                @click="toggleDropdown('location', $event)"
              >
                <span>{{ getFilterDisplay('location').label }}</span>
                <template v-if="getFilterDisplay('location').hasValue">
                  <span class="text-primary-300">·</span>
                  <span class="max-w-[110px] truncate">{{ getFilterDisplay('location').value }}</span>
                  <span
                    role="button"
                    tabindex="0"
                    class="p-0.5 -mr-1 rounded hover:bg-primary-100 text-primary-500 hover:text-primary-700 focus:outline-none focus:ring-1 focus:ring-primary-400 transition inline-flex items-center"
                    aria-label="Bỏ lọc theo địa điểm"
                    @click.stop="handleLocationSelect(null, undefined)"
                    @keydown.enter.stop.prevent="handleLocationSelect(null, undefined)"
                    @keydown.space.stop.prevent="handleLocationSelect(null, undefined)"
                  >
                    <X class="w-3.5 h-3.5" />
                  </span>
                </template>
                <ChevronDown
                  class="w-4 h-4 shrink-0 transition"
                  :class="getFilterDisplay('location').hasValue ? 'text-primary-500' : 'text-gray-400'"
                />
              </button>
              <div
                v-if="openDropdown === 'location' && !isMobileView"
                id="dropdown-location"
                role="listbox"
                aria-label="Danh sách địa điểm"
                class="absolute left-0 top-full mt-1.5 z-30 w-64 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-md py-1"
                @click.stop
              >
                <button
                  type="button"
                  role="option"
                  :aria-selected="currentLocationCity === null"
                  class="w-full h-9 px-3 text-sm text-left hover:bg-gray-50 flex items-center justify-between transition focus-visible:outline-none focus-visible:bg-gray-50"
                  :class="currentLocationCity === null ? 'text-primary-700 font-medium bg-primary-50/50' : 'text-gray-700'"
                  @click="handleLocationSelect(null, undefined)"
                >
                  <span>Tất cả địa điểm</span>
                  <Check v-if="currentLocationCity === null" class="w-4 h-4 text-primary-600 shrink-0" />
                </button>
                <div class="h-px bg-gray-100 my-1" />
                <div
                  v-if="locations.loading.value && locations.items.value.length === 0"
                  class="px-3 py-2 text-xs text-gray-500 inline-flex items-center gap-1.5"
                >
                  <Loader2 class="w-3.5 h-3.5 animate-spin" /> Đang tải...
                </div>
                <button
                  v-for="loc in locations.items.value"
                  :key="loc.code"
                  type="button"
                  role="option"
                  :aria-selected="currentLocationCity === loc.shortName"
                  class="w-full h-9 px-3 text-sm text-left hover:bg-gray-50 flex items-center justify-between transition focus-visible:outline-none focus-visible:bg-gray-50"
                  :class="currentLocationCity === loc.shortName ? 'text-primary-700 font-medium bg-primary-50/50' : 'text-gray-700'"
                  @click="handleLocationSelect(loc.shortName, loc.name)"
                >
                  <span class="truncate">{{ loc.name }}</span>
                  <Check v-if="currentLocationCity === loc.shortName" class="w-4 h-4 text-primary-600 shrink-0" />
                </button>
              </div>
            </div>

            <!-- 3. Ngành nghề -->
            <div data-dropdown class="relative shrink-0">
              <button
                type="button"
                class="h-10 px-3 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 shrink-0"
                :class="getFilterDisplay('industry').hasValue
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
                :aria-expanded="openDropdown === 'industry'"
                :aria-haspopup="isMobileView ? 'dialog' : 'listbox'"
                :aria-controls="isMobileView ? 'mobile-filter-sheet' : 'dropdown-industry'"
                aria-label="Lọc theo ngành nghề"
                @click="toggleDropdown('industry', $event)"
              >
                <span>{{ getFilterDisplay('industry').label }}</span>
                <template v-if="getFilterDisplay('industry').hasValue">
                  <span class="text-primary-300">·</span>
                  <span class="max-w-[110px] truncate">{{ getFilterDisplay('industry').value }}</span>
                  <span
                    role="button"
                    tabindex="0"
                    class="p-0.5 -mr-1 rounded hover:bg-primary-100 text-primary-500 hover:text-primary-700 focus:outline-none focus:ring-1 focus:ring-primary-400 transition inline-flex items-center"
                    aria-label="Bỏ lọc theo ngành nghề"
                    @click.stop="handleIndustrySelect(null)"
                    @keydown.enter.stop.prevent="handleIndustrySelect(null)"
                    @keydown.space.stop.prevent="handleIndustrySelect(null)"
                  >
                    <X class="w-3.5 h-3.5" />
                  </span>
                </template>
                <ChevronDown
                  class="w-4 h-4 shrink-0 transition"
                  :class="getFilterDisplay('industry').hasValue ? 'text-primary-500' : 'text-gray-400'"
                />
              </button>
              <div
                v-if="openDropdown === 'industry' && !isMobileView"
                id="dropdown-industry"
                role="listbox"
                aria-label="Danh sách ngành nghề"
                class="absolute left-0 top-full mt-1.5 z-30 w-64 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-md py-1"
                @click.stop
              >
                <button
                  type="button"
                  role="option"
                  :aria-selected="currentIndustry === null"
                  class="w-full h-9 px-3 text-sm text-left hover:bg-gray-50 flex items-center justify-between transition focus-visible:outline-none focus-visible:bg-gray-50"
                  :class="currentIndustry === null ? 'text-primary-700 font-medium bg-primary-50/50' : 'text-gray-700'"
                  @click="handleIndustrySelect(null)"
                >
                  <span>Tất cả ngành nghề</span>
                  <Check v-if="currentIndustry === null" class="w-4 h-4 text-primary-600 shrink-0" />
                </button>
                <div class="h-px bg-gray-100 my-1" />
                <div
                  v-if="industriesLoading && industries.length === 0"
                  class="px-3 py-2 text-xs text-gray-500 inline-flex items-center gap-1.5"
                >
                  <Loader2 class="w-3.5 h-3.5 animate-spin" /> Đang tải...
                </div>
                <button
                  v-for="ind in industries"
                  :key="ind"
                  type="button"
                  role="option"
                  :aria-selected="currentIndustry === ind"
                  class="w-full h-9 px-3 text-sm text-left hover:bg-gray-50 flex items-center justify-between transition focus-visible:outline-none focus-visible:bg-gray-50"
                  :class="currentIndustry === ind ? 'text-primary-700 font-medium bg-primary-50/50' : 'text-gray-700'"
                  @click="handleIndustrySelect(ind)"
                >
                  <span class="truncate">{{ ind }}</span>
                  <Check v-if="currentIndustry === ind" class="w-4 h-4 text-primary-600 shrink-0" />
                </button>
              </div>
            </div>

            <!-- 4. Loại hình -->
            <div data-dropdown class="relative shrink-0">
              <button
                type="button"
                class="h-10 px-3 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 shrink-0"
                :class="getFilterDisplay('jobType').hasValue
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
                :aria-expanded="openDropdown === 'jobType'"
                :aria-haspopup="isMobileView ? 'dialog' : 'listbox'"
                :aria-controls="isMobileView ? 'mobile-filter-sheet' : 'dropdown-jobType'"
                aria-label="Lọc theo loại hình làm việc"
                @click="toggleDropdown('jobType', $event)"
              >
                <span>{{ getFilterDisplay('jobType').label }}</span>
                <template v-if="getFilterDisplay('jobType').hasValue">
                  <span class="text-primary-300">·</span>
                  <span class="max-w-[110px] truncate">{{ getFilterDisplay('jobType').value }}</span>
                  <span
                    role="button"
                    tabindex="0"
                    class="p-0.5 -mr-1 rounded hover:bg-primary-100 text-primary-500 hover:text-primary-700 focus:outline-none focus:ring-1 focus:ring-primary-400 transition inline-flex items-center"
                    aria-label="Bỏ lọc theo loại hình làm việc"
                    @click.stop="handleJobTypeSelect(null)"
                    @keydown.enter.stop.prevent="handleJobTypeSelect(null)"
                    @keydown.space.stop.prevent="handleJobTypeSelect(null)"
                  >
                    <X class="w-3.5 h-3.5" />
                  </span>
                </template>
                <ChevronDown
                  class="w-4 h-4 shrink-0 transition"
                  :class="getFilterDisplay('jobType').hasValue ? 'text-primary-500' : 'text-gray-400'"
                />
              </button>
              <div
                v-if="openDropdown === 'jobType' && !isMobileView"
                id="dropdown-jobType"
                role="listbox"
                aria-label="Danh sách loại hình làm việc"
                class="absolute left-0 top-full mt-1.5 z-30 w-48 rounded-lg border border-gray-200 bg-white shadow-md py-1"
                @click.stop
              >
                <template v-for="(opt, idx) in jobTypeOptions" :key="opt.label">
                  <button
                    type="button"
                    role="option"
                    :aria-selected="currentJobType === opt.value"
                    class="w-full h-9 px-3 text-sm text-left hover:bg-gray-50 flex items-center justify-between transition focus-visible:outline-none focus-visible:bg-gray-50"
                    :class="currentJobType === opt.value ? 'text-primary-700 font-medium bg-primary-50/50' : 'text-gray-700'"
                    @click="handleJobTypeSelect(opt.value)"
                  >
                    <span>{{ opt.label }}</span>
                    <Check v-if="currentJobType === opt.value" class="w-4 h-4 text-primary-600 shrink-0" />
                  </button>
                  <div v-if="idx === 0 && jobTypeOptions.length > 1" class="h-px bg-gray-100 my-1" />
                </template>
              </div>
            </div>

            <!-- 5. Cấp bậc -->
            <div data-dropdown class="relative shrink-0">
              <button
                type="button"
                class="h-10 px-3 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 shrink-0"
                :class="getFilterDisplay('jobLevel').hasValue
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
                :aria-expanded="openDropdown === 'jobLevel'"
                :aria-haspopup="isMobileView ? 'dialog' : 'listbox'"
                :aria-controls="isMobileView ? 'mobile-filter-sheet' : 'dropdown-jobLevel'"
                aria-label="Lọc theo cấp bậc"
                @click="toggleDropdown('jobLevel', $event)"
              >
                <span>{{ getFilterDisplay('jobLevel').label }}</span>
                <template v-if="getFilterDisplay('jobLevel').hasValue">
                  <span class="text-primary-300">·</span>
                  <span class="max-w-[110px] truncate">{{ getFilterDisplay('jobLevel').value }}</span>
                  <span
                    role="button"
                    tabindex="0"
                    class="p-0.5 -mr-1 rounded hover:bg-primary-100 text-primary-500 hover:text-primary-700 focus:outline-none focus:ring-1 focus:ring-primary-400 transition inline-flex items-center"
                    aria-label="Bỏ lọc theo cấp bậc"
                    @click.stop="handleJobLevelSelect(null)"
                    @keydown.enter.stop.prevent="handleJobLevelSelect(null)"
                    @keydown.space.stop.prevent="handleJobLevelSelect(null)"
                  >
                    <X class="w-3.5 h-3.5" />
                  </span>
                </template>
                <ChevronDown
                  class="w-4 h-4 shrink-0 transition"
                  :class="getFilterDisplay('jobLevel').hasValue ? 'text-primary-500' : 'text-gray-400'"
                />
              </button>
              <div
                v-if="openDropdown === 'jobLevel' && !isMobileView"
                id="dropdown-jobLevel"
                role="listbox"
                aria-label="Danh sách cấp bậc"
                class="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 z-30 w-48 rounded-lg border border-gray-200 bg-white shadow-md py-1"
                @click.stop
              >
                <template v-for="(opt, idx) in jobLevelOptions" :key="opt.label">
                  <button
                    type="button"
                    role="option"
                    :aria-selected="currentJobLevel === opt.value"
                    class="w-full h-9 px-3 text-sm text-left hover:bg-gray-50 flex items-center justify-between transition focus-visible:outline-none focus-visible:bg-gray-50"
                    :class="currentJobLevel === opt.value ? 'text-primary-700 font-medium bg-primary-50/50' : 'text-gray-700'"
                    @click="handleJobLevelSelect(opt.value)"
                  >
                    <span>{{ opt.label }}</span>
                    <Check v-if="currentJobLevel === opt.value" class="w-4 h-4 text-primary-600 shrink-0" />
                  </button>
                  <div v-if="idx === 0 && jobLevelOptions.length > 1" class="h-px bg-gray-100 my-1" />
                </template>
              </div>
            </div>

            <!-- 6. Hình thức -->
            <div data-dropdown class="relative shrink-0">
              <button
                type="button"
                class="h-10 px-3 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 shrink-0"
                :class="getFilterDisplay('workType').hasValue
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
                :aria-expanded="openDropdown === 'workType'"
                :aria-haspopup="isMobileView ? 'dialog' : 'listbox'"
                :aria-controls="isMobileView ? 'mobile-filter-sheet' : 'dropdown-workType'"
                aria-label="Lọc theo hình thức làm việc"
                @click="toggleDropdown('workType', $event)"
              >
                <span>{{ getFilterDisplay('workType').label }}</span>
                <template v-if="getFilterDisplay('workType').hasValue">
                  <span class="text-primary-300">·</span>
                  <span class="max-w-[110px] truncate">{{ getFilterDisplay('workType').value }}</span>
                  <span
                    role="button"
                    tabindex="0"
                    class="p-0.5 -mr-1 rounded hover:bg-primary-100 text-primary-500 hover:text-primary-700 focus:outline-none focus:ring-1 focus:ring-primary-400 transition inline-flex items-center"
                    aria-label="Bỏ lọc theo hình thức làm việc"
                    @click.stop="handleWorkTypeSelect(null)"
                    @keydown.enter.stop.prevent="handleWorkTypeSelect(null)"
                    @keydown.space.stop.prevent="handleWorkTypeSelect(null)"
                  >
                    <X class="w-3.5 h-3.5" />
                  </span>
                </template>
                <ChevronDown
                  class="w-4 h-4 shrink-0 transition"
                  :class="getFilterDisplay('workType').hasValue ? 'text-primary-500' : 'text-gray-400'"
                />
              </button>
              <div
                v-if="openDropdown === 'workType' && !isMobileView"
                id="dropdown-workType"
                role="listbox"
                aria-label="Danh sách hình thức làm việc"
                class="absolute right-0 top-full mt-1.5 z-30 w-48 rounded-lg border border-gray-200 bg-white shadow-md py-1"
                @click.stop
              >
                <template v-for="(opt, idx) in workTypeOptions" :key="opt.label">
                  <button
                    type="button"
                    role="option"
                    :aria-selected="currentWorkType === opt.value"
                    class="w-full h-9 px-3 text-sm text-left hover:bg-gray-50 flex items-center justify-between transition focus-visible:outline-none focus-visible:bg-gray-50"
                    :class="currentWorkType === opt.value ? 'text-primary-700 font-medium bg-primary-50/50' : 'text-gray-700'"
                    @click="handleWorkTypeSelect(opt.value)"
                  >
                    <span>{{ opt.label }}</span>
                    <Check v-if="currentWorkType === opt.value" class="w-4 h-4 text-primary-600 shrink-0" />
                  </button>
                  <div v-if="idx === 0 && workTypeOptions.length > 1" class="h-px bg-gray-100 my-1" />
                </template>
              </div>
            </div>
          </div>

          <!-- Fade indicator bên phải khi còn nội dung để cuộn -->
          <div
            v-show="canScrollRight"
            class="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent z-10 sm:hidden transition-opacity"
            aria-hidden="true"
          />
        </div>
      </div>

      <!-- ============ Bộ đếm kết quả + Nút Xoá lọc ============ -->
      <div
        class="my-3 min-h-[24px] flex items-center gap-3 text-[13px] text-gray-500"
      >
        <div
          v-if="!initialLoaded"
          class="h-4 w-36 bg-gray-100 rounded animate-pulse motion-reduce:animate-none"
        />
        <span
          v-else
          role="status"
          aria-live="polite"
          aria-atomic="true"
          :class="{ 'sr-only': items.length === 0 || error }"
        >
          <template v-if="error">
            {{ error }}
          </template>
          <template v-else-if="items.length === 0">
            {{ hasActiveFilter ? 'Không có tin phù hợp' : 'Chưa có tin tuyển dụng nào' }}
          </template>
          <template v-else>
            Hiển thị <strong class="font-semibold text-gray-900">{{ displayedCount.count }}</strong> / {{ displayedCount.total }} tin
          </template>
        </span>
        <button
          v-if="initialLoaded && !error && hasActiveFilter"
          type="button"
          class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded px-1 -ml-1"
          aria-label="Xoá tất cả bộ lọc"
          @click="resetAllFilters"
        >
          <X class="w-3.5 h-3.5" />
          <span>Xoá bộ lọc</span>
        </button>
      </div>

      <!-- ============ Loading State (Skeleton >=768px bảng 7/5 cột, <768px card) ============ -->
      <div v-if="!initialLoaded" class="space-y-4">
        <!-- BẢNG SKELETON (>=768px: Khớp 100% tỷ lệ cột của bảng thật) -->
        <div class="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full table-fixed text-left border-collapse min-w-[570px] xl:min-w-[850px]">
              <thead class="bg-gray-50/90 border-b border-gray-200">
                <tr class="h-11 text-xs font-medium text-gray-600 select-none">
                  <!-- Cột 1: Tin tuyển dụng (~43% md/lg, ~32% xl) -->
                  <th scope="col" class="px-4 py-2 font-medium w-[43%] xl:w-[32%] min-w-[210px] xl:min-w-[220px]">
                    <div class="h-3.5 w-24 bg-gray-200 rounded animate-pulse motion-reduce:animate-none" />
                  </th>
                  <!-- Cột 2: Trạng thái (~17% md/lg, ~13% xl) -->
                  <th scope="col" class="px-3 py-2 font-medium text-center whitespace-nowrap w-[17%] xl:w-[13%] min-w-[100px]">
                    <div class="h-3.5 w-16 bg-gray-200 rounded mx-auto animate-pulse motion-reduce:animate-none" />
                  </th>
                  <!-- Cột 3: Mức lương (~18% md/lg, ~15% xl) -->
                  <th scope="col" class="px-3 py-2 font-medium whitespace-nowrap w-[18%] xl:w-[15%] min-w-[105px]">
                    <div class="h-3.5 w-16 bg-gray-200 rounded animate-pulse motion-reduce:animate-none" />
                  </th>
                  <!-- Cột 4: Hạn nộp (~14% xl) (ẩn ở md/lg, hiện ở xl) -->
                  <th scope="col" class="hidden xl:table-cell px-3 py-2 font-medium text-center whitespace-nowrap xl:w-[14%] min-w-[110px]">
                    <div class="h-3.5 w-16 bg-gray-200 rounded mx-auto animate-pulse motion-reduce:animate-none" />
                  </th>
                  <!-- Cột 5: Lượt xem (~10% xl) (ẩn ở md/lg, hiện ở xl) -->
                  <th scope="col" class="hidden xl:table-cell px-1 py-2 font-medium text-center whitespace-nowrap xl:w-[10%] min-w-[70px]">
                    <div class="h-3.5 w-14 bg-gray-200 rounded mx-auto animate-pulse motion-reduce:animate-none" />
                  </th>
                  <!-- Cột 6: Ứng viên (~14% md/lg, ~10% xl) -->
                  <th scope="col" class="px-1 py-2 font-medium text-center whitespace-nowrap w-[14%] xl:w-[10%] min-w-[70px]">
                    <div class="h-3.5 w-14 bg-gray-200 rounded mx-auto animate-pulse motion-reduce:animate-none" />
                  </th>
                  <!-- Cột 7: Thao tác (~8% md/lg, ~6% xl) (Căn giữa) -->
                  <th scope="col" class="px-2 py-2 font-medium text-center whitespace-nowrap w-[8%] xl:w-[6%] min-w-[50px] xl:min-w-[60px]">
                    <div class="h-3.5 w-10 bg-gray-200 rounded mx-auto animate-pulse motion-reduce:animate-none" />
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="i in (pageSize || 12)" :key="i" class="h-[72px] bg-white">
                  <!-- 1. Tin tuyển dụng -->
                  <td class="px-4 py-3 align-middle">
                    <div class="space-y-2">
                      <div class="h-4 w-4/5 bg-gray-200 rounded animate-pulse motion-reduce:animate-none" />
                      <div class="h-3 w-1/2 bg-gray-100 rounded animate-pulse motion-reduce:animate-none" />
                    </div>
                  </td>
                  <!-- 2. Trạng thái -->
                  <td class="px-3 py-3 align-middle text-center">
                    <div class="h-[26px] w-24 bg-gray-200 rounded-md mx-auto animate-pulse motion-reduce:animate-none" />
                  </td>
                  <!-- 3. Mức lương -->
                  <td class="px-3 py-3 align-middle">
                    <div class="h-4 w-24 bg-gray-200 rounded animate-pulse motion-reduce:animate-none" />
                  </td>
                  <!-- 4. Hạn nộp -->
                  <td class="hidden xl:table-cell px-3 py-3 align-middle text-center">
                    <div class="h-4 w-20 bg-gray-200 rounded mx-auto animate-pulse motion-reduce:animate-none" />
                  </td>
                  <!-- 5. Lượt xem -->
                  <td class="hidden xl:table-cell px-1 py-3 align-middle text-center">
                    <div class="h-4 w-12 bg-gray-200 rounded mx-auto animate-pulse motion-reduce:animate-none" />
                  </td>
                  <!-- 6. Ứng viên -->
                  <td class="px-1 py-3 align-middle text-center">
                    <div class="h-4 w-10 bg-gray-200 rounded mx-auto animate-pulse motion-reduce:animate-none" />
                  </td>
                  <!-- 7. Thao tác -->
                  <td class="px-2 py-3 align-middle text-center">
                    <div class="h-8 w-8 bg-gray-200 rounded-lg mx-auto animate-pulse motion-reduce:animate-none" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- CARD SKELETON (<768px: Mobile) -->
        <div class="block md:hidden space-y-3">
          <div
            v-for="i in (pageSize || 12)"
            :key="i"
            class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="h-4 w-3/4 bg-gray-200 rounded animate-pulse motion-reduce:animate-none" />
              <div class="h-5 w-20 bg-gray-200 rounded-md animate-pulse motion-reduce:animate-none shrink-0" />
            </div>
            <div class="space-y-1.5">
              <div class="h-3 w-1/2 bg-gray-100 rounded animate-pulse motion-reduce:animate-none" />
              <div class="h-3 w-1/3 bg-gray-100 rounded animate-pulse motion-reduce:animate-none" />
            </div>
            <div class="pt-2 border-t border-gray-100 flex items-center justify-between">
              <div class="h-4 w-16 bg-gray-200 rounded animate-pulse motion-reduce:animate-none" />
              <div class="h-8 w-24 bg-gray-200 rounded-lg animate-pulse motion-reduce:animate-none" />
            </div>
          </div>
        </div>
      </div>

      <!-- ============ Error ============ -->
      <div
        v-else-if="error"
        role="alert"
        aria-live="assertive"
        class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 c3-fade"
      >
        <div class="flex items-center gap-2 min-w-0">
          <AlertCircle class="w-4 h-4 text-red-500 shrink-0" />
          <p class="text-xs text-red-700 break-words">{{ error }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            v-if="hasActiveFilter"
            type="button"
            class="px-2.5 py-1 text-xs font-medium text-red-700 hover:text-red-800 hover:bg-red-100 rounded transition inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            aria-label="Xoá bộ lọc khi lỗi"
            @click="resetAllFilters"
          >
            <X class="w-3.5 h-3.5" />
            <span>Xoá bộ lọc</span>
          </button>
          <button
            type="button"
            class="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 transition inline-flex items-center gap-1.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            @click="retryFetch"
          >
            <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': loading }" />
            <span>Thử lại</span>
          </button>
        </div>
      </div>

      <!-- ============ Empty State (Lọc trả về 0 kết quả) ============ -->
      <div
        v-else-if="items.length === 0 && hasActiveFilter"
        class="bg-white rounded-xl border border-gray-200 shadow-sm c3-fade"
      >
        <div class="flex flex-col items-center justify-center py-12 text-center px-6">
          <Search class="w-7 h-7 text-gray-300 mb-2" />
          <p class="text-sm font-medium text-gray-900 mb-1">
            Không tìm thấy tin tuyển dụng nào
          </p>
          <p class="text-xs text-gray-500 mb-4 max-w-sm">
            Thử tìm kiếm với từ khoá khác hoặc xoá bớt các bộ lọc đang chọn.
          </p>
          <button
            type="button"
            class="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition shadow-sm"
            @click="resetAllFilters"
          >
            Xoá bộ lọc
          </button>
        </div>
      </div>

      <!-- ============ Empty State (Công ty có 0 tin và KHÔNG lọc) ============ -->
      <div
        v-else-if="items.length === 0 && !hasActiveFilter"
        class="bg-white rounded-xl border border-gray-200 shadow-sm c3-fade"
      >
        <div class="flex flex-col items-center justify-center py-12 text-center px-6">
          <Briefcase class="w-8 h-8 text-gray-300 mb-2" />
          <p class="text-sm font-medium text-gray-900 mb-1">
            Chưa có tin tuyển dụng nào
          </p>
          <p class="text-xs text-gray-500 mb-4 max-w-sm">
            Tạo tin tuyển dụng đầu tiên để bắt đầu nhận hồ sơ ứng viên tiềm năng.
          </p>
          <button
            type="button"
            class="px-4 py-2 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition shadow-sm inline-flex items-center gap-1.5"
            @click="openCreateModal"
          >
            <Plus class="w-3.5 h-3.5" />
            <span>Đăng tin tuyển dụng</span>
          </button>
        </div>
      </div>

      <!-- ============ DANH SÁCH TIN TUYỂN DỤNG (Bảng Desktop & Card Mobile) ============ -->
      <template v-else-if="items.length > 0">
        <!-- BẢNG DANH SÁCH (Desktop & Tablet ngang: >=768px) -->
        <div
          id="posted-jobs-table-root"
          class="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm c3-fade"
        >
        <div class="overflow-x-auto">
          <table class="w-full table-fixed text-left border-collapse min-w-[570px] xl:min-w-[850px]">
            <!-- Header Bảng (7 Cột chuẩn SaaS) -->
            <thead class="bg-gray-50/90 border-b border-gray-200">
              <tr class="h-11 text-xs font-medium text-gray-600 select-none">
                <!-- Cột 1: Tin tuyển dụng (~43% md/lg, ~32% xl) -->
                <th
                  scope="col"
                  class="px-4 py-2 font-medium w-[43%] xl:w-[32%] min-w-[210px] xl:min-w-[220px]"
                >
                  Tin tuyển dụng
                </th>

                <!-- Cột 2: Trạng thái (~17% md/lg, ~13% xl) -->
                <th scope="col" class="px-3 py-2 font-medium text-center whitespace-nowrap w-[17%] xl:w-[13%] min-w-[100px]">
                  Trạng thái
                </th>

                <!-- Cột 3: Mức lương (~18% md/lg, ~15% xl) -->
                <th scope="col" class="px-3 py-2 font-medium whitespace-nowrap w-[18%] xl:w-[15%] min-w-[105px]">
                  Mức lương
                </th>

                <!-- Cột 4: Hạn nộp (~14% xl) (Sortable, ẩn ở md/lg, hiện ở xl) -->
                <th
                  scope="col"
                  class="hidden xl:table-cell px-3 py-2 font-medium text-center whitespace-nowrap xl:w-[14%] min-w-[110px]"
                  :class="sortColumn === 'deadline' ? 'text-gray-900 font-semibold' : ''"
                  :aria-sort="sortColumn === 'deadline' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'"
                >
                  <button
                    type="button"
                    class="inline-flex items-center justify-center gap-1 w-full h-full text-inherit font-inherit cursor-pointer hover:text-gray-900 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded py-1 px-1.5"
                    aria-label="Sắp xếp theo hạn nộp"
                    @click="toggleSort('deadline')"
                  >
                    <span>Hạn nộp</span>
                    <ArrowUp v-if="sortColumn === 'deadline' && sortDirection === 'asc'" class="w-3.5 h-3.5 text-primary-600 shrink-0" />
                    <ArrowDown v-else-if="sortColumn === 'deadline' && sortDirection === 'desc'" class="w-3.5 h-3.5 text-primary-600 shrink-0" />
                    <ArrowUpDown v-else class="w-3 h-3 text-gray-400 shrink-0" />
                  </button>
                </th>

                <!-- Cột 5: Lượt xem (~10% xl) (Sortable, ẩn ở md/lg, hiện ở xl) -->
                <th
                  scope="col"
                  class="hidden xl:table-cell px-1 py-2 font-medium text-center whitespace-nowrap xl:w-[10%] min-w-[70px]"
                  :class="sortColumn === 'viewsCount' ? 'text-gray-900 font-semibold' : ''"
                  :aria-sort="sortColumn === 'viewsCount' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'"
                >
                  <button
                    type="button"
                    class="inline-flex items-center justify-center gap-1 w-full h-full text-inherit font-inherit cursor-pointer hover:text-gray-900 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded py-1 px-1"
                    aria-label="Sắp xếp theo lượt xem"
                    @click="toggleSort('viewsCount')"
                  >
                    <span>Lượt xem</span>
                    <ArrowUp v-if="sortColumn === 'viewsCount' && sortDirection === 'asc'" class="w-3.5 h-3.5 text-primary-600 shrink-0" />
                    <ArrowDown v-else-if="sortColumn === 'viewsCount' && sortDirection === 'desc'" class="w-3.5 h-3.5 text-primary-600 shrink-0" />
                    <ArrowUpDown v-else class="w-3 h-3 text-gray-400 shrink-0" />
                  </button>
                </th>

                <!-- Cột 6: Ứng viên (~14% md/lg, ~10% xl) (Sortable) -->
                <th
                  scope="col"
                  class="px-1 py-2 font-medium text-center whitespace-nowrap w-[14%] xl:w-[10%] min-w-[70px]"
                  :class="sortColumn === 'appliesCount' ? 'text-gray-900 font-semibold' : ''"
                  :aria-sort="sortColumn === 'appliesCount' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'"
                >
                  <button
                    type="button"
                    class="inline-flex items-center justify-center gap-1 w-full h-full text-inherit font-inherit cursor-pointer hover:text-gray-900 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded py-1 px-1"
                    aria-label="Sắp xếp theo số ứng viên"
                    @click="toggleSort('appliesCount')"
                  >
                    <span>Ứng viên</span>
                    <ArrowUp v-if="sortColumn === 'appliesCount' && sortDirection === 'asc'" class="w-3.5 h-3.5 text-primary-600 shrink-0" />
                    <ArrowDown v-else-if="sortColumn === 'appliesCount' && sortDirection === 'desc'" class="w-3.5 h-3.5 text-primary-600 shrink-0" />
                    <ArrowUpDown v-else class="w-3 h-3 text-gray-400 shrink-0" />
                  </button>
                </th>

                <!-- Cột 7: Thao tác (~8% md/lg, ~6% xl) (Căn giữa) -->
                <th scope="col" class="px-2 py-2 font-medium text-center whitespace-nowrap w-[8%] xl:w-[6%] min-w-[50px] xl:min-w-[60px]">
                  Thao tác
                </th>
              </tr>
            </thead>

            <!-- Thân Bảng (Fade mờ nhẹ 60% khi fetch ngầm, stagger fade từng hàng) -->
            <tbody
              class="divide-y divide-gray-100 transition-opacity duration-150"
              :class="{ 'opacity-60 pointer-events-none': loading }"
            >
              <tr
                v-for="(job, i) in items"
                :key="job.id"
                :class="[
                  'h-[72px] transition duration-150 group cursor-pointer pj-row',
                  rowAnimationClass,
                  job.status === 'closed' ? 'bg-gray-50/40 hover:bg-gray-50/80 text-gray-400' : 'bg-white hover:bg-gray-50/70'
                ]"
                :style="{ animationDelay: `${Math.min(i * 35, 280)}ms` }"
                @click="navigateToDetail(job)"
              >
                <!-- 1. Cột Tin tuyển dụng -->
                <td class="px-4 py-3 align-middle">
                  <div class="flex flex-col min-w-0 pr-2">
                    <router-link
                      :to="`/employer/jobs/${job.slug || job.id}`"
                      class="text-[15px] font-semibold tracking-normal truncate block leading-[23px] transition group-hover:text-primary-600"
                      :class="job.status === 'closed' ? 'text-gray-500' : 'text-gray-900'"
                      :title="job.title"
                      @click.prevent.stop="navigateToDetail(job)"
                    >
                      {{ job.title }}
                    </router-link>
                    <div class="mt-1 flex items-center gap-1.5 text-xs leading-[20px] text-gray-500">
                      <!-- Địa điểm / Hình thức chính -->
                      <span class="inline-flex items-center gap-1 min-w-0 truncate">
                        <MapPin class="h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden="true" />
                        <span class="truncate">{{ job.location?.city || getWorkTypeLabel(job) || 'Chưa cập nhật' }}</span>
                      </span>

                      <!-- Hình thức làm việc phụ (khi đã có thành phố) -->
                      <template v-if="job.location?.city && getWorkTypeLabel(job)">
                        <span class="text-gray-300 shrink-0 select-none" aria-hidden="true">·</span>
                        <span class="shrink-0">{{ getWorkTypeLabel(job) }}</span>
                      </template>
                    </div>
                  </div>
                </td>

                <!-- 2. Trạng thái -->
                <td class="px-3 py-3 align-middle whitespace-nowrap text-center">
                  <div class="inline-flex items-center justify-center">
                    <span
                      class="h-[26px] shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium leading-none select-none"
                      :class="getStatusConfig(job.status).pillClass"
                    >
                      <span
                        class="h-1.5 w-1.5 shrink-0 rounded-full"
                        :class="getStatusConfig(job.status).dotClass"
                        aria-hidden="true"
                      />
                      {{ getStatusConfig(job.status).label }}
                    </span>
                  </div>
                </td>

                <!-- 3. Mức lương -->
                <td class="px-3 py-3 align-middle whitespace-nowrap">
                  <span
                    v-if="getSalaryText(job).isNegotiable"
                    class="text-[13px] font-medium text-gray-800"
                  >
                    Thoả thuận
                  </span>
                  <div v-else class="flex items-baseline gap-1">
                    <span class="text-[13px] font-medium text-gray-800">
                      {{ getSalaryText(job).label }}
                    </span>
                    <span v-if="getSalaryText(job).period" class="text-[11px] text-gray-500">
                      {{ getSalaryText(job).period }}
                    </span>
                  </div>
                </td>

                <!-- 4. Hạn nộp (Cột mới: ẩn ở tablet md/lg, hiện ở desktop xl) -->
                <td
                  class="hidden xl:table-cell px-3 py-3 align-middle text-center whitespace-nowrap"
                  :title="getPublishedAtTitle(job.publishedAt)"
                >
                  <div class="inline-flex flex-col items-center justify-center">
                    <span
                      class="text-[13px] leading-tight"
                      :class="getDeadlineInfo(job.deadline).dateClass"
                    >
                      {{ getDeadlineInfo(job.deadline).formattedDate }}
                      <span v-if="getDeadlineInfo(job.deadline).isExpired" class="sr-only">Đã hết hạn</span>
                    </span>
                    <span
                      v-if="getDeadlineInfo(job.deadline).subtext"
                      class="text-xs leading-tight mt-0.5"
                      :class="getDeadlineInfo(job.deadline).subtextClass"
                    >
                      {{ getDeadlineInfo(job.deadline).subtext }}
                    </span>
                  </div>
                </td>

                <!-- 5. Lượt xem (Cột mới: ẩn ở tablet md/lg, hiện ở desktop xl) -->
                <td class="hidden xl:table-cell px-2 py-3 align-middle text-center whitespace-nowrap">
                  <span class="text-sm font-semibold text-gray-700">
                    {{ formatCount(job.viewsCount) }}
                  </span>
                </td>

                <!-- 6. Ứng viên -->
                <td class="px-2 py-3 align-middle text-center whitespace-nowrap">
                  <div class="inline-flex items-center justify-center gap-1">
                    <router-link
                      v-if="typeof job.appliesCount === 'number' && !isNaN(job.appliesCount) && job.appliesCount > 0"
                      :to="{ path: '/employer/applications', query: { jobId: job.id } }"
                      class="text-sm font-semibold transition hover:text-primary-600 hover:underline"
                      :class="job.status === 'closed' ? 'text-gray-500' : 'text-gray-900'"
                      :title="`Xem ${formatCount(job.appliesCount)} ứng viên`"
                      @click.stop
                    >
                      {{ formatCount(job.appliesCount) }}
                    </router-link>
                    <span
                      v-else-if="job.appliesCount === 0"
                      class="text-sm font-semibold text-gray-400 cursor-not-allowed"
                      title="Chưa có ứng viên"
                    >
                      0
                    </span>
                    <span
                      v-else
                      class="text-sm font-normal text-gray-400 cursor-not-allowed"
                      title="Chưa có dữ liệu ứng viên"
                    >
                      —
                    </span>
                    <span
                      v-if="getNewAppliesCount(job) > 0"
                      class="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 leading-none"
                      title="Ứng viên mới"
                    >
                      +{{ getNewAppliesCount(job) }}
                    </span>
                  </div>
                </td>

                <!-- 7. Thao tác -->
                <td class="px-2 py-3 align-middle text-center whitespace-nowrap">
                  <div data-row-menu class="relative inline-flex items-center justify-center">
                    <button
                      type="button"
                      class="relative inline-flex h-8 w-8 min-h-[32px] min-w-[32px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#5b4eea] motion-reduce:transition-none before:absolute before:-inset-1 before:content-['']"
                      :class="{ 'bg-slate-100 text-slate-800 ring-1 ring-slate-200': activeRowMenuId === job.id }"
                      :aria-label="job.title ? `Thao tác cho tin ${job.title}` : 'Thao tác'"
                      aria-haspopup="menu"
                      :aria-expanded="activeRowMenuId === job.id ? 'true' : 'false'"
                      :aria-controls="'row-menu-' + job.id"
                      @click.stop="toggleRowMenu(job.id, $event)"
                    >
                      <MoreHorizontal class="h-4 w-4 shrink-0" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ============ MOBILE VIEW (<768px): Khối danh sách xếp dọc ============ -->
      <div
        class="md:hidden space-y-3 transition-opacity duration-150 c3-fade"
        :class="{ 'opacity-60 pointer-events-none': loading }"
      >
        <div
          v-for="(job, i) in items"
          :key="'mobile-' + job.id"
          :class="[
            'border border-gray-200 rounded-xl p-4 shadow-sm cursor-pointer transition pj-row',
            rowAnimationClass,
            job.status === 'closed' ? 'bg-gray-50/60 hover:bg-gray-50/90' : 'bg-white hover:bg-gray-50/80'
          ]"
          :style="{ animationDelay: `${Math.min(i * 35, 280)}ms` }"
          @click="navigateToDetail(job)"
        >
          <!-- Header hàng: status badge + thời hạn & ngày đăng -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span
                class="h-[26px] shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium leading-none"
                :class="getStatusConfig(job.status).pillClass"
              >
                <span class="h-1.5 w-1.5 rounded-full" :class="getStatusConfig(job.status).dotClass" />
                {{ getStatusConfig(job.status).label }}
              </span>
              <span
                v-if="getRemainingSubtext(job)"
                class="text-xs"
                :class="getRemainingSubtext(job)?.class"
              >
                {{ getRemainingSubtext(job)?.text }}
              </span>
            </div>
            <span
              class="text-[11px] text-gray-500"
              :title="job.status === 'pending' ? 'Đang chờ duyệt' : undefined"
            >
              {{ getPublishedTimeText(job) }}
            </span>
          </div>

          <!-- Tiêu đề job -->
          <router-link
            :to="`/employer/jobs/${job.slug || job.id}`"
            class="mt-2.5 text-sm font-semibold tracking-tight text-gray-900 block leading-snug line-clamp-2"
            :class="job.status === 'closed' ? 'text-gray-500' : 'text-gray-900'"
            @click.prevent.stop="navigateToDetail(job)"
          >
            {{ job.title }}
          </router-link>

          <!-- Địa điểm & Lương -->
          <div class="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span class="inline-flex items-center gap-1 min-w-0 truncate">
              <MapPin class="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span class="truncate">{{ getLocationWorkTypeText(job) }}</span>
            </span>
            <span class="font-medium text-gray-800 shrink-0 ml-2">
              {{ getSalaryText(job).label }}<span v-if="!getSalaryText(job).isNegotiable && getSalaryText(job).period" class="text-[11px] text-gray-400">{{ getSalaryText(job).period }}</span>
            </span>
          </div>

          <!-- Dòng Ứng viên + Thao tác -->
          <div class="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
            <div class="inline-flex items-center gap-1.5 text-xs">
              <span class="text-gray-500">Ứng viên:</span>
              <router-link
                v-if="typeof job.appliesCount === 'number' && !isNaN(job.appliesCount) && job.appliesCount > 0"
                :to="{ path: '/employer/applications', query: { jobId: job.id } }"
                class="font-semibold text-primary-600 hover:underline"
                @click.stop
              >
                {{ formatCount(job.appliesCount) }}
              </router-link>
              <span v-else-if="job.appliesCount === 0" class="font-semibold text-gray-400">0</span>
              <span v-else class="font-normal text-gray-400">—</span>
              <span
                v-if="getNewAppliesCount(job) > 0"
                class="rounded-full bg-emerald-50 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-700"
              >
                +{{ getNewAppliesCount(job) }}
              </span>
            </div>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="h-8 px-2.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1"
                @click.stop="openEditModal(job.id)"
              >
                <Pencil class="h-3 w-3 text-gray-500" />
                <span>Sửa</span>
              </button>
              <button
                type="button"
                class="h-8 px-3 rounded-lg text-xs font-semibold disabled:cursor-not-allowed"
                :class="getActionButtonConfig(job).classes"
                :disabled="getActionButtonConfig(job).disabled"
                @click.stop="getActionButtonConfig(job).onClick()"
              >
                {{ getActionButtonConfig(job).label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

      <!-- ============ Phân trang ============ -->
      <nav
        v-if="total > pageSize"
        aria-label="Phân trang"
        class="mt-6 flex items-center justify-between gap-3 flex-wrap bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm"
      >
        <p class="text-xs text-gray-500">
          Trang <strong class="text-gray-900">{{ page }}</strong> / <strong class="text-gray-900">{{ totalPages }}</strong>
          <span class="mx-1.5 text-gray-300">•</span>
          Tổng <strong class="text-gray-900">{{ total }}</strong> tin tuyển dụng
        </p>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="h-8 px-3 min-w-8 text-xs rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="page <= 1 || loading"
            aria-label="Trang trước"
            @click="goToPage(page - 1)"
          >
            <ChevronLeft class="w-3.5 h-3.5" /> Trước
          </button>
          <template v-for="item in paginationItems" :key="item.key">
            <button
              v-if="item.type === 'page'"
              type="button"
              class="h-8 min-w-8 px-2 text-xs font-medium rounded-lg border transition inline-flex items-center justify-center disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              :class="item.value === page ? 'border-primary-600 bg-primary-50 text-primary-600 font-semibold' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
              :aria-label="`Trang ${item.value}`"
              :aria-current="item.value === page ? 'page' : undefined"
              :disabled="loading"
              @click="goToPage(item.value as number)"
            >
              {{ item.value }}
            </button>
            <span
              v-else
              class="h-8 min-w-8 px-1 text-xs text-gray-400 inline-flex items-center justify-center select-none"
              aria-hidden="true"
            >
              ...
            </span>
          </template>
          <button
            type="button"
            class="h-8 px-3 min-w-8 text-xs rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            :disabled="page >= totalPages || loading"
            aria-label="Trang sau"
            @click="goToPage(page + 1)"
          >
            Sau <ChevronRight class="w-3.5 h-3.5" />
          </button>
        </div>
      </nav>
    </div>

    <!-- ============ Confirm Delete Modal ============ -->
    <ConfirmModal
      :open="deleteConfirmId !== null"
      title="Xoá tin tuyển dụng?"
      :message="`Bạn có chắc chắn muốn xoá tin &quot;${deleteConfirmTitle}&quot;? Tin sẽ chuyển sang trạng thái ${STATUS_LABELS.closed.toLowerCase()}.`"
      confirm-text="Xoá"
      variant="danger"
      @cancel="cancelDelete"
      @confirm="confirmDeleteAction"
    />

    <!-- ============ Edit Modal ============ -->
    <EditJobModal
      v-if="editModalJobId"
      v-model:open="editModalOpen"
      :job-id="editModalJobId"
      @saved="onEditSaved"
    />

    <!-- ============ Create Modal ============ -->
    <CreateJobModal
      v-model:open="createModalOpen"
      @created="onJobCreated"
    />

    <!-- ============ Teleported Row Menu (Thao tác) ============ -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="activeRowMenuId && activeMenuJob"
          :id="'row-menu-' + activeRowMenuId"
          data-teleported-menu
          data-row-menu
          :style="rowMenuStyles"
          class="fixed z-[60] min-w-[180px] w-max max-w-[240px] rounded-xl border border-slate-200/90 bg-white p-1 shadow-lg shadow-slate-900/5 focus:outline-none"
          :class="rowMenuPlacement === 'top' ? 'origin-bottom-right' : 'origin-top-right'"
          role="menu"
          :aria-label="activeMenuJob.title ? `Thao tác cho tin ${activeMenuJob.title}` : 'Menu thao tác'"
          tabindex="-1"
          @keydown="handleMenuKeydown"
          @click.stop
        >
          <!-- 1. Xem ứng viên (live / pending) -->
          <button
            v-if="activeMenuJob.status === 'live' || activeMenuJob.status === 'pending'"
            type="button"
            role="menuitem"
            tabindex="-1"
            :disabled="!activeMenuJob.appliesCount || activeMenuJob.appliesCount <= 0"
            class="group flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-normal transition-colors duration-150 focus:outline-none motion-reduce:transition-none"
            :class="(!activeMenuJob.appliesCount || activeMenuJob.appliesCount <= 0)
              ? 'text-slate-400 cursor-not-allowed'
              : 'cursor-pointer text-slate-700 hover:bg-slate-100/80 focus:bg-slate-100/80 focus-visible:bg-slate-100/80'"
            @click="handleMenuAction('view-applies')"
          >
            <span class="inline-flex items-center gap-2.5 min-w-0">
              <Users
                class="h-4 w-4 shrink-0 transition-colors"
                :class="(!activeMenuJob.appliesCount || activeMenuJob.appliesCount <= 0) ? 'text-slate-300' : 'text-slate-400 group-hover:text-slate-600'"
                aria-hidden="true"
              />
              <span class="truncate">Xem ứng viên</span>
            </span>
            <span
              v-if="typeof activeMenuJob.appliesCount === 'number' && activeMenuJob.appliesCount > 0"
              class="rounded-full bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold text-primary-700 leading-none shrink-0"
            >
              {{ formatCount(activeMenuJob.appliesCount) }}
            </span>
          </button>

          <!-- 2. Đăng tin (draft) -->
          <button
            v-else-if="activeMenuJob.status === 'draft'"
            type="button"
            role="menuitem"
            tabindex="-1"
            class="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-primary-600 hover:bg-primary-50 focus:bg-primary-50 focus-visible:bg-primary-50 transition-colors duration-150 focus:outline-none motion-reduce:transition-none"
            @click="handleMenuAction('publish')"
          >
            <Send class="h-4 w-4 shrink-0 text-primary-500 transition-colors" aria-hidden="true" />
            <span class="truncate">Đăng tin</span>
          </button>

          <!-- 4. Mở lại tin (closed) -->
          <button
            v-else-if="activeMenuJob.status === 'closed'"
            type="button"
            role="menuitem"
            tabindex="-1"
            class="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-primary-600 hover:bg-primary-50 focus:bg-primary-50 focus-visible:bg-primary-50 transition-colors duration-150 focus:outline-none motion-reduce:transition-none"
            @click="handleMenuAction('reopen')"
          >
            <RotateCcw class="h-4 w-4 shrink-0 text-primary-500 transition-colors" aria-hidden="true" />
            <span class="truncate">Mở lại tin</span>
          </button>

          <!-- 5. Xem lý do gắn cờ (ai_flagged) -->
          <button
            v-else-if="activeMenuJob.status === 'ai_flagged'"
            type="button"
            role="menuitem"
            tabindex="-1"
            class="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-amber-700 hover:bg-amber-50 focus:bg-amber-50 focus-visible:bg-amber-50 transition-colors duration-150 focus:outline-none motion-reduce:transition-none"
            @click="handleMenuAction('flagged-reason')"
          >
            <Flag class="h-4 w-4 shrink-0 text-amber-600 transition-colors" aria-hidden="true" />
            <span class="truncate">Xem lý do gắn cờ</span>
          </button>

          <!-- 6. Xem chi tiết (mọi trạng thái) -->
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-normal text-slate-700 hover:bg-slate-100/80 focus:bg-slate-100/80 focus-visible:bg-slate-100/80 transition-colors duration-150 focus:outline-none motion-reduce:transition-none"
            @click="handleMenuAction('view-detail')"
          >
            <Eye class="h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-600 transition-colors" aria-hidden="true" />
            <span class="truncate">Xem chi tiết</span>
          </button>

          <!-- 7. Chỉnh sửa (mọi trạng thái) -->
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-normal text-slate-700 hover:bg-slate-100/80 focus:bg-slate-100/80 focus-visible:bg-slate-100/80 transition-colors duration-150 focus:outline-none motion-reduce:transition-none"
            @click="handleMenuAction('edit')"
          >
            <Pencil class="h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-600 transition-colors" aria-hidden="true" />
            <span class="truncate">Chỉnh sửa</span>
          </button>

          <!-- Đường kẻ phân cách -->
          <div class="my-1 border-t border-slate-100" role="separator" aria-orientation="horizontal" />

          <!-- 8. Xoá tin (danger) -->
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-normal text-red-600 hover:bg-red-50/80 focus:bg-red-50/80 focus-visible:bg-red-50/80 transition-colors duration-150 focus:outline-none motion-reduce:transition-none"
            @click="handleMenuAction('delete')"
          >
            <Trash2 class="h-4 w-4 shrink-0 text-red-500 transition-colors" aria-hidden="true" />
            <span class="truncate">Xoá tin</span>
          </button>
        </div>
      </Transition>
    </Teleport>

    <!-- ============ Mobile Bottom Sheet Filter ============ -->
    <Teleport to="body">
      <div
        v-if="openDropdown !== null && isMobileView"
        id="mobile-filter-sheet"
        class="fixed inset-0 z-40 flex flex-col justify-end"
        role="dialog"
        aria-modal="true"
        :aria-label="'Bộ lọc ' + currentMobileFilterTitle"
        data-filter-sheet
        @keydown="handleSheetKeydown"
      >
        <!-- Backdrop mờ (bấm để đóng) -->
        <div
          class="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
          data-filter-backdrop
          @click="openDropdown = null"
          @pointerdown="openDropdown = null"
        />

        <!-- Sheet container -->
        <div
          class="relative z-10 flex flex-col max-h-[70dvh] w-full bg-white rounded-t-2xl shadow-2xl border-t border-gray-200 overflow-hidden"
          style="overscroll-behavior: contain;"
        >
          <!-- Header của Sheet -->
          <div class="relative flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <div class="w-10 h-1 bg-gray-200 rounded-full mx-auto absolute top-2 left-1/2 -translate-x-1/2" />
            <h3 class="text-base font-semibold text-gray-900 mt-1">
              {{ currentMobileFilterTitle }}
            </h3>
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              @click="openDropdown = null"
            >
              Xong
            </button>
          </div>

          <!-- Danh sách options cuộn bên trong -->
          <div
            class="overflow-y-auto p-2 space-y-1 pb-[max(1rem,env(safe-area-inset-bottom))]"
            role="listbox"
            :aria-label="currentMobileFilterTitle"
            tabindex="-1"
          >
            <!-- 1. Trạng thái -->
            <template v-if="openDropdown === 'status'">
              <button
                v-for="opt in statusOptions"
                :key="opt.label"
                type="button"
                role="option"
                :aria-selected="currentStatus === opt.value"
                class="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm transition text-left"
                :class="currentStatus === opt.value ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'"
                @click="handleStatusSelect(opt.value)"
              >
                <span>{{ opt.label }}</span>
                <Check v-if="currentStatus === opt.value" class="w-4 h-4 text-primary-600 shrink-0" />
              </button>
            </template>

            <!-- 2. Địa điểm -->
            <template v-else-if="openDropdown === 'location'">
              <button
                type="button"
                role="option"
                :aria-selected="currentLocationCity === null"
                class="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm transition text-left"
                :class="currentLocationCity === null ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'"
                @click="handleLocationSelect(null, undefined)"
              >
                <span>Tất cả địa điểm</span>
                <Check v-if="currentLocationCity === null" class="w-4 h-4 text-primary-600 shrink-0" />
              </button>
              <div
                v-if="locations.loading.value && locations.items.value.length === 0"
                class="px-4 py-3 text-xs text-gray-500 inline-flex items-center gap-1.5"
              >
                <Loader2 class="w-4 h-4 animate-spin text-primary-500" /> Đang tải danh sách địa điểm...
              </div>
              <button
                v-for="loc in locations.items.value"
                :key="loc.code"
                type="button"
                role="option"
                :aria-selected="currentLocationCity === loc.shortName"
                class="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm transition text-left"
                :class="currentLocationCity === loc.shortName ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'"
                @click="handleLocationSelect(loc.shortName, loc.name)"
              >
                <span class="truncate">{{ loc.name }}</span>
                <Check v-if="currentLocationCity === loc.shortName" class="w-4 h-4 text-primary-600 shrink-0" />
              </button>
            </template>

            <!-- 3. Ngành nghề -->
            <template v-else-if="openDropdown === 'industry'">
              <button
                type="button"
                role="option"
                :aria-selected="currentIndustry === null"
                class="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm transition text-left"
                :class="currentIndustry === null ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'"
                @click="handleIndustrySelect(null)"
              >
                <span>Tất cả ngành nghề</span>
                <Check v-if="currentIndustry === null" class="w-4 h-4 text-primary-600 shrink-0" />
              </button>
              <div
                v-if="industriesLoading && industries.length === 0"
                class="px-4 py-3 text-xs text-gray-500 inline-flex items-center gap-1.5"
              >
                <Loader2 class="w-4 h-4 animate-spin text-primary-500" /> Đang tải ngành nghề...
              </div>
              <button
                v-for="ind in industries"
                :key="ind"
                type="button"
                role="option"
                :aria-selected="currentIndustry === ind"
                class="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm transition text-left"
                :class="currentIndustry === ind ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'"
                @click="handleIndustrySelect(ind)"
              >
                <span class="truncate">{{ ind }}</span>
                <Check v-if="currentIndustry === ind" class="w-4 h-4 text-primary-600 shrink-0" />
              </button>
            </template>

            <!-- 4. Loại hình -->
            <template v-else-if="openDropdown === 'jobType'">
              <button
                v-for="opt in jobTypeOptions"
                :key="opt.label"
                type="button"
                role="option"
                :aria-selected="currentJobType === opt.value"
                class="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm transition text-left"
                :class="currentJobType === opt.value ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'"
                @click="handleJobTypeSelect(opt.value)"
              >
                <span>{{ opt.label }}</span>
                <Check v-if="currentJobType === opt.value" class="w-4 h-4 text-primary-600 shrink-0" />
              </button>
            </template>

            <!-- 5. Cấp bậc -->
            <template v-else-if="openDropdown === 'jobLevel'">
              <button
                v-for="opt in jobLevelOptions"
                :key="opt.label"
                type="button"
                role="option"
                :aria-selected="currentJobLevel === opt.value"
                class="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm transition text-left"
                :class="currentJobLevel === opt.value ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'"
                @click="handleJobLevelSelect(opt.value)"
              >
                <span>{{ opt.label }}</span>
                <Check v-if="currentJobLevel === opt.value" class="w-4 h-4 text-primary-600 shrink-0" />
              </button>
            </template>

            <!-- 6. Hình thức -->
            <template v-else-if="openDropdown === 'workType'">
              <button
                v-for="opt in workTypeOptions"
                :key="opt.label"
                type="button"
                role="option"
                :aria-selected="currentWorkType === opt.value"
                class="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm transition text-left"
                :class="currentWorkType === opt.value ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'"
                @click="handleWorkTypeSelect(opt.value)"
              >
                <span>{{ opt.label }}</span>
                <Check v-if="currentWorkType === opt.value" class="w-4 h-4 text-primary-600 shrink-0" />
              </button>
            </template>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style>
/* Stagger fade-up khi trang xuất hiện — đồng bộ CompanyView và CompanyMembersView */
.c3-fade {
  animation: c3-fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.c3-d1 {
  animation-delay: 60ms;
}
.c3-d2 {
  animation-delay: 120ms;
}

@keyframes c3-fade-up {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* Stagger cho từng hàng bảng và card mobile (nhẹ, nhanh 200-250ms, không đổi chiều cao/hình học) */
.pj-row {
  will-change: opacity;
}

.pj-row-fade-a,
.pj-row-fade-b {
  animation-duration: 0.25s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: both;
}

.pj-row-fade-a {
  animation-name: pj-row-fade-a;
}

.pj-row-fade-b {
  animation-name: pj-row-fade-b;
}

@keyframes pj-row-fade-a {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes pj-row-fade-b {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Chống giật scrollbar ngang trong overflow wrapper của bảng */
#posted-jobs-table-root .overflow-x-auto {
  scrollbar-width: none;
}
#posted-jobs-table-root .overflow-x-auto::-webkit-scrollbar {
  width: 0;
  height: 0;
}

@media (prefers-reduced-motion: reduce) {
  .c3-fade,
  .pj-row-fade-a,
  .pj-row-fade-b {
    animation: none !important;
    transition: none !important;
  }
}
</style>
