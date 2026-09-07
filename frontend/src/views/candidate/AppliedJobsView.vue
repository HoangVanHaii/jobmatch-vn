<script setup lang="ts">
/**
 * AppliedJobsView — trang "Việc đã ứng tuyển" của candidate tại
 * `/candidate/applications`.
 *
 * Hiển thị list applications của candidate hiện tại (GET /applications/me).
 * Mỗi row gồm:
 *   - Logo + tên công ty + tiêu đề job
 *   - Status badge (pending/viewed/screening/interview/offered/hired/rejected/withdrawn)
 *   - AI match score (nếu có) hoặc loading indicator (nếu worker chưa xong)
 *   - Ngày apply + ngày employer xem (viewedAt)
 *
 * Realtime:
 *   - Listen socket `application:match-ready` / `application:match-skipped` →
 *     update row tương ứng (không cần refetch).
 *   - Listen `notification:new` filter type=application_match_ready → bell + toast.
 *
 * Filter:
 *   - Dropdown status: pending / viewed / ... / withdrawn + "Tất cả".
 *   - Pagination page/limit=20.
 */
import { computed, onBeforeUnmount, onMounted, ref, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  Loader2,
  Briefcase,
  Calendar,
  Sparkles,
  ExternalLink,
  AlertCircle,
  Search,
  X,
  XCircle,
  FileText,
  Download,
  Eye,
  ChevronDown,
  Check,
  MessageCircle,
  Inbox,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import { applicationApi } from '@services/application.api';
import { useToastStore } from '@stores/toast';
import { useChatStore } from '@stores/chat';
import { getSocket } from '@services/socket';
import { useAuthStore } from '@stores/auth';
import ApplicationDetailPanel from '@components/candidate/ApplicationDetailPanel.vue';
import type {
  ApplicationStatus,
  CandidateApplicationRow,
  ApplicationMatchReadyPayload,
  ApplicationMatchSkippedPayload,
  ApplicationStatusChangedPayload,
} from '@/types/application';

const router = useRouter();
const toast = useToastStore();
const auth = useAuthStore();
const chatStore = useChatStore();

// -----------------------------------------------------------------------
// State
// -----------------------------------------------------------------------
const rows = ref<CandidateApplicationRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(20);
const loading = ref(false);
const error = ref<string | null>(null);
const statusFilter = ref<ApplicationStatus | ''>('');

/**
 * Custom dropdown state — thay thế `<select>` mặc định để UI đồng nhất với
 * các dropdown khác trong app (chip + popover).
 */
const statusDropdownOpen = ref(false);
const statusDropdownRef = ref<HTMLElement | null>(null);

/** Label hiện tại cho button trigger. */
const currentStatusLabel = computed<string>(
  () => STATUS_OPTIONS.find((o) => o.value === statusFilter.value)?.label ?? 'Tất cả',
);

/** Click handler cho từng option trong popover. */
const selectStatus = (value: ApplicationStatus | ''): void => {
  statusFilter.value = value;
  statusDropdownOpen.value = false;
  onFilterChange();
};

/** Click outside để đóng popover. */
const onDocClick = (e: MouseEvent): void => {
  if (statusDropdownRef.value && !statusDropdownRef.value.contains(e.target as Node)) {
    statusDropdownOpen.value = false;
  }
};
/** Esc để đóng popover. */
const onDocKey = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') statusDropdownOpen.value = false;
};

onMounted(() => {
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onDocKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  document.removeEventListener('keydown', onDocKey);
});

// ---------------------------------------------------------------------------
// Force download — bắt buộc save file xuống máy thay vì mở tab mới.
// Cùng pattern với employer ApplicationsView: `<a download>` bị browser bỏ
// qua với cross-origin URL (MinIO ở origin khác với Vite dev server) → dùng
// fetch → blob → same-origin object URL → `a.download` mới có hiệu lực.
// ---------------------------------------------------------------------------
const downloading = ref<string | null>(null);
const downloadCv = async (
  cvUrl: string | null,
  fallbackName: string,
  rowId: string,
): Promise<void> => {
  if (!cvUrl || downloading.value) return;
  downloading.value = rowId;
  try {
    const res = await fetch(cvUrl, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const cd = res.headers.get('Content-Disposition') ?? '';
    const starMatch = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const plainMatch = cd.match(/filename="?([^";]+)"?/i);
    const suggested = starMatch
      ? decodeURIComponent(starMatch[1])
      : plainMatch
        ? plainMatch[1]
        : null;
    const filename = suggested || fallbackName || cvUrl.split('/').pop() || 'cv';

    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  } catch {
    toast.push({
      variant: 'error',
      title: 'Tải về thất bại',
      body: 'Không thể tải file. Vui lòng thử lại sau.',
    });
  } finally {
    downloading.value = null;
  }
};

/**
 * Drawer detail — mở khi click row. Click job link trong drawer sẽ đóng
 * drawer + navigate sang trang job (xem `goToJob` helper trong drawer).
 */
const detailRow = ref<CandidateApplicationRow | null>(null);
const detailOpen = ref(false);

const openDetail = (row: CandidateApplicationRow, e: Event): void => {
  e.stopPropagation();
  detailRow.value = row;
  detailOpen.value = true;
};

const onDrawerWithdrawn = (id: string): void => {
  // Optimistic flip trong list (không refetch).
  const row = rows.value.find((r) => r.id === id);
  if (row) row.status = 'withdrawn';
};

// Withdraw modal — giữ cho preview ở list (click nút rút ngay trên row).
const withdrawTarget = ref<CandidateApplicationRow | null>(null);
const withdrawing = ref(false);

// Chat — track id nào đang tạo conversation để disable button tương ứng.
const chatLoadingId = ref<string | null>(null);

/**
 * Tạo conversation với recruiter đăng job rồi navigate sang /candidate/chat/:id.
 * Click row không mở detail (stopPropagation) vì Chat là action riêng.
 */
const contactEmployer = async (row: CandidateApplicationRow, e: Event): Promise<void> => {
  e.stopPropagation();
  if (!row.jobPostedBy || chatLoadingId.value) return;
  chatLoadingId.value = row.id;
  try {
    const conversationId = await chatStore.createOrGet({
      peerUserId: row.jobPostedBy,
      jobId: row.jobId,
    });
    void router.push({ name: 'chat', params: { id: conversationId } });
  } catch {
    toast.push({
      variant: 'error',
      title: 'Không thể mở cuộc trò chuyện',
      body: 'Vui lòng thử lại sau ít phút.',
    });
  } finally {
    chatLoadingId.value = null;
  }
};

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));

/**
 * Status mà candidate có thể rút đơn.
 * Match với backend service.application.withdraw (xem backend):
 *   - pending: chưa ai xem
 *   - viewed: employer đã mở xem nhưng chưa screening
 * Các status khác (screening/interview/offered/hired/rejected/withdrawn) → không rút được.
 */
const WITHDRAWABLE_STATUSES: ApplicationStatus[] = ['pending', 'viewed'];

const canWithdraw = (row: CandidateApplicationRow): boolean =>
  WITHDRAWABLE_STATUSES.includes(row.status);

interface StatusOption {
  value: ApplicationStatus | '';
  label: string;
}

const STATUS_OPTIONS: StatusOption[] = [
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
  // Amber — chờ duyệt.
  pending: 'bg-amber-100 text-amber-800',
  // Violet — đang xử lý (đã xem / sàng lọc / phỏng vấn / đề nghị).
  viewed: 'bg-violet-100 text-violet-800',
  screening: 'bg-violet-100 text-violet-800',
  interview: 'bg-violet-100 text-violet-800',
  offered: 'bg-violet-100 text-violet-800',
  // Green — đã tuyển (success).
  hired: 'bg-emerald-100 text-emerald-800',
  // Red — bị từ chối.
  rejected: 'bg-red-100 text-red-800',
  // Gray — đã rút (neutral).
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

// -----------------------------------------------------------------------
// Fetch
// -----------------------------------------------------------------------
const fetchList = async (): Promise<void> => {
  loading.value = true;
  error.value = null;
  try {
    const { data } = await applicationApi.listMine({
      status: statusFilter.value || undefined,
      page: page.value,
      limit: limit.value,
    });
    rows.value = data.data.rows;
    total.value = data.data.total;
  } catch (err) {
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

// -----------------------------------------------------------------------
// Realtime updates — patch row trực tiếp khi worker xong
// -----------------------------------------------------------------------
const onMatchReady = (payload: ApplicationMatchReadyPayload): void => {
  const row = rows.value.find((r) => r.id === payload.applicationId);
  if (!row) return;

  // Patch `aiMatchReason` từ payload để badge chuyển terminal ngay khi
  // worker skip (quota_exceeded / failed) thay vì phải chờ refetch.
  if (payload.reason) {
    row.aiMatchReason = payload.reason;
  }

  // Patch `aiMatchScore` chỉ khi worker trả về matchPercent (case success).
  // quota_exceeded / failed → matchPercent = null → KHÔNG touch score.
  if (payload.matchPercent != null) {
    row.aiMatchScore = String(payload.matchPercent);
  }
};

const onMatchSkipped = (payload: ApplicationMatchSkippedPayload): void => {
  const row = rows.value.find((r) => r.id === payload.applicationId);
  if (!row) return;
  // Patch reason để badge chuyển về "Hết lượt AI" (terminal state, không spinner).
  row.aiMatchReason = 'quota_exceeded';
  // Toast cho user biết — copy cũ đã có sẵn.
  toast.push({
    variant: 'warning',
    title: 'AI matching không khả dụng',
    body: 'Bạn đã apply thành công, nhưng hệ thống tạm thời hết quota AI match cho CV này.',
  });
};

/**
 * Realtime status change — employer đổi status → patch row + toast.
 * Update cả list row (nếu có) và detail drawer đang mở cho application đó
 * (tránh mismatch khi user đang xem detail mà status thay đổi).
 */
const STATUS_TOAST: Partial<Record<ApplicationStatus, { title: string; variant: 'info' | 'success' | 'warning' | 'error' }>> = {
  viewed: { title: 'Nhà tuyển dụng đã xem đơn của bạn', variant: 'info' },
  screening: { title: 'Đơn của bạn đang được sàng lọc', variant: 'info' },
  interview: { title: 'Bạn được mời phỏng vấn', variant: 'success' },
  offered: { title: 'Bạn nhận được đề nghị', variant: 'success' },
  hired: { title: 'Chúc mừng! Bạn đã được tuyển', variant: 'success' },
  rejected: { title: 'Đơn của bạn đã bị từ chấp nhận', variant: 'warning' },
};

const onStatusChanged = (payload: ApplicationStatusChangedPayload): void => {
  // 1. Patch row trong list (nếu đang hiển thị).
  const row = rows.value.find((r) => r.id === payload.applicationId);
  if (row) {
    row.status = payload.status;
    row.stage = payload.stage;
    if (payload.viewedAt) row.viewedAt = payload.viewedAt;
  }

  // 2. Nếu drawer detail đang mở cho application này → patch row + emit
  //    lên để panel tự refetch (hoặc patch trực tiếp).
  if (detailRow.value?.id === payload.applicationId) {
    detailRow.value.status = payload.status;
    detailRow.value.stage = payload.stage;
    if (payload.viewedAt) detailRow.value.viewedAt = payload.viewedAt;
  }

  // 3. Toast — skip withdrawn (candidate là người trigger).
  const cfg = STATUS_TOAST[payload.status];
  if (cfg && row) {
    const jobLabel = row.jobTitle ?? 'đơn ứng tuyển';
    toast.push({
      variant: cfg.variant,
      title: cfg.title,
      body: `Trạng thái đơn "${jobLabel}" vừa được cập nhật.`,
    });
  }
};

// -----------------------------------------------------------------------
// Mount + socket
// -----------------------------------------------------------------------
let socket: ReturnType<typeof getSocket> | null = null;

onMounted(async () => {
  await fetchList();
  // Chỉ connect socket khi user đã login (auth token có sẵn).
  if (auth.isAuthenticated) {
    socket = getSocket();
    if (!socket.connected) socket.connect();
    socket.on('application:match-ready', onMatchReady);
    socket.on('application:match-skipped', onMatchSkipped);
    socket.on('application:status-changed', onStatusChanged);
  }
});

onUnmounted(() => {
  if (socket) {
    socket.off('application:match-ready', onMatchReady);
    socket.off('application:match-skipped', onMatchSkipped);
    socket.off('application:status-changed', onStatusChanged);
  }
});

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
const formatMatchScore = (score: string | null): string => {
  if (score == null) return '';
  const n = Number(score);
  return Number.isFinite(n) ? `${Math.round(n)}%` : '';
};

/**
 * Phân cấp điểm AI match để chọn màu chip:
 *   - >= 80: high (emerald) — fit tốt
 *   - >= 50: mid  (amber)   — fit trung bình
 *   - <  50: low  (rose)    — không phù hợp
 *
 * Trả null nếu score null / NaN để template không render màu.
 */
type MatchLevel = 'high' | 'mid' | 'low';

const MATCH_STYLE: Record<MatchLevel, { bg: string; text: string; border: string; icon: string; ring: string; label: string }> = {
  high: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    icon: 'text-emerald-600',
    ring: '#10b981',
    label: 'Cao',
  },
  mid: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    icon: 'text-amber-600',
    ring: '#f59e0b',
    label: 'Trung bình',
  },
  low: {
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    icon: 'text-rose-600',
    ring: '#f43f5e',
    label: 'Thấp',
  },
};

const matchLevel = (score: string | null): MatchLevel | null => {
  if (score == null) return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 80) return 'high';
  if (n >= 50) return 'mid';
  return 'low';
};

/** Status "in-progress" — có dot pulse để nhấn mạnh đang hoạt động. */
const PROCESSING_STATUSES: ApplicationStatus[] = ['viewed', 'screening', 'interview', 'offered'];
const isProcessing = (s: ApplicationStatus): boolean => PROCESSING_STATUSES.includes(s);

// ---------------------------------------------------------------------------
// Company avatar fallback — khi không có logo, render chữ cái đầu trên nền
// gradient primary nhạt. Style match với JobCard ở trang danh sách việc làm.
// ---------------------------------------------------------------------------

/** Chữ cái đầu của companyName (uppercase). Fallback "J" nếu null/rỗng. */
const companyInitial = (name: string | null): string => {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'J';
  // Bỏ qua khoảng trắng/dấu đầu — lấy chữ cái đầu tiên của từ đầu.
  return trimmed.charAt(0).toLocaleUpperCase('vi-VN');
};

/**
 * "Nhà tuyển dụng đã xem …" — dùng fromNow relative nếu < 24h, ngược lại
 * format ngày. Dayjs không có plugin relativeTime → dùng format thường.
 */
const formatViewedAt = (iso: string): string => {
  const d = dayjs(iso);
  const hours = Date.now() - d.valueOf();
  if (hours < 60_000) return 'vừa xong';
  const day = Math.floor(hours / (60 * 60 * 1000 * 24));
  if (day < 1) return d.format('HH:mm');
  if (day < 30) return `${day} ngày trước`;
  return d.format('DD/MM');
};

// -----------------------------------------------------------------------
// Withdraw flow
// -----------------------------------------------------------------------
const openWithdrawModal = (row: CandidateApplicationRow, e: Event): void => {
  // Stop propagation để không trigger navigate tới job detail.
  e.stopPropagation();
  withdrawTarget.value = row;
};

const closeWithdrawModal = (): void => {
  if (withdrawing.value) return;
  withdrawTarget.value = null;
};

const confirmWithdraw = async (): Promise<void> => {
  const target = withdrawTarget.value;
  if (!target || withdrawing.value) return;
  withdrawing.value = true;
  try {
    await applicationApi.withdraw(target.id);
    toast.push({
      variant: 'success',
      title: 'Đã rút đơn ứng tuyển',
      body: target.jobTitle ?? '',
    });
    // Optimistic update: flip status ngay trong list (không cần refetch).
    const row = rows.value.find((r) => r.id === target.id);
    if (row) row.status = 'withdrawn';
    closeWithdrawModal();
  } catch (err) {
    const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
    const messageMap: Record<string, string> = {
      CANNOT_WITHDRAW: 'Không thể rút đơn ở trạng thái hiện tại.',
      APPLICATION_NOT_FOUND: 'Đơn ứng tuyển không còn tồn tại.',
      APPLICATION_FORBIDDEN: 'Bạn không sở hữu đơn này.',
    };
    toast.push({
      variant: 'error',
      title: 'Rút đơn thất bại',
      body: messageMap[code ?? ''] ?? 'Vui lòng thử lại sau.',
    });
    // Đóng modal cả khi lỗi — user đã thấy toast, không nên kẹt lại trong form.
    closeWithdrawModal();
    // Nếu status thực sự đã đổi ở BE (vd concurrent) → refetch để sync.
    if (code === 'CANNOT_WITHDRAW') {
      void fetchList();
    }
  } finally {
    withdrawing.value = false;
  }
};
</script>

<template>
  <!--
    Layout 2-cột trên desktop / 1-cột trên mobile:

      - Bên trái: list applications. Desktop → 60% width, fixed-height với
        internal scroll (header + filter pin trên đầu, list cards scroll bên
        dưới). Khi list ngắn hơn viewport → không scrollbar.
      - Bên phải: detail panel khi đã chọn, empty-state redesign khi chưa.
        Desktop luôn 40%. Mobile khi detailOpen → full-screen overlay (list ẩn),
        khi đóng → hidden (chỉ list).

    Outer `lg:h-screen lg:overflow-hidden` lock viewport trên desktop → body
    không scroll, mọi thao tác scroll xảy ra bên trong list column. Mobile:
    page scroll bình thường (lg: không áp dụng).
  -->
  <div class="bg-gray-50/50 p-5 md:p-8 lg:h-screen lg:overflow-hidden">
    <div class="lg:flex lg:gap-6 lg:max-w-[1280px] lg:mx-auto lg:h-full">

      <!-- ====== List column (60%) — flex col với internal scroll ====== -->
      <div
        :class="[
          'min-w-0 transition-all flex flex-col',
          detailOpen ? 'hidden lg:flex' : 'block lg:flex',
          'lg:w-[60%] lg:h-full',
        ]"
      >
        <!--
          Header + filter — pin trên đầu list column (không scroll ra ngoài).
          `shrink-0` để flex parent không ép nhỏ khi scroll area phát triển.
        -->
        <div class="shrink-0">
          <header class="mb-4 lg:mb-5">
            <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Việc đã ứng tuyển</h1>
            <p class="text-sm text-gray-500 mt-1">
              Theo dõi trạng thái và điểm AI match của các hồ sơ bạn đã nộp.
            </p>
          </header>

          <div ref="statusDropdownRef" class="relative inline-block mb-3 lg:mb-4">
            <button
              type="button"
              class="relative inline-flex items-center gap-1.5 pl-7 pr-2 py-1 text-xs text-gray-700 border border-gray-200 hover:text-gray-900 hover:bg-gray-100/70 rounded transition"
              :class="statusDropdownOpen ? 'bg-gray-100/70 text-gray-900' : ''"
              aria-haspopup="listbox"
              :aria-expanded="statusDropdownOpen"
              @click="statusDropdownOpen = !statusDropdownOpen"
            >
              <Search class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <span class="font-medium">{{ currentStatusLabel }}</span>
              <ChevronDown
                class="w-3.5 h-3.5 text-gray-400 transition-transform"
                :class="statusDropdownOpen ? 'rotate-180' : ''"
              />
            </button>

            <Transition>
              <ul
                v-if="statusDropdownOpen"
                role="listbox"
                class="absolute top-full left-0 mt-1 z-30 min-w-[160px] bg-white border border-gray-200 rounded shadow-sm overflow-hidden py-0.5"
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
        </div>

        <!--
          Scrollable list area.
            - `lg:flex-1 lg:min-h-0` để flex parent cho area chiếm phần height
              còn lại (không bị content đẩy xuống).
            - `lg:overflow-y-auto scrollbar-thin` chỉ scroll bên trong area.
            - Mobile: không áp dụng flex-1/min-h-0, nội dung flow bình thường
              theo page scroll.
        -->
        <div class="lg:flex-1 lg:min-h-0 lg:overflow-y-auto scrollbar-thin lg:pr-1 space-y-3 max-w-[640px]">
          <!-- Loading -->
          <div v-if="loading" class="flex items-center justify-center py-16 text-sm text-gray-500">
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

          <!-- Empty — phân biệt 2 case: chưa apply gì vs filter không khớp -->
          <div
            v-else-if="rows.length === 0"
            class="bg-white border border-gray-200 rounded-xl p-10 text-center"
          >
            <template v-if="statusFilter">
              <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                <Search class="w-6 h-6 text-gray-500" />
              </div>
              <h3 class="text-sm font-semibold text-gray-900">
                Không có đơn nào ở trạng thái "{{ STATUS_LABEL[statusFilter] ?? currentStatusLabel }}"
              </h3>
              <p class="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Thử bỏ bộ lọc để xem tất cả đơn ứng tuyển của bạn.
              </p>
              <button
                type="button"
                class="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded transition"
                @click="selectStatus('')"
              >
                <X class="w-4 h-4" />
                Bỏ lọc
              </button>
            </template>
            <template v-else>
              <div class="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mx-auto mb-3">
                <Briefcase class="w-6 h-6 text-primary-600" />
              </div>
              <h3 class="text-sm font-semibold text-gray-900">Bạn chưa ứng tuyển job nào</h3>
              <p class="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Hãy khám phá các job phù hợp và bấm "Ứng tuyển ngay" để bắt đầu.
              </p>
              <button
                type="button"
                class="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded transition"
                @click="router.push({ name: 'candidate-jobs' })"
              >
                Khám phá việc làm
              </button>
            </template>
          </div>

          <!-- List -->
          <template v-else>
            <article
              v-for="row in rows"
              :key="row.id"
              :class="[
                'group bg-white border border-gray-200 rounded-[14px] p-4 sm:p-[18px] shadow-sm',
                'hover:shadow-md hover:-translate-y-px hover:border-gray-300 transition cursor-pointer',
                'flex gap-3.5',
                row.status === 'withdrawn' ? 'opacity-60 hover:opacity-90' : '',
                detailRow?.id === row.id
                  ? 'border-primary-500'
                  : '',
              ]"
              @click="openDetail(row, $event)"
            >
              <!-- Company logo / initial fallback -->
              <div
                class="shrink-0 w-[42px] h-[42px] rounded-[10px] overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 text-primary-700 font-bold text-[15px] ring-1 ring-black/5"
                :aria-label="row.companyName ?? 'Công ty'"
              >
                <img
                  v-if="row.companyLogoUrl"
                  :src="row.companyLogoUrl"
                  :alt="row.companyName ?? ''"
                  class="w-full h-full object-cover bg-gray-50"
                />
                <span v-else>{{ companyInitial(row.companyName) }}</span>
              </div>

              <!-- Main -->
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2.5">
                  <div class="min-w-0">
                    <h3 class="text-[14.5px] font-semibold tracking-tight text-gray-900 truncate">
                      {{ row.jobTitle ?? '(Job đã bị xoá)' }}
                    </h3>
                    <p class="text-[12.5px] text-gray-500 mt-0.5 truncate">
                      {{ row.companyName ?? 'Công ty ẩn danh' }}
                    </p>
                  </div>
                  <span
                    class="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap"
                    :class="[
                      STATUS_COLOR[row.status],
                      isProcessing(row.status) ? 'animate-[badge-pulse_1.4s_infinite_ease-in-out]' : '',
                    ]"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
                    {{ STATUS_LABEL[row.status] }}
                  </span>
                </div>

                <div class="mt-1.5 flex items-center gap-1 text-[11.5px] text-gray-400">
                  <Calendar class="w-3 h-3" />
                  Nộp {{ dayjs(row.appliedAt).format('DD/MM/YYYY') }}
                  <span v-if="row.viewedAt" class="inline-flex items-center gap-1 ml-2">
                    <Eye class="w-3 h-3" />
                    Nhà tuyển dụng đã xem {{ formatViewedAt(row.viewedAt) }}
                  </span>
                </div>

                <!-- Cover letter preview -->
                <p
                  v-if="row.coverLetter"
                  class="mt-1.5 text-[12px] text-gray-500 italic line-clamp-2 pl-2 border-l-2 border-gray-200"
                >
                  "{{ row.coverLetter }}"
                </p>

                <!-- Bottom row: CV chip + AI match (trái) / Rút đơn + Chat (phải) -->
                <div
                  v-if="row.cvTitle || row.cvUrl || row.aiMatchScore != null || row.status !== 'withdrawn' || canWithdraw(row) || row.jobPostedBy"
                  class="mt-3 flex items-center justify-between gap-2.5 flex-wrap"
                >
                  <div class="flex items-center gap-2 flex-wrap min-w-0">
                    <!-- CV chip -->
                    <span
                      v-if="row.cvTitle || row.cvUrl"
                      class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-100 text-[11.5px] font-medium text-gray-600 max-w-[170px]"
                    >
                      <FileText class="w-3 h-3 text-gray-500 shrink-0" />
                      <span class="truncate">{{ row.cvTitle ?? 'CV' }}</span>
                      <button
                        v-if="row.cvUrl"
                        type="button"
                        class="text-primary-600 hover:text-primary-800 shrink-0 disabled:opacity-50"
                        title="Tải xuống"
                        :disabled="downloading === row.id"
                        @click.stop="downloadCv(row.cvUrl, row.cvTitle ?? 'cv', row.id)"
                      >
                        <Loader2
                          v-if="downloading === row.id"
                          class="w-3 h-3 animate-spin"
                        />
                        <Download v-else class="w-3 h-3" />
                      </button>
                    </span>

                    <!-- AI match mini (text only — radial chỉ ở detail panel) -->
                    <span
                      v-if="row.aiMatchScore != null"
                      class="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-violet-700"
                      :title="`Mức độ phù hợp: ${MATCH_STYLE[matchLevel(row.aiMatchScore)!]?.label ?? ''}`"
                    >
                      <Sparkles class="w-3.5 h-3.5 text-violet-600" />
                      {{ formatMatchScore(row.aiMatchScore) }} phù hợp
                    </span>
                    <!-- Trạng thái terminal khi worker skip do quota/LLM lỗi — badge
                         cố định (không spinner) để user biết matching đã kết thúc
                         không thành công, không phải "đang chờ". -->
                    <span
                      v-else-if="row.aiMatchReason === 'quota_exceeded'"
                      class="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[11.5px] font-semibold"
                      title="Bạn đã hết lượt AI match — nâng cấp gói để dùng tiếp"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-amber-600" />
                      Hết lượt AI
                    </span>
                    <span
                      v-else-if="row.aiMatchReason === 'failed'"
                      class="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full bg-rose-100 text-rose-800 text-[11.5px] font-semibold"
                      title="AI tạm thời không khả dụng, sẽ thử lại sau"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-rose-600" />
                      AI tạm lỗi
                    </span>
                    <span
                      v-else-if="row.status !== 'withdrawn'"
                      class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-violet-100 text-violet-800 text-[11.5px] font-semibold"
                    >
                      <Loader2 class="w-3 h-3 animate-spin" />
                      Đang so khớp
                    </span>
                  </div>

                  <!-- Actions: Rút đơn + Chat -->
                  <div class="flex items-center gap-2">
                    <button
                      v-if="canWithdraw(row)"
                      type="button"
                      class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-white border border-gray-200 hover:bg-red-50 hover:border-red-200 rounded-lg transition"
                      @click="openWithdrawModal(row, $event)"
                    >
                      <XCircle class="w-3.5 h-3.5" />
                      Rút đơn
                    </button>
                    <button
                      v-if="row.jobPostedBy"
                      type="button"
                      class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed"
                      :disabled="chatLoadingId === row.id"
                      @click="contactEmployer(row, $event)"
                    >
                      <Loader2 v-if="chatLoadingId === row.id" class="w-3.5 h-3.5 animate-spin" />
                      <MessageCircle v-else class="w-3.5 h-3.5" />
                      Chat
                    </button>
                  </div>
                </div>
              </div>
            </article>

            <!-- Pagination (cuối list, scroll cùng content) -->
            <nav v-if="!loading && rows.length > 0" class="mt-4 flex items-center justify-between text-sm text-gray-600">
              <p>
                Trang <span class="font-medium">{{ page }}</span> / {{ totalPages }}
                · {{ total }} hồ sơ
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
          </template>
        </div>
        <!-- /Scrollable list area -->
      </div>
      <!-- /List column -->

      <!-- ====== Right column (40%) — detail panel hoặc empty-state ====== -->
      <!--
        Desktop: luôn `lg:w-[40%] lg:max-w-[520px] lg:h-full` (flex sibling với
        list column). Mobile: khi detailOpen → full-screen overlay (fixed inset-0
        z-50, list ẩn), khi đóng → hidden (chỉ list chiếm page).
      -->
      <div
        :class="[
          'lg:shrink-0 lg:w-[40%] lg:max-w-[520px] lg:h-full',
          detailOpen
            ? 'fixed inset-0 z-50 bg-white lg:static lg:bg-transparent lg:z-auto'
            : 'hidden lg:block',
        ]"
      >
        <ApplicationDetailPanel
          v-if="detailOpen"
          v-model:open="detailOpen"
          :application="detailRow"
          @withdrawn="onDrawerWithdrawn"
        />
        <!--
          Empty-state panel khi chưa chọn đơn nào.
            - Container ngoài `h-full flex items-center justify-center` canh
              giữa cả 2 chiều trong right column.
            - `bg-white` đồng bộ với panel bên cạnh.
            - Inner `mt-12` đẩy content xuống 1 chút cho cảm giác thoáng.
        -->
        <div
          v-else
          class="h-full flex items-center justify-center bg-white p-8"
          aria-hidden="true"
        >
          <div class="w-full max-w-[250px] flex flex-col items-center text-center mt-12">
            <div
              class="relative w-[76px] h-[76px] rounded-[20px] bg-gradient-to-br from-violet-50 to-violet-100 flex items-center justify-center mb-5"
            >
              <svg
                width="34"
                height="34"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#7C3AED"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="relative z-10"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M9 13l1.8 1.8L15 10.5" />
              </svg>
              <span
                class="pointer-events-none absolute -inset-1.5 rounded-[24px] border-[1.5px] border-dashed border-violet-200"
                aria-hidden="true"
              />
            </div>
            <p class="text-[14.5px] font-bold text-gray-900 mb-2">Chọn một đơn ứng tuyển</p>
            <div class="flex flex-col gap-2.5 w-full mt-1.5">
              <div class="flex items-center gap-2.5 text-left text-xs text-gray-600">
                <span
                  class="w-[18px] h-[18px] rounded-full bg-violet-100 text-violet-700 text-[10.5px] font-bold flex items-center justify-center shrink-0"
                >1</span>
                Bấm vào 1 job trong danh sách bên trái
              </div>
              <div class="flex items-center gap-2.5 text-left text-xs text-gray-600">
                <span
                  class="w-[18px] h-[18px] rounded-full bg-violet-100 text-violet-700 text-[10.5px] font-bold flex items-center justify-center shrink-0"
                >2</span>
                Xem điểm AI matching &amp; nhận xét chi tiết
              </div>
              <div class="flex items-center gap-2.5 text-left text-xs text-gray-600">
                <span
                  class="w-[18px] h-[18px] rounded-full bg-violet-100 text-violet-700 text-[10.5px] font-bold flex items-center justify-center shrink-0"
                >3</span>
                Chat trực tiếp với nhà tuyển dụng
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!--
      Withdraw confirm modal — sibling của master-detail flex (z-[60]) để đảm bảo
      modal nằm trên cả detail panel overlay (z-50). Vì `fixed` nên vị trí DOM
      không ảnh hưởng rendering; tách ra cho gọn structure.
    -->
    <div
      v-if="withdrawTarget"
      class="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      @click.self="closeWithdrawModal"
    >
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div class="flex items-start gap-3 p-5">
          <div class="shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle class="w-5 h-5 text-red-600" />
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-semibold text-gray-900">Rút đơn ứng tuyển?</h3>
            <p class="text-sm text-gray-600 mt-1">
              Bạn sẽ rút đơn cho vị trí
              <span class="font-semibold text-gray-900">"{{ withdrawTarget.jobTitle ?? '(Job đã bị xoá)' }}"</span>
              tại <span class="font-semibold text-gray-900">{{ withdrawTarget.companyName ?? 'công ty' }}</span>.
            </p>
            <p class="text-xs text-gray-500 mt-2">
              Hành động này không thể hoàn tác. Bạn có thể ứng tuyển lại job này sau nếu muốn.
            </p>
          </div>
          <button
            type="button"
            class="text-gray-400 hover:text-gray-600 transition shrink-0"
            :disabled="withdrawing"
            @click="closeWithdrawModal"
          >
            <X class="w-5 h-5" />
          </button>
        </div>
        <div class="flex items-center justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
            :disabled="withdrawing"
            @click="closeWithdrawModal"
          >
            Huỷ
          </button>
          <button
            type="button"
            class="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="withdrawing"
            @click="confirmWithdraw"
          >
            <Loader2 v-if="withdrawing" class="w-4 h-4 animate-spin" />
            {{ withdrawing ? 'Đang rút...' : 'Rút đơn' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/**
 * Pulse animation cho badge dot khi status đang "in-progress"
 * (viewed/screening/interview/offered). Dùng scoped style vì Tailwind
 * không có sẵn keyframe này.
 */
@keyframes badge-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
</style>
