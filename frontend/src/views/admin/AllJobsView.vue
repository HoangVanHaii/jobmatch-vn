<script setup lang="ts">
/**
 * AllJobsView — trang quản lý Job cho Admin (/admin/jobs).
 *
 * Layout (card-based, khác biệt với UsersListView table-based):
 *   1. Hero header: gradient + title + 3 key stats (Tổng / Đang tuyển / Tổng ứng viên)
 *   2. Status filter pills: 8 status ngang (Tất cả + 7 statuses), click filter
 *   3. Toolbar: search + 3 filters (level, type, sort) + "Xoá bộ lọc"
 *   4. Job cards grid: 2 cột desktop, 1 mobile. Mỗi card có company avatar
 *      (gradient theo tên), title, salary highlight (emerald), meta icons,
 *      status badge, action menu, footer với applies/views + "Xem chi tiết"
 *   5. Status change confirm modal + View detail modal
 *   6. Pagination
 *
 * Color theme: emerald (vs Users dùng indigo) để phân biệt rõ 2 trang.
 */
import { onMounted, ref, computed, watch, type Component } from 'vue';
import { storeToRefs } from 'pinia';
import { useAdminJobsStore, type JobStatusFilter } from '@stores/adminJobs';
import { useToastStore } from '@stores/toast';
import { adminJobApi } from '@/services/adminJob.api';
import JobStatusBadge from '@components/admin/JobStatusBadge.vue';
import AdminPagination from '@components/admin/AdminPagination.vue';
import AdminActionMenu from '@components/admin/AdminActionMenu.vue';
import AdminModal from '@components/admin/AdminModal.vue';
import ConfirmModal from '@components/common/ConfirmModal.vue';
import {
  Search, Inbox, RefreshCw, ChevronDown, X, Briefcase, MapPin,
  DollarSign, Users, Loader2, Eye, Award, Building2, Sparkles,
  TrendingUp, ChevronRight, FileText, Clock,
  AlertTriangle, Play, XCircle, XSquare,
} from 'lucide-vue-next';
import { formatDate, relativeTime } from '@/utils/format';
import type { JobDetail, JobStatus, JobLevel, JobType } from '@/types/job';

/** Shape action item — mirror với AdminActionMenu.vue (component này không export type). */
type ActionItem = {
  label?: string;
  onClick?: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  separator?: boolean;
  icon?: Component;
  active?: boolean;
  header?: boolean;
};

const store = useAdminJobsStore();
const toast = useToastStore();
const { jobs, loading, error, page, pageSize, total, counts, filters, paged, canGoNext, canGoPrev } = storeToRefs(store);

onMounted(() => {
  store.refetch();
  store.fetchCounts();
});

/* ============================================================================
 * Search debounce
 * ==========================================================================*/
const SEARCH_DEBOUNCE_MS = 400;
const searchInput = ref<string>(filters.value.q);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (q) => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchTimeout = null;
    store.setFilter('q', q);
  }, SEARCH_DEBOUNCE_MS);
});
watch(() => filters.value.q, (q) => { if (searchInput.value !== q) searchInput.value = q; });

/* ============================================================================
 * Filter options
 * ==========================================================================*/
const STATUS_OPTIONS: { value: JobStatusFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'draft', label: 'Bản nháp' },
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'ai_scanning', label: 'AI đang quét' },
  { value: 'ai_flagged', label: 'AI cảnh báo' },
  { value: 'live', label: 'Đang tuyển' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'closed', label: 'Đã đóng' },
];

const LEVEL_OPTIONS: { value: '' | JobLevel; label: string }[] = [
  { value: '', label: 'Tất cả cấp bậc' },
  { value: 'intern', label: 'Intern' },
  { value: 'fresher', label: 'Fresher' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'manager', label: 'Manager' },
];

const TYPE_OPTIONS: { value: '' | JobType; label: string }[] = [
  { value: '', label: 'Tất cả loại hình' },
  { value: 'full-time', label: 'Toàn thời gian' },
  { value: 'part-time', label: 'Bán thời gian' },
  { value: 'contract', label: 'Hợp đồng' },
  { value: 'internship', label: 'Thực tập' },
  { value: 'freelance', label: 'Freelance' },
];

const SORT_OPTIONS: { value: 'newest' | 'oldest' | 'views' | 'applies'; label: string }[] = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'oldest', label: 'Cũ nhất' },
  { value: 'views', label: 'Lượt xem' },
  { value: 'applies', label: 'Lượt nộp' },
];

const openDropdown = ref<'status' | 'level' | 'type' | 'sort' | null>(null);
function toggleDropdown(name: 'status' | 'level' | 'type' | 'sort'): void {
  openDropdown.value = openDropdown.value === name ? null : name;
}
function closeDropdowns(): void { openDropdown.value = null; }
function selectStatus(v: string): void { store.setFilter('status', v as JobStatusFilter); closeDropdowns(); }
function selectLevel(v: string): void { store.setFilter('jobLevel', v as '' | JobLevel); closeDropdowns(); }
function selectType(v: string): void { store.setFilter('jobType', v as '' | JobType); closeDropdowns(); }
function selectSort(v: string): void { store.setFilter('sort', v as 'newest' | 'oldest' | 'views' | 'applies'); closeDropdowns(); }
function currentLabel(name: 'status' | 'level' | 'type' | 'sort'): string {
  if (name === 'status') return STATUS_OPTIONS.find(o => o.value === filters.value.status)?.label ?? '';
  if (name === 'level') return LEVEL_OPTIONS.find(o => o.value === filters.value.jobLevel)?.label ?? '';
  if (name === 'type') return TYPE_OPTIONS.find(o => o.value === filters.value.jobType)?.label ?? '';
  return SORT_OPTIONS.find(o => o.value === filters.value.sort)?.label ?? '';
}
function hasActiveFilter(): boolean {
  return filters.value.q !== '' || filters.value.status !== 'all' || filters.value.jobLevel !== '' || filters.value.jobType !== '' || filters.value.sort !== 'newest';
}

/* ============================================================================
 * Format helpers
 * ==========================================================================*/
const JOB_TYPE_LABEL: Record<JobType, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Hợp đồng',
  internship: 'Thực tập',
  freelance: 'Freelance',
};
const JOB_LEVEL_LABEL: Record<JobLevel, string> = {
  intern: 'Intern', fresher: 'Fresher', junior: 'Junior', mid: 'Mid',
  senior: 'Senior', lead: 'Lead', manager: 'Manager',
};
function formatSalary(min: string | null, max: string | null, currency: string | null): string {
  if (!min && !max) return 'Thỏa thuận';
  const fmt = (v: string) => {
    const n = Number(v);
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} tỷ`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)} tr`;
    return n.toLocaleString('vi-VN');
  };
  const cur = currency || 'VND';
  if (min && max) return `${fmt(min)} - ${fmt(max)} ${cur}`;
  if (min) return `Từ ${fmt(min)} ${cur}`;
  return `Đến ${fmt(max!)} ${cur}`;
}
function formatLocation(loc: { city?: string; district?: string } | null, remote: boolean | null): string {
  const parts: string[] = [];
  if (loc?.city) parts.push(loc.city);
  if (remote) parts.push('Remote');
  return parts.join(' · ') || '—';
}

/* ============================================================================
 * Card visual helpers — tạo cảm giác "rich content" cho card
 * ==========================================================================*/

/** Lấy 1-2 chữ cái đầu của tên công ty làm avatar fallback. */
function companyInitial(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
  return name.charAt(0).toUpperCase();
}

/** Hash tên công ty → gradient color (8 màu tone hài hoà). */
function companyGradient(name: string | null | undefined): string {
  if (!name) return 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)';
  const palette: [string, string][] = [
    ['#10b981', '#059669'], // emerald
    ['#3b82f6', '#2563eb'], // blue
    ['#8b5cf6', '#7c3aed'], // violet
    ['#ec4899', '#db2777'], // pink
    ['#f59e0b', '#d97706'], // amber
    ['#06b6d4', '#0891b2'], // cyan
    ['#f43f5e', '#e11d48'], // rose
    ['#6366f1', '#4f46e5'], // indigo
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const [c1, c2] = palette[Math.abs(hash) % palette.length];
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

/** Màu dot cho status filter pill. */
function statusDotColor(status: JobStatusFilter): string {
  switch (status) {
    case 'all':         return 'bg-slate-400';
    case 'draft':       return 'bg-slate-400';
    case 'pending':     return 'bg-amber-500';
    case 'ai_scanning': return 'bg-indigo-500';
    case 'ai_flagged':  return 'bg-red-500';
    case 'live':        return 'bg-emerald-500';
    case 'expired':     return 'bg-slate-600';
    case 'closed':      return 'bg-gray-500';
  }
}

/* ============================================================================
 * Summary row — count từ `counts` (BE counts theo status + total applicants).
 * Tất cả đều là số TOÀN CỤC (không phụ thuộc filter / page hiện tại).
 * ==========================================================================*/
const summary = computed(() => ({
  total: counts.value?.total ?? 0,
  totalApplicants: counts.value?.totalApplicants ?? 0,
  draft: counts.value?.byStatus.draft ?? 0,
  pending: counts.value?.byStatus.pending ?? 0,
  ai_scanning: counts.value?.byStatus.ai_scanning ?? 0,
  ai_flagged: counts.value?.byStatus.ai_flagged ?? 0,
  live: counts.value?.byStatus.live ?? 0,
  expired: counts.value?.byStatus.expired ?? 0,
  closed: counts.value?.byStatus.closed ?? 0,
}));

/* ============================================================================
 * Status tabs — click để filter
 * ==========================================================================*/
const statusTabs: { value: JobStatusFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'draft', label: 'Bản nháp' },
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'ai_scanning', label: 'AI đang quét' },
  { value: 'ai_flagged', label: 'AI cảnh báo' },
  { value: 'live', label: 'Đang tuyển' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'closed', label: 'Đã đóng' },
];
const tabCount = (status: JobStatusFilter): number => {
  if (status === 'all') return summary.value.total;
  return summary.value[status as keyof typeof summary.value] as number || 0;
};

/* ============================================================================
 * Status change modal — admin change bất kỳ status nào
 * Mỗi option có icon Lucide để hiển thị trong action menu + quick switcher.
 * ==========================================================================*/
const STATUS_CHANGE_OPTIONS: { value: JobStatus; label: string; icon: Component }[] = [
  { value: 'draft', label: 'Bản nháp', icon: FileText },
  { value: 'pending', label: 'Chờ duyệt', icon: Clock },
  { value: 'ai_scanning', label: 'AI đang quét', icon: Loader2 },
  { value: 'ai_flagged', label: 'AI cảnh báo', icon: AlertTriangle },
  { value: 'live', label: 'Đang tuyển', icon: Play },
  { value: 'expired', label: 'Hết hạn', icon: XCircle },
  { value: 'closed', label: 'Đã đóng', icon: XSquare },
];
const pendingStatusChange = ref<{ jobId: string; current: JobStatus; next: JobStatus } | null>(null);
/** Loading flag cho ConfirmModal khi đang gọi API changeStatus — disable nút confirm
 *  + ESC + backdrop click để user không đóng giữa chừng. */
const statusChangeLoading = ref(false);
function askStatusChange(jobId: string, current: JobStatus, next: JobStatus): void {
  if (current === next) return;
  pendingStatusChange.value = { jobId, current, next };
}
async function confirmStatusChange(): Promise<void> {
  if (!pendingStatusChange.value || statusChangeLoading.value) return;
  statusChangeLoading.value = true;
  try {
    await store.changeStatus(pendingStatusChange.value.jobId, pendingStatusChange.value.next);
    // Chỉ đóng modal khi API + refetch đã xong (store đã toast success/error).
    pendingStatusChange.value = null;
  } finally {
    statusChangeLoading.value = false;
  }
}
function cancelStatusChange(): void {
  if (statusChangeLoading.value) return; // Không cho đóng khi đang loading
  pendingStatusChange.value = null;
}

/** Message cho confirm modal — bind qua computed để tránh narrowing null trong template. */
const statusChangeMessage = computed<string>(() => {
  const p = pendingStatusChange.value;
  if (!p) return '';
  const cur = STATUS_CHANGE_OPTIONS.find(o => o.value === p.current)?.label ?? p.current;
  const nxt = STATUS_CHANGE_OPTIONS.find(o => o.value === p.next)?.label ?? p.next;
  return `Chuyển trạng thái từ '${cur}' sang '${nxt}'?`;
});

/* ============================================================================
 * View detail modal
 * ==========================================================================*/
const viewJobId = ref<string | null>(null);
const viewJob = ref<JobDetail | null>(null);
const viewLoading = ref(false);
function openViewDetail(jobId: string): void {
  viewJobId.value = jobId;
  viewLoading.value = true;
  // Reset state khi mở
  viewJob.value = null;
  // Gọi API lấy detail — BE trả `{ success, data: JobDetail }` → unwrap 2 lần.
  // Check viewJobId trước khi set để tránh race: nếu user đóng modal A rồi mở
  // modal B trong khi fetch A chưa xong, .then() của A không ghi đè lên B.
  adminJobApi.detail(jobId)
    .then((res) => {
      if (viewJobId.value !== jobId) return;
      viewJob.value = res.data?.data ?? null;
    })
    .catch(() => {
      if (viewJobId.value !== jobId) return;
      toast.error('Không tải được chi tiết job');
    })
    .finally(() => {
      if (viewJobId.value === jobId) viewLoading.value = false;
    });
}
function closeViewDetail(): void { viewJobId.value = null; }

/* ============================================================================
 * Action menu items
 * ==========================================================================*/
function buildActions(j: typeof jobs.value[number]): ActionItem[] {
  const items: ActionItem[] = [];
  const current = STATUS_CHANGE_OPTIONS.find(o => o.value === j.status);

  // "Xem chi tiết" đã có button riêng ở card footer → không cần duplicate trong menu.

  // Section header: "Đổi trạng thái"
  items.push({ header: true, label: 'Đổi trạng thái' });

  // Trạng thái hiện tại — show với ✓ và disabled (không click)
  if (current) {
    items.push({
      label: current.label,
      icon: current.icon,
      active: true,
      disabled: true,
    });
  }

  // Các status khác — click để đổi
  for (const opt of STATUS_CHANGE_OPTIONS) {
    if (opt.value === j.status) continue;
    items.push({
      label: opt.label,
      icon: opt.icon,
      onClick: () => askStatusChange(j.id, j.status as JobStatus, opt.value),
      tone: opt.value === 'closed' || opt.value === 'ai_flagged' ? 'danger' : 'default',
    });
  }
  return items;
}

/**
 * Top 3 status changes thường dùng để hiển thị quick switcher trên card.
 * Skip status hiện tại. Tối đa 3 option để card gọn.
 */
const QUICK_STATUS_PRIORITY: JobStatus[] = ['live', 'closed', 'draft', 'pending', 'ai_flagged', 'expired', 'ai_scanning'];
function quickStatusOptions(current: JobStatus) {
  return QUICK_STATUS_PRIORITY
    .filter((s) => s !== current)
    .slice(0, 3)
    .map((s) => {
      const opt = STATUS_CHANGE_OPTIONS.find((o) => o.value === s)!;
      return {
        value: s,
        label: opt.label,
        icon: opt.icon,
        tone: (s === 'closed' || s === 'ai_flagged' ? 'danger' : 'default') as 'default' | 'danger',
      };
    });
}

const isEmpty = computed(() => !loading.value && paged.value.length === 0);
</script>

<template>
  <div class="min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:px-8" style="background-color: var(--admin-page-bg);">
    <div v-if="openDropdown" class="fixed inset-0 z-10" @click="closeDropdowns" />

    <div class="mx-auto max-w-7xl space-y-6">
      <!-- ===== 1. HERO HEADER ===== -->
      <div
        class="relative overflow-hidden rounded-2xl border p-6 sm:p-8"
        style="background: linear-gradient(135deg, #ecfdf5 0%, #ffffff 60%, #ffffff 100%); border-color: var(--admin-border-subtle); box-shadow: var(--admin-shadow-sm);"
      >
        <!-- Decorative gradient blob -->
        <div
          class="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full opacity-40"
          style="background: radial-gradient(circle, #10b981 0%, transparent 70%);"
        />

        <div class="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex items-start gap-4">
            <div
              class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-emerald-500/25"
              style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);"
            >
              <Briefcase class="h-7 w-7 text-white" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-2xl font-bold tracking-tight sm:text-3xl" style="color: var(--admin-text);">
                  Tất cả Job
                </h1>
                <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <Sparkles class="h-3 w-3" />
                  Job Hub
                </span>
              </div>
              <p class="mt-1 text-sm" style="color: var(--admin-text-muted);">
                Quản lý toàn bộ tin tuyển dụng — lọc, duyệt, cập nhật trạng thái.
              </p>
            </div>
          </div>

          <!-- Quick stats + actions -->
          <div class="flex flex-wrap items-center gap-3 sm:gap-6">
            <div class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold tabular-nums" style="color: var(--admin-text);">{{ summary.total }}</span>
              <span class="text-xs font-medium" style="color: var(--admin-text-muted);">Tổng</span>
            </div>
            <div class="hidden h-8 w-px bg-gray-200 sm:block" />
            <div class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold tabular-nums text-emerald-600">{{ summary.live }}</span>
              <span class="text-xs font-medium" style="color: var(--admin-text-muted);">Đang tuyển</span>
            </div>
            <div class="hidden h-8 w-px bg-gray-200 sm:block" />
            <div class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold tabular-nums" style="color: var(--admin-text);">{{ summary.totalApplicants }}</span>
              <span class="text-xs font-medium" style="color: var(--admin-text-muted);">Ứng viên</span>
            </div>
            <button
              type="button"
              class="ml-auto inline-flex items-center gap-1.5 self-start rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
              style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface); color: var(--admin-text);"
              :disabled="loading"
              @click="store.refetch()"
            >
              <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
              Làm mới
            </button>
          </div>
        </div>
      </div>

      <!-- ===== 2. STATUS FILTER PILLS ===== -->
      <div class="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div class="flex items-center gap-2 pb-1 min-w-max sm:flex-wrap sm:min-w-0 sm:pb-0">
          <button
            v-for="t in statusTabs"
            :key="t.value"
            type="button"
            class="group inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition"
            :class="filters.status === t.value
              ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
              : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50/50'"
            @click="selectStatus(t.value)"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="filters.status === t.value ? 'bg-white' : statusDotColor(t.value)"
            />
            <span>{{ t.label }}</span>
            <span
              class="rounded-md px-1.5 py-0.5 text-xs tabular-nums"
              :class="filters.status === t.value
                ? 'bg-white/20 text-white'
                : 'bg-gray-100 text-gray-600 group-hover:bg-emerald-100 group-hover:text-emerald-700'"
            >
              {{ tabCount(t.value) }}
            </span>
          </button>
        </div>
      </div>

      <!-- ===== 3. TOOLBAR ===== -->
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <!-- Search -->
          <div class="relative sm:max-w-xs sm:flex-1">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style="color: var(--admin-text-subtle);" />
            <input
              v-model="searchInput"
              type="search"
              placeholder="Tìm kiếm theo tiêu đề, công ty..."
              class="w-full rounded-full border py-2 pl-9 pr-3 text-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface); color: var(--admin-text);"
            />
          </div>
          <!-- Level filter -->
          <div class="relative">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition"
              :class="filters.jobLevel !== ''
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-gray-200 bg-white'"
              style="color: var(--admin-text);"
              @click="toggleDropdown('level')"
            >
              {{ currentLabel('level') }}
              <ChevronDown class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
            </button>
            <div
              v-if="openDropdown === 'level'"
              class="absolute left-0 z-20 mt-1 w-44 rounded-lg border py-1 shadow-lg"
              style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface);"
            >
              <button
                v-for="o in LEVEL_OPTIONS"
                :key="o.value"
                type="button"
                class="block w-full px-3 py-1.5 text-left text-sm transition hover:bg-emerald-50"
                :class="filters.jobLevel === o.value ? 'font-medium text-emerald-700' : 'text-gray-700'"
                @click="selectLevel(o.value)"
              >{{ o.label }}</button>
            </div>
          </div>
          <!-- Type filter -->
          <div class="relative">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition"
              :class="filters.jobType !== ''
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-gray-200 bg-white'"
              style="color: var(--admin-text);"
              @click="toggleDropdown('type')"
            >
              {{ currentLabel('type') }}
              <ChevronDown class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
            </button>
            <div
              v-if="openDropdown === 'type'"
              class="absolute left-0 z-20 mt-1 w-44 rounded-lg border py-1 shadow-lg"
              style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface);"
            >
              <button
                v-for="o in TYPE_OPTIONS"
                :key="o.value"
                type="button"
                class="block w-full px-3 py-1.5 text-left text-sm transition hover:bg-emerald-50"
                :class="filters.jobType === o.value ? 'font-medium text-emerald-700' : 'text-gray-700'"
                @click="selectType(o.value)"
              >{{ o.label }}</button>
            </div>
          </div>
          <!-- Sort -->
          <div class="relative">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm transition hover:border-emerald-300"
              style="color: var(--admin-text);"
              @click="toggleDropdown('sort')"
            >
              {{ currentLabel('sort') }}
              <ChevronDown class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
            </button>
            <div
              v-if="openDropdown === 'sort'"
              class="absolute right-0 z-20 mt-1 w-40 rounded-lg border py-1 shadow-lg"
              style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface);"
            >
              <button
                v-for="o in SORT_OPTIONS"
                :key="o.value"
                type="button"
                class="block w-full px-3 py-1.5 text-left text-sm transition hover:bg-emerald-50"
                :class="filters.sort === o.value ? 'font-medium text-emerald-700' : 'text-gray-700'"
                @click="selectSort(o.value)"
              >{{ o.label }}</button>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-emerald-700 transition-all duration-150 hover:bg-emerald-50"
          :class="hasActiveFilter()
            ? 'opacity-100 pointer-events-auto'
            : 'pointer-events-none opacity-0 select-none'"
          :aria-hidden="!hasActiveFilter()"
          :tabindex="hasActiveFilter() ? 0 : -1"
          @click="store.resetFilters()"
        >
          <X class="h-3 w-3" />
          Xoá bộ lọc
        </button>
      </div>

      <!-- ===== 4. JOB CARDS GRID ===== -->
      <!-- Loading skeleton (cards) -->
      <div
        v-if="loading && paged.length === 0"
        class="grid grid-cols-1 gap-4 xl:grid-cols-2"
      >
        <div
          v-for="i in 4"
          :key="i"
          class="rounded-2xl border bg-white p-5"
          style="border-color: var(--admin-border-subtle);"
        >
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div class="h-11 w-11 animate-pulse rounded-xl bg-gray-100" />
              <div class="space-y-2">
                <div class="h-3 w-24 animate-pulse rounded bg-gray-100" />
                <div class="h-2.5 w-16 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
            <div class="h-5 w-16 animate-pulse rounded-full bg-gray-100" />
          </div>
          <div class="mt-4 space-y-2">
            <div class="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
            <div class="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
          </div>
          <div class="mt-4 h-5 w-32 animate-pulse rounded bg-gray-100" />
          <div class="mt-3 flex gap-2">
            <div class="h-5 w-12 animate-pulse rounded bg-gray-100" />
            <div class="h-5 w-16 animate-pulse rounded bg-gray-100" />
            <div class="h-5 w-14 animate-pulse rounded bg-gray-100" />
          </div>
          <div class="mt-4 h-px w-full bg-gray-100" />
          <div class="mt-3 flex justify-between">
            <div class="h-4 w-24 animate-pulse rounded bg-gray-100" />
            <div class="h-4 w-20 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
      </div>

      <!-- Error -->
      <div
        v-else-if="error"
        class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-100 bg-red-50/50 px-6 py-16 text-center"
      >
        <p class="text-sm font-medium text-red-600">{{ error }}</p>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-full bg-red-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-red-700"
          @click="store.refetch()"
        >Thử lại</button>
      </div>

      <!-- Empty -->
      <div
        v-else-if="isEmpty"
        class="flex flex-col items-center justify-center gap-3 rounded-2xl border bg-white px-6 py-20 text-center"
        style="border-color: var(--admin-border-subtle); border-style: dashed;"
      >
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
          <Inbox class="h-7 w-7 text-emerald-500" />
        </div>
        <p class="text-base font-semibold" style="color: var(--admin-text);">Không tìm thấy Job nào</p>
        <p class="text-sm" style="color: var(--admin-text-muted);">Thử thay đổi bộ lọc hoặc từ khoá tìm kiếm.</p>
        <button
          type="button"
          class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition-all duration-150 hover:bg-emerald-100"
          :class="hasActiveFilter()
            ? 'opacity-100 pointer-events-auto'
            : 'pointer-events-none opacity-0 select-none'"
          :aria-hidden="!hasActiveFilter()"
          :tabindex="hasActiveFilter() ? 0 : -1"
          @click="store.resetFilters()"
        >
          <X class="h-3.5 w-3.5" />
          Xoá bộ lọc
        </button>
      </div>

      <!-- Cards grid -->
      <div v-else class="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article
          v-for="j in paged"
          :key="j.id"
          class="group relative overflow-hidden rounded-2xl border bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-500/5"
          style="border-color: var(--admin-border-subtle);"
        >
          <!-- Top: company avatar + meta + status + action -->
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <div
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm"
                :style="{ background: companyGradient(j.companyName) }"
              >
                {{ companyInitial(j.companyName) }}
              </div>
              <div class="min-w-0">
                <p class="flex items-center gap-1.5 truncate text-sm font-semibold" style="color: var(--admin-text);">
                  <Building2 class="h-3.5 w-3.5 shrink-0" style="color: var(--admin-text-subtle);" />
                  <span class="truncate">{{ j.companyName || '—' }}</span>
                </p>
                <p class="mt-0.5 flex items-center gap-1 text-[11px]" style="color: var(--admin-text-subtle);">
                  <TrendingUp class="h-3 w-3" />
                  Đăng {{ relativeTime(j.publishedAt || j.createdAt) }}
                </p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <JobStatusBadge :status="j.status" />
              <AdminActionMenu :actions="buildActions(j)" />
            </div>
          </div>

          <!-- Title -->
          <h3 class="mt-3.5 line-clamp-2 text-base font-bold leading-snug" style="color: var(--admin-text);">
            {{ j.title }}
          </h3>

          <!-- Salary highlight -->
          <div class="mt-3 inline-flex items-baseline gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1">
            <DollarSign class="h-3.5 w-3.5 text-emerald-600" />
            <span class="text-sm font-bold text-emerald-700">
              <span v-if="j.salaryVisible">{{ formatSalary(j.salaryMin, j.salaryMax, j.salaryCurrency) }}</span>
              <span v-else class="text-emerald-600/70">Thỏa thuận</span>
            </span>
          </div>

          <!-- Meta row -->
          <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" style="color: var(--admin-text-muted);">
            <div class="flex items-center gap-1">
              <MapPin class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
              <span>{{ formatLocation(j.location, j.remoteOk) }}</span>
            </div>
            <div v-if="j.jobType" class="flex items-center gap-1">
              <Briefcase class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
              <span>{{ JOB_TYPE_LABEL[j.jobType] }}</span>
            </div>
            <div v-if="j.jobLevel" class="flex items-center gap-1">
              <Award class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
              <span>{{ JOB_LEVEL_LABEL[j.jobLevel] }}</span>
            </div>
          </div>

          <!-- Quick status switcher — top 3 status changes ngay trên card -->
          <div class="mt-3 flex items-center gap-1.5">
            <span class="text-[10px] font-semibold uppercase tracking-wider" style="color: var(--admin-text-subtle);">
              Đổi sang:
            </span>
            <div class="flex flex-wrap items-center gap-1">
              <button
                v-for="opt in quickStatusOptions(j.status)"
                :key="opt.value"
                type="button"
                class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition"
                :class="opt.tone === 'danger'
                  ? 'border-gray-200 text-red-600 hover:border-red-300 hover:bg-red-50'
                  : 'border-gray-200 text-gray-600 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50/50'"
                :title="`Chuyển sang ${opt.label}`"
                @click="askStatusChange(j.id, j.status, opt.value)"
              >
                <component :is="opt.icon" class="h-3 w-3" />
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Footer: applicants/views + view detail -->
          <div class="mt-4 flex items-center justify-between border-t pt-3" style="border-color: var(--admin-border-subtle);">
            <div class="flex items-center gap-3 text-xs" style="color: var(--admin-text-muted);">
              <div class="flex items-center gap-1">
                <Users class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
                <span class="font-bold tabular-nums" style="color: var(--admin-text);">{{ j.appliesCount }}</span>
                <span>ứng tuyển</span>
              </div>
              <div class="flex items-center gap-1">
                <Eye class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
                <span class="font-bold tabular-nums" style="color: var(--admin-text);">{{ j.viewsCount }}</span>
                <span>xem</span>
              </div>
            </div>
            <button
              type="button"
              class="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-600 transition hover:gap-1 hover:text-emerald-700"
              @click="openViewDetail(j.id)"
            >
              Xem chi tiết
              <ChevronRight class="h-3.5 w-3.5" />
            </button>
          </div>
        </article>
      </div>

      <!-- ===== 5. PAGINATION ===== -->
      <div
        v-if="!loading && !error && total > 0"
        class="rounded-2xl border bg-white px-2 py-1"
        style="border-color: var(--admin-border-subtle);"
      >
        <AdminPagination
          :page="page"
          :page-size="pageSize"
          :total="total"
          @update:page="store.goToPage($event)"
        />
      </div>
    </div>

    <!-- ===== 6. STATUS CHANGE CONFIRM ===== -->
    <ConfirmModal
      :open="pendingStatusChange !== null"
      variant="danger"
      title="Đổi trạng thái Job"
      :message="statusChangeMessage"
      confirm-text="Đổi trạng thái"
      cancel-text="Huỷ"
      :loading="statusChangeLoading"
      :dismissible="!statusChangeLoading"
      @update:open="(v) => { if (!v) cancelStatusChange() }"
      @confirm="confirmStatusChange"
    />

    <!-- ===== 7. VIEW DETAIL MODAL ===== -->
    <AdminModal
      :open="viewJobId !== null"
      :title="viewJob?.title || 'Chi tiết Job'"
      size="lg"
      @update:open="(v) => { if (!v) closeViewDetail() }"
    >
      <div v-if="viewLoading" class="flex items-center justify-center gap-2 py-8" style="color: var(--admin-text-muted);">
        <Loader2 class="h-4 w-4 animate-spin" />
        <span class="text-sm">Đang tải...</span>
      </div>
      <div v-else-if="viewJob" class="space-y-4 text-sm">
        <div class="grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--admin-text-muted);">Công ty</p>
            <p class="mt-1" style="color: var(--admin-text);">{{ viewJob.companyName || '—' }}</p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--admin-text-muted);">Trạng thái</p>
            <p class="mt-1"><JobStatusBadge :status="viewJob.status" /></p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--admin-text-muted);">Loại hình</p>
            <p class="mt-1" style="color: var(--admin-text);">
              {{ viewJob.jobType ? JOB_TYPE_LABEL[viewJob.jobType] : '—' }} /
              {{ viewJob.jobLevel ? JOB_LEVEL_LABEL[viewJob.jobLevel] : '—' }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--admin-text-muted);">Địa điểm</p>
            <p class="mt-1" style="color: var(--admin-text);">{{ formatLocation(viewJob.location, viewJob.remoteOk) }}</p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--admin-text-muted);">Lương</p>
            <p class="mt-1" style="color: var(--admin-text);">
              {{ viewJob.salaryVisible ? formatSalary(viewJob.salaryMin, viewJob.salaryMax, viewJob.salaryCurrency) : 'Thỏa thuận' }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--admin-text-muted);">Hạn nộp</p>
            <p class="mt-1 tabular-nums" style="color: var(--admin-text);">{{ formatDate(viewJob.deadline) }}</p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--admin-text-muted);">Lượt xem / Ứng tuyển</p>
            <p class="mt-1 tabular-nums" style="color: var(--admin-text);">
              {{ viewJob.viewsCount }} / {{ viewJob.appliesCount }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--admin-text-muted);">Ngày đăng</p>
            <p class="mt-1 tabular-nums" style="color: var(--admin-text);">{{ formatDate(viewJob.publishedAt || viewJob.createdAt) }}</p>
          </div>
        </div>
        <div v-if="viewJob.description" class="border-t pt-3" style="border-color: var(--admin-border-subtle);">
          <p class="text-xs font-semibold uppercase tracking-wider mb-1" style="color: var(--admin-text-muted);">Mô tả</p>
          <p class="whitespace-pre-wrap text-sm" style="color: var(--admin-text);">{{ viewJob.description }}</p>
        </div>
        <div v-if="viewJob.requirements" class="border-t pt-3" style="border-color: var(--admin-border-subtle);">
          <p class="text-xs font-semibold uppercase tracking-wider mb-1" style="color: var(--admin-text-muted);">Yêu cầu</p>
          <p class="whitespace-pre-wrap text-sm" style="color: var(--admin-text);">{{ viewJob.requirements }}</p>
        </div>
        <div v-if="viewJob.benefits" class="border-t pt-3" style="border-color: var(--admin-border-subtle);">
          <p class="text-xs font-semibold uppercase tracking-wider mb-1" style="color: var(--admin-text-muted);">Quyền lợi</p>
          <p class="whitespace-pre-wrap text-sm" style="color: var(--admin-text);">{{ viewJob.benefits }}</p>
        </div>
      </div>
    </AdminModal>
  </div>
</template>
