<script setup lang="ts">
/**
 * JobDetailView (employer) — trang chi tiết job tại `/employer/jobs/:id`.
 *
 * Khác với candidate JobDetailView:
 *  - Có AI Moderation card (verdict/score/flags) để employer xem lý do job bị
 *    gắn cờ (ai_flagged) hoặc tình trạng scan gần nhất.
 *  - Right sidebar là "Quản lý" chứ không phải Apply:
 *    • Nút Sửa (chỉ job draft / ai_flagged / closed)
 *    • Nút Gửi kiểm duyệt AI (chỉ draft)
 *    • Nút Re-scan (ai_flagged / expired)
 *    • Nút Xem ứng viên (link → /employer/applications?jobId=...)
 *    • Nút Xem trang công khai (mở candidate view trong tab mới)
 *    • Nút Xoá (soft delete → status=closed)
 *  - Hiển thị stats: lượt xem, ứng viên, ngày đăng, hạn nộp.
 *
 * Status color mapping (mirror EmployerJobCard):
 *   live        → green
 *   draft       → gray
 *   ai_scanning → yellow
 *   ai_flagged  → red
 *   expired     → orange
 *   closed      → gray line-through
 *
 * Backend:
 *  - GET /api/v1/jobs/:id — full detail, side-effect tăng viewsCount +1.
 *    (Owner & admin đều xem được; public ẩn job non-live.)
 *  - GET /api/v1/jobs/:id/scan — verdict + flags (nếu có).
 *    Backend check `postedBy === userId` hoặc role='admin'.
 *  - POST /api/v1/jobs/:id/submit — owner submit job draft cho AI.
 *  - POST /api/v1/jobs/:id/resubmit — admin force re-scan.
 *  - DELETE /api/v1/jobs/:id — soft delete (status='closed').
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Globe2,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import { useToastStore } from '@stores/toast';
import { useAuthStore } from '@stores/auth';
import { jobApi } from '@services/job.api';
import ConfirmModal from '@components/common/ConfirmModal.vue';
import EditJobModal from '@components/employer/EditJobModal.vue';
import type { JobDetail, JobStatus } from '@/types/job';
import { useSocket } from '@/composables/useSocket';
/* ============================================================================
 * State
 * ==========================================================================*/
const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const auth = useAuthStore();

const job = ref<JobDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

/** AI scan result. `null` = chưa scan bao giờ. `undefined` = chưa load / lỗi. */
const scan = ref<unknown>(undefined);
const scanLoading = ref(false);
const scanError = ref<string | null>(null);

/** Submit / re-scan / reopen in-flight. */
const actionPending = ref(false);

/** Delete confirm. */
const deleteOpen = ref(false);

/** Edit modal — toggle state, controlled by `<EditJobModal v-model:open>`. */
const editOpen = ref(false);

/* ============================================================================
 * "Thao tác khác" dropdown
 *  - showMoreActions : toggle mở/đóng menu phụ trong panel "Quản lý".
 *  - managePanelRef  : ref tới root card, dùng để detect click-outside.
 *  - Click ra ngoài card → tự đóng (document mousedown listener).
 *  - Mỗi action trong dropdown → cũng tự đóng (gọi showMoreActions = false).
 * ==========================================================================*/
const showMoreActions = ref(false);
const managePanelRef = ref<HTMLElement | null>(null);

/** Click ngoài panel → đóng dropdown (nếu đang mở). */
const onDocMouseDown = (e: MouseEvent): void => {
  const root = managePanelRef.value;
  if (!root) return;
  if (e.target instanceof Node && !root.contains(e.target)) {
    showMoreActions.value = false;
  }
};
onMounted((): void => { document.addEventListener('mousedown', onDocMouseDown); });
onUnmounted((): void => { document.removeEventListener('mousedown', onDocMouseDown); });

const jobId = computed<string>(() => String(route.params.id ?? ''));

/* ============================================================================
 * Formatters (mirror candidate JobDetailView)
 * ==========================================================================*/
const jobLevelLabel = computed((): string => {
  const m: Record<string, string> = {
    intern: 'Intern', fresher: 'Fresher', junior: 'Junior', mid: 'Mid-level',
    senior: 'Senior', lead: 'Lead', manager: 'Manager',
  };
  return job.value?.jobLevel ? m[job.value.jobLevel] ?? job.value.jobLevel : '';
});

const jobTypeLabel = computed((): string => {
  const m: Record<string, string> = {
    'full-time': 'Toàn thời gian', 'part-time': 'Bán thời gian',
    contract: 'Hợp đồng', internship: 'Thực tập', freelance: 'Freelance',
  };
  return job.value?.jobType ? m[job.value.jobType] ?? job.value.jobType : '';
});

const salaryLabel = computed((): string => {
  const j = job.value;
  if (!j) return '';
  if (!j.salaryVisible) return 'Thoả thuận';
  const { salaryMin, salaryMax } = j;
  if (!salaryMin && !salaryMax) return 'Thoả thuận';
  const toM = (s: string): string => `${(Number(s) / 1_000_000).toFixed(0)} triệu`;
  if (salaryMin && salaryMax) return `${toM(salaryMin)} – ${toM(salaryMax)}`;
  if (salaryMin) return `Từ ${toM(salaryMin)}`;
  return `Đến ${toM(salaryMax!)}`;
});

const companyInitial = computed((): string => {
  const name = job.value?.companyName;
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
});

const locationLine = computed((): string => {
  const loc = job.value?.location;
  if (!loc) return '';
  const parts = [loc.district, loc.city].filter(Boolean);
  return parts.join(', ');
});

const experienceLabel = computed((): string => {
  const j = job.value;
  if (!j) return '';
  const { experienceYearsMin, experienceYearsMax } = j;
  if (experienceYearsMin == null && experienceYearsMax == null) return '';
  if (experienceYearsMin != null && experienceYearsMax != null) {
    return `${experienceYearsMin}–${experienceYearsMax} năm`;
  }
  if (experienceYearsMin != null) return `Từ ${experienceYearsMin} năm`;
  return `Đến ${experienceYearsMax} năm`;
});

const publishedLabel = computed((): string => {
  if (!job.value?.publishedAt) return '';
  return dayjs(job.value.publishedAt).format('DD/MM/YYYY');
});

const deadlineLabel = computed((): string => {
  if (!job.value?.deadline) return '';
  return dayjs(job.value.deadline).format('DD/MM/YYYY');
});

const deadlineRelative = computed((): string => {
  if (!job.value?.deadline) return '';
  const d = dayjs(job.value.deadline);
  const now = dayjs();
  const diff = d.diff(now, 'day');
  if (diff < 0) return `Đã quá hạn ${-diff} ngày`;
  if (diff === 0) return 'Hết hạn hôm nay';
  if (diff <= 7) return `Còn ${diff} ngày`;
  return `Còn ${diff} ngày`;
});

const compactNumber = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
};

/* ============================================================================
 * Status badge (mirror EmployerJobCard)
 * ==========================================================================*/
interface StatusBadge {
  label: string;
  classes: string;
  description: string;
}
const STATUS_MAP: Record<JobStatus, StatusBadge> = {
  live:        { label: 'Đang hiển thị', classes: 'bg-green-100 text-green-700',
                 description: 'Job đã vượt qua AI moderation và hiển thị công khai cho ứng viên.' },
  draft:       { label: 'Bản nháp',     classes: 'bg-gray-100 text-gray-600',
                 description: 'Job đang là bản nháp — chỉ bạn thấy. Submit để gửi AI moderation.' },
  pending:     { label: 'Đang chờ',     classes: 'bg-blue-100 text-blue-700',
                 description: 'Job đang chờ xử lý moderation.' },
  ai_scanning: { label: 'AI đang quét',  classes: 'bg-yellow-100 text-yellow-700',
                 description: 'Hệ thống AI đang quét nội dung job. Vui lòng đợi trong ít phút.' },
  ai_flagged:  { label: 'Bị gắn cờ',    classes: 'bg-red-100 text-red-700',
                 description: 'AI phát hiện vấn đề trong nội dung. Sửa job rồi re-scan.' },
  expired:     { label: 'Hết hạn',      classes: 'bg-orange-100 text-orange-700',
                 description: 'Job đã quá hạn nộp. Gia hạn hoặc re-scan để tiếp tục.' },
  closed:      { label: 'Đã đóng',      classes: 'bg-gray-200 text-gray-500 line-through',
                 description: 'Job đã bị đóng — ứng viên không thấy job này nữa.' },
};
const statusBadge = computed<StatusBadge | null>(() => {
  if (!job.value) return null;
  return STATUS_MAP[job.value.status] ?? STATUS_MAP.closed;
});

/* ============================================================================
 * AI scan — typed khớp schema backend (jobAiScans + jobAiFlags).
 *
 * Backend enums (xem backend/src/db/schema/enums.ts):
 *   scan_verdict  : 'approved' | 'flagged'
 *   flag_severity : 'block' | 'warn'
 *   field         : 'title' | 'description' | 'requirements'
 *   score         : numeric(3,2) → 0.00–1.00 (LUÔN 0..1, không phải 0..100)
 *
 * Backend flag fields (xem backend/src/db/schema/jobAiFlags.ts):
 *   id, scanId, severity, category (text free-form), field, quote,
 *   reasoning, suggestion, lawRef
 *
 * Lưu ý:
 *   - CATEGORY không phải enum ở DB — là text do LLM sinh ra. Có ~15 giá trị
 *     chuẩn (xem JOB_MODERATION_SYSTEM_PROMPT) nhưng LLM có thể trả giá trị
 *     mới → CATEGORY_LABELS map tối đa, còn lại hiển thị raw.
 *   - `quote` là text GỐC bị vi phạm (Ctrl+F để tìm trong job).
 *   - `reasoning` là giải thích bằng tiếng Việt từ LLM.
 *   - `suggestion` là gợi ý sửa cụ thể (HR-readable).
 *   - `lawRef` tham chiếu pháp luật (vd "Bộ luật LĐ 2019 §6").
 *
 * Giữ `scan` ref là unknown + cast qua interface (defensive) — nếu backend
 * thêm field mới FE không vỡ.
 * ==========================================================================*/

type ScanVerdict = 'approved' | 'flagged';
type FlagSeverity = 'block' | 'warn';
type FlagField = 'title' | 'description' | 'requirements';

interface ScanFlag {
  id?: string;
  severity?: FlagSeverity | string;
  category?: string;
  field?: FlagField | string;
  quote?: string;
  reasoning?: string;
  suggestion?: string;
  lawRef?: string;
}
interface ScanInfo {
  id?: string;
  verdict?: ScanVerdict | string;
  /** numeric(3,2) → 0.00–1.00. Cast string → number ở đây. */
  score?: number | string;
  model?: string;
  scannedAt?: string | Date;
  scannedBy?: string;
}
interface ScanPayload {
  scan: ScanInfo;
  flags: ScanFlag[];
}

const scanInfo = computed<ScanInfo | null>(() => {
  if (!scan.value) return null;
  const s = scan.value as Partial<ScanPayload> | null;
  return s?.scan ?? null;
});
const scanFlags = computed<ScanFlag[]>(() => {
  if (!scan.value) return [];
  const s = scan.value as Partial<ScanPayload> | null;
  return s?.flags ?? [];
});

/** Verdict (chỉ 2 giá trị theo enum backend). */
interface VerdictMeta {
  label: string;
  classes: string;
  description: string;
  icon: typeof CheckCircle2;
}
const VERDICT_MAP: Record<ScanVerdict, VerdictMeta> = {
  approved: {
    label: 'Đã duyệt',
    classes: 'bg-green-100 text-green-700',
    description: 'AI không phát hiện vấn đề. Job có thể hiển thị cho ứng viên.',
    icon: CheckCircle2,
  },
  flagged: {
    label: 'Bị gắn cờ',
    classes: 'bg-red-100 text-red-700',
    description: 'AI phát hiện vấn đề. Sửa nội dung rồi gửi re-scan.',
    icon: AlertTriangle,
  },
};
const scanVerdictMeta = computed<VerdictMeta>(() => {
  const v = scanInfo.value?.verdict;
  return (v && v in VERDICT_MAP)
    ? VERDICT_MAP[v as ScanVerdict]
    : { label: 'Không rõ', classes: 'bg-gray-100 text-gray-600', description: '', icon: AlertCircle };
});

/** Score LUÔN 0..1 theo schema. Nhân 100 cho %. */
const scanScorePct = computed((): number => {
  const raw = scanInfo.value?.score;
  const s = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof s !== 'number' || Number.isNaN(s)) return 0;
  return Math.round(Math.max(0, Math.min(1, s)) * 100);
});

/** Score bar color — theo mức độ "sạch" của job.
 *  approved + score cao → xanh; flagged + score thấp → đỏ. */
const scoreBarColor = computed((): string => {
  const pct = scanScorePct.value;
  if (scanInfo.value?.verdict === 'approved') return 'bg-green-500';
  if (pct >= 70) return 'bg-orange-500';
  return 'bg-red-500';
});

/** Sort flag: block trước, warn sau; trong cùng severity theo field order. */
const sortedFlags = computed<ScanFlag[]>(() => {
  const fieldOrder: Record<string, number> = { title: 0, description: 1, requirements: 2 };
  return [...scanFlags.value].sort((a, b) => {
    const sa = a.severity === 'block' ? 0 : 1;
    const sb = b.severity === 'block' ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const fa = fieldOrder[a.field ?? ''] ?? 99;
    const fb = fieldOrder[b.field ?? ''] ?? 99;
    return fa - fb;
  });
});

/** Đếm severity để hiển thị "(Y nghiêm trọng)" ở header. */
const flagCounts = computed(() => {
  const block = scanFlags.value.filter((f) => f.severity === 'block').length;
  const warn = scanFlags.value.filter((f) => f.severity === 'warn').length;
  return { block, warn, total: scanFlags.value.length };
});

/** Category labels — map từ 15 giá trị chuẩn trong JOB_MODERATION_SYSTEM_PROMPT. */
const CATEGORY_LABELS: Record<string, string> = {
  discrimination_gender: 'Phân biệt giới tính',
  discrimination_age: 'Phân biệt tuổi',
  discrimination_other: 'Phân biệt khác (tôn giáo/khuyết tật)',
  scam_mlm: 'Lừa đảo đa cấp',
  scam_recruitment_fee: 'Thu phí ứng tuyển',
  scam_money_request: 'Yêu cầu chuyển tiền',
  sexual_explicit: 'Nội dung khiêu dâm',
  sexual_solicitation: 'Tuyển mại dâm/gợi dục',
  profanity: 'Ngôn ngữ thô thiển',
  violence_threat: 'Đe doạ bạo lực',
  hate_speech: 'Ngôn từ thù ghét',
  pii_leak_post: 'Lộ thông tin cá nhân (PII)',
  illegal_activity: 'Hoạt động phi pháp',
  low_quality_vague: 'Nội dung mơ hồ/thiếu thông tin',
  misleading_title: 'Tiêu đề gây hiểu lầm/clickbait',
};
const categoryLabel = (cat: string | undefined): string => {
  if (!cat) return '';
  return CATEGORY_LABELS[cat] ?? cat;
};

/** Field label + icon. */
const FIELD_META: Record<FlagField, { label: string; sectionId: string }> = {
  title:        { label: 'Tiêu đề',   sectionId: 'job-title' },
  description:  { label: 'Mô tả',     sectionId: 'job-description' },
  requirements: { label: 'Yêu cầu',   sectionId: 'job-requirements' },
};
const fieldMeta = (f: string | undefined) => {
  if (!f) return null;
  return FIELD_META[f as FlagField] ?? { label: f, sectionId: '' };
};

/** Severity classes (chỉ 'block' | 'warn' theo enum). */
const severityClasses = (sev: string | undefined): string => {
  if (sev === 'block') return 'border-red-200 bg-red-50/50';
  if (sev === 'warn')  return 'border-yellow-200 bg-yellow-50/50';
  return 'border-gray-200 bg-gray-50/50';
};
const severityBadgeClasses = (sev: string | undefined): string => {
  if (sev === 'block') return 'bg-red-100 text-red-700';
  if (sev === 'warn')  return 'bg-yellow-100 text-yellow-700';
  return 'bg-gray-100 text-gray-600';
};
const severityLabel = (sev: string | undefined): string => {
  if (sev === 'block') return 'Chặn — Không được đăng';
  if (sev === 'warn')  return 'Cảnh báo — Nên sửa';
  return sev ?? 'Không rõ';
};

/** scannedBy: 'system' → Auto, còn lại → Manual (userId). */
const scannedByLabel = (s: string | undefined): string => {
  if (!s) return '';
  if (s === 'system') return 'Auto';
  return 'Manual';
};

/* ============================================================================
 * Action availability (dựa trên status)
 * ==========================================================================*/
const isAdmin = computed(() => auth.user?.role === 'admin');
const canEdit = computed(() => {
  // Backend `jobService.update` không chặn theo status (chỉ check ownership).
  // Chặn duy nhất khi job đang được AI scan (worker đang xử lý) để tránh
  // race text thay đổi trong lúc moderation đang chạy.
  return job.value?.status !== 'ai_scanning';
});
/**
 * Cho phép submit từ mọi status NGOẠI TRỪ:
 *  - 'ai_scanning'  → đã scan, đợi worker xử lý
 *  - 'closed'       → đã xoá (soft delete), không resurrect
 *
 * Backend `jobService.submit` đã comment-out check status (xem
 * backend/src/service/job.service.ts:201-203) nên FE lo phần gate UX,
 * backend vẫn owner-check qua `postedBy === userId`.
 *
 * Use case:
 *  - draft       → submit lần đầu
 *  - ai_flagged  → re-scan sau khi sửa nội dung
 *  - expired     → gia hạn + re-scan
 *  - pending     → re-queue (vd LLM timeout)
 *  - live        → re-scan nếu muốn cập nhật verdict (vẫn đang hiển thị trong
 *                  khi chờ; cẩn thận có thể bật cờ job đang live).
 */
const canSubmit = computed(() => {
  const s = job.value?.status;
  return s !== undefined && s !== 'ai_scanning' && s !== 'closed';
});
const canRescan = computed(() => {
  const s = job.value?.status;
  return isAdmin.value && (s === 'ai_flagged' || s === 'expired' || s === 'live');
});
const canDelete = computed(() => job.value?.status !== 'closed');
/** Chỉ job đã đóng mới cho "Mở lại" (chuyển về draft). */
const canReopen = computed(() => job.value?.status === 'closed');

/* ============================================================================
 * Fetch
 * ==========================================================================*/
const fetchDetail = async (): Promise<void> => {
  if (!jobId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const { data } = await jobApi.detail(jobId.value);
    job.value = data.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Không tải được chi tiết job';
    job.value = null;
  } finally {
    loading.value = false;
  }
};

const fetchScan = async (): Promise<void> => {
  if (!jobId.value) return;
  scanLoading.value = true;
  scanError.value = null;
  try {
    const { data } = await jobApi.scanResult(jobId.value);
    // Backend có thể trả data=null nếu job chưa từng được scan.
    scan.value = data.data ?? null;
  } catch (e) {
    // 404/403/... → coi như không có scan, không chặn UI.
    scan.value = null;
    scanError.value = e instanceof Error ? e.message : null;
  } finally {
    scanLoading.value = false;
  }
};

const loadAll = async (): Promise<void> => {
  await fetchDetail();
  if (job.value) await fetchScan();
};

onMounted(loadAll);
watch(jobId, () => { void loadAll(); });

/* ============================================================================
 * Handlers
 * ==========================================================================*/
const goBack = (): void => {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push('/employer/jobs');
  }
};

const onEdit = (): void => {
  if (!job.value) return;
  showMoreActions.value = false;
  // Mở modal edit (xem EditJobModal.vue) — không navigate sang trang mới.
  editOpen.value = true;
};

/** Sau khi EditJobModal PATCH thành công → refetch để cập nhật header + scan. */
const onEditSaved = async (): Promise<void> => {
  await loadAll();
};

/* ============================================================================
 * Sidebar "Quản lý" — vertical stack đơn giản (không hover-to-grow).
 *  - Primary action (full width, primary black): Gửi kiểm duyệt AI (draft) /
 *    Xem ứng viên (còn lại).
 *  - Các nút phụ full width bên dưới: Sửa, Re-scan (admin), Xem công khai,
 *    Xoá.
 *  - Xem chi tiết template ở block "Actions" trong template.
 * ==========================================================================*/

const onSubmitForScan = async (): Promise<void> => {
  if (!job.value || actionPending.value) return;
  showMoreActions.value = false;
  actionPending.value = true;
  try {
    await jobApi.submit(job.value.id);
    await loadAll();
  } catch (e) {
  } finally {
    actionPending.value = false;
  }
};
useSocket(
  'job_scan_complete', async (payload: { jobId: string, verdict: 'approved' | 'flagged', score: number, flaggedCount: number }) => {
    if (payload.jobId === jobId.value) {
      // Nếu jobId khớp → refetch scan result để cập nhật verdict/score/flags.
      job.value = { ...job.value, status: payload.verdict === 'approved' ? 'live' : 'ai_flagged' } as JobDetail;
      await fetchScan();
    }
  }
)
const onRescan = async (): Promise<void> => {
  if (!job.value || actionPending.value) return;
  showMoreActions.value = false;
  actionPending.value = true;
  try {
    await jobApi.resubmit(job.value.id);
    await loadAll();
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Re-scan thất bại',
      body: e instanceof Error ? e.message : 'Vui lòng thử lại',
    });
  } finally {
    actionPending.value = false;
  }
};

const onDelete = (): void => {
  if (!job.value) return;
  showMoreActions.value = false;
  deleteOpen.value = true;
};
const cancelDelete = (): void => { deleteOpen.value = false; };
const confirmDelete = async (): Promise<void> => {
  if (!job.value) return;
  deleteOpen.value = false;
  try {
    await jobApi.delete(job.value.id);
    toast.push({ variant: 'success', title: 'Đã đóng job' });
    await router.push('/employer/jobs');
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Xoá thất bại',
      body: e instanceof Error ? e.message : 'Vui lòng thử lại',
    });
  }
};

/**
 * Mở lại job đã đóng (closed → draft).
 * KHÔNG dùng confirm modal — đây là action reversible, user có thể close lại
 * nếu lỡ tay. Toast kết quả + refetch detail để status badge + primary button
 * đổi từ "Đã đóng" (placeholder) → "Gửi kiểm duyệt AI" (draft).
 */
const onReopen = async (): Promise<void> => {
  if (!job.value || actionPending.value) return;
  showMoreActions.value = false;
  actionPending.value = true;
  try {
    await jobApi.reopen(job.value.id);
    toast.push({
      variant: 'success',
      title: 'Đã mở lại job',
      body: 'Job chuyển về bản nháp. Sửa nội dung rồi gửi AI kiểm duyệt để đăng lại.',
    });
    await loadAll();
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Mở lại thất bại',
      body: e instanceof Error ? e.message : 'Vui lòng thử lại',
    });
  } finally {
    actionPending.value = false;
  }
};

const onViewApplications = (): void => {
  if (!job.value) return;
  router.push({ path: '/employer/applications', query: { jobId: job.value.id } });
};

const onViewPublic = (): void => {
  showMoreActions.value = false;
  // Mở candidate view trong tab mới (chỉ job live mới có thể xem public).
  const url = `/candidate/viec-lam/${jobId.value}`;
  window.open(url, '_blank', 'noopener,noreferrer');
};

/* ============================================================================
 * Helpers cho template — đã move vào block "AI scan" ở trên để giữ tất cả
 * logic moderation cùng chỗ.
 * ==========================================================================*/
</script>

<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-6xl mx-auto">
      <!-- ============ Back ============ -->
      <button
        type="button"
        class="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition"
        @click="goBack"
      >
        <ArrowLeft class="w-4 h-4" /> Quay lại Job đã đăng
      </button>

      <!-- ============ Loading ============ -->
      <div
        v-if="loading && !job"
        class="bg-white rounded-xl border border-gray-200 flex items-center justify-center py-20"
      >
        <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
      </div>

      <!-- ============ Error / Not found ============ -->
      <div
        v-else-if="error || !job"
        class="bg-white rounded-xl border border-gray-200 px-6 py-16 text-center"
      >
        <div class="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
          <AlertCircle class="w-6 h-6 text-red-500" />
        </div>
        <h3 class="text-sm font-semibold text-gray-900">Không tải được chi tiết job</h3>
        <p class="text-xs text-gray-500 mt-1">{{ error ?? 'Job không tồn tại hoặc bạn không có quyền xem.' }}</p>
        <button
          type="button"
          class="mt-4 px-3 py-1.5 text-xs rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition"
          @click="goBack"
        >
          Quay lại
        </button>
      </div>

      <!-- ============ Main ============ -->
      <template v-else>
        <!-- ============ Header ============ -->
        <header class="bg-white rounded-xl border border-gray-200 p-6 mb-4">
          <div class="flex items-start gap-4">
            <div
              class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary-50 to-primary-100 text-xl font-semibold text-primary-700"
            >
              <img
                v-if="job.companyLogoUrl"
                :src="job.companyLogoUrl"
                :alt="job.companyName ?? ''"
                class="h-full w-full object-cover"
              />
              <span v-else>{{ companyInitial }}</span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-start gap-2 flex-wrap">
                <h1 id="job-title" class="text-xl md:text-2xl font-semibold text-gray-900 leading-snug scroll-mt-20">
                  {{ job.title }}
                </h1>
                <span
                  v-if="statusBadge"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 mt-1"
                  :class="statusBadge.classes"
                  :title="statusBadge.description"
                >
                  <Loader2 v-if="job.status === 'ai_scanning'" class="w-3 h-3 animate-spin" />
                  {{ statusBadge.label }}
                </span>
              </div>

              <div class="mt-1.5 flex items-center gap-x-4 gap-y-1 flex-wrap text-sm text-gray-600">
                <span v-if="job.companyName" class="inline-flex items-center gap-1">
                  <Building2 class="w-3.5 h-3.5 text-gray-400" />
                  {{ job.companyName }}
                </span>
                <span v-if="locationLine" class="inline-flex items-center gap-1">
                  <MapPin class="w-3.5 h-3.5 text-gray-400" />
                  {{ locationLine }}
                </span>
                <span v-if="job.industry" class="inline-flex items-center gap-1">
                  <Globe2 class="w-3.5 h-3.5 text-gray-400" />
                  {{ job.industry }}
                </span>
              </div>

              <!-- Tag row -->
              <div class="mt-3 flex flex-wrap gap-1.5">
                <span
                  v-if="job.jobLevel"
                  class="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700"
                >
                  <Briefcase class="h-3 w-3" />
                  {{ jobLevelLabel }}
                </span>
                <span
                  v-if="job.jobType"
                  class="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700"
                >
                  {{ jobTypeLabel }}
                </span>
                <span
                  class="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
                >
                  <Wallet class="h-3 w-3" />
                  {{ salaryLabel }}
                </span>
                <span
                  v-if="job.remoteOk"
                  class="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700"
                >
                  Remote OK
                </span>
              </div>

              <!-- Meta row -->
              <div class="mt-4 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-gray-500">
                <span v-if="publishedLabel" class="inline-flex items-center gap-1">
                  <Calendar class="w-3 h-3" />
                  Đăng {{ publishedLabel }}
                </span>
                <span v-if="deadlineLabel" class="inline-flex items-center gap-1">
                  <Clock class="w-3 h-3" />
                  Hạn nộp {{ deadlineLabel }}
                </span>
                <span v-if="experienceLabel" class="inline-flex items-center gap-1">
                  <Briefcase class="w-3 h-3" />
                  Kinh nghiệm: {{ experienceLabel }}
                </span>
                <span class="inline-flex items-center gap-1">
                  <Eye class="w-3 h-3" />
                  {{ compactNumber(job.viewsCount) }} lượt xem
                </span>
                <span class="inline-flex items-center gap-1">
                  <FileText class="w-3 h-3" />
                  {{ compactNumber(job.appliesCount) }} ứng viên
                </span>
              </div>

              <!-- Status description -->
              <p v-if="statusBadge" class="mt-3 text-xs text-gray-600">
                <component :is="ShieldCheck" class="inline w-3.5 h-3.5 -mt-0.5 mr-0.5 text-gray-400" />
                {{ statusBadge.description }}
              </p>
            </div>
          </div>
        </header>

        <!-- ============ AI Moderation card ============ -->
        <section
          v-if="!scanLoading || scan"
          class="bg-white rounded-xl border border-gray-200 p-5 mb-4"
        >
          <div class="flex items-center gap-2 mb-3">
            <ScanLine class="w-4 h-4 text-gray-500" />
            <h2 class="text-sm font-semibold text-gray-900">AI Moderation</h2>
            <span
              v-if="scanLoading"
              class="inline-flex items-center gap-1 text-[11px] text-gray-500"
            >
              <Loader2 class="w-3 h-3 animate-spin" /> Đang tải kết quả...
            </span>
          </div>

          <div v-if="scanInfo" class="space-y-4">
            <!-- ============ Summary row: verdict + score + meta ============ -->
            <div class="flex items-center gap-3 flex-wrap">
              <span
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold"
                :class="scanVerdictMeta.classes"
                :title="scanVerdictMeta.description"
              >
                <component :is="scanVerdictMeta.icon" class="w-3.5 h-3.5" />
                {{ scanVerdictMeta.label }}
              </span>
              <div class="flex-1 min-w-[200px] max-w-sm">
                <div class="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                  <span>Điểm AI</span>
                  <span class="font-medium text-gray-900">{{ scanScorePct }}%</span>
                </div>
                <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="scoreBarColor"
                    :style="{ width: `${scanScorePct}%` }"
                  />
                </div>
              </div>
              <div class="flex items-center gap-3 text-[11px] text-gray-500">
                <span v-if="scanInfo.model" class="inline-flex items-center gap-1">
                  <code class="px-1.5 py-0.5 bg-gray-50 rounded text-[10px] font-mono">{{ scanInfo.model }}</code>
                </span>
                <span v-if="scanInfo.scannedBy" class="inline-flex items-center gap-1">
                  🤖 {{ scannedByLabel(scanInfo.scannedBy) }}
                </span>
                <span v-if="scanInfo.scannedAt" class="inline-flex items-center gap-1">
                  {{ dayjs(scanInfo.scannedAt).format('DD/MM/YYYY HH:mm') }}
                </span>
              </div>
            </div>

            <p v-if="scanVerdictMeta.description" class="text-xs text-gray-600">
              {{ scanVerdictMeta.description }}
            </p>

            <!-- ============ Flags list ============ -->
            <div v-if="sortedFlags.length > 0" class="space-y-2.5">
              <div class="flex items-center justify-between">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Chi tiết cảnh báo ({{ sortedFlags.length }})
                </p>
                <p v-if="flagCounts.block > 0 && flagCounts.warn > 0" class="text-[11px] text-gray-500">
                  <span class="text-red-700 font-medium">{{ flagCounts.block }} chặn</span>
                  ·
                  <span class="text-yellow-700 font-medium">{{ flagCounts.warn }} cảnh báo</span>
                </p>
              </div>
              <ul class="space-y-2.5">
                <li
                  v-for="(flag, idx) in sortedFlags"
                  :key="flag.id ?? idx"
                  class="rounded-lg border p-3.5"
                  :class="severityClasses(flag.severity)"
                >
                  <!-- Header: severity badge + category + field chip -->
                  <div class="flex items-start justify-between gap-2 mb-2">
                    <div class="flex items-center gap-2 flex-wrap min-w-0">
                      <span
                        class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide"
                        :class="severityBadgeClasses(flag.severity)"
                      >
                        {{ severityLabel(flag.severity) }}
                      </span>
                      <span v-if="flag.category" class="text-xs font-medium text-gray-900">
                        {{ categoryLabel(flag.category) }}
                      </span>
                    </div>
                    <a
                      v-if="fieldMeta(flag.field)?.sectionId"
                      :href="`#${fieldMeta(flag.field)!.sectionId}`"
                      class="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
                      :title="`Đi tới phần ${fieldMeta(flag.field)!.label}`"
                    >
                      📍 {{ fieldMeta(flag.field)!.label }}
                    </a>
                  </div>

                  <!-- Quote: text gốc bị vi phạm (user Ctrl+F trong job) -->
                  <blockquote
                    v-if="flag.quote"
                    class="mt-1 pl-3 border-l-2 border-gray-300 text-xs italic text-gray-700 whitespace-pre-line"
                  >
                    "{{ flag.quote }}"
                  </blockquote>

                  <!-- Reasoning: giải thích từ AI -->
                  <p
                    v-if="flag.reasoning"
                    class="mt-2 text-xs leading-relaxed text-gray-800"
                  >
                    <strong class="font-semibold text-gray-900">Lý do:</strong>
                    {{ flag.reasoning }}
                  </p>

                  <!-- Suggestion: gợi ý sửa -->
                  <div
                    v-if="flag.suggestion"
                    class="mt-2 rounded-md bg-blue-50 border border-blue-100 px-2.5 py-1.5 text-xs text-blue-900"
                  >
                    <span class="font-semibold">💡 Gợi ý sửa:</span>
                    {{ flag.suggestion }}
                  </div>

                  <!-- Law ref: tham chiếu pháp luật -->
                  <p
                    v-if="flag.lawRef"
                    class="mt-1.5 text-[11px] text-gray-500"
                  >
                    📜 <span class="font-medium">{{ flag.lawRef }}</span>
                  </p>
                </li>
              </ul>
            </div>

            <!-- Approved + no flags -->
            <div
              v-else-if="scanInfo.verdict === 'approved'"
              class="flex items-start gap-2 rounded-md bg-green-50 border border-green-100 px-3 py-2.5"
            >
              <CheckCircle2 class="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              <p class="text-xs text-green-900">
                <strong class="font-semibold">AI đã duyệt job này.</strong>
                Không phát hiện vi phạm trong tiêu đề, mô tả và yêu cầu.
              </p>
            </div>

            <!-- Flagged nhưng không có flag (LLM output lỗi) -->
            <div
              v-else
              class="rounded-md bg-orange-50 border border-orange-100 px-3 py-2.5"
            >
              <p class="text-xs text-orange-900">
                AI trả verdict <strong>flagged</strong> nhưng không cung cấp chi tiết.
                Vui lòng liên hệ admin.
              </p>
            </div>
          </div>

          <!-- ============ Chưa từng scan ============ -->
          <p v-else class="text-xs text-gray-500">
            Job chưa từng được AI quét.
            <span v-if="canSubmit">Bấm <strong>Gửi kiểm duyệt AI</strong> ở sidebar để bắt đầu.</span>
          </p>
        </section>

        <!-- ============ 2-col main ============ -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <!-- ============ Left col — content ============ -->
          <div class="lg:col-span-8 space-y-4">
            <section class="bg-white rounded-xl border border-gray-200 p-6">
              <h2 id="job-description" class="text-sm font-semibold text-gray-900 mb-3 scroll-mt-20">Mô tả công việc</h2>
              <p class="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {{ job.description }}
              </p>
            </section>

            <section
              v-if="job.requirements"
              class="bg-white rounded-xl border border-gray-200 p-6"
            >
              <h2 id="job-requirements" class="text-sm font-semibold text-gray-900 mb-3 scroll-mt-20">Yêu cầu ứng viên</h2>
              <p class="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {{ job.requirements }}
              </p>
            </section>

            <section
              v-if="job.benefits"
              class="bg-white rounded-xl border border-gray-200 p-6"
            >
              <h2 class="text-sm font-semibold text-gray-900 mb-3">Quyền lợi</h2>
              <p class="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {{ job.benefits }}
              </p>
            </section>

            <section
              v-if="job.requiredSkills?.length || job.niceToHaveSkills?.length"
              class="bg-white rounded-xl border border-gray-200 p-6"
            >
              <h2 class="text-sm font-semibold text-gray-900 mb-3">Kỹ năng</h2>
              <div v-if="job.requiredSkills?.length" class="mb-3">
                <p class="text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-1.5">
                  Yêu cầu
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="skill in job.requiredSkills"
                    :key="skill"
                    class="inline-flex items-center rounded-md bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
                  >
                    {{ skill }}
                  </span>
                </div>
              </div>
              <div v-if="job.niceToHaveSkills?.length">
                <p class="text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-1.5">
                  Ưu tiên
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="skill in job.niceToHaveSkills"
                    :key="skill"
                    class="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                  >
                    {{ skill }}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <!-- ============ Right col — management ============ -->
          <aside class="lg:col-span-4 space-y-4">
            <div class="lg:sticky lg:top-4 space-y-4">
              <!--
                Actions — vertical stack đơn giản, không hover-to-grow.
                Primary: Xem ứng viên / Gửi kiểm duyệt AI (tuỳ status).
                Secondary: Sửa, Xoá, Re-scan, Xem trang công khai.
              -->
              <div
                ref="managePanelRef"
                class="bg-white rounded-xl border border-gray-200 p-5 space-y-2"
              >
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Quản lý
                </h3>

                <!-- Primary action tuỳ status, hoặc status placeholder khi không có action chính -->
                <!--
                  Quy tắc primary:
                  - live       → "Xem ứng viên" (job đang chạy, action chính là xem apply)
                  - draft / ai_flagged / expired / pending → "Gửi kiểm duyệt AI"
                  - ai_scanning / closed → không có primary (chỉ hiển thị badge)
                  Dropdown "Thao tác khác" bên dưới luôn có để truy cập Sửa, ...
                -->
                <button
                  v-if="job.status === 'live'"
                  type="button"
                  class="w-full px-3 py-2 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition inline-flex items-center justify-center gap-2"
                  @click="onViewApplications"
                >
                  <Users class="w-4 h-4" /> Xem ứng viên ({{ job.appliesCount }})
                </button>

                <button
                  v-else-if="canSubmit"
                  type="button"
                  class="w-full px-3 py-2 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="actionPending"
                  @click="onSubmitForScan"
                >
                  <Loader2 v-if="actionPending" class="w-4 h-4 animate-spin" />
                  <Send v-else class="w-4 h-4" />
                  Gửi kiểm duyệt AI
                </button>

                <div
                  v-else
                  class="w-full px-3 py-2 text-xs text-gray-600 rounded-lg bg-gray-50 border border-gray-200 text-center inline-flex items-center justify-center gap-2"
                >
                  <Loader2 v-if="job.status === 'ai_scanning'" class="w-3.5 h-3.5 animate-spin text-gray-500" />
                  <span v-if="job.status === 'ai_scanning'">AI đang quét nội dung...</span>
                  <span v-else-if="job.status === 'closed'">Job đã đóng</span>
                  <span v-else>Không có thao tác khả dụng</span>
                </div>

                <!-- "Thao tác khác" toggle -->
                <button
                  type="button"
                  class="w-full px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition inline-flex items-center justify-center gap-2"
                  aria-haspopup="true"
                  :aria-expanded="showMoreActions"
                  @click="showMoreActions = !showMoreActions"
                >
                  Thao tác khác
                  <ChevronDown
                    class="w-4 h-4 transition-transform"
                    :class="showMoreActions ? 'rotate-180' : ''"
                  />
                </button>

                <!-- Dropdown items — chỉ render khi showMoreActions = true.
                     Click-outside đóng qua document mousedown (script setup). -->
                <div
                  v-if="showMoreActions"
                  class="rounded-lg border border-gray-200 overflow-hidden"
                >
                  <!-- Sửa (luôn hiện) -->
                  <button
                    type="button"
                    class="w-full px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 transition border-b border-gray-200 last:border-b-0 inline-flex items-center gap-2"
                    @click="onEdit"
                  >
                    <Pencil class="w-4 h-4 text-gray-500" /> Sửa job
                  </button>

                  <!-- Xem trang công khai (chỉ job live) -->
                  <button
                    v-if="job.status === 'live'"
                    type="button"
                    class="w-full px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 transition border-b border-gray-200 last:border-b-0 inline-flex items-center gap-2"
                    @click="onViewPublic"
                  >
                    <ExternalLink class="w-4 h-4 text-gray-500" /> Xem trang công khai
                  </button>

                  <!-- Gửi kiểm duyệt lại (live + canSubmit, giữ loading state) -->
                  <button
                    v-if="job.status === 'live' && canSubmit"
                    type="button"
                    class="w-full px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 transition border-b border-gray-200 last:border-b-0 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="actionPending"
                    @click="onSubmitForScan"
                  >
                    <Loader2 v-if="actionPending" class="w-4 h-4 animate-spin text-gray-500" />
                    <Send v-else class="w-4 h-4 text-gray-500" />
                    Gửi kiểm duyệt lại
                  </button>

                  <!-- Re-scan (admin only, giữ loading state) -->
                  <button
                    v-if="canRescan"
                    type="button"
                    class="w-full px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 transition border-b border-gray-200 last:border-b-0 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="actionPending"
                    @click="onRescan"
                  >
                    <Loader2 v-if="actionPending" class="w-4 h-4 animate-spin text-gray-500" />
                    <RefreshCw v-else class="w-4 h-4 text-gray-500" />
                    {{ job.status === 'live' ? 'Force re-scan (admin)' : 'Re-scan' }}
                  </button>

                  <!-- Mở lại (chỉ job đã đóng → chuyển về bản nháp để sửa + submit lại) -->
                  <button
                    v-if="canReopen"
                    type="button"
                    class="w-full px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 transition border-b border-gray-200 last:border-b-0 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="actionPending"
                    @click="onReopen"
                  >
                    <Loader2 v-if="actionPending" class="w-4 h-4 animate-spin text-gray-500" />
                    <RotateCcw v-else class="w-4 h-4 text-gray-500" />
                    Mở lại (chuyển về bản nháp)
                  </button>

                  <!-- Xoá job (luôn last). canDelete=false khi status=closed → không render. -->
                  <button
                    v-if="canDelete"
                    type="button"
                    class="w-full px-3 py-2 text-sm text-left transition border-b border-gray-200 last:border-b-0 inline-flex items-center gap-2"
                    :class="job.status === 'closed' ? 'text-gray-400 cursor-not-allowed' : 'text-red-600 hover:bg-red-50'"
                    :disabled="job.status === 'closed'"
                    @click="onDelete"
                  >
                    <Trash2 class="w-4 h-4" />
                    {{ job.status === 'closed' ? 'Đã đóng' : 'Xoá job' }}
                  </button>
                </div>
              </div>

              <!-- Deadline (prominent) -->
              <div
                v-if="deadlineLabel"
                class="bg-white rounded-xl border border-gray-200 p-5"
              >
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Hạn nộp hồ sơ
                </h3>
                <p class="text-sm font-semibold text-gray-900">{{ deadlineLabel }}</p>
                <p class="text-xs text-gray-500 mt-0.5">{{ deadlineRelative }}</p>
              </div>

              <!-- Tổng quan stats -->
              <div class="bg-white rounded-xl border border-gray-200 p-5 space-y-2.5">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Tổng quan
                </h3>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <Eye class="w-3.5 h-3.5" /> Lượt xem
                  </span>
                  <span class="font-medium text-gray-900">{{ job.viewsCount.toLocaleString('vi-VN') }}</span>
                </div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <FileText class="w-3.5 h-3.5" /> Ứng viên
                  </span>
                  <span class="font-medium text-gray-900">{{ job.appliesCount.toLocaleString('vi-VN') }}</span>
                </div>
                <div v-if="publishedLabel" class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <Calendar class="w-3.5 h-3.5" /> Ngày đăng
                  </span>
                  <span class="font-medium text-gray-900">{{ publishedLabel }}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </template>
    </div>

    <!-- ============ Delete confirm ============ -->
    <ConfirmModal
      :open="deleteOpen"
      title="Đóng job này?"
      :message="`Job '${job?.title ?? ''}' sẽ chuyển sang trạng thái 'Đã đóng' và không còn hiển thị với ứng viên. Bạn có chắc muốn tiếp tục?`"
      confirm-text="Đóng job"
      variant="danger"
      @cancel="cancelDelete"
      @confirm="confirmDelete"
    />

    <!-- ============ Edit modal ============ -->
    <EditJobModal
      v-if="job"
      v-model:open="editOpen"
      :job-id="job.id"
      @saved="onEditSaved"
    />
  </div>
</template>
