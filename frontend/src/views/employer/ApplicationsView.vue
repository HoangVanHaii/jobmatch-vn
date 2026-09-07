<script setup lang="ts">
/**
 * ApplicationsView — trang quản lý đơn ứng tuyển cho employer tại
 * `/employer/applications`.
 *
 * Design: list đơn + popup (modal) chi tiết khi click row.
 *   - List: card với avatar chữ cái đầu, candidate name, job title, status,
 *     match %, ngày nộp.
 *   - Popup: header gradient + AI ring, candidate info, timeline, status grid,
 *     contact, CV preview (iframe nếu có cvUrl).
 *
 * Realtime:
 *   - `notification:new` filter type=application_new → refresh list.
 *   - `application:match-ready` → update row + close popup nếu đang mở row đó
 *     để re-fetch detail.
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue';
import {
  Loader2,
  AlertCircle,
  Sparkles,
  Mail,
  Calendar,
  Search,
  X,
  ChevronDown,
  Check,
  RefreshCw,
  Eye,
  CheckCircle2,
  XCircle,
  Briefcase,
  FileText,
  Download,
  ExternalLink,
  Circle,
  Clock,
  BarChart3,
  ArrowUpDown,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import { applicationApi } from '@services/application.api';
import { useToastStore } from '@stores/toast';
import { getSocket } from '@services/socket';
import { useAuthStore } from '@stores/auth';
import type {
  ApplicationStatus,
  ApplicationDetail,
  EmployerApplicationRow,
  ApplicationMatchReadyPayload,
} from '@/types/application';

const toast = useToastStore();
const auth = useAuthStore();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const rows = ref<EmployerApplicationRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(20);
const loading = ref(false);
const error = ref<string | null>(null);
const statusFilter = ref<ApplicationStatus | ''>('');

// Custom dropdown
const statusDropdownOpen = ref(false);
const statusDropdownRef = ref<HTMLElement | null>(null);

// Detail modal
const detailOpen = ref(false);
const detailLoading = ref(false);
const detail = ref<ApplicationDetail | null>(null);
const detailRow = ref<EmployerApplicationRow | null>(null);
const recomputing = ref<string | null>(null);
const statusUpdating = ref<string | null>(null);

// AI match ring animation
const matchPercentNumber = ref(0);
let matchPercentRaf: number | null = null;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));

/**
 * Sort direction cho 2 cột (Chưa chấm / Đã chấm) — toggle qua nút bên phải
 * header. `desc` = mới nhất trên cùng, `asc` = cũ nhất trên cùng.
 */
const sortDir = ref<'desc' | 'asc'>('desc');

/**
 * Chia list thành 2 nhóm theo trạng thái AI match:
 *   - `pendingRows`: chưa chấm (aiMatchScore = null) — card cột phải
 *   - `scoredRows`: đã chấm (aiMatchScore != null) — card cột trái
 *
 * Sort theo appliedAt theo `sortDir`. `slice()` trước sort vì `filter` trả
 * reference mới nhưng vẫn an toàn sort không mutate rows.value.
 *
 * Khi nhận `application:match-ready` qua socket → row chuyển từ pending
 * sang scored tự động (reactive).
 */
const pendingRows = computed(() => {
  const dir = sortDir.value === 'desc' ? 1 : -1;
  return rows.value
    .filter((r) => r.aiMatchScore == null)
    .slice()
    .sort((a, b) =>
      a.appliedAt < b.appliedAt ? dir : a.appliedAt > b.appliedAt ? -dir : 0,
    );
});
const scoredRows = computed(() => {
  const dir = sortDir.value === 'desc' ? 1 : -1;
  return rows.value
    .filter((r) => r.aiMatchScore != null)
    .slice()
    .sort((a, b) =>
      a.appliedAt < b.appliedAt ? dir : a.appliedAt > b.appliedAt ? -dir : 0,
    );
});

/** Toggle sort direction khi user bấm nút "Mới nhất" / "Cũ nhất". */
const toggleSort = (): void => {
  sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc';
};

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
const STATUS_OPTIONS: { value: ApplicationStatus | ''; label: string }[] = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'viewed', label: 'Đã xem' },
  { value: 'screening', label: 'Sàng lọc' },
  { value: 'interview', label: 'Phỏng vấn' },
  { value: 'offered', label: 'Đề nghị' },
  { value: 'hired', label: 'Đã tuyển' },
  { value: 'rejected', label: 'Từ chối' },
  { value: 'withdrawn', label: 'Đã rút' },
];

const STATUS_COLOR: Record<ApplicationStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  viewed: 'bg-violet-100 text-violet-800',
  screening: 'bg-violet-100 text-violet-800',
  interview: 'bg-violet-100 text-violet-800',
  offered: 'bg-violet-100 text-violet-800',
  hired: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  withdrawn: 'bg-gray-100 text-gray-500',
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: 'Chờ duyệt',
  viewed: 'Đã xem',
  screening: 'Đang sàng lọc',
  interview: 'Phỏng vấn',
  offered: 'Đề nghị',
  hired: 'Đã tuyển',
  rejected: 'Bị từ chối',
  withdrawn: 'Đã rút',
};

const STATUS_FLOW: ApplicationStatus[] = [
  'pending',
  'viewed',
  'screening',
  'interview',
  'offered',
  'hired',
];

// ---------------------------------------------------------------------------
// Match level helpers
// ---------------------------------------------------------------------------
type MatchLevel = 'high' | 'mid' | 'low';

const MATCH_LEVEL: Record<
  MatchLevel,
  { ring: string; label: string; text: string; bg: string }
> = {
  high: { ring: '#10b981', label: 'Cao', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  mid: { ring: '#f59e0b', label: 'Trung bình', text: 'text-amber-700', bg: 'bg-amber-50' },
  low: { ring: '#f43f5e', label: 'Thấp', text: 'text-rose-700', bg: 'bg-rose-50' },
};

const matchLevelFromPercent = (n: number): MatchLevel =>
  n >= 80 ? 'high' : n >= 50 ? 'mid' : 'low';

/**
 * Badge cho card "Chưa chấm AI" — phân biệt 3 trạng thái:
 *   - undefined: worker đang chạy hoặc retry → spinner "Đang so khớp"
 *   - 'quota_exceeded': candidate hết quota → amber "Hết quota"
 *   - 'failed': LLM lỗi sau hết retry → rose "AI lỗi" (employer có thể bấm
 *     "Chấm lại" trong popup để enqueue lại job)
 */
type MatchFailBadge = { class: string; label: string; dotClass: string };
const MATCH_FAIL_BADGE: Record<'quota_exceeded' | 'failed', MatchFailBadge> = {
  quota_exceeded: {
    class: 'bg-amber-100 text-amber-800',
    label: 'Hết quota',
    dotClass: 'bg-amber-600',
  },
  failed: {
    class: 'bg-rose-100 text-rose-800',
    label: 'AI lỗi — chấm lại',
    dotClass: 'bg-rose-600',
  },
};

// ---------------------------------------------------------------------------
// Avatar — chữ cái đầu candidateName trên gradient primary (match JobCard).
// ---------------------------------------------------------------------------
const candidateInitial = (name: string | null): string => {
  const t = (name ?? '').trim();
  return t ? t.charAt(0).toLocaleUpperCase('vi-VN') : '?';
};

// ---------------------------------------------------------------------------
// Fetch list
// ---------------------------------------------------------------------------
const fetchList = async (): Promise<void> => {
  loading.value = true;
  error.value = null;
  try {
    const { data } = await applicationApi.listByCompany({
      status: statusFilter.value || undefined,
      page: page.value,
      limit: limit.value,
    });
    rows.value = data.data.rows;
    total.value = data.data.total;
  } catch {
    error.value = 'Không tải được danh sách. Vui lòng thử lại.';
  } finally {
    loading.value = false;
  }
};

const onFilterChange = (): void => {
  page.value = 1;
  void fetchList();
};

const goPrev = (): void => {
  if (page.value > 1) {
    page.value -= 1;
    void fetchList();
  }
};

const goNext = (): void => {
  if (page.value < totalPages.value) {
    page.value += 1;
    void fetchList();
  }
};

// ---------------------------------------------------------------------------
// Custom dropdown handlers
// ---------------------------------------------------------------------------
const currentStatusLabel = computed<string>(
  () =>
    STATUS_OPTIONS.find((o) => o.value === statusFilter.value)?.label ??
    'Tất cả trạng thái',
);

const selectStatus = (value: ApplicationStatus | ''): void => {
  statusFilter.value = value;
  statusDropdownOpen.value = false;
  onFilterChange();
};

const onDocClick = (e: MouseEvent): void => {
  if (statusDropdownRef.value && !statusDropdownRef.value.contains(e.target as Node)) {
    statusDropdownOpen.value = false;
  }
};
const onDocKey = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') {
    if (detailOpen.value) closeDetail();
    else statusDropdownOpen.value = false;
  }
};

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------
const openDetail = async (row: EmployerApplicationRow): Promise<void> => {
  detailRow.value = row;
  detailOpen.value = true;
  detailLoading.value = true;
  try {
    const { data } = await applicationApi.getById(row.id);
    detail.value = data.data;
  } catch {
    detail.value = null;
    toast.push({
      variant: 'error',
      title: 'Không tải được chi tiết',
      body: 'Vui lòng thử lại sau.',
    });
  } finally {
    detailLoading.value = false;
  }
};

const closeDetail = (): void => {
  detailOpen.value = false;
  // Giữ row data để list highlight; reset detail khi modal đóng xong.
  void nextTick(() => {
    detail.value = null;
  });
};

/**
 * Có CV đính kèm và URL accessible để preview iframe không.
 * PDF thường render inline OK; các format khác thì cho link download.
 */
const cvIsPreviewable = computed<boolean>(() => {
  const url = detail.value?.cv?.url;
  if (!url) return false;
  return /\.pdf($|\?)/i.test(url) || /^https?:\/\//i.test(url);
});

/**
 * Src cho iframe — append Chrome PDFium fragment params để:
 *   - view=FitH       : fit width ngay khi load
 *   - toolbar=0       : ẩn top toolbar (page count, zoom controls)
 *   - navpanes=0      : ẩn sidebar thumbnail bên trái
 *   - statusbar=0     : ẩn status bar
 *   - messages=0      : ẩn dialog overlay
 * Fragment chỉ áp dụng cho PDF; các URL khác (ảnh, etc.) pass-through.
 *
 * Lưu ý: PDFium params chỉ honored trong Chrome/Edge. Firefox/Safari vẫn
 * render native viewer của họ — user có thể dùng "Mở tab mới" làm fallback.
 */
const cvPreviewSrc = computed<string>(() => {
  const url = detail.value?.cv?.url;
  if (!url) return '';
  if (!/\.pdf($|\?)/i.test(url)) return url;
  const [base] = url.split('#');
  return `${base}#view=FitH&toolbar=0&navpanes=0&statusbar=0&messages=0`;
});

// ---------------------------------------------------------------------------
// Force download — bắt buộc save file xuống máy thay vì mở tab mới.
//
// Lý do không dùng `<a download href=...>`:
//   - MinIO chạy ở origin khác (`localhost:9000` vs `localhost:5173`) → trình
//     duyệt bỏ qua thuộc tính `download` cho cross-origin. Click vào link
//     mở PDF inline trong tab mới, không lưu xuống.
//   - Fetch → blob → URL.createObjectURL → click anchor trong cùng origin
//     → browser mới honor `download` attribute.
//
// Bonus: cũng bypass vấn đề file cũ trong bucket chưa có Content-Disposition.
const downloading = ref(false);
const downloadFile = async (url: string, fallbackName: string): Promise<void> => {
  if (!url || downloading.value) return;
  downloading.value = true;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();

    // Lấy filename gợi ý từ Content-Disposition nếu server trả về; fallback
    // sang tên CV hoặc tên phái sinh từ URL.
    const cd = res.headers.get('Content-Disposition') ?? '';
    const starMatch = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const plainMatch = cd.match(/filename="?([^";]+)"?/i);
    const suggested = starMatch
      ? decodeURIComponent(starMatch[1])
      : plainMatch
        ? plainMatch[1]
        : null;
    const filename = suggested || fallbackName || url.split('/').pop() || 'download';

    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke sau 1 tick để browser kịp start download trên Safari/Firefox.
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  } catch (err) {
    toast.push({
      variant: 'error',
      title: 'Tải về thất bại',
      body: 'Không thể tải file. Vui lòng thử lại sau.',
    });
  } finally {
    downloading.value = false;
  }
};

// ---------------------------------------------------------------------------
// Match ring animation
// ---------------------------------------------------------------------------
const animateMatchPercent = (target: number): void => {
  if (matchPercentRaf !== null) cancelAnimationFrame(matchPercentRaf);
  const start = performance.now();
  const duration = 1200;
  const from = 0;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    matchPercentNumber.value = Math.round(from + (target - from) * eased);
    if (t < 1) {
      matchPercentRaf = requestAnimationFrame(step);
    } else {
      matchPercentRaf = null;
    }
  };
  matchPercentRaf = requestAnimationFrame(step);
};

watch(
  () => detail.value?.aiMatchScore,
  (raw) => {
    if (raw == null) {
      if (matchPercentRaf !== null) cancelAnimationFrame(matchPercentRaf);
      matchPercentRaf = null;
      matchPercentNumber.value = 0;
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) animateMatchPercent(Math.max(0, Math.min(100, n)));
  },
  { immediate: true },
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const recomputeMatch = async (id: string): Promise<void> => {
  if (recomputing.value) return;
  recomputing.value = id;
  try {
    await applicationApi.recomputeMatch(id);
    const row = rows.value.find((r) => r.id === id);
    if (row) {
      row.aiMatchScore = null;
      // Reset reason về null để badge chuyển về spinner (worker sẽ ghi lại
      // 'success' / 'quota_exceeded' / 'failed' khi job chạy xong).
      row.aiMatchReason = null;
    }
    if (detail.value?.id === id) {
      detail.value.aiMatchScore = null;
      if (detail.value.aiMatchReasoning) {
        detail.value.aiMatchReasoning = { ...detail.value.aiMatchReasoning, reason: undefined };
      }
    }
    toast.push({
      variant: 'info',
      title: 'Đã yêu cầu chấm lại',
      body: 'AI đang chấm điểm, kết quả sẽ cập nhật trong vài giây.',
    });
  } catch {
    toast.push({
      variant: 'error',
      title: 'Yêu cầu thất bại',
      body: 'Không thể chấm lại lúc này. Vui lòng thử lại sau.',
    });
  } finally {
    recomputing.value = null;
  }
};

const updateStatus = async (id: string, newStatus: ApplicationStatus): Promise<void> => {
  if (statusUpdating.value) return;
  statusUpdating.value = id;
  try {
    const { data } = await applicationApi.updateStatus(id, { status: newStatus });
    const row = rows.value.find((r) => r.id === id);
    if (row) {
      row.status = data.data.status;
      row.stage = data.data.stage;
      if (newStatus === 'viewed') row.viewedAt = new Date().toISOString();
    }
    if (detail.value?.id === id) {
      detail.value.status = data.data.status;
      detail.value.stage = data.data.stage;
      if (newStatus === 'viewed') detail.value.viewedAt = new Date().toISOString();
    }
    toast.push({
      variant: 'success',
      title: 'Đã cập nhật trạng thái',
      body: STATUS_LABEL[newStatus],
    });
  } catch {
    toast.push({
      variant: 'error',
      title: 'Cập nhật thất bại',
      body: 'Vui lòng thử lại sau.',
    });
  } finally {
    statusUpdating.value = null;
  }
};

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------
let socket: ReturnType<typeof getSocket> | null = null;

const onNotificationNew = (row: { type: string }): void => {
  if (row.type === 'application_new') {
    // Đơn mới tới → refetch list rồi seed timeline. Push realtime cũng là
    // được nhưng fetchList đảm bảo data đầy đủ (candidateName, jobTitle, …).
    void fetchList();
  }
};

const onMatchReady = (payload: ApplicationMatchReadyPayload): void => {
  const row = rows.value.find((r) => r.id === payload.applicationId);
  if (!row) return;

  // Patch `aiMatchReason` từ socket để badge chuyển terminal ngay khi worker
  // emit 'quota_exceeded' / 'failed' (không cần refetch). Reason không có
  // trong payload (legacy caller) → giữ nguyên giá trị hiện tại của row.
  if (payload.reason) {
    row.aiMatchReason = payload.reason;
  }

  // Patch `aiMatchScore` chỉ khi worker trả về matchPercent (case success).
  // Null matchPercent + reason='quota_exceeded'/'failed' → KHÔNG touch score
  // (giữ NULL → row vẫn ở cột "Chưa chấm AI" với badge terminal).
  if (payload.matchPercent != null) {
    row.aiMatchScore = String(payload.matchPercent);
  }

  if (detail.value?.id === payload.applicationId) {
    if (payload.matchPercent != null) {
      detail.value.aiMatchScore = String(payload.matchPercent);
    }
    // detail payload không expose aiMatchReason — refetch để đồng bộ.
    if (payload.reason && payload.reason !== 'success') {
      void applicationApi.getById(payload.applicationId).then((res) => {
        detail.value = res.data.data;
      }).catch(() => {});
    }
  }
};

onMounted(async () => {
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onDocKey);
  await fetchList();
  if (auth.isAuthenticated) {
    socket = getSocket();
    if (!socket.connected) socket.connect();
    socket.on('notification:new', onNotificationNew);
    socket.on('application:match-ready', onMatchReady);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  document.removeEventListener('keydown', onDocKey);
  if (matchPercentRaf !== null) cancelAnimationFrame(matchPercentRaf);
});

onUnmounted(() => {
  if (socket) {
    socket.off('notification:new', onNotificationNew);
    socket.off('application:match-ready', onMatchReady);
  }
});

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
const formatMatchScore = (score: string | null): string => {
  if (score == null) return '';
  const n = Number(score);
  return Number.isFinite(n) ? `${Math.round(n)}%` : '';
};
</script>

<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-5xl mx-auto">
      <!-- Header -->
      <header class="mb-6">
        <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Đơn ứng tuyển</h1>
        <p class="text-sm text-gray-500 mt-1">
          Danh sách ứng viên đã apply vào job của các công ty bạn quản lý.
        </p>
      </header>

      <!-- Sticky filter bar -->
      <div
        class="sticky top-0 z-20 -mx-1 px-1 pt-1 pb-3 bg-gray-50/80 backdrop-blur-sm border-b border-gray-200/60 mb-4 flex items-center gap-2"
      >
        <div ref="statusDropdownRef" class="relative inline-block">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-xs text-gray-700 border border-gray-200 hover:text-gray-900 hover:bg-gray-100/70 rounded transition"
            :class="statusDropdownOpen ? 'bg-gray-100/70 text-gray-900' : ''"
            aria-haspopup="listbox"
            :aria-expanded="statusDropdownOpen"
            @click="statusDropdownOpen = !statusDropdownOpen"
          >
            <span>{{ currentStatusLabel }}</span>
            <ChevronDown
              class="w-3.5 h-3.5 transition"
              :class="statusDropdownOpen ? 'rotate-180' : ''"
            />
          </button>
          <Transition>
            <ul
              v-if="statusDropdownOpen"
              class="absolute top-full left-0 mt-1 z-30 min-w-[180px] bg-white border border-gray-200 rounded shadow-sm overflow-hidden py-0.5"
            >
              <li
                v-for="opt in STATUS_OPTIONS"
                :key="opt.value"
                role="option"
                :aria-selected="statusFilter === opt.value"
                class="relative flex items-center gap-1.5 pl-7 pr-2 py-1 text-xs cursor-pointer transition"
                :class="
                  statusFilter === opt.value
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                "
                @click="selectStatus(opt.value)"
              >
                <Check
                  v-if="statusFilter === opt.value"
                  class="absolute left-2 w-3.5 h-3.5 text-primary-600"
                />
                <span class="truncate">{{ opt.label }}</span>
              </li>
            </ul>
          </Transition>
        </div>
        <button
          type="button"
          class="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded transition"
          @click="fetchList"
        >
          <RefreshCw class="w-3.5 h-3.5" />
          Làm mới
        </button>
      </div>

      <!-- Loading -->
      <div
        v-if="loading"
        class="flex items-center justify-center py-16 text-sm text-gray-500"
      >
        <Loader2 class="w-5 h-5 mr-2 animate-spin" /> Đang tải...
      </div>

      <!-- Error -->
      <div
        v-else-if="error"
        class="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-900"
      >
        <AlertCircle class="w-5 h-5 mt-0.5 shrink-0" />
        <div>
          <p class="font-medium">{{ error }}</p>
          <button
            type="button"
            class="mt-2 text-xs font-medium underline"
            @click="fetchList"
          >
            Thử lại
          </button>
        </div>
      </div>

      <!-- Empty -->
      <div
        v-else-if="rows.length === 0"
        class="bg-white border border-gray-200 rounded-xl p-10 text-center"
      >
        <template v-if="statusFilter">
          <div
            class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3"
          >
            <Search class="w-6 h-6 text-gray-500" />
          </div>
          <h3 class="text-sm font-semibold text-gray-900">
            Không có đơn nào ở trạng thái "{{
              STATUS_LABEL[statusFilter as ApplicationStatus]
            }}"
          </h3>
          <p class="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            Thử bỏ bộ lọc để xem tất cả đơn.
          </p>
        </template>
        <template v-else>
          <div
            class="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mx-auto mb-3"
          >
            <Briefcase class="w-6 h-6 text-primary-600" />
          </div>
          <h3 class="text-sm font-semibold text-gray-900">Chưa có đơn ứng tuyển nào</h3>
          <p class="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            Khi có ứng viên apply vào job của công ty bạn, đơn sẽ hiện ở đây.
          </p>
        </template>
      </div>

      <!-- ============ 2 cột: Đã chấm AI · Chưa chấm AI ============ -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <!-- ===== Cột trái: Đã chấm AI ===== -->
        <section class="min-w-0">
          <header
            class="sticky top-12 z-10 -mx-1 px-1 py-2.5 bg-gray-50/80 backdrop-blur-sm flex items-center gap-2 border-b border-gray-200/60"
          >
            <span
              class="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0"
            >
              <BarChart3 class="w-3.5 h-3.5 text-emerald-600" />
            </span>
            <h2 class="text-sm font-semibold text-gray-900">Đã chấm AI</h2>
            <span
              class="text-[11px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5"
            >
              {{ scoredRows.length }}
            </span>
            <!--
              Nút sort — click để đổi chiều sort giữa "Mới nhất" (desc, mặc định)
              và "Cũ nhất" (asc). Cả 2 cột cùng share 1 sortDir để hiển thị
              đồng nhất.
            -->
            <button
              type="button"
              class="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-900 transition"
              :aria-label="`Sắp xếp ${sortDir === 'desc' ? 'mới nhất trước' : 'cũ nhất trước'}`"
              @click="toggleSort"
            >
              <ArrowUpDown class="w-3 h-3" />
              {{ sortDir === 'desc' ? 'Mới nhất' : 'Cũ nhất' }}
            </button>
          </header>
          <div v-if="scoredRows.length === 0" class="mt-3 bg-white border border-dashed border-gray-200 rounded-xl p-8 text-center">
            <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2">
              <BarChart3 class="w-4 h-4 text-gray-400" />
            </div>
            <p class="text-xs font-semibold text-gray-700">Chưa có đơn nào được chấm AI</p>
            <p class="text-[11px] text-gray-500 mt-1">Khi AI xử lý xong, đơn sẽ tự động xuất hiện ở đây.</p>
          </div>
          <div v-else class="mt-3 space-y-3">
            <article
              v-for="row in scoredRows"
              :key="row.id"
              class="group bg-white border border-gray-200 rounded-[14px] p-4 shadow-sm hover:shadow-md hover:-translate-y-px hover:border-gray-300 transition cursor-pointer flex gap-3.5"
              @click="openDetail(row)"
            >
              <div
                class="shrink-0 w-[42px] h-[42px] rounded-[10px] overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 text-primary-700 font-bold text-[15px] ring-1 ring-black/5"
                :aria-label="row.candidateName ?? 'Ứng viên'"
              >
                <span>{{ candidateInitial(row.candidateName) }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2.5">
                  <div class="min-w-0">
                    <h3 class="text-[14.5px] font-semibold tracking-tight text-gray-900 truncate">
                      {{ row.candidateName ?? 'Ứng viên ẩn danh' }}
                    </h3>
                    <p class="text-[12.5px] text-gray-500 mt-0.5 truncate">
                      {{ row.jobTitle ?? '(Job đã bị xoá)' }}
                    </p>
                  </div>
                  <span
                    class="shrink-0 inline-flex items-center gap-1 rounded-full pl-1.5 pr-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap"
                    :class="STATUS_COLOR[row.status]"
                  >
                    <Circle class="w-1.5 h-1.5 fill-current opacity-80" />
                    {{ STATUS_LABEL[row.status] }}
                  </span>
                </div>
                <div class="mt-2 flex items-center gap-3 flex-wrap">
                  <span class="inline-flex items-center gap-1 text-[11.5px] text-gray-500">
                    <Calendar class="w-3 h-3" />
                    {{ dayjs(row.appliedAt).format('DD/MM/YYYY HH:mm') }}
                  </span>
                  <span
                    class="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full text-[11.5px] font-semibold"
                    :class="MATCH_LEVEL[matchLevelFromPercent(Number(row.aiMatchScore))].text"
                    :style="{
                      background: MATCH_LEVEL[matchLevelFromPercent(Number(row.aiMatchScore))].bg,
                    }"
                  >
                    <!-- Ring 22px — fill % theo matchPercent, màu viền theo level (cao/TB/thấp).
                         r=9, circumference ≈ 56.55; offset = 56.55 * (1 - pct/100). -->
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 22 22"
                      class="-rotate-90 shrink-0"
                      :aria-label="`AI match ${formatMatchScore(row.aiMatchScore)}`"
                    >
                      <circle
                        cx="11"
                        cy="11"
                        r="9"
                        fill="none"
                        stroke="#e5e7eb"
                        stroke-width="2.5"
                      />
                      <circle
                        cx="11"
                        cy="11"
                        r="9"
                        fill="none"
                        :stroke="MATCH_LEVEL[matchLevelFromPercent(Number(row.aiMatchScore))].ring"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        :stroke-dasharray="56.55"
                        :stroke-dashoffset="
                          56.55 *
                          (1 -
                            Math.max(0, Math.min(100, Number(row.aiMatchScore))) /
                              100)
                        "
                      />
                    </svg>
                    {{ formatMatchScore(row.aiMatchScore) }}
                    ·
                    {{ MATCH_LEVEL[matchLevelFromPercent(Number(row.aiMatchScore))].label }}
                  </span>
                </div>
              </div>
            </article>
          </div>
        </section>

        <!-- ===== Cột phải: Chưa chấm AI ===== -->
        <section class="min-w-0">
          <header
            class="sticky top-12 z-10 -mx-1 px-1 py-2.5 bg-gray-50/80 backdrop-blur-sm flex items-center gap-2 border-b border-gray-200/60"
          >
            <span
              class="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0"
            >
              <Clock class="w-3.5 h-3.5 text-violet-600" />
            </span>
            <h2 class="text-sm font-semibold text-gray-900">Chưa chấm AI</h2>
            <span
              class="text-[11px] font-bold text-violet-700 bg-violet-100 rounded-full px-2 py-0.5"
            >
              {{ pendingRows.length }}
            </span>
            <!--
              Nút sort — cùng sortDir với cột trái để đồng bộ khi user muốn xem
              "cũ nhất" ở cả 2 cột cùng lúc (chỉ cần bấm 1 bên).
            -->
            <button
              type="button"
              class="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-900 transition"
              :aria-label="`Sắp xếp ${sortDir === 'desc' ? 'mới nhất trước' : 'cũ nhất trước'}`"
              @click="toggleSort"
            >
              <ArrowUpDown class="w-3 h-3" />
              {{ sortDir === 'desc' ? 'Mới nhất' : 'Cũ nhất' }}
            </button>
          </header>
          <div v-if="pendingRows.length === 0" class="mt-3 bg-white border border-dashed border-gray-200 rounded-xl p-8 text-center">
            <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2">
              <Clock class="w-4 h-4 text-gray-400" />
            </div>
            <p class="text-xs font-semibold text-gray-700">Tất cả đơn đã được chấm AI</p>
            <p class="text-[11px] text-gray-500 mt-1">Không có đơn nào đang chờ xử lý.</p>
          </div>
          <div v-else class="mt-3 space-y-3">
            <article
              v-for="row in pendingRows"
              :key="row.id"
              class="group bg-white border border-gray-200 rounded-[14px] p-4 shadow-sm hover:shadow-md hover:-translate-y-px hover:border-gray-300 transition cursor-pointer flex gap-3.5"
              @click="openDetail(row)"
            >
              <div
                class="shrink-0 w-[42px] h-[42px] rounded-[10px] overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 text-primary-700 font-bold text-[15px] ring-1 ring-black/5"
                :aria-label="row.candidateName ?? 'Ứng viên'"
              >
                <span>{{ candidateInitial(row.candidateName) }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2.5">
                  <div class="min-w-0">
                    <h3 class="text-[14.5px] font-semibold tracking-tight text-gray-900 truncate">
                      {{ row.candidateName ?? 'Ứng viên ẩn danh' }}
                    </h3>
                    <p class="text-[12.5px] text-gray-500 mt-0.5 truncate">
                      {{ row.jobTitle ?? '(Job đã bị xoá)' }}
                    </p>
                  </div>
                  <span
                    class="shrink-0 inline-flex items-center gap-1 rounded-full pl-1.5 pr-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap"
                    :class="STATUS_COLOR[row.status]"
                  >
                    <Circle class="w-1.5 h-1.5 fill-current opacity-80" />
                    {{ STATUS_LABEL[row.status] }}
                  </span>
                </div>
                <div class="mt-2 flex items-center gap-3 flex-wrap">
                  <span class="inline-flex items-center gap-1 text-[11.5px] text-gray-500">
                    <Calendar class="w-3 h-3" />
                    {{ dayjs(row.appliedAt).format('DD/MM/YYYY HH:mm') }}
                  </span>
                  <!-- Badge AI matching — 3 trạng thái:
                       - reason undefined → worker đang chạy, spinner
                       - reason quota_exceeded / failed → trạng thái terminal,
                         employer có thể bấm "Chấm lại" trong popup (chỉ 'failed'). -->
                  <span
                    v-if="row.aiMatchReason === 'quota_exceeded' || row.aiMatchReason === 'failed'"
                    class="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-[11.5px] font-semibold"
                    :class="MATCH_FAIL_BADGE[row.aiMatchReason].class"
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full"
                      :class="MATCH_FAIL_BADGE[row.aiMatchReason].dotClass"
                    />
                    {{ MATCH_FAIL_BADGE[row.aiMatchReason].label }}
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-violet-100 text-violet-800 text-[11.5px] font-semibold"
                  >
                    <Loader2 class="w-3 h-3 animate-spin" />
                    Đang so khớp
                  </span>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>

      <!-- Pagination (áp dụng cho cả 2 cột — vì cùng gọi 1 endpoint paginated) -->
      <nav class="mt-4 pt-3 border-t border-gray-200/60 flex items-center justify-between text-sm text-gray-600">
        <p>
          Trang <span class="font-medium">{{ page }}</span> / {{ totalPages }}
          · {{ total }} đơn
        </p>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="page <= 1"
            @click="goPrev"
          >
            Trước
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="page >= totalPages"
            @click="goNext"
          >
            Sau
          </button>
        </div>
      </nav>
    </div>

    <!-- ============ Detail modal ============ -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="detailOpen"
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          @click.self="closeDetail"
        >
          <div
            class="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col"
          >
            <!-- Modal header -->
            <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="shrink-0 w-11 h-11 rounded-[10px] overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 text-primary-700 font-bold text-base ring-1 ring-black/5"
                >
                  <span>{{
                    candidateInitial(detailRow?.candidateName ?? null)
                  }}</span>
                </div>
                <div class="min-w-0">
                  <h2 class="text-base font-bold tracking-tight text-gray-900 truncate">
                    {{
                      detailRow?.candidateName ?? 'Ứng viên ẩn danh'
                    }}
                  </h2>
                  <p class="text-xs text-gray-500 truncate">
                    Ứng tuyển:
                    {{ detail?.jobTitle ?? detailRow?.jobTitle ?? '(Job đã bị xoá)' }}
                  </p>
                </div>
              </div>
              <button
                type="button"
                class="text-gray-400 hover:text-gray-600 shrink-0"
                aria-label="Đóng"
                @click="closeDetail"
              >
                <X class="w-5 h-5" />
              </button>
            </div>

            <!-- Modal body -->
            <div class="flex-1 overflow-y-auto scrollbar-thin">
              <div v-if="detailLoading" class="flex items-center justify-center py-20">
                <Loader2 class="w-6 h-6 animate-spin text-gray-400" />
              </div>
              <div v-else-if="detail" class="p-5 space-y-4">
                <!-- AI match card -->
                <div
                  class="rounded-2xl bg-gradient-to-br from-violet-50 to-primary-50 p-4 flex items-center gap-4"
                >
                  <template v-if="detail.aiMatchScore != null">
                    <div class="relative shrink-0 w-16 h-16">
                      <svg
                        width="64"
                        height="64"
                        viewBox="0 0 64 64"
                        class="-rotate-90"
                      >
                        <circle
                          cx="32"
                          cy="32"
                          r="27"
                          fill="none"
                          stroke="#E6DCFB"
                          stroke-width="7"
                        />
                        <circle
                          cx="32"
                          cy="32"
                          r="27"
                          fill="none"
                          :stroke="
                            MATCH_LEVEL[matchLevelFromPercent(Number(detail.aiMatchScore))]
                              .ring
                          "
                          stroke-width="7"
                          stroke-linecap="round"
                          :stroke-dasharray="169.6"
                          :stroke-dashoffset="
                            169.6 *
                            (1 -
                              Math.max(
                                0,
                                Math.min(100, Number(detail.aiMatchScore)),
                              ) /
                                100)
                          "
                          class="match-ring"
                          :style="{
                            '--ring-target':
                              169.6 *
                              (1 -
                                Math.max(
                                  0,
                                  Math.min(100, Number(detail.aiMatchScore)),
                                ) /
                                  100),
                          }"
                        />
                      </svg>
                      <div
                        class="absolute inset-0 flex items-center justify-center text-[15px] font-extrabold text-violet-700"
                      >
                        {{ matchPercentNumber }}%
                      </div>
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-bold text-gray-900">Mức độ phù hợp:</p>
                      <p
                        class="text-xs font-semibold"
                        :class="
                          MATCH_LEVEL[matchLevelFromPercent(Number(detail.aiMatchScore))].text
                        "
                      >
                        {{
                          MATCH_LEVEL[
                            matchLevelFromPercent(Number(detail.aiMatchScore))
                          ].label
                        }}
                      </p>
                      <p class="text-[11px] text-gray-500 mt-0.5">
                        AI chấm dựa trên CV + JD
                      </p>
                    </div>
                    <button
                      v-if="recomputing !== detail.id"
                      type="button"
                      class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-white border border-violet-200 text-violet-700 hover:bg-violet-50 transition disabled:opacity-50"
                      :disabled="recomputing !== null"
                      @click="recomputeMatch(detail.id)"
                    >
                      <Sparkles class="w-3 h-3" />
                      Chấm lại
                    </button>
                  </template>
                  <template v-else>
                    <span
                      class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-violet-100 text-violet-800 text-[11.5px] font-semibold"
                    >
                      <Loader2
                        v-if="recomputing === detail.id"
                        class="w-3 h-3 animate-spin"
                      />
                      <span v-if="recomputing === detail.id">Đang so khớp</span>
                      <span v-else>Chưa có AI match</span>
                    </span>
                    <button
                      v-if="recomputing !== detail.id"
                      type="button"
                      class="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-violet-200 hover:bg-violet-300 text-violet-800 transition disabled:opacity-50"
                      :disabled="recomputing !== null"
                      @click="recomputeMatch(detail.id)"
                    >
                      <Sparkles class="w-3 h-3" />
                      So khớp AI
                    </button>
                  </template>
                </div>

                <!-- CV đã nộp + preview -->
                <section
                  v-if="detail.cv"
                  class="rounded-xl border border-gray-200 overflow-hidden"
                >
                  <div
                    class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50/50"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <FileText class="w-4 h-4 text-gray-400 shrink-0" />
                      <p class="text-sm font-semibold text-gray-900 truncate">
                        {{ detail.cv.title || 'CV đã nộp' }}
                      </p>
                    </div>
                    <div v-if="detail.cv.url" class="flex items-center gap-1.5 shrink-0">
                      <a
                        :href="detail.cv.url"
                        target="_blank"
                        rel="noopener"
                        class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition"
                      >
                        <ExternalLink class="w-3 h-3" />
                        Mở tab mới
                      </a>
                      <button
                        type="button"
                        :disabled="downloading"
                        class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                        @click="downloadFile(detail.cv!.url, detail.cv?.title || 'cv')"
                      >
                        <Download class="w-3 h-3" />
                        Tải về
                      </button>
                    </div>
                  </div>
                  <!-- Preview iframe — render khi URL accessible -->
                  <div
                    v-if="detail.cv.url && cvIsPreviewable"
                    class="bg-gray-100 -mx-4"
                    style="height: 480px"
                  >
                    <iframe
                      :src="cvPreviewSrc"
                      class="w-full h-full border-0"
                      :title="detail.cv.title || 'CV preview'"
                    />
                  </div>
                  <div
                    v-else-if="detail.cv.url"
                    class="p-6 text-center text-xs text-gray-500"
                  >
                    Không thể preview trực tiếp. Bấm "Mở tab mới" hoặc "Tải về" để xem.
                  </div>
                  <div v-else class="p-6 text-center text-xs text-gray-500">
                    CV chưa có file đính kèm.
                  </div>
                </section>
                <section
                  v-else
                  class="rounded-xl border border-gray-200 p-6 text-center"
                >
                  <FileText class="w-6 h-6 text-gray-300 mx-auto mb-2" />
                  <p class="text-sm font-semibold text-gray-900">Ứng viên không đính kèm CV</p>
                  <p class="text-xs text-gray-500 mt-1">
                    Đơn này được nộp không kèm CV.
                  </p>
                </section>

                <!-- Candidate info -->
                <section class="rounded-xl border border-gray-200 p-4">
                  <p class="text-xs font-semibold text-gray-900 mb-2.5">
                    Thông tin ứng viên
                  </p>
                  <div class="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-gray-500 w-20 shrink-0">Họ tên:</span>
                      <span class="font-medium text-gray-900 truncate">
                        {{ detailRow?.candidateName ?? 'Ẩn danh' }}
                      </span>
                    </div>
                    <div
                      v-if="detail.cv?.candidateId"
                      class="flex items-center gap-2 min-w-0"
                    >
                      <span class="text-gray-500 w-20 shrink-0">User ID:</span>
                      <span class="font-mono text-gray-700 truncate text-[11px]">
                        {{ detail.cv.candidateId }}
                      </span>
                    </div>
                    <div
                      v-if="detailRow?.candidateEmail"
                      class="flex items-center gap-2 min-w-0 sm:col-span-2"
                    >
                      <span class="text-gray-500 w-20 shrink-0">Email:</span>
                      <a
                        :href="`mailto:${detailRow.candidateEmail}`"
                        class="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline truncate"
                      >
                        <Mail class="w-3 h-3 shrink-0" />
                        {{ detailRow.candidateEmail }}
                      </a>
                    </div>
                  </div>

                  <!-- Cover letter -->
                  <div v-if="detail.coverLetter" class="mt-3 pt-3 border-t border-gray-100">
                    <p class="text-xs font-semibold text-gray-900 mb-1.5">
                      Thư xin việc
                    </p>
                    <p
                      class="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed"
                    >
                      {{ detail.coverLetter }}
                    </p>
                  </div>
                </section>

                <!-- Timeline -->
                <section class="rounded-xl border border-gray-200 p-4">
                  <p class="text-xs font-semibold text-gray-900 mb-2.5">Thời gian</p>
                  <div class="space-y-1.5 text-xs text-gray-600">
                    <p class="flex items-center gap-2">
                      <Calendar class="w-3.5 h-3.5 text-gray-400" />
                      Nộp: {{ dayjs(detail.appliedAt).format('DD/MM/YYYY HH:mm') }}
                    </p>
                    <p v-if="detail.viewedAt" class="flex items-center gap-2">
                      <Eye class="w-3.5 h-3.5 text-gray-400" />
                      Bạn đã xem: {{ dayjs(detail.viewedAt).format('DD/MM/YYYY HH:mm') }}
                    </p>
                  </div>
                </section>

                <!-- Status update -->
                <section class="rounded-xl border border-gray-200 p-4">
                  <p class="text-xs font-semibold text-gray-900 mb-2.5">
                    Cập nhật trạng thái
                  </p>
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    <button
                      v-for="s in STATUS_FLOW"
                      :key="s"
                      type="button"
                      class="px-2 py-1.5 text-xs font-medium rounded-md border transition inline-flex items-center justify-center gap-1"
                      :class="
                        detail.status === s
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      "
                      :disabled="statusUpdating !== null"
                      @click="updateStatus(detail.id, s)"
                    >
                      <Loader2
                        v-if="statusUpdating === detail.id"
                        class="w-3 h-3 animate-spin"
                      />
                      <CheckCircle2 v-else-if="s === 'hired'" class="w-3 h-3" />
                      <XCircle v-else-if="s === 'rejected'" class="w-3 h-3" />
                      <Eye v-else-if="s === 'viewed'" class="w-3 h-3" />
                      {{ STATUS_LABEL[s] }}
                    </button>
                  </div>
                  <button
                    v-if="
                      detail.status !== 'rejected' &&
                      detail.status !== 'withdrawn' &&
                      detail.status !== 'hired'
                    "
                    type="button"
                    class="mt-2 w-full px-2 py-1.5 text-xs font-medium rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition inline-flex items-center justify-center gap-1"
                    :disabled="statusUpdating !== null"
                    @click="updateStatus(detail.id, 'rejected')"
                  >
                    <XCircle class="w-3 h-3" />
                    Từ chối đơn này
                  </button>
                </section>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* Match ring — animate từ 0% (full offset) đến % thực tế.
   Sync 1.2s với rAF counter trong script. */
.match-ring {
  animation: draw-ring 1.2s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes draw-ring {
  from {
    stroke-dashoffset: 169.6;
  }
  to {
    stroke-dashoffset: var(--ring-target, 169.6);
  }
}

/* Modal fade + scale nhẹ. */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 200ms ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-active > div,
.modal-leave-active > div {
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
.modal-enter-from > div,
.modal-leave-to > div {
  transform: scale(0.96);
}
</style>
