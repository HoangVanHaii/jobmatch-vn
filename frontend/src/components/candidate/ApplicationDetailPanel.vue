<script setup lang="ts">
/**
 * ApplicationDetailPanel — inline detail panel 1 application của candidate.
 *
 * Render inline trong master-detail 2 cột cùng list (không overlay/drawer).
 * Parent dùng flex/grid 2-cột:
 *   - Cột trái: list các application.
 *   - Cột phải: <ApplicationDetailPanel> (cố định 1 cột khi có selection).
 *
 * Props:
 *   - `application`: row từ listMine — dùng cho instant header render trước
 *     khi fetch detail xong (jobTitle, companyName, status…). Null = đóng.
 *   - `open`: v-model:open để parent show/hide. Khi đóng → parent nên
 *     un-render hoặc hiển thị placeholder.
 *
 * Emits:
 *   - `update:open`: parent bắt để set detailRow = null (reset selection).
 *   - `withdrawn(id)`: parent flip row.status='withdrawn' trong list optimistic.
 *
 * Sections (vertical scroll nếu tràn):
 *   - Header (sticky top): logo + jobTitle + company + status badge + close.
 *   - Job context: location (jobs.location jsonb), deadline countdown.
 *   - AI match card: score + reasoning (strengths / missing / concerns / rationale).
 *   - CV snapshot: title + file download (nếu có cv.url).
 *   - Cover letter: full text (nếu có).
 *   - Timeline: appliedAt → viewedAt → status transitions.
 *   - Footer (sticky bottom): nút rút đơn (chỉ khi canWithdraw) + đóng.
 *
 * Best-effort realtime:
 *   - Listen socket `application:match-ready` cho id này → re-fetch detail.
 */
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import {
  MapPin,
  CalendarClock,
  Sparkles,
  FileText,
  Download,
  ExternalLink,
  Clock,
  CheckCircle2,
  Eye,
  AlertCircle,
  XCircle,
  X as CloseIcon,
  Loader2,
  Inbox,
  MessageCircle,
  Check,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { applicationApi } from '@services/application.api';
import { useToastStore } from '@stores/toast';
import { useChatStore } from '@stores/chat';
import { getSocket } from '@services/socket';
import { useAuthStore } from '@stores/auth';
import type {
  ApplicationDetail,
  ApplicationMatchReadyPayload,
  ApplicationStatus,
  ApplicationStatusChangedPayload,
  CandidateApplicationRow,
} from '@/types/application';

dayjs.locale('vi');

const props = defineProps<{
  application: CandidateApplicationRow | null;
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  withdrawn: [applicationId: string];
}>();

const toast = useToastStore();
const auth = useAuthStore();
const router = useRouter();
const chatStore = useChatStore();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const detail = ref<ApplicationDetail | null>(null);
const loading = ref(false);
const errorMsg = ref<string | null>(null);

// Withdraw flow
const showWithdrawConfirm = ref(false);
const withdrawing = ref(false);

// Contact (create conversation + navigate)
const contacting = ref(false);

// ---------------------------------------------------------------------------
// Force download — bắt buộc save file xuống máy thay vì mở tab mới.
// Cùng pattern với employer ApplicationsView: `<a download>` bị browser bỏ
// qua với cross-origin URL (MinIO ở origin khác với Vite dev server) → dùng
// fetch → blob → same-origin object URL → `a.download` mới có hiệu lực.
// ---------------------------------------------------------------------------
const downloading = ref(false);
const downloadCv = async (cvUrl: string, fallbackName: string): Promise<void> => {
  if (downloading.value) return;
  downloading.value = true;
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
    downloading.value = false;
  }
};

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
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

const STATUS_COLOR: Record<ApplicationStatus, string> = {
  // Amber — chờ duyệt.
  pending: 'bg-amber-100 text-amber-800',
  // Violet — đang xử lý (matching đợi cũng là violet).
  viewed: 'bg-violet-100 text-violet-800',
  screening: 'bg-violet-100 text-violet-800',
  interview: 'bg-violet-100 text-violet-800',
  offered: 'bg-violet-100 text-violet-800',
  // Green — đã tuyển.
  hired: 'bg-emerald-100 text-emerald-800',
  // Red — bị từ chối.
  rejected: 'bg-red-100 text-red-800',
  // Gray — đã rút.
  withdrawn: 'bg-gray-100 text-gray-500',
};

/** Màu ring + label cho AI match — dùng cho radial trong card panel. */
type MatchLevel = 'high' | 'mid' | 'low';
const MATCH_LEVEL: Record<MatchLevel, { ring: string; label: string; text: string }> = {
  high: { ring: '#10b981', label: 'Cao', text: 'text-emerald-700' },
  mid: { ring: '#f59e0b', label: 'Trung bình', text: 'text-amber-700' },
  low: { ring: '#f43f5e', label: 'Thấp', text: 'text-rose-700' },
};
const matchLevelFromPercent = (n: number): MatchLevel =>
  n >= 80 ? 'high' : n >= 50 ? 'mid' : 'low';

/** Logo fallback — gradient primary nhạt + chữ cái đầu. Style match với JobCard. */
const companyInitial = (name: string | null): string => {
  const t = (name ?? '').trim();
  return t ? t.charAt(0).toLocaleUpperCase('vi-VN') : 'J';
};

/** Logo URL ưu tiên detail (sau fetch), fallback về row (instant header). */
const headerLogoUrl = computed<string | null>(() =>
  detail.value?.companyLogoUrl ?? props.application?.companyLogoUrl ?? null,
);
const headerCompanyName = computed<string | null>(() =>
  detail.value?.companyName ?? props.application?.companyName ?? null,
);
const headerJobTitle = computed<string | null>(() =>
  detail.value?.jobTitle ?? props.application?.jobTitle ?? null,
);

const WITHDRAWABLE: ApplicationStatus[] = ['pending', 'viewed'];
const canWithdraw = (status: ApplicationStatus): boolean =>
  WITHDRAWABLE.includes(status);

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------
const currentStatus = computed<ApplicationStatus>(() =>
  detail.value?.status ?? props.application?.status ?? 'pending',
);

const locationText = computed<string | null>(() => {
  const loc = detail.value?.jobLocation;
  if (!loc) return null;
  const parts = [loc.city, loc.district].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : (loc.address ?? null);
});

const deadlineInfo = computed<{ text: string; expired: boolean } | null>(() => {
  const d = detail.value?.jobDeadline;
  if (!d) return null;
  const date = new Date(d);
  const diffDays = Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return { text: 'Đã hết hạn', expired: true };
  if (diffDays === 0) return { text: 'Hết hạn hôm nay', expired: false };
  if (diffDays === 1) return { text: 'Còn 1 ngày', expired: false };
  return { text: `Còn ${diffDays} ngày`, expired: false };
});

const matchScoreText = computed<string | null>(() => {
  const s = detail.value?.aiMatchScore;
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? `${Math.round(n)}%` : null;
});

/**
 * Trạng thái terminal của AI matching — null nếu đang chấm (spinner).
 * FE dựa vào đây để đổi "Đang so khớp" thành badge terminal khi worker
 * skip do quota_exceeded hoặc fail. Mirror `ApplicationMatchReasoning.reason`.
 */
const matchTerminalReason = computed<
  'quota_exceeded' | 'failed' | null
>(() => {
  const r = detail.value?.aiMatchReasoning?.reason;
  if (r === 'quota_exceeded' || r === 'failed') return r;
  return null;
});

/**
 * Số % hiển thị trong ring — animate từ 0 → target khi score load/realtime update.
 * Dùng rAF để chạy mượt ~60fps, ease-out cubic cho cảm giác "đến" tự nhiên.
 */
const matchPercentNumber = ref(0);
let matchPercentRaf: number | null = null;

const animateMatchPercent = (target: number): void => {
  if (matchPercentRaf !== null) cancelAnimationFrame(matchPercentRaf);
  const start = performance.now();
  const duration = 1200; // sync với CSS animation của ring (1.2s).
  const from = 0;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    // Ease-out cubic: 1 - (1 - t)^3
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

onBeforeUnmount(() => {
  if (matchPercentRaf !== null) cancelAnimationFrame(matchPercentRaf);
});

interface TimelineStep {
  label: string;
  at: string | null;
  done: boolean;
  icon: typeof CheckCircle2;
}

const timeline = computed<TimelineStep[]>(() => {
  const detail_ = detail.value;
  const status = currentStatus.value;
  const appliedAt = detail_?.appliedAt ?? props.application?.appliedAt ?? null;
  const viewedAt = detail_?.viewedAt ?? props.application?.viewedAt ?? null;

  return [
    { label: 'Nộp đơn', at: appliedAt, done: true, icon: CheckCircle2 },
    {
      label: 'Nhà tuyển dụng xem',
      at: viewedAt,
      done: viewedAt != null,
      icon: Eye,
    },
    {
      label: STATUS_LABEL[status],
      at: null,
      done: false,
      icon: AlertCircle,
    },
  ];
});

// ---------------------------------------------------------------------------
// Fetch + socket
// ---------------------------------------------------------------------------
const fetchDetail = async (id: string): Promise<void> => {
  loading.value = true;
  errorMsg.value = null;
  try {
    const { data } = await applicationApi.getById(id);
    detail.value = data.data;
  } catch {
    errorMsg.value = 'Không tải được chi tiết đơn ứng tuyển.';
  } finally {
    loading.value = false;
  }
};

let socket: ReturnType<typeof getSocket> | null = null;
const onMatchReady = (payload: ApplicationMatchReadyPayload): void => {
  if (payload.applicationId !== props.application?.id) return;
  void fetchDetail(payload.applicationId);
};

/**
 * Patch inline khi employer đổi status — tránh flash + tiết kiệm 1 round-trip
 * `GET /applications/:id`. Chỉ patch field status/stage/viewedAt; cover letter,
 * CV, AI reasoning giữ nguyên từ fetch trước.
 */
const onStatusChanged = (payload: ApplicationStatusChangedPayload): void => {
  if (payload.applicationId !== props.application?.id) return;
  if (detail.value) {
    detail.value.status = payload.status;
    detail.value.stage = payload.stage;
    if (payload.viewedAt) detail.value.viewedAt = payload.viewedAt;
  }
};

watch(
  () => [props.open, props.application?.id] as const,
  ([isOpen, appId]) => {
    if (!isOpen || !appId) {
      detail.value = null;
      errorMsg.value = null;
      showWithdrawConfirm.value = false;
      if (socket) {
        socket.off('application:match-ready', onMatchReady);
        socket.off('application:status-changed', onStatusChanged);
        socket = null;
      }
      return;
    }
    void fetchDetail(appId);
    if (auth.isAuthenticated) {
      if (!socket) socket = getSocket();
      if (!socket.connected) socket.connect();
      socket.on('application:match-ready', onMatchReady);
      socket.on('application:status-changed', onStatusChanged);
    }
  },
  { immediate: true },
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const closePanel = (): void => emit('update:open', false);

const goToJob = (): void => {
  // Ưu tiên slug (SEO-friendly); fallback id cho job cũ.
  const slug = detail.value?.jobSlug ?? props.application?.jobSlug;
  const id = props.application?.jobId;
  const path = slug ?? id;
  if (!path) return;
  closePanel();
  void import('@/router').then(({ router }) => {
    void router.push({ name: 'candidate-job-detail', params: { slug: path } });
  });
};

const openWithdraw = (): void => {
  showWithdrawConfirm.value = true;
};

const cancelWithdraw = (): void => {
  if (withdrawing.value) return;
  showWithdrawConfirm.value = false;
};

/**
 * Tạo conversation với employer đăng job (peer = jobs.postedBy) rồi nhảy
 * sang trang chat.
 *
 * Migration 0034: unique 2-user, không cần jobId. Nếu đã có conv với
 * employer này (từ job khác) → BE trả về cùng conversation.
 */
const contactEmployer = async (): Promise<void> => {
  const postedBy = detail.value?.jobPostedBy;
  if (!postedBy || contacting.value) return;
  contacting.value = true;
  try {
    const conversationId = await chatStore.createOrGet({
      peerUserId: postedBy,
    });
    closePanel();
    void router.push({ name: 'chat', params: { id: conversationId } });
  } catch (err) {
    toast.push({
      variant: 'error',
      title: 'Không thể mở cuộc trò chuyện',
      body: 'Vui lòng thử lại sau ít phút.',
    });
  } finally {
    contacting.value = false;
  }
};

const confirmWithdraw = async (): Promise<void> => {
  const id = props.application?.id;
  if (!id || withdrawing.value) return;
  withdrawing.value = true;
  try {
    await applicationApi.withdraw(id);
    detail.value = detail.value
      ? { ...detail.value, status: 'withdrawn' }
      : null;
    showWithdrawConfirm.value = false;
    emit('withdrawn', id);
    toast.push({
      variant: 'success',
      title: 'Đã rút đơn ứng tuyển',
      body: detail.value?.jobTitle ?? '',
    });
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
  } finally {
    withdrawing.value = false;
  }
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
const formatDateTime = (iso: string | null): string => {
  if (!iso) return '';
  return dayjs(iso).format('HH:mm DD/MM/YYYY');
};
</script>

<template>
  <!--
    Panel chiếm full column của parent (master-detail grid). Không teleport,
    không backdrop — parent control width. Khi parent muốn ẩn panel thì
    set `open=false` + bỏ render hoặc ẩn bằng class.

    `h-[calc(100vh-2rem)]` cho desktop sticky column height cố định, scroll
    nội bộ.
  -->
  <section
    v-if="open"
    class="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col h-full overflow-hidden"
    aria-label="Chi tiết đơn ứng tuyển"
  >
    <!-- ===== Header (sticky) ===== -->
    <header class="flex items-start gap-3 p-5 border-b border-gray-200 shrink-0">
      <!-- Logo: gradient + chữ cái đầu khi không có ảnh -->
      <div
        class="shrink-0 w-10 h-10 rounded-[10px] overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 text-primary-700 font-bold text-[15px] ring-1 ring-black/5"
        :aria-label="headerCompanyName ?? 'Công ty'"
      >
        <img
          v-if="headerLogoUrl"
          :src="headerLogoUrl"
          :alt="headerCompanyName ?? ''"
          class="w-full h-full object-cover bg-gray-50"
        />
        <span v-else>{{ companyInitial(headerCompanyName) }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <h2 class="text-base font-bold tracking-tight text-gray-900 truncate">
          {{ headerJobTitle ?? '(Job đã bị xoá)' }}
        </h2>
        <p class="text-xs text-gray-500 mt-0.5 truncate">
          {{ headerCompanyName ?? 'Công ty ẩn danh' }}
        </p>
        <span
          class="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
          :class="STATUS_COLOR[currentStatus]"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
          {{ STATUS_LABEL[currentStatus] }}
        </span>
      </div>
      <button
        type="button"
        class="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition"
        aria-label="Đóng chi tiết"
        @click="closePanel"
      >
        <CloseIcon class="w-3.5 h-3.5" />
      </button>
    </header>

    <!-- ===== Body (scrollable) ===== -->
    <div class="flex-1 overflow-y-auto scrollbar-thin">
      <!-- Loading skeleton -->
      <div v-if="loading" class="p-5 space-y-4">
        <div class="h-4 bg-gray-100 rounded animate-pulse w-3/4" />
        <div class="h-4 bg-gray-100 rounded animate-pulse w-1/2" />
        <div class="h-20 bg-gray-100 rounded animate-pulse" />
        <div class="h-32 bg-gray-100 rounded animate-pulse" />
      </div>

      <!-- Error -->
      <div
        v-else-if="errorMsg"
        class="p-5 flex items-start gap-3 bg-red-50 text-sm text-red-900 m-5 rounded-lg border border-red-200"
      >
        <AlertCircle class="w-5 h-5 mt-0.5 shrink-0" />
        <div>
          <p class="font-medium">{{ errorMsg }}</p>
          <button
            type="button"
            class="mt-2 text-xs font-medium underline"
            @click="application && fetchDetail(application.id)"
          >
            Thử lại
          </button>
        </div>
      </div>

      <!-- Detail content -->
      <div v-else class="px-5 pt-5 pb-2 space-y-5">
        <!-- Empty placeholder nếu chưa fetch được detail (network race hiếm gặp). -->
        <section
          v-if="!detail"
          class="flex flex-col items-center justify-center py-12 text-center"
        >
          <Inbox class="w-10 h-10 text-gray-300 mb-2" />
          <p class="text-sm text-gray-500">Chọn 1 đơn ứng tuyển để xem chi tiết.</p>
        </section>

        <template v-else>
          <!-- ----- Link row + meta ----- -->
          <div class="space-y-1.5">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary-600 hover:text-primary-800 cursor-pointer"
              @click="goToJob"
            >
              <ExternalLink class="w-3.5 h-3.5" />
              Xem trang chi tiết công việc
            </button>
            <div v-if="locationText" class="flex items-center gap-1.5 text-[12.5px] text-gray-600">
              <MapPin class="w-3.5 h-3.5 text-gray-400 shrink-0" />
              {{ locationText }}
            </div>
            <div
              v-if="deadlineInfo"
              class="flex items-center gap-1.5 text-[12.5px]"
              :class="deadlineInfo.expired ? 'text-gray-500' : 'text-amber-700'"
            >
              <CalendarClock
                class="w-3.5 h-3.5 shrink-0"
                :class="deadlineInfo.expired ? 'text-gray-400' : 'text-amber-500'"
              />
              <span>
                Job {{ deadlineInfo.expired ? 'đã hết hạn nộp đơn' : `hết hạn nộp · ${deadlineInfo.text}` }}
              </span>
            </div>
          </div>

          <!-- ----- AI Match card ----- -->
          <section
            v-if="detail.aiMatchReasoning || detail.aiMatchScore != null"
            class="rounded-[14px] border border-violet-100 overflow-hidden"
            style="background: linear-gradient(180deg, #F4EEFE 0%, #FBFAFF 100%);"
          >
            <div class="flex items-center gap-1.5 px-4 pt-4">
              <Sparkles class="w-3.5 h-3.5 text-violet-600" />
              <h3 class="text-[13px] font-bold text-violet-700">AI Matching</h3>
            </div>

            <div class="p-4 flex items-center gap-3.5">
              <!-- Radial ring SVG -->
              <template v-if="matchScoreText">
                <div class="relative shrink-0 w-16 h-16">
                  <svg width="64" height="64" viewBox="0 0 64 64" class="-rotate-90">
                    <circle cx="32" cy="32" r="27" fill="none" stroke="#E6DCFB" stroke-width="7" />
                    <circle
                      cx="32" cy="32" r="27" fill="none"
                      :stroke="MATCH_LEVEL[matchLevelFromPercent(Number(detail.aiMatchScore))].ring"
                      stroke-width="7" stroke-linecap="round"
                      :stroke-dasharray="169.6"
                      :stroke-dashoffset="169.6 * (1 - Math.max(0, Math.min(100, Number(detail.aiMatchScore))) / 100)"
                      class="match-ring"
                      :style="{ '--ring-target': 169.6 * (1 - Math.max(0, Math.min(100, Number(detail.aiMatchScore))) / 100) }"
                    />
                  </svg>
                  <div class="absolute inset-0 flex items-center justify-center text-[15px] font-extrabold text-violet-700">
                    {{ matchPercentNumber }}%
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-[13px] font-bold text-gray-900">
                    Mức độ phù hợp:
                    <span :class="MATCH_LEVEL[matchLevelFromPercent(Number(detail.aiMatchScore))].text">
                      {{ MATCH_LEVEL[matchLevelFromPercent(Number(detail.aiMatchScore))].label }}
                    </span>
                  </p>
                  <p v-if="detail.aiMatchReasoning?.rationale" class="text-[11.5px] text-gray-600 mt-1 leading-relaxed">
                    {{ detail.aiMatchReasoning.rationale }}
                  </p>
                </div>
              </template>
              <span v-else class="inline-flex items-center gap-1.5 text-xs text-amber-700">
                <Loader2 class="w-3.5 h-3.5 animate-spin" />
                Đang so khớp
              </span>
              <!-- Terminal state: quota_exceeded / failed → không spinner,
                   text mô tả lý do để user không tưởng nhầm "đang chờ". -->
              <span
                v-if="matchTerminalReason === 'quota_exceeded'"
                class="inline-flex items-center gap-1.5 text-xs text-amber-700"
                title="Bạn đã hết lượt AI match — nâng cấp gói để dùng tiếp"
              >
                <AlertCircle class="w-3.5 h-3.5" />
                Hết lượt AI match
              </span>
              <span
                v-if="matchTerminalReason === 'failed'"
                class="inline-flex items-center gap-1.5 text-xs text-rose-700"
                title="AI tạm thời không khả dụng, sẽ thử lại sau"
              >
                <AlertCircle class="w-3.5 h-3.5" />
                AI match tạm lỗi
              </span>
            </div>

            <!-- Strengths -->
            <div
              v-if="detail.aiMatchReasoning?.strengths?.length"
              class="px-4 pb-4"
            >
              <h4 class="text-[12.5px] font-bold text-emerald-700 mb-2">Điểm mạnh</h4>
              <ul class="space-y-1.5">
                <li
                  v-for="(s, i) in detail.aiMatchReasoning.strengths"
                  :key="`s-${i}`"
                  class="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-700"
                >
                  <Check class="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" stroke-width="3" />
                  <span>{{ s }}</span>
                </li>
              </ul>
            </div>

            <!-- Missing skills as chips -->
            <div
              v-if="detail.aiMatchReasoning?.missingSkills?.length"
              class="px-4 pb-4"
            >
              <h4 class="text-[12.5px] font-bold text-amber-700 mb-2">Còn thiếu</h4>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="(s, i) in detail.aiMatchReasoning.missingSkills"
                  :key="`m-${i}`"
                  class="text-[12px] font-semibold text-amber-800 bg-amber-100 rounded-md px-2 py-1"
                >
                  {{ s }}
                </span>
              </div>
            </div>

            <!-- Concerns (optional — match strengths pattern) -->
            <div
              v-if="detail.aiMatchReasoning?.concerns?.length"
              class="px-4 pb-4"
            >
              <h4 class="text-[12.5px] font-bold text-rose-700 mb-2">Điểm cần lưu ý</h4>
              <ul class="space-y-1.5">
                <li
                  v-for="(s, i) in detail.aiMatchReasoning.concerns"
                  :key="`c-${i}`"
                  class="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-700"
                >
                  <AlertCircle class="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" stroke-width="2.5" />
                  <span>{{ s }}</span>
                </li>
              </ul>
            </div>
          </section>

          <!-- ----- CV snapshot ----- -->
          <section v-if="detail.cv" class="rounded-md border border-gray-200 overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
              <FileText class="w-4 h-4 text-gray-600" />
              <h3 class="text-sm font-semibold text-gray-900">CV đã nộp</h3>
            </div>
            <div class="p-4 flex items-center gap-3">
              <div class="shrink-0 w-10 h-12 rounded bg-gray-100 border border-gray-200 flex items-center justify-center">
                <FileText class="w-5 h-5 text-gray-500" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-gray-900 truncate">
                  {{ detail.cv.title ?? 'CV không tên' }}
                </p>
                <p class="text-xs text-gray-500 mt-0.5">Snapshot tại thời điểm nộp</p>
              </div>
              <button
                v-if="detail.cv.url"
                type="button"
                :disabled="downloading"
                class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                @click="downloadCv(detail.cv.url, detail.cv.title ?? 'cv')"
              >
                <Loader2 v-if="downloading" class="w-3.5 h-3.5 animate-spin" />
                <Download v-else class="w-3.5 h-3.5" />
                Tải xuống
              </button>
            </div>
          </section>

          <!-- ----- Cover letter ----- -->
          <section v-if="detail.coverLetter" class="rounded-md border border-gray-200 overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
              <FileText class="w-4 h-4 text-gray-600" />
              <h3 class="text-sm font-semibold text-gray-900">Thư xin việc</h3>
            </div>
            <div class="p-4 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
              {{ detail.coverLetter }}
            </div>
          </section>

          <!-- ----- Timeline ----- -->
          <section class="rounded-md border border-gray-200 overflow-hidden">
            <div class="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
              <Clock class="w-4 h-4 text-gray-600" />
              <h3 class="text-sm font-semibold text-gray-900">Hoạt động</h3>
            </div>
            <ol class="p-4 space-y-3">
              <li v-for="(step, i) in timeline" :key="i" class="flex items-start gap-3">
                <component
                  :is="step.done ? CheckCircle2 : Clock"
                  class="w-4 h-4 mt-0.5 shrink-0"
                  :class="step.done ? 'text-emerald-600' : 'text-gray-300'"
                />
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium" :class="step.done ? 'text-gray-900' : 'text-gray-500'">
                    {{ step.label }}
                  </p>
                  <p v-if="step.at" class="text-xs text-gray-500 mt-0.5">
                    {{ formatDateTime(step.at) }}
                  </p>
                  <p v-else class="text-xs text-gray-400 mt-0.5">—</p>
                </div>
              </li>
            </ol>
          </section>
        </template>
      </div>
    </div>

    <!-- ===== Footer (sticky) ===== -->
    <footer
      v-if="detail && detail.status !== 'withdrawn'"
      class="shrink-0 border-t border-gray-200 px-4 py-3 bg-white flex items-center gap-2.5"
    >
      <button
        v-if="canWithdraw(detail.status)"
        type="button"
        class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold text-red-700 bg-white hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition"
        @click="openWithdraw"
      >
        <XCircle class="w-3.5 h-3.5" />
        Rút đơn ứng tuyển
      </button>
      <button
        v-if="detail.jobPostedBy"
        type="button"
        class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed"
        :disabled="contacting"
        @click="contactEmployer"
      >
        <Loader2 v-if="contacting" class="w-4 h-4 animate-spin" />
        <MessageCircle v-else class="w-4 h-4" />
        Chat
      </button>
    </footer>
  </section>

  <!-- Withdraw confirm modal — teleport vì là overlay modal thực sự. -->
  <Teleport to="body">
    <Transition>
      <div
        v-if="showWithdrawConfirm && detail"
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
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
                <span class="font-semibold text-gray-900">"{{ detail.jobTitle ?? '(Job đã bị xoá)' }}"</span>.
              </p>
              <p class="text-xs text-gray-500 mt-2">
                Hành động này không thể hoàn tác. Bạn có thể ứng tuyển lại job này sau nếu muốn.
              </p>
            </div>
            <button
              type="button"
              class="text-gray-400 hover:text-gray-600 transition shrink-0"
              :disabled="withdrawing"
              @click="cancelWithdraw"
            >
              <CloseIcon class="w-5 h-5" />
            </button>
          </div>
          <div class="flex items-center justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
              :disabled="withdrawing"
              @click="cancelWithdraw"
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
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Withdraw modal fade + scale nhẹ. */
.v-enter-active,
.v-leave-active {
  transition: opacity 180ms ease;
}
.v-enter-from,
.v-leave-to {
  opacity: 0;
}
.v-enter-active > div,
.v-leave-active > div {
  transition: transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
}
.v-enter-from > div,
.v-leave-to > div {
  transform: scale(0.96);
}

/* Match ring — animate từ 0% (full offset = ẩn) đến % thực tế.
   Target offset truyền qua CSS var `--ring-target` (computed từ score).
   Dùng keyframes thay vì transition để tự replay khi element re-mount
   (ví dụ: đổi application sang detail khác). */
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
</style>
