<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  Inbox,
} from 'lucide-vue-next';
import { applicationApi } from '@services/application.api';
import { companyApi } from '@services/company.api';
import { jobApi, type JobNameItem } from '@services/job.api';
import { getSocket } from '@services/socket';
import { useToastStore } from '@stores/toast';
import ApplicationDetailPanel from '@components/employer/ApplicationDetailPanel.vue';
import { formatDate } from '@/utils/format';
import type {
  ApplicationItem,
  ApplicationStatus,
  EmployerApplicationRow,
} from '@/types/application';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';

dayjs.locale('vi');

export type Application = ApplicationItem;
const EMPTY_APPLICATION: Application = {
  name: '',
  avatarUrl: null,
  email: '',
  position: '',
  status: 'pending',
  match: null,
  date: '',
  applicationId: '',
};

const avatarInitial = (name: string): string => {
  const t = name.trim();
  return t ? t.charAt(0).toLocaleUpperCase('vi-VN') : '?';
};


/**
 * Format ISO date → "HH:mm" (vd "14:30") — compact cho list row.
 * Hover để xem ngày đầy đủ qua `title="formatDate(...)"`.
 */
const formatTime = (iso: string): string => {
  const d = dayjs(iso);
  return d.isValid() ? d.format('HH:mm') : iso;
};

const applications = ref<Application[]>([]);
const toast = useToastStore();

/**
 * Vai trò của user trong công ty ('owner' | 'member' | null).
 * Được lấy từ `companyApi.getMyCompany()`.
 */
const userRole = ref<'owner' | 'member' | null>(null);

/**
 * Tab phạm vi đơn ứng tuyển:
 * - 'company': Tất cả đơn ứng tuyển của công ty (chỉ Owner có quyền chọn)
 * - 'me': Chỉ các đơn thuộc tin tuyển dụng do user tạo hoặc phụ trách
 * Mặc định 'company' cho Owner; Member không có tab và luôn cố định 'me'.
 */
const activeScopeTab = ref<'company' | 'me'>('company');

const currentEffectiveScope = computed<'company' | 'me'>(() => {
  if (userRole.value === 'member') return 'me';
  return activeScopeTab.value;
});

// ---------------------------------------------------------------------------
// Job filter dropdown — list job (id + title) từ GET /jobs/names, mặc định
// "Tất cả" (value ''). Chọn job → fetchPage(1) truyền ?jobId= cho BE filter.
// ---------------------------------------------------------------------------
const jobOptions = ref<JobNameItem[]>([]);
const selectedJobId = ref('');
// Combobox: 1 input duy nhất vừa hiển thị lựa chọn vừa gõ để filter.
// jobKeyword = text trong input; khi chọn job → set = title (input "hiện"
// lựa chọn), chọn "Tất cả" → reset ''. Filter options làm CLIENT-SIDE
// (list job 1 company nhỏ, load 1 lần — không gọi API mỗi keystroke).
const jobKeyword = ref('');
const jobSelectOpen = ref(false);
const jobSelectRoot = ref<HTMLElement | null>(null);

const loadJobNames = async (): Promise<void> => {
  try {
    const { data } = await jobApi.listNames({ scope: currentEffectiveScope.value });
    jobOptions.value = data.data;
  } catch {
    // Dropdown trống — không chặn trang; "Tất cả" vẫn hoạt động.
  }
};

const switchScopeTab = (scope: 'company' | 'me'): void => {
  if (activeScopeTab.value === scope) return;
  activeScopeTab.value = scope;
  // Reset filter job khi đổi tab
  selectedJobId.value = '';
  jobKeyword.value = '';
  void loadJobNames();
  void fetchPage(1);
};

const filteredJobOptions = computed(() => {
  const kw = jobKeyword.value.trim().toLowerCase();
  if (!kw) return jobOptions.value;
  return jobOptions.value.filter((j) => j.title.toLowerCase().includes(kw));
});

// ---------------------------------------------------------------------------
// Sort cột "Phù hợp" — click header cycle: none → desc (cao→thấp) → asc →
// none. Rows match=null (chưa chấm) LUÔN nằm cuối bất kể chiều sort.
// Client-side sort trên page hiện tại (BE listByCompany sort appliedAt DESC
// mặc định — 'none' trả về thứ tự gốc).
// ---------------------------------------------------------------------------
type MatchSort = 'none' | 'desc' | 'asc';
const matchSort = ref<MatchSort>('none');

const toggleMatchSort = (): void => {
  matchSort.value = matchSort.value === 'none' ? 'desc' : matchSort.value === 'desc' ? 'asc' : 'none';
};

const displayedApplications = computed(() => {
  if (matchSort.value === 'none') return applications.value;
  const dir = matchSort.value === 'desc' ? -1 : 1;
  return [...applications.value].sort((a, b) => {
    if (a.match === null && b.match === null) return 0;
    if (a.match === null) return 1;  // null luôn cuối
    if (b.match === null) return -1;
    return (a.match - b.match) * dir;
  });
});

const pickJob = (id: string): void => {
  selectedJobId.value = id;
  const job = jobOptions.value.find((j) => j.id === id);
  jobKeyword.value = job?.title ?? '';
  jobSelectOpen.value = false;
  void fetchPage(1);
};

// ---------------------------------------------------------------------------
// Status filter — dropdown lọc đơn theo trạng thái gốc (8 enum values +
// "Tất cả"). BE listByCompany hỗ trợ sẵn ?status= (zod enum), FE chỉ truyền.
// ---------------------------------------------------------------------------
const STATUS_FILTER_OPTIONS: Array<{ value: ApplicationStatus | ''; label: string }> = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'pending', label: 'Chờ xử lý' },
  { value: 'viewed', label: 'Đã xem' },
  { value: 'screening', label: 'Sàng lọc' },
  { value: 'interview', label: 'Phỏng vấn' },
  { value: 'offered', label: 'Đã offer' },
  { value: 'hired', label: 'Đã tuyển' },
  { value: 'rejected', label: 'Đã từ chối' },
  { value: 'withdrawn', label: 'Đã rút đơn' },
];
const selectedStatus = ref<ApplicationStatus | ''>('');
const statusSelectOpen = ref(false);
const statusSelectRoot = ref<HTMLElement | null>(null);

/** Label hiển thị trên trigger — theo option đang chọn. */
const statusFilterLabel = computed(
  () => STATUS_FILTER_OPTIONS.find((o) => o.value === selectedStatus.value)?.label ?? 'Tất cả trạng thái',
);

const pickStatus = (value: ApplicationStatus | ''): void => {
  selectedStatus.value = value;
  statusSelectOpen.value = false;
  void fetchPage(1);
};

/**
 * Bấm icon chevron → đóng/mở dropdown. SVG không focus được như input
 * nên phải tự quản lý: mở thì focus input luôn (để gõ được tiếp),
 * đang mở thì thu lại.
 */
const jobSelectInput = ref<HTMLInputElement | null>(null);
const toggleJobSelect = (): void => {
  if (jobSelectOpen.value) {
    jobSelectOpen.value = false;
  } else {
    jobSelectOpen.value = true;
    jobSelectInput.value?.focus();
  }
};

/** Click ngoài combobox → đóng cả 2 dropdown (job + status). */
const onDocClick = (e: MouseEvent): void => {
  const target = e.target as Node;
  if (jobSelectRoot.value && !jobSelectRoot.value.contains(target)) {
    jobSelectOpen.value = false;
  }
  if (statusSelectRoot.value && !statusSelectRoot.value.contains(target)) {
    statusSelectOpen.value = false;
  }
};

// ---------------------------------------------------------------------------
// Retry AI match — icon bên phải khối Match Score. Gọi POST /:id/recompute-match
// (BE reset score + enqueue lại cv-match, TRỪ quota candidate). Điểm hiển thị
// reset về null ("Chưa có điểm") ngay; kết quả mới về qua socket
// 'application:scored' → onApplicationScored tự cập nhật ring + list + detail.
// ---------------------------------------------------------------------------
const scoringApplicationId = ref<string | null>(null);
const isScoringSelected = computed(
  () => !!scoringApplicationId.value && selectedApplication.value?.applicationId === scoringApplicationId.value,
);

const fromApi = ref(false);

const page = ref(1);
const limit = ref(7);
const total = ref(0);
const loading = ref(false);

const selectedApplication = ref<Application | null>(null);

const isSelected = (a: Application): boolean =>
  selectedApplication.value?.applicationId === a.applicationId;

const selectApplication = (a: Application): void => {
  if (selectedApplication.value?.applicationId === a.applicationId) {
    selectedApplication.value = null;
  } else {
    selectedApplication.value = a;
  }
};

const onDetailStatusChanged = (payload: {
  applicationId: string;
  status: ApplicationStatus;
  stage?: string | null;
}): void => {
  const row = applications.value.find((a) => a.applicationId === payload.applicationId);
  if (row) {
    row.status = payload.status;
  }
  if (selectedApplication.value?.applicationId === payload.applicationId) {
    selectedApplication.value.status = payload.status;
  }
};

const onDetailRecomputeMatch = (appId: string): void => {
  const row = applications.value.find((a) => a.applicationId === appId);
  if (row) row.match = null;
  if (selectedApplication.value?.applicationId === appId) {
    selectedApplication.value.match = null;
  }
  scoringApplicationId.value = appId;
};

/** Styling chip theo status gốc — STATUS_CHIP (xem block status display). */

/**
 * Stage tiếng Việt — ĐÃ BỎ (trước đây map 8 status về 4 stage mockup làm
 * offered/hired hiện "Phỏng vấn" sai). Giờ hiển thị thẳng theo status gốc
 * qua STATUS_LABEL / STATUS_CHIP (xem block status filter + display).
 */

/**
 * Cắt chuỗi dài về `max` ký tự + thêm "..." — dùng cho Application row name và
 * Job title trong list (column hẹp, không đủ chỗ cho tên dài từ API).
 */
const truncate = (s: string | null | undefined, max = 20): string => {
  const v = (s ?? '').trim();
  return v.length > max ? `${v.slice(0, max)}…` : v;
};

/** Map 1 row `EmployerApplicationRow` → `Application` UI shape. Field nào
 *  null → dùng giá trị mặc định hợp lý (placeholder string / 0 / rỗng). */
const mapRow = (row: EmployerApplicationRow, fallbackIdx: number): Application => {
  const matchNum = row.aiMatchScore != null ? Math.round(Number(row.aiMatchScore)) : null;
  return {
    name: row.candidateName ?? `Ứng viên #${fallbackIdx + 1}`,
    avatarUrl: row.candidateAvatarUrl ?? null,
    email: row.candidateEmail ?? (row.isAnonymous ? '(ẩn danh)' : ''),
    position: row.jobTitle ?? '',
    status: row.status,
    match: matchNum !== null && Number.isFinite(matchNum) ? matchNum : null,
    // Giữ ISO gốc để `formatTime` (HH:mm trong list) + `formatDate`
    // (D Thg M tooltip) đều parse được dayjs. Format trước đây 'MMM D, YYYY'
    // không có giờ → HH:mm trả rỗng.
    date: dayjs(row.appliedAt).isValid() ? row.appliedAt : '',
    applicationId: row.id,
  };
};

/**
 * Fetch 1 page từ API. `pageNum` optional — nếu không truyền thì giữ nguyên
 * `page.value` hiện tại. Update cả `applications` + `total` từ response để
 * pagination hiển thị đúng số.
 */
const fetchPage = async (pageNum?: number): Promise<void> => {
  if (typeof pageNum === 'number') page.value = pageNum;
  loading.value = true;
  try {
    const { data } = await applicationApi.listByCompany({
      page: page.value,
      limit: limit.value,
      // Phạm vi đơn: 'company' (toàn công ty) hoặc 'me' (tin của tôi)
      scope: currentEffectiveScope.value,
      // Filter theo job đang chọn trong dropdown ('' = tất cả → undefined).
      jobId: selectedJobId.value || undefined,
      // Filter theo trạng thái đơn ('' = tất cả → undefined).
      status: selectedStatus.value || undefined,
    });
    const rows = data.data?.rows ?? [];
    applications.value = rows.map((r, i) => mapRow(r, i));
    total.value = data.data?.total ?? rows.length;
    // Cập nhật page/limit echo từ response (BE có thể clamp nếu vượt max).
    if (typeof data.data?.page === 'number') page.value = data.data.page;
    if (typeof data.data?.limit === 'number') limit.value = data.data.limit;
    if (selectedApplication.value) {
      const updated = applications.value.find(
        (a) => a.applicationId === selectedApplication.value?.applicationId,
      );
      if (updated) {
        selectedApplication.value = updated;
      }
    }
    fromApi.value = true;
  } catch {
    // Network / 401 / 500 → reset list rỗng + total = 0 để pagination
    // collapse về 1 page thay vì "of 455".
    applications.value = [];
    total.value = 0;
    fromApi.value = false;
    selectedApplication.value = null;
  } finally {
    loading.value = false;
  }
};

// ---------------------------------------------------------------------------
// Realtime: candidate apply mới → backend emit 'application:new' cho employer.
// Đang ở page 1 → refetch ngay để row mới xuất hiện tức thời. Đang ở page
// khác → chỉ toast (không giật user về page 1 vô điều kiện).
// ---------------------------------------------------------------------------
const onApplicationNew = (): void => {
  if (page.value === 1) {
    void fetchPage(1);
    toast.push({
      variant: 'info',
      title: 'Có đơn ứng tuyển mới',
      body: 'Danh sách đã được cập nhật.',
    });
  } else {
    toast.push({
      variant: 'info',
      title: 'Có đơn ứng tuyển mới',
      body: 'Quay về trang 1 để xem.',
    });
  }
};

// ---------------------------------------------------------------------------
// Realtime: cvMatch worker chấm xong → backend emit 'application:scored' cho
// employer. Cập nhật điểm TẠI CHỖ (không refetch): row trong list +
// update selectedApplication nếu đúng application đang chọn.
// ---------------------------------------------------------------------------
const onApplicationScored = (payload: {
  applicationId?: string;
  matchPercent?: number;
}): void => {
  if (!payload?.applicationId || typeof payload.matchPercent !== 'number') return;
  if (scoringApplicationId.value === payload.applicationId) {
    scoringApplicationId.value = null;
  }
  const row = applications.value.find((a) => a.applicationId === payload.applicationId);
  if (!row) return;
  row.match = Math.round(payload.matchPercent);
  const appId = row.applicationId;
  if (appId) {
    animatedMatches.value = { ...animatedMatches.value, [appId]: row.match };
  }
  if (appId && selectedApplication.value?.applicationId === appId) {
    selectedApplication.value.match = row.match;
  }
};

// Trạng thái/Stage thay đổi từ server (AI auto-advance / auto-reject / reference check / giao test)
// → patch list row + selected.
const onStatusChanged = (payload: {
  applicationId?: string;
  status?: ApplicationStatus;
  stage?: string | null;
}): void => {
  if (!payload?.applicationId) return;
  const row = applications.value.find((a) => a.applicationId === payload.applicationId);
  if (row && payload.status) {
    row.status = payload.status;
  }
  if (payload.applicationId !== selectedApplication.value?.applicationId) return;
  if (payload.status) {
    selectedApplication.value.status = payload.status;
  }
};

onMounted(async () => {
  try {
    const { data } = await companyApi.getMyCompany();
    if (data.data?.role) {
      userRole.value = data.data.role;
      if (userRole.value === 'member') {
        activeScopeTab.value = 'me';
      }
    }
  } catch {
    // best-effort
  }

  void fetchPage(1);
  void loadJobNames();
  document.addEventListener('mousedown', onDocClick, true);
  getSocket().on('application:new', onApplicationNew);
  getSocket().on('application:scored', onApplicationScored);
  getSocket().on('application:status-changed', onStatusChanged);
});

/**
 * Compute tổng số page + window page numbers để render pagination UI.
 * - totalPages = ceil(total / limit); nếu total=0 → 1 (chỉ render 1 page trống).
 * - paginationPages: nếu totalPages ≤ 7 → render [1..totalPages].
 *   Ngược lại: luôn show 1 + last + window ±1 quanh current, dùng '…' che gap.
 */
const totalPages = computed(() =>
  total.value === 0 ? 1 : Math.max(1, Math.ceil(total.value / limit.value)),
);

const paginationPages = computed<(number | '…')[]>(() => {
  const total_ = totalPages.value;
  const current = page.value;
  if (total_ <= 7) return Array.from({ length: total_ }, (_, i) => i + 1);
  const pages: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total_ - 1, current + 1);
  if (start > 2) pages.push('…');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total_ - 1) pages.push('…');
  pages.push(total_);
  return pages;
});

const goToPage = (n: number): void => {
  if (n < 1 || n > totalPages.value || n === page.value) return;
  void fetchPage(n);
};

// ---------------------------------------------------------------------------
// Label + màu chip theo STATUS GỐC (8 giá trị enum) — dùng cho table rows.
// ---------------------------------------------------------------------------
const STATUS_LABEL: Record<ApplicationStatus, string> = Object.fromEntries(
  STATUS_FILTER_OPTIONS.filter((o) => o.value).map((o) => [o.value as ApplicationStatus, o.label]),
) as Record<ApplicationStatus, string>;

const STATUS_CHIP: Record<ApplicationStatus, { bg: string; text: string }> = {
  pending: { bg: 'bg-[#eef0f2]', text: 'text-[#64748b]' },
  viewed: { bg: 'bg-[#eaf2ff]', text: 'text-[#1769e8]' },
  screening: { bg: 'bg-[#fff1e7]', text: 'text-[#f97316]' },
  interview: { bg: 'bg-[#eaf2ff]', text: 'text-[#1769e8]' },
  offered: { bg: 'bg-[#f7e9ff]', text: 'text-[#b24be7]' },
  hired: { bg: 'bg-[#e7f8f0]', text: 'text-[#0d9463]' },
  rejected: { bg: 'bg-[#fdecec]', text: 'text-[#e11d48]' },
  withdrawn: { bg: 'bg-[#f1f5f9]', text: 'text-[#64748b]' },
};

/* ============================================================================
 * Match level — phân cấp mức độ phù hợp để đổi màu progress bar (list).
 * ==========================================================================*/
type MatchLevel = 'high' | 'mid' | 'low';

const MATCH_LEVEL_STYLE: Record<
  MatchLevel,
  { bar: string; ring: string; text: string; label: string }
> = {
  high: { bar: 'bg-emerald-500', ring: '#10b981', text: 'text-emerald-700', label: 'Phù hợp cao' },
  mid:  { bar: 'bg-amber-500',   ring: '#f59e0b', text: 'text-amber-700',   label: 'Trung bình' },
  low:  { bar: 'bg-rose-500',    ring: '#f43f5e', text: 'text-rose-700',    label: 'Thấp' },
};

const matchLevelOf = (m: number): MatchLevel =>
  m >= 80 ? 'high' : m >= 50 ? 'mid' : 'low';

/**
 * Per-row animated match % cho list — key theo applicationId để mỗi row
 * có giá trị đếm riêng. Khi `applications` thay đổi (fetch page mới) → reset
 * tất cả về 0 rồi chạy rAF tween lên target, kết hợp với `transition-all`
 * ở CSS để progress bar fill mượt song song với số nhảy.
 */
const animatedMatches = ref<Record<string, number>>({});
let rowRaf: number | null = null;

const animateRows = (list: Application[]): void => {
  if (rowRaf !== null) cancelAnimationFrame(rowRaf);
  const ids = list.map((a) => a.applicationId ?? a.email);
  const targets = new Map(ids.map((id, i) => [id, list[i]!.match ?? 0]));
  const reset: Record<string, number> = {};
  ids.forEach((id) => (reset[id] = 0));
  animatedMatches.value = reset;

  const start = performance.now();
  const duration = 1200;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const next: Record<string, number> = {};
    for (const id of ids) next[id] = Math.round((targets.get(id) ?? 0) * eased);
    animatedMatches.value = next;
    if (t < 1) {
      rowRaf = requestAnimationFrame(step);
    } else {
      rowRaf = null;
    }
  };
  rowRaf = requestAnimationFrame(step);
};

watch(
  () => applications.value,
  (list) => animateRows(list),
  { immediate: true },
);

onUnmounted(() => {
  if (rowRaf !== null) cancelAnimationFrame(rowRaf);
  document.removeEventListener('mousedown', onDocClick, true);
  getSocket().off('application:new', onApplicationNew);
  getSocket().off('application:scored', onApplicationScored);
  getSocket().off('application:status-changed', onStatusChanged);
});
</script>

<template>
  <div class="bg-[#f7f9fc] font-poppins text-[#17233c]">
    <div
      class="flex flex-col lg:flex-row lg:h-screen lg:overflow-hidden bg-white shadow-[0_10px_40px_rgba(31,52,85,.08)]"
    >
      <!-- ============ Main: list ============ -->
      <main class="min-w-0 flex-1 p-4 sm:p-5 lg:p-6 overflow-y-auto lg:overflow-y-hidden scrollbar-thin main-list-area">
        <div class="mb-5 flex flex-col gap-3">
          <div>
            <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Danh sách ứng tuyển</h1>
            <p class="text-[12px] text-[#8190a5]">Quản lý các đơn ứng tuyển và duy trì quy trình tuyển dụng của bạn.</p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <!-- 2 Tabs chỉ hiển thị khi Owner đăng nhập: 'Của công ty' và 'Của tôi' (style đơn giản như MyResumesView) -->
            <div
              v-if="userRole === 'owner'"
              class="flex h-7 overflow-hidden rounded-md border border-[#e3e8ef]"
            >
              <button
                type="button"
                class="flex h-full items-center px-2.5 text-[12px] font-medium transition-colors"
                :class="activeScopeTab === 'company'
                  ? 'bg-[#1769e8] text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'"
                :aria-pressed="activeScopeTab === 'company'"
                @click="switchScopeTab('company')"
              >
                Của công ty
              </button>
              <button
                type="button"
                class="flex h-full items-center px-2.5 text-[12px] font-medium transition-colors border-l border-[#e3e8ef]"
                :class="activeScopeTab === 'me'
                  ? 'bg-[#1769e8] text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'"
                :aria-pressed="activeScopeTab === 'me'"
                @click="switchScopeTab('me')"
              >
                Của tôi
              </button>
            </div>

            <!-- Combobox chọn job — gõ thẳng trong ô để filter options
                 (client-side), click option → filter list ứng tuyển. -->
            <div ref="jobSelectRoot" class="relative w-full sm:w-[260px]">
              <div
                class="flex h-7 items-center gap-1.5 rounded-md border border-[#e3e8ef] bg-white px-2.5 text-[12px]"
              >
                <input
                  ref="jobSelectInput"
                  v-model="jobKeyword"
                  type="text"
                  placeholder="Tất cả — gõ để tìm job"
                  maxlength="100"
                  class="w-full cursor-pointer bg-transparent text-[#334155] placeholder-[#a0acbc] outline-none border-none outline-0 text-[12px] focus:ring-0"
                  aria-label="Lọc theo công việc"
                  @focus="jobSelectOpen = true"
                  @input="jobSelectOpen = true"
                  @keydown.esc="jobSelectOpen = false"
                />
                <ChevronDown
                  class="h-3.5 w-3.5 shrink-0 cursor-pointer text-[#a0acbc] transition hover:text-[#334155]"
                  :class="jobSelectOpen ? 'rotate-180' : ''"
                  @click="toggleJobSelect"
                />
              </div>
              <div
                v-if="jobSelectOpen"
                class="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto scrollbar-thin rounded-lg border border-[#e3e8ef] bg-white py-1 shadow-lg"
              >
                <button
                  type="button"
                  class="block w-full px-3 py-2 text-left text-[12px] transition hover:bg-[#eef5ff]"
                  :class="selectedJobId === '' ? 'font-semibold text-[#1769e8]' : 'text-[#334155]'"
                  @click="pickJob('')"
                >
                  Tất cả
                </button>
                <button
                  v-for="j in filteredJobOptions"
                  :key="j.id"
                  type="button"
                  class="block w-full truncate px-3 py-2 text-left text-[12px] transition hover:bg-[#eef5ff]"
                  :class="selectedJobId === j.id ? 'font-semibold text-[#1769e8]' : 'text-[#334155]'"
                  :title="j.title"
                  @click="pickJob(j.id)"
                >
                  {{ j.title }}
                </button>
                <div v-if="filteredJobOptions.length === 0" class="px-3 py-2 text-[12px] italic text-[#94a3b8]">
                  Không có job nào khớp
                </div>
              </div>
            </div>

            <!-- Dropdown lọc theo trạng thái đơn — div custom (không dùng
                 <select>) để style đồng bộ với combobox job. Chọn → refetch
                 với ?status=. -->
            <div ref="statusSelectRoot" class="relative w-full sm:w-[175px]">
              <button
                type="button"
                class="flex h-7 w-full items-center gap-1.5 rounded-md border border-[#e3e8ef] bg-white px-2.5 text-[12px] transition hover:border-[#c7d2e0]"
                aria-label="Lọc theo trạng thái"
                @click="statusSelectOpen = !statusSelectOpen"
              >
                <span class="w-full truncate text-left text-[#334155]">{{ statusFilterLabel }}</span>
                <ChevronDown
                  class="h-3.5 w-3.5 shrink-0 text-[#a0acbc] transition"
                  :class="statusSelectOpen ? 'rotate-180' : ''"
                />
              </button>
              <div
                v-if="statusSelectOpen"
                class="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto scrollbar-thin rounded-lg border border-[#e3e8ef] bg-white py-1 shadow-lg"
              >
                <button
                  v-for="opt in STATUS_FILTER_OPTIONS"
                  :key="opt.label"
                  type="button"
                  class="block w-full px-3 py-2 text-left text-[12px] transition hover:bg-[#eef5ff]"
                  :class="selectedStatus === opt.value ? 'font-semibold text-[#1769e8]' : 'text-[#334155]'"
                  @click="pickStatus(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <section class="overflow-hidden rounded-xl border border-[#e7ebf1] bg-white">
          <div class="px-2 pb-2 pt-2">
            <h2 class="text-[15px] font-semibold">
              {{ currentEffectiveScope === 'me' ? 'Đơn ứng tuyển của tôi' : 'Tất cả các đơn ứng tuyển của công ty' }}
            </h2>
          </div>

          <!-- Column headers -->
          <div
            class="grid grid-cols-[1.5fr_1.2fr_0.7fr_0.7fr] sm:grid-cols-[1.7fr_1.7fr_1fr_1fr_0.7fr] items-center border-y border-[#eef1f5] px-4 py-3 text-[12px] font-medium text-[#7c889a]"
          >
            <div>Ứng viên</div>
            <div>Việc làm</div>
            <div>Giai đoạn</div>
            <div>
              <button
                type="button"
                class="inline-flex items-center gap-1 transition hover:text-[#334155]"
                title="Sắp xếp theo điểm phù hợp"
                @click="toggleMatchSort"
              >
                Phù hợp
                <ArrowUpDown v-if="matchSort === 'none'" class="h-3 w-3" />
                <ArrowDown v-else-if="matchSort === 'desc'" class="h-3 w-3 text-[#1769e8]" />
                <ArrowUp v-else class="h-3 w-3 text-[#1769e8]" />
              </button>
            </div>
            <div class="hidden sm:block">Thời gian</div>
          </div>

          <!-- Rows Container -->
          <div class="divide-y divide-[#eef1f5]">
            <!-- Skeleton Loading (limit = 7 rows) matching table grid -->
            <template v-if="loading">
              <div
                v-for="n in (limit || 7)"
                :key="'skel-' + n"
                class="grid grid-cols-[1.5fr_1.2fr_0.7fr_0.7fr] sm:grid-cols-[1.7fr_1.7fr_1fr_1fr_0.7fr] items-center px-4 py-3 animate-pulse"
              >
                <!-- Application / Candidate skeleton -->
                <div class="flex min-w-0 items-center gap-2">
                  <div class="h-8 w-8 shrink-0 rounded-lg bg-gray-200/80" />
                  <div class="min-w-0 flex-1 space-y-1.5">
                    <div class="h-3.5 bg-gray-200/80 rounded w-28" />
                    <div class="hidden sm:block h-2.5 bg-gray-200/50 rounded w-36" />
                  </div>
                </div>

                <!-- Position skeleton -->
                <div class="flex min-w-0 items-center pr-2">
                  <div class="h-3 bg-gray-200/70 rounded w-32" />
                </div>

                <!-- Stage skeleton -->
                <div>
                  <div class="h-5 w-16 bg-gray-200/70 rounded-md" />
                </div>

                <!-- Match Score skeleton -->
                <div class="space-y-1.5">
                  <div class="h-3 bg-gray-200/70 rounded w-10" />
                  <div class="h-1.5 w-[60px] sm:w-[85px] bg-gray-200/50 rounded-full" />
                </div>

                <!-- Applied Time skeleton -->
                <div class="hidden sm:block">
                  <div class="h-3 bg-gray-200/70 rounded w-14" />
                </div>
              </div>
            </template>

            <!-- Actual Applications (Staggered Animation) -->
            <template v-else-if="displayedApplications.length > 0">
              <div
                v-for="(a, i) in displayedApplications"
                :key="`${a.email}-${i}`"
                class="relative grid grid-cols-[1.5fr_1.2fr_0.7fr_0.7fr] sm:grid-cols-[1.7fr_1.7fr_1fr_1fr_0.7fr] items-center px-4 py-2.5 text-[13px] cursor-pointer transition-all duration-200 nt-row"
                :style="{ animationDelay: `${Math.min(300, i * 40)}ms` }"
                :class="isSelected(a) ? 'bg-[#edf4ff] font-medium' : 'bg-white hover:bg-gray-50'"
                @click="selectApplication(a)"
              >
                <!-- Active bar when selected -->
                <div
                  v-if="isSelected(a)"
                  class="absolute left-0 top-0 bottom-0 w-1 bg-[#1769e8]"
                />
                <!-- Application -->
                <div class="flex min-w-0 items-center gap-2">
                  <div
                    class="relative h-8 w-8 shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-primary-50 to-primary-100 ring-1 ring-black/5"
                    :aria-label="a.name"
                  >
                    <img
                      v-if="a.avatarUrl"
                      :src="a.avatarUrl"
                      :alt="a.name"
                      class="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                      @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                    />
                    <span
                      v-else
                      class="absolute inset-0 grid place-items-center text-primary-700 font-bold text-[12px]"
                    >
                      {{ avatarInitial(a.name) }}
                    </span>
                  </div>
                  <div class="min-w-0">
                    <div class="truncate font-semibold" :title="a.name">{{ truncate(a.name, 14) }}</div>
                    <div class="hidden sm:block truncate text-[11px] text-[#94a3b8]" :title="a.email">{{ truncate(a.email, 18) }}</div>
                  </div>
                </div>

                <!-- Position -->
                <div class="flex min-w-0 items-center">
                  <div class="min-w-0">
                    <div class="truncate font-medium" :title="a.position">{{ truncate(a.position, 24) }}</div>
                  </div>
                </div>

                <!-- Stage -->
                <div>
                  <span
                    class="inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium"
                    :class="[STATUS_CHIP[a.status].bg, STATUS_CHIP[a.status].text]"
                  >{{ STATUS_LABEL[a.status] }}</span>
                </div>

                <!-- Match — 3 state: scoring (spinner "Đang chấm…"), null
                     ("Chưa có điểm"), có điểm (% + bar). 0 điểm thật vẫn hiện 0%. -->
                <div v-if="a.applicationId === scoringApplicationId" class="flex items-center gap-1">
                  <Loader2 class="h-3 w-3 animate-spin text-[#1769e8]" />
                  <span class="text-[11px] text-[#64748b]">Đang chấm…</span>
                </div>
                <div v-else-if="a.match === null">
                  <div class="text-[11px] text-[#94a3b8] italic">Chưa có điểm</div>
                </div>
                <div v-else>
                  <div
                    class="font-semibold tabular-nums"
                    :class="MATCH_LEVEL_STYLE[matchLevelOf(animatedMatches[a.applicationId ?? a.email] ?? a.match ?? 0)].text"
                  >
                    {{ animatedMatches[a.applicationId ?? a.email] ?? a.match ?? 0 }}%
                  </div>
                  <div class="mt-1 h-1.5 w-[60px] sm:w-[85px] rounded-full bg-[#e8eef8]">
                    <!--
                      Bar color bám theo animated % (không phải target) → bắt đầu
                      luôn ở màu đỏ (rose) khi % = 0, rồi chuyển amber khi vượt
                      50%, rồi emerald khi vượt 80%. `transition-colors` để đổi
                      màu mượt song song với fill width.
                    -->
                    <div
                      class="h-full rounded-full transition-all duration-[1100ms] ease-out"
                      :class="MATCH_LEVEL_STYLE[matchLevelOf(animatedMatches[a.applicationId ?? a.email] ?? a.match ?? 0)].bar"
                      :style="{ width: `${animatedMatches[a.applicationId ?? a.email] ?? a.match ?? 0}%` }"
                    ></div>
                  </div>
                </div>

                <!-- Applied -->
                <div class="hidden sm:block text-[12px] text-[#475569]" :title="formatDate(a.date)">{{ formatTime(a.date) }}</div>
              </div>
            </template>

            <!-- Empty State -->
            <div
              v-else
              class="py-12 px-4 text-center anim-empty-fade"
            >
              <Inbox class="w-10 h-10 mx-auto text-[#cbd5e1] mb-2" />
              <p class="text-[13px] font-medium text-[#475569]">Không tìm thấy đơn ứng tuyển nào</p>
              <p class="text-[11.5px] text-[#94a3b8] mt-1">Hãy thử thay đổi bộ lọc công việc hoặc trạng thái đơn.</p>
            </div>
          </div>

          <!-- Pagination footer — bind theo state thật từ API response. -->
          <div
            class="flex items-center justify-between border-t border-[#eef1f5] px-4 py-3 text-[12px] text-[#7c889a]"
          >
            <span>
              Hiển thị
              <strong class="text-[#334155]">{{ applications.length === 0 ? 0 : (page - 1) * limit + 1 }}</strong>
              đến
              <strong class="text-[#334155]">{{ (page - 1) * limit + applications.length }}</strong>
              của <strong class="text-[#334155]">{{ total }}</strong> đơn ứng tuyển
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-lg border border-[#e3e8ef] text-[#7c889a] hover:bg-[#f8fafc] transition disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="page <= 1"
                aria-label="Trang trước"
                @click="goToPage(page - 1)"
              >
                <ChevronLeft class="h-3.5 w-3.5" />
              </button>

              <!-- Page numbers + ellipsis window. -->
              <template v-for="(p, idx) in paginationPages" :key="`${p}-${idx}`">
                <span
                  v-if="p === '…'"
                  class="h-8 min-w-8 px-2 inline-flex items-center justify-center text-[#7c889a]"
                  aria-hidden="true"
                >…</span>
                <button
                  v-else
                  type="button"
                  class="h-8 min-w-8 px-2.5 inline-flex items-center justify-center rounded-lg text-[12px] font-medium transition"
                  :class="p === page
                    ? 'bg-[#1769e8] text-white'
                    : 'border border-[#e3e8ef] text-[#334155] hover:bg-[#f8fafc]'"
                  :aria-current="p === page ? 'page' : undefined"
                  @click="goToPage(p)"
                >{{ p }}</button>
              </template>

              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-lg border border-[#e3e8ef] text-[#7c889a] hover:bg-[#f8fafc] transition disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="page >= totalPages"
                aria-label="Trang sau"
                @click="goToPage(page + 1)"
              >
                <ChevronRight class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </section>
      </main>

      <!-- ============ Detail panel with slide animation ============ -->
      <Transition name="panel-slide">
        <ApplicationDetailPanel
          v-if="selectedApplication"
          :application="selectedApplication"
          :is-scoring="isScoringSelected"
          @status-changed="onDetailStatusChanged"
          @recompute-match="onDetailRecomputeMatch"
          @close="selectedApplication = null"
        />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/*
 * Main list area smooth flex resize transition
 */
.main-list-area {
  transition: all 0.35s cubic-bezier(0.25, 1, 0.5, 1);
}

/*
 * Detail panel slide & contraction animation
 */
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: all 0.35s cubic-bezier(0.25, 1, 0.5, 1);
  overflow: hidden !important;
}

@media (min-width: 1024px) {
  .panel-slide-enter-from,
  .panel-slide-leave-to {
    max-width: 0 !important;
    min-width: 0 !important;
    width: 0 !important;
    opacity: 0;
    transform: translateX(40px);
    border-left-color: transparent !important;
  }
}

@media (max-width: 1023px) {
  .panel-slide-enter-from,
  .panel-slide-leave-to {
    max-height: 0 !important;
    opacity: 0;
    transform: translateY(30px);
    border-top-color: transparent !important;
  }
}

/*
 * Scrollbar mỏng (~6px) cho 2 panel overflow-y-auto. Webkit + Firefox đều
 * style để thanh cuộn không chiếm quá nhiều diện tích.
 */
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}
.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 9999px;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

/*
 * Row entrance animation (staggered fade & rise) — đồng bộ phong cách với trang Notifications
 */
@media (prefers-reduced-motion: no-preference) {
  .nt-row {
    animation: nt-fade 0.28s ease-out both;
  }
}

@keyframes nt-fade {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Empty state fade-in */
@keyframes emptyFade {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

.anim-empty-fade {
  animation: emptyFade 180ms ease-out forwards;
}

@media (prefers-reduced-motion: reduce) {
  .nt-row,
  .anim-empty-fade {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .animate-pulse {
    animation: none !important;
  }
}
</style>
