<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useToastStore } from '@stores/toast';
import { useAuthStore } from '@stores/auth';
import { jobApi } from '@services/job.api';
import { applicationApi } from '@services/application.api';
import {
  aiTestApi,
  type AiTestSummary,
  type AiTestDetail,
  type AiTestType,
} from '@services/aiTest.api';
import AiTestReviewModal from '@components/employer/AiTestReviewModal.vue';
import type {
  ApplicationStatus,
  EmployerApplicationRow,
  ApplicationDetail,
} from '@/types/application';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import ConfirmModal from '@components/common/ConfirmModal.vue';
import EditJobModal from '@components/employer/EditJobModal.vue';
import UpgradePricing from '@components/pricing/UpgradePricing.vue';
import type { JobDetail, JobStatus } from '@/types/job';
import { useSocket } from '@/composables/useSocket';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  X,
  Mail,
  Check,
  Plus,
  HelpCircle,
  Heart,
  MoreHorizontal,
  Share2,
  BadgeAlert,
  Crown,
  Pencil,
  User,
  Users,
  Info,
  Globe,
  Briefcase,
  FileText,
  Calendar,
  Clock,
  Hourglass,
  Building2,
  Banknote,
  GraduationCap,
  MapPin,
  MinusCircle,
  CheckSquare,
  BookOpen,
  Compass,
  Star,
  ScanLine,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Loader2,
  ExternalLink,
  Trash2,
  Send,
  RotateCcw,
  Eye,
  Sparkles
} from 'lucide-vue-next';

// =========================================================================
// ROUTE & STORES
// =========================================================================
const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const auth = useAuthStore();

// Job ID từ route param (nếu có)
const jobId = computed<string>(() => String(route.params.id ?? ''));

// =========================================================================
// STATE (KHÔNG DÙNG DỮ LIỆU MOCK - TOÀN BỘ FETCH TỪ API)
// =========================================================================
const job = ref<JobDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

// AI Scan result từ API
const scan = ref<unknown>(undefined);
const scanLoading = ref(false);
const scanError = ref<string | null>(null);

// Modals & Action states
const editOpen = ref(false);
const deleteOpen = ref(false);
const reopenOpen = ref(false);
const showUpgradeModal = ref(false);
const actionPending = ref(false);
const showMoreActions = ref(false);

// State tương tác giao diện
const activeTab = ref<'information' | 'application' | 'test' | 'feedback'>('information');
const isFavorite = ref(true);
const showModerationDetail = ref(false);

// Hiring manager removed ids (client-side toggle)
const removedManagerIds = ref<number[]>([]);

// =========================================================================
// AI MODERATION TYPING & COMPUTED
// =========================================================================
interface ScanInfo {
  id?: string;
  verdict?: 'approved' | 'flagged' | string;
  score?: number | string;
  model?: string;
  scannedAt?: string | Date;
  scannedBy?: string;
}

interface ScanFlag {
  id?: string;
  scanId?: string;
  severity: 'block' | 'warn';
  category: string;
  field: string;
  quote?: string;
  reasoning: string;
  suggestion?: string;
  lawRef?: string;
}

interface ScanPayload {
  scan: ScanInfo;
  flags: ScanFlag[];
}

const scanData = computed<ScanPayload | null>(() => {
  if (!scan.value) return null;
  const s = scan.value as Partial<ScanPayload>;
  if (s && s.scan) return s as ScanPayload;
  return null;
});

const currentScan = computed<ScanInfo | null>(() => scanData.value?.scan ?? null);
const currentFlags = computed<ScanFlag[]>(() => scanData.value?.flags ?? []);

const scanScorePct = computed((): number => {
  if (!currentScan.value?.score) return 0;
  const raw = currentScan.value.score;
  const num = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (isNaN(num)) return 0;
  return Math.round(Math.max(0, Math.min(1, num)) * 100);
});

// =========================================================================
// HELPER MAPS CHO CATEGORY VÀ FIELD CỦA AI SCAN
// =========================================================================
const CATEGORY_MAP: Record<string, string> = {
  discrimination_gender: 'Phân biệt giới tính',
  discrimination_age: 'Phân biệt độ tuổi',
  discrimination_other: 'Phân biệt khác (tôn giáo/khuyết tật)',
  scam_mlm: 'Lừa đảo đa cấp',
  scam_recruitment_fee: 'Thu phí tuyển dụng',
  scam_money_request: 'Yêu cầu chuyển tiền',
  sexual_explicit: 'Nội dung khiêu dâm',
  sexual_solicitation: 'Tuyển dụng mại dâm / gợi dục',
  profanity: 'Ngôn từ thô tục / xúc phạm',
  violence_threat: 'Đe dọa bạo lực',
  pii_leak_post: 'Lộ thông tin cá nhân (PII)',
};

const FIELD_MAP: Record<string, string> = {
  description: 'Mô tả công việc (Description)',
  title: 'Tiêu đề công việc (Title)',
  requirements: 'Yêu cầu công việc (Requirements)',
  benefits: 'Quyền lợi (Benefits)',
};

// =========================================================================
// FORMATTERS & LABELS
// =========================================================================
const formatDateTime = (dateStr?: string | Date): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${hours}:${minutes} · ${day}/${month}/${year}`;
};

const formatDate = (dateStr?: string | Date | null): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month}, ${year}`;
};

const calculateDaysRemaining = (deadline?: string | Date | null): number => {
  if (!deadline) return 0;
  const d = new Date(deadline);
  const now = new Date();
  const diffTime = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};

const daysRemaining = computed(() => {
  return calculateDaysRemaining(job.value?.deadline);
});

const jobLevelLabel = computed((): string => {
  const m: Record<string, string> = {
    intern: 'Intern',
    fresher: 'Fresher',
    junior: 'Junior',
    mid: 'Mid-level',
    senior: 'Senior',
    lead: 'Lead',
    manager: 'Manager',
  };
  return job.value?.jobLevel ? m[job.value.jobLevel] ?? job.value.jobLevel : 'Chưa cập nhật';
});

const jobTypeLabel = computed((): string => {
  const m: Record<string, string> = {
    'full-time': 'Full Time',
    'part-time': 'Part Time',
    contract: 'Contract',
    internship: 'Internship',
    freelance: 'Freelance',
  };
  return job.value?.jobType ? m[job.value.jobType] ?? job.value.jobType : 'Full Time';
});

const salaryLabel = computed((): string => {
  const j = job.value;
  if (!j) return '';
  if (j.salaryVisible === false) return 'Thoả thuận';
  const { salaryMin, salaryMax } = j;
  if (!salaryMin && !salaryMax) return 'Thoả thuận';
  const toM = (s: string): string => `${(Number(s) / 1_000_000).toFixed(0)} triệu`;

  const extra = (j as any)?.extraData;
  const cycle = extra?.paymentType;
  const cycleSuffix = cycle === 'weekly' ? ' / tuần' : cycle === 'contract' ? ' / dự án' : cycle === 'monthly' ? ' / tháng' : '';

  if (salaryMin && salaryMax) return `${toM(salaryMin)} – ${toM(salaryMax)}${cycleSuffix}`;
  if (salaryMin) return `Từ ${toM(salaryMin)}${cycleSuffix}`;
  return `Đến ${toM(salaryMax!)}${cycleSuffix}`;
});

const locationLine = computed((): string => {
  const loc = job.value?.location;
  if (!loc) return 'Chưa cập nhật';
  const parts = [loc.district, loc.city].filter(Boolean);
  return parts.join(', ') || 'Chưa cập nhật';
});

const experienceLabel = computed((): string => {
  const j = job.value;
  if (!j) return 'Không yêu cầu';
  const { experienceYearsMin, experienceYearsMax } = j;
  if (experienceYearsMin == null && experienceYearsMax == null) return 'Không yêu cầu';
  if (experienceYearsMin != null && experienceYearsMax != null) {
    return `${experienceYearsMin} - ${experienceYearsMax} Năm`;
  }
  if (experienceYearsMin != null) return `Từ ${experienceYearsMin} Năm`;
  return `Đến ${experienceYearsMax} Năm`;
});

const STATUS_MAP: Record<string, { label: string; bgClass: string; dotClass: string; description: string }> = {
  live:        { label: 'Đang hiển thị', bgClass: 'bg-emerald-50 text-emerald-700', dotClass: 'bg-emerald-500', description: 'Job đã vượt qua AI moderation và hiển thị công khai.' },
  active:      { label: 'Active', bgClass: 'bg-emerald-50 text-emerald-700', dotClass: 'bg-emerald-500', description: 'Job đang hoạt động.' },
  draft:       { label: 'Bản nháp', bgClass: 'bg-gray-100 text-gray-700', dotClass: 'bg-gray-400', description: 'Job đang là bản nháp — chỉ bạn thấy.' },
  pending:     { label: 'Đang chờ', bgClass: 'bg-blue-50 text-blue-700', dotClass: 'bg-blue-500', description: 'Job đang chờ xử lý moderation.' },
  ai_scanning: { label: 'Đang quét', bgClass: 'bg-amber-50 text-amber-700', dotClass: 'bg-amber-500', description: 'Hệ thống AI đang quét nội dung job.' },
  ai_scaning:  { label: 'Đang quét', bgClass: 'bg-amber-50 text-amber-700', dotClass: 'bg-amber-500', description: 'Hệ thống AI đang quét nội dung job.' },
  ai_flagged:  { label: 'Bị gắn cờ', bgClass: 'bg-red-50 text-red-700', dotClass: 'bg-red-500', description: 'AI phát hiện vấn đề trong nội dung.' },
  expired:     { label: 'Hết hạn', bgClass: 'bg-orange-50 text-orange-700', dotClass: 'bg-orange-500', description: 'Job đã quá hạn nộp.' },
  closed:      { label: 'Đã đóng', bgClass: 'bg-gray-100 text-gray-500 line-through', dotClass: 'bg-gray-400', description: 'Job đã bị đóng.' },
};

const currentStatusBadge = computed(() => {
  const s = String(job.value?.status ?? 'active');
  return STATUS_MAP[s] ?? STATUS_MAP.active;
});

// Danh sách chi tiết công việc bên cột phải
const jobDetailsList = computed(() => [
  {
    label: 'Ngành',
    value: job.value?.industry || 'Khác',
    icon: Users,
  },
  {
    label: 'Hình thức',
    value: jobTypeLabel.value,
    icon: Compass,
  },
  {
    label: 'Cách thức',
    value: job.value?.workType === 'remote' ? 'Remote' : job.value?.workType === 'hybrid' ? 'Hybrid' : 'On-Site',
    icon: Building2,
  },
  {
    label: 'Lương',
    value: salaryLabel.value,
    icon: Banknote,
  },
  {
    label: 'Kinh nghiệm',
    value: experienceLabel.value,
    icon: GraduationCap,
  },
  {
    label: 'Địa điểm',
    value: locationLine.value,
    icon: MapPin,
  },
  {
    label: 'Lượt xem',
    value: job.value?.viewsCount != null ? String(job.value.viewsCount) : '0',
    icon: Eye,
  },
]);

// Hiring manager list (hỗ trợ extraData từ backend nếu có)
const hiringManagers = computed(() => {
  const extra = (job.value as any)?.extraData;
  const list = (job.value as any)?.hiringManagers || extra?.hiringManagers;
  if (Array.isArray(list) && list.length > 0) return list;
  return [
    {
      id: 1,
      name: extra?.hiringManagerName || 'Quản lý tuyển dụng',
      role: 'HR Manager',
      avatarType: 'initial',
      initial: (extra?.hiringManagerName || 'Q').charAt(0).toUpperCase(),
      initialBg: 'bg-[#2563eb]',
    },
  ];
});

const visibleManagers = computed(() => {
  return hiringManagers.value.filter((m: any) => !removedManagerIds.value.includes(m.id));
});

const removeManager = (id: number): void => {
  removedManagerIds.value.push(id);
};

// =========================================================================
// COLLAPSE / EXPAND FOR DESCRIPTION, REQUIREMENTS, BENEFITS
// =========================================================================
const isDescExpanded = ref(false);
const isReqExpanded = ref(false);
const isBenExpanded = ref(false);

const TEXT_COLLAPSE_THRESHOLD = 240;
const isDescLong = computed(() => {
  const t = job.value?.description || '';
  return t.length > TEXT_COLLAPSE_THRESHOLD || t.trim().split('\n').filter(Boolean).length > 4;
});

const isReqLong = computed(() => {
  const t = job.value?.requirements || '';
  return t.length > TEXT_COLLAPSE_THRESHOLD || t.trim().split('\n').filter(Boolean).length > 4;
});

const isBenLong = computed(() => {
  const t = job.value?.benefits || '';
  return t.length > TEXT_COLLAPSE_THRESHOLD || t.trim().split('\n').filter(Boolean).length > 4;
});

const getTruncatedText = (text?: string | null, maxLen = 240, maxLines = 4): string => {
  if (!text) return '';
  const lines = text.split('\n');
  if (lines.length > maxLines) {
    const subset = lines.slice(0, maxLines).join('\n');
    if (subset.length <= maxLen) {
      return subset.trim();
    }
    const truncated = subset.slice(0, maxLen);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim();
  }
  if (text.length > maxLen) {
    const truncated = text.slice(0, maxLen);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim();
  }
  return text;
};

// =========================================================================
// API FETCHING & REALTIME SOCKET
// =========================================================================
const fetchDetail = async (): Promise<void> => {
  let targetId = jobId.value;

  // Nếu không có id trên URL, tìm job đầu tiên của công ty hoặc hệ thống để hiển thị
  if (!targetId) {
    try {
      const res = await jobApi.listByCompany({ limit: 1 });
      const firstJob = res.data?.data?.[0];
      if (firstJob?.id) {
        targetId = firstJob.id;
      }
    } catch {
      try {
        const publicRes = await jobApi.list({ limit: 1 });
        const firstPublic = publicRes.data?.data?.[0];
        if (firstPublic?.id) {
          targetId = firstPublic.id;
        }
      } catch {
        // Ignored
      }
    }
  }

  if (!targetId) {
    error.value = 'Không tìm thấy tin tuyển dụng nào để hiển thị.';
    return;
  }

  try {
    const { data } = await jobApi.detail(targetId);
    if (data.data) {
      job.value = data.data;
    } else {
      error.value = 'Không tìm thấy thông tin tin tuyển dụng.';
    }
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || 'Không thể tải chi tiết tin tuyển dụng.';
  }
};

const fetchScan = async (): Promise<void> => {
  const targetId = jobId.value || job.value?.id;
  if (!targetId) return;

  scanLoading.value = true;
  scanError.value = null;
  try {
    const { data } = await jobApi.scanResult(targetId);
    if (data.data) {
      scan.value = data.data;
    } else {
      scan.value = null;
    }
  } catch {
    scan.value = null;
  } finally {
    scanLoading.value = false;
  }
};

const loadAll = async (): Promise<void> => {
  loading.value = true;
  error.value = null;
  try {
    await fetchDetail();
    await fetchScan();
    void fetchJobTests();
  } finally {
    loading.value = false;
  }
};

onMounted(loadAll);
watch(jobId, () => {
  isDescExpanded.value = false;
  isReqExpanded.value = false;
  isBenExpanded.value = false;
  void loadAll();
  if (activeTab.value === 'application') {
    void fetchJobApplications(1);
  } else if (activeTab.value === 'test') {
    void fetchJobTests();
  }
});

// Realtime socket: khi worker hoàn thành scan thì tự động refetch
useSocket(
  'job_scan_complete', async (payload: { jobId: string, verdict: 'approved' | 'flagged', score: number, flaggedCount: number }) => {
    const targetId = jobId.value || job.value?.id;
    if (payload.jobId === targetId) {
      if (job.value) {
        job.value = {
          ...job.value,
          status: payload.verdict === 'approved' ? 'live' : 'ai_flagged'
        };
      }
      await fetchScan();
      // toast.push({
      //   variant: payload.verdict === 'approved' ? 'success' : 'warning',
      //   title: 'Kiểm duyệt AI hoàn tất',
      //   body: payload.verdict === 'approved'
      //     ? 'Tin tuyển dụng đã được duyệt tự động'
      //     : 'Tin tuyển dụng bị gắn cờ cảnh báo nội dung',
      // });
    }
  }
);

// =========================================================================
// ACTION HANDLERS
// =========================================================================
const prevJob = computed(() => job.value?.prevJob ?? null);
const nextJob = computed(() => job.value?.nextJob ?? null);

const goToPrevJob = (): void => {
  if (prevJob.value?.id) {
    router.push({ name: route.name || 'employer-job-detail', params: { id: prevJob.value.id } });
  }
};

const goToNextJob = (): void => {
  if (nextJob.value?.id) {
    router.push({ name: route.name || 'employer-job-detail', params: { id: nextJob.value.id } });
  }
};

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
  editOpen.value = true;
};

const onEditSaved = async (): Promise<void> => {
  await loadAll();
  toast.push({ variant: 'success', title: 'Đã cập nhật tin tuyển dụng' });
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
  actionPending.value = true;
  try {
    await jobApi.delete(job.value.id);
    toast.push({ variant: 'success', title: 'Đã đóng job thành công' });
    if (job.value) {
      job.value.status = 'closed';
    }
    await loadAll();
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Đóng job thất bại',
      body: e instanceof Error ? e.message : 'Vui lòng thử lại',
    });
  } finally {
    actionPending.value = false;
  }
};

const onReopen = (): void => {
  if (!job.value) return;
  showMoreActions.value = false;
  reopenOpen.value = true;
};
const cancelReopen = (): void => { reopenOpen.value = false; };
const confirmReopen = async (): Promise<void> => {
  if (!job.value) return;
  reopenOpen.value = false;
  actionPending.value = true;
  try {
    await jobApi.reopen(job.value.id);
    toast.push({
      variant: 'success',
      title: 'Đã mở lại job',
      body: 'Job chuyển về bản nháp. Bạn có thể cập nhật thông tin và gửi AI kiểm duyệt để đăng lại.',
    });
    if (job.value) {
      job.value.status = 'draft';
    }
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

const isQuotaExceeded = (e: unknown): boolean => {
  const err = e as any;
  if (err?.response?.status === 402) return true;
  if (err?.response?.data?.code === 'QUOTA_EXCEEDED') return true;
  const msg = (err?.response?.data?.message || err?.message || '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('hết lượt') ||
    msg.includes('hết hạn ngạch') ||
    msg.includes('nâng cấp gói') ||
    msg.includes('payment_required')
  );
};

const openUpgradeModal = (): void => {
  showMoreActions.value = false;
  showUpgradeModal.value = true;
};

const onUpgradeSuccess = async (): Promise<void> => {
  showUpgradeModal.value = false;
  toast.push({
    variant: 'success',
    title: 'Nâng cấp gói thành công!',
    body: 'Lượt sử dụng AI đã được bổ sung. Bạn có thể tiếp tục kiểm duyệt.',
  });
  await loadAll();
};

const onSubmitForScan = async (): Promise<void> => {
  if (!job.value || actionPending.value || job.value.status === 'ai_scanning') return;
  showMoreActions.value = false;
  actionPending.value = true;

  const previousStatus = job.value.status;
  // Đổi ngay status ở cạnh title thành ai_scanning ("Đang quét")
  job.value.status = 'ai_scanning' as JobStatus;

  try {
    await jobApi.submit(job.value.id);
    await fetchScan();
  } catch (e) {
    if (job.value) {
      job.value.status = previousStatus;
    }
    if (isQuotaExceeded(e)) {
      showUpgradeModal.value = true;
      toast.push({
        variant: 'warning',
        title: 'Hết lượt kiểm duyệt AI',
        body: 'Bạn đã sử dụng hết lượt kiểm duyệt AI trong gói hiện tại. Vui lòng nâng cấp gói để tiếp tục.',
      });
      return;
    }
    toast.push({
      variant: 'error',
      title: 'Gửi duyệt thất bại',
      body: e instanceof Error ? e.message : 'Vui lòng thử lại',
    });
  } finally {
    actionPending.value = false;
  }
};

// =========================================================================
// TAB ĐƠN ỨNG TUYỂN (APPLICATIONS LIST CHO RIÊNG JOB NÀY)
// =========================================================================
interface JobApplicationItem {
  applicationId: string;
  candidateId: string;
  name: string;
  avatarUrl?: string | null;
  email: string;
  status: ApplicationStatus;
  match: number | null;
  date: string;
}

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

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: 'Chờ xử lý',
  viewed: 'Đã xem',
  screening: 'Sàng lọc',
  interview: 'Phỏng vấn',
  offered: 'Đã offer',
  hired: 'Đã tuyển',
  rejected: 'Đã từ chối',
  withdrawn: 'Đã rút đơn',
};

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

const avatarInitial = (name: string): string => {
  const t = name.trim();
  return t ? t.charAt(0).toLocaleUpperCase('vi-VN') : '?';
};

const truncate = (s: string | null | undefined, max = 20): string => {
  const v = (s ?? '').trim();
  return v.length > max ? `${v.slice(0, max)}…` : v;
};

const formatAppDate = (iso: string): string => {
  const d = dayjs(iso);
  return d.isValid() ? d.format('D [Thg] M, YYYY') : iso;
};

const formatAppTime = (iso: string): string => {
  const d = dayjs(iso);
  return d.isValid() ? d.format('HH:mm') : iso;
};

const applicationList = ref<JobApplicationItem[]>([]);
const appLoading = ref(false);
const appTotal = ref(0);
const appPage = ref(1);
const appLimit = ref(10);
const appSelectedStatus = ref<ApplicationStatus | ''>('');
const appStatusSelectOpen = ref(false);
const appStatusSelectRoot = ref<HTMLElement | null>(null);
const appMatchSort = ref<'none' | 'desc' | 'asc'>('none');
const appSearchKeyword = ref('');

const appStatusFilterLabel = computed(
  () => STATUS_FILTER_OPTIONS.find((o) => o.value === appSelectedStatus.value)?.label ?? 'Tất cả trạng thái',
);

const pickAppStatus = (val: ApplicationStatus | ''): void => {
  appSelectedStatus.value = val;
  appStatusSelectOpen.value = false;
  void fetchJobApplications(1);
};

const toggleAppMatchSort = (): void => {
  appMatchSort.value = appMatchSort.value === 'none' ? 'desc' : appMatchSort.value === 'desc' ? 'asc' : 'none';
};

const mapEmployerAppRow = (row: EmployerApplicationRow, fallbackIdx: number): JobApplicationItem => {
  const matchNum = row.aiMatchScore != null ? Math.round(Number(row.aiMatchScore)) : null;
  return {
    applicationId: row.id,
    candidateId: row.candidateId,
    name: row.candidateName ?? `Ứng viên #${fallbackIdx + 1}`,
    avatarUrl: row.candidateAvatarUrl ?? null,
    email: row.candidateEmail ?? (row.isAnonymous ? '(Ẩn danh)' : ''),
    status: row.status,
    match: matchNum !== null && Number.isFinite(matchNum) ? matchNum : null,
    date: dayjs(row.appliedAt).isValid() ? row.appliedAt : '',
  };
};

const fetchJobApplications = async (pageNum?: number): Promise<void> => {
  const targetJobId = jobId.value || job.value?.id;
  if (!targetJobId) return;
  if (typeof pageNum === 'number') appPage.value = pageNum;
  appLoading.value = true;
  try {
    const { data } = await applicationApi.listByCompany({
      page: appPage.value,
      limit: appLimit.value,
      jobId: targetJobId,
      status: appSelectedStatus.value || undefined,
    });
    const rows = data.data?.rows ?? [];
    applicationList.value = rows.map((r, i) => mapEmployerAppRow(r, i));
    appTotal.value = data.data?.total ?? rows.length;
    if (typeof data.data?.page === 'number') appPage.value = data.data.page;
    if (typeof data.data?.limit === 'number') appLimit.value = data.data.limit;
  } catch {
    applicationList.value = [];
    appTotal.value = 0;
  } finally {
    appLoading.value = false;
  }
};

const displayedApplications = computed(() => {
  let list = applicationList.value;
  if (appSearchKeyword.value.trim()) {
    const kw = appSearchKeyword.value.trim().toLowerCase();
    list = list.filter((a) =>
      a.name.toLowerCase().includes(kw) || a.email.toLowerCase().includes(kw)
    );
  }
  if (appMatchSort.value === 'none') return list;
  const dir = appMatchSort.value === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    if (a.match === null && b.match === null) return 0;
    if (a.match === null) return 1;
    if (b.match === null) return -1;
    return (a.match - b.match) * dir;
  });
});

const appTotalPages = computed(() =>
  appTotal.value === 0 ? 1 : Math.max(1, Math.ceil(appTotal.value / appLimit.value))
);

const appPaginationPages = computed<(number | '…')[]>(() => {
  const total_ = appTotalPages.value;
  const current = appPage.value;
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

const goToAppPage = (n: number): void => {
  if (n < 1 || n > appTotalPages.value || n === appPage.value) return;
  void fetchJobApplications(n);
};

// Modal chi tiết đơn ứng tuyển
const showAppDetailModal = ref(false);
const appDetailLoading = ref(false);
const selectedAppItem = ref<JobApplicationItem | null>(null);
const selectedAppDetail = ref<ApplicationDetail | null>(null);
const updatingAppStatus = ref(false);

const openAppDetail = async (a: JobApplicationItem): Promise<void> => {
  selectedAppItem.value = a;
  showAppDetailModal.value = true;
  appDetailLoading.value = true;
  selectedAppDetail.value = null;
  try {
    const { data } = await applicationApi.getById(a.applicationId);
    selectedAppDetail.value = data.data;
  } catch (e: any) {
    toast.push({
      variant: 'error',
      title: 'Không thể tải chi tiết đơn ứng tuyển',
      body: e?.response?.data?.message || e?.message || 'Vui lòng thử lại sau',
    });
  } finally {
    appDetailLoading.value = false;
  }
};

const closeAppDetailModal = (): void => {
  showAppDetailModal.value = false;
  selectedAppItem.value = null;
  selectedAppDetail.value = null;
};

const changeAppStatus = async (appId: string, next: ApplicationStatus): Promise<void> => {
  updatingAppStatus.value = true;
  try {
    await applicationApi.updateStatus(appId, { status: next });
    const row = applicationList.value.find((a) => a.applicationId === appId);
    if (row) row.status = next;
    if (selectedAppItem.value && selectedAppItem.value.applicationId === appId) {
      selectedAppItem.value.status = next;
    }
    if (selectedAppDetail.value && selectedAppDetail.value.id === appId) {
      selectedAppDetail.value.status = next;
    }
    toast.push({
      variant: 'success',
      title: 'Đã cập nhật trạng thái',
      body: `Đơn ứng tuyển đã chuyển sang "${STATUS_LABEL[next]}".`,
    });
  } catch (e: any) {
    toast.push({
      variant: 'error',
      title: 'Cập nhật thất bại',
      body: e?.response?.data?.message || e?.message || 'Vui lòng thử lại.',
    });
  } finally {
    updatingAppStatus.value = false;
  }
};

const onAppDocClick = (e: MouseEvent): void => {
  const target = e.target as Node;
  if (appStatusSelectRoot.value && !appStatusSelectRoot.value.contains(target)) {
    appStatusSelectOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener('mousedown', onAppDocClick, true);
  if (activeTab.value === 'application') {
    void fetchJobApplications(1);
  } else if (activeTab.value === 'test') {
    void fetchJobTests();
  }
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onAppDocClick, true);
});

watch(activeTab, (tab) => {
  if (tab === 'application') {
    void fetchJobApplications(1);
  } else if (tab === 'test') {
    void fetchJobTests();
  }
});

// =========================================================================
// TAB BÀI KIỂM TRA (AI TEST LIST CHO RIÊNG JOB NÀY)
// =========================================================================
const testList = ref<AiTestSummary[]>([]);
const testLoading = ref(false);
const testError = ref<string | null>(null);
const generatingTestType = ref<AiTestType | null>(null);
const reviewModalOpen = ref(false);
const reviewTestDetail = ref<AiTestDetail | null>(null);
const reviewLoading = ref(false);
const regeneratingTestId = ref<string | null>(null);
const confirmRegenerateOpen = ref(false);
const testToRegenerate = ref<AiTestSummary | null>(null);

const fetchJobTests = async (): Promise<void> => {
  const targetJobId = jobId.value || job.value?.id;
  if (!targetJobId) return;
  testLoading.value = true;
  testError.value = null;
  try {
    const { data } = await aiTestApi.listForJob(targetJobId);
    testList.value = data.data ?? [];
  } catch (e: any) {
    testError.value = e?.response?.data?.message || e?.message || 'Không thể tải danh sách bài kiểm tra';
    testList.value = [];
  } finally {
    testLoading.value = false;
  }
};

const handleGenerateTest = async (type: AiTestType): Promise<void> => {
  const targetJobId = jobId.value || job.value?.id;
  if (!targetJobId || generatingTestType.value) return;
  generatingTestType.value = type;
  try {
    const { data } = await aiTestApi.generate(targetJobId, type);
    toast.push({
      variant: 'success',
      title: data.data.reused ? 'Đã liên kết đề bài có sẵn' : 'Đang sinh đề bài bằng AI',
      body: data.data.reused
        ? 'Bộ đề kiểm tra đã sẵn sàng để sử dụng.'
        : 'AI đang tiến hành sinh bộ câu hỏi. Danh sách sẽ tự động cập nhật khi hoàn tất.',
    });
    await fetchJobTests();
  } catch (e: any) {
    toast.push({
      variant: 'error',
      title: 'Không thể tạo đề kiểm tra',
      body: e?.response?.data?.message || e?.message || 'Vui lòng thử lại sau',
    });
  } finally {
    generatingTestType.value = null;
  }
};

const openReviewTest = async (testId: string): Promise<void> => {
  reviewModalOpen.value = true;
  reviewLoading.value = true;
  reviewTestDetail.value = null;
  try {
    const { data } = await aiTestApi.getDetail(testId);
    reviewTestDetail.value = data.data;
  } catch (e: any) {
    toast.push({
      variant: 'error',
      title: 'Không thể tải chi tiết đề kiểm tra',
      body: e?.response?.data?.message || e?.message || 'Vui lòng thử lại',
    });
    reviewModalOpen.value = false;
  } finally {
    reviewLoading.value = false;
  }
};

const requestRegenerateTest = (testItem: AiTestSummary): void => {
  if (testItem.status === 'failed') {
    void handleRegenerateTest(testItem);
    return;
  }
  testToRegenerate.value = testItem;
  confirmRegenerateOpen.value = true;
};

const confirmRegenerate = async (): Promise<void> => {
  if (!testToRegenerate.value) return;
  const target = testToRegenerate.value;
  confirmRegenerateOpen.value = false;
  testToRegenerate.value = null;
  await handleRegenerateTest(target);
};

const handleRegenerateTest = async (testItem: AiTestSummary): Promise<void> => {
  if (regeneratingTestId.value || generatingTestType.value) return;
  regeneratingTestId.value = testItem.id;
  try {
    await aiTestApi.regenerate(testItem.id);
    toast.push({
      variant: 'success',
      title: 'Đang tạo lại đề bằng AI',
      body: `AI đang tiến hành sinh bộ câu hỏi mới cho đề ${testItem.testType === 'iq' ? 'IQ' : 'Tiếng Anh'}. Danh sách sẽ tự động cập nhật khi hoàn tất.`,
    });
    const found = testList.value.find((t) => t.id === testItem.id);
    if (found) {
      found.status = 'generating';
    }
    await fetchJobTests();
  } catch (e: any) {
    toast.push({
      variant: 'error',
      title: 'Không thể tạo lại đề kiểm tra',
      body: e?.response?.data?.message || e?.message || 'Vui lòng thử lại sau',
    });
  } finally {
    regeneratingTestId.value = null;
  }
};

// Realtime socket: khi AI sinh đề xong thì tự động reload test list
useSocket('ai-test:ready', (payload: any) => {
  const targetJobId = jobId.value || job.value?.id;
  if (
    !payload?.jobId ||
    payload.jobId === targetJobId ||
    (payload?.testId && testList.value.some((t) => t.id === payload.testId))
  ) {
    void fetchJobTests();
  }
});
</script>

<template>
  <div class="max-w-[1240px] mx-auto bg-white border-none shadow-2xs overflow-hidden relative pb-6 font-poppins text-gray-900 min-h-screen">

    <!-- ===================================================================
         TRƯỜNG HỢP 1: SKELETON LOADING (HIỆU ỨNG KHI ĐANG TẢI HOẶC TẢI LẠI)
         ======================================================f============= -->
    <div v-if="loading" class="animate-pulse">
      <!-- 1. Header Skeleton -->
      <div class="px-6 lg:px-8 pt-5 pb-4 border-b border-gray-100 bg-white">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <!-- Trái: Back button + Title + Badges -->
          <div class="flex items-center gap-2.5 sm:gap-3 flex-wrap">
            <div class="w-7 h-7 rounded-full bg-gray-200"></div>
            <div class="h-6 sm:h-7 w-64 sm:w-96 rounded-md bg-gray-200"></div>
            <div class="h-5 w-24 rounded-full bg-gray-200"></div>
            <div class="h-5 w-28 rounded-full bg-gray-200 hidden sm:block"></div>
          </div>
          <!-- Phải: Action buttons -->
          <div class="flex items-center gap-1.5 self-end sm:self-auto">
            <div class="w-7 h-7 rounded-full bg-gray-200"></div>
            <div class="w-7 h-7 rounded-full bg-gray-200"></div>
            <div class="w-7 h-7 rounded-full bg-gray-200"></div>
            <div class="w-7 h-7 rounded-lg bg-gray-200"></div>
            <div class="w-7 h-7 rounded-lg bg-gray-200"></div>
            <div class="h-7 w-20 rounded-lg bg-gray-200"></div>
          </div>
        </div>

        <!-- Meta row skeleton -->
        <div class="flex items-center gap-x-4 gap-y-2 flex-wrap mt-3 pt-1">
          <div class="h-4 w-28 rounded bg-gray-200"></div>
          <div class="h-4 w-24 rounded bg-gray-200"></div>
          <div class="h-4 w-24 rounded bg-gray-200"></div>
          <div class="h-4 w-36 rounded bg-gray-200"></div>
          <div class="h-4 w-32 rounded bg-gray-200"></div>
        </div>
      </div>

      <!-- 2. Tabs Row Skeleton -->
      <div class="px-6 lg:px-8 border-b border-gray-100 bg-white pt-2.5 pb-2.5">
        <div class="flex items-center gap-4">
          <div class="h-8 w-28 rounded-lg bg-gray-200"></div>
          <div class="h-8 w-32 rounded-lg bg-gray-200"></div>
          <div class="h-8 w-28 rounded-lg bg-gray-200"></div>
          <div class="h-8 w-24 rounded-lg bg-gray-200"></div>
        </div>
      </div>

      <!-- 3. Body Skeleton (2 Cột 67% - 33%) -->
      <div class="p-4 sm:p-5 lg:p-6">
        <div class="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
          <!-- Cột trái (67%) -->
          <div class="w-full lg:w-[67%] space-y-6">
            <!-- AI Moderation Card Skeleton -->
            <div class="rounded-xl border border-gray-100 p-4 space-y-3.5 bg-gray-50/50">
              <div class="flex items-center justify-between">
                <div class="h-4 w-44 rounded bg-gray-200"></div>
                <div class="h-4 w-20 rounded-full bg-gray-200"></div>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div v-for="i in 4" :key="i" class="flex items-center gap-2">
                  <div class="w-8 h-8 rounded-full bg-gray-200 shrink-0"></div>
                  <div class="space-y-1.5 flex-1">
                    <div class="h-2.5 w-14 bg-gray-200 rounded"></div>
                    <div class="h-3 w-20 bg-gray-200 rounded"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Description Skeleton -->
            <div class="space-y-3">
              <div class="h-5 w-44 rounded bg-gray-200"></div>
              <div class="space-y-2">
                <div class="h-3.5 w-full rounded bg-gray-200"></div>
                <div class="h-3.5 w-[94%] rounded bg-gray-200"></div>
                <div class="h-3.5 w-[98%] rounded bg-gray-200"></div>
                <div class="h-3.5 w-[85%] rounded bg-gray-200"></div>
              </div>
            </div>

            <!-- Requirements Skeleton -->
            <div class="space-y-3 pt-2">
              <div class="h-5 w-48 rounded bg-gray-200"></div>
              <div class="space-y-2.5">
                <div v-for="i in 4" :key="i" class="flex items-start gap-2.5">
                  <div class="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 shrink-0"></div>
                  <div class="h-3.5 rounded bg-gray-200" :class="i % 2 === 0 ? 'w-[90%]' : 'w-[80%]'"></div>
                </div>
              </div>
            </div>

            <!-- Benefits Skeleton -->
            <div class="space-y-3 pt-2">
              <div class="h-5 w-40 rounded bg-gray-200"></div>
              <div class="space-y-2.5">
                <div v-for="i in 4" :key="i" class="flex items-start gap-2.5">
                  <div class="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 shrink-0"></div>
                  <div class="h-3.5 rounded bg-gray-200" :class="i % 2 === 0 ? 'w-[85%]' : 'w-[75%]'"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Cột phải (33%) -->
          <div class="w-full lg:w-[33%] space-y-5">
            <!-- Closing Date Skeleton -->
            <div class="rounded-xl border border-gray-100 p-4 space-y-3 bg-gray-50/50">
              <div class="h-4 w-36 rounded bg-gray-200"></div>
              <div class="h-3.5 w-44 rounded bg-gray-200"></div>
              <div class="h-3.5 w-44 rounded bg-gray-200"></div>
              <div class="h-12 w-full rounded-lg bg-gray-200"></div>
            </div>

            <!-- Job Details Card Skeleton -->
            <div class="rounded-xl border border-gray-100 p-4 space-y-4 bg-gray-50/50">
              <div class="h-4 w-32 rounded bg-gray-200"></div>
              <div class="space-y-3">
                <div v-for="i in 6" :key="i" class="flex items-center gap-3">
                  <div class="w-7 h-7 rounded-lg bg-gray-200 shrink-0"></div>
                  <div class="space-y-1.5 flex-1">
                    <div class="h-2.5 w-16 bg-gray-200 rounded"></div>
                    <div class="h-3 w-28 bg-gray-200 rounded"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Hiring Team Card Skeleton -->
            <div class="rounded-xl border border-gray-100 p-4 space-y-3.5 bg-gray-50/50">
              <div class="h-4 w-36 rounded bg-gray-200"></div>
              <div class="space-y-3">
                <div v-for="i in 2" :key="i" class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-gray-200 shrink-0"></div>
                  <div class="space-y-1.5 flex-1">
                    <div class="h-3 w-24 bg-gray-200 rounded"></div>
                    <div class="h-2.5 w-20 bg-gray-200 rounded"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================================================================
         TRƯỜNG HỢP 2: LỖI HOẶC KHÔNG TÌM THẤY TIN TUYỂN DỤNG
         =================================================================== -->
    <div v-else-if="error || !job" class="px-6 py-24 text-center max-w-md mx-auto">
      <div class="w-14 h-14 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-3">
        <AlertCircle class="w-7 h-7" />
      </div>
      <h2 class="text-base font-bold text-gray-900 mb-1">Không thể tải tin tuyển dụng</h2>
      <p class="text-xs text-gray-500 mb-5 leading-relaxed">{{ error || 'Tin tuyển dụng không tồn tại hoặc bạn không có quyền xem.' }}</p>
      <div class="flex items-center justify-center gap-2">
        <button
          type="button"
          @click="goBack"
          class="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition cursor-pointer"
        >
          Quay lại danh sách
        </button>
        <button
          type="button"
          @click="loadAll"
          class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#5b4eea] text-white hover:bg-[#4b3fd0] transition cursor-pointer"
        >
          Thử lại
        </button>
      </div>
    </div>

    <!-- ===================================================================
         TRƯỜNG HỢP 3: HIỂN THỊ DỮ LIỆU THẬT TỪ API
         =================================================================== -->
    <div v-else>
      <!-- Loading indicator nhỏ góc trên khi scan hoặc refetch ngầm -->
      <div
        v-if="scanLoading || actionPending"
        class="absolute top-2 right-4 z-30 flex items-center gap-1.5 text-xs text-[#5b4eea] bg-white/95 px-3 py-1 rounded-full shadow-xs border border-indigo-100"
      >
        <!-- <Loader2 class="w-3.5 h-3.5 animate-spin" />
        <span>Đang đồng bộ...</span> -->
      </div>

      <!-- ===================================================================
           KHU VỰC B: JOB HEADER
           =================================================================== -->
      <div class="px-6 lg:px-8 pt-5 pb-4 border-b border-gray-100 bg-white">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <!-- Bên trái: Nút quay lại, Tên công việc, Badges trạng thái -->
          <div class="flex items-center gap-2.5 sm:gap-3 flex-wrap">
            <!-- Nút back -->
            <button
              type="button"
              @click="goBack"
              class="w-7 h-7 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-2xs shrink-0 cursor-pointer"
              title="Quay lại danh sách việc làm"
            >
              <ArrowLeft class="h-3.5 w-3.5" />
            </button>

            <!-- Tiêu đề công việc -->
            <h1 class="text-xl sm:text-[22px] font-bold text-gray-900 tracking-tight leading-none">
              {{ job.title }}
            </h1>

            <!-- Badge trạng thái động theo status của Job -->
            <span
              class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
              :class="currentStatusBadge.bgClass"
              :title="currentStatusBadge.description"
            >
              <Loader2
                v-if="(job.status as string) === 'ai_scanning' || (job.status as string) === 'ai_scaning'"
                class="w-3 h-3 animate-spin text-amber-600"
              />
              <span v-else class="w-1.5 h-1.5 rounded-full" :class="currentStatusBadge.dotClass"></span>
              {{ currentStatusBadge.label }}
            </span>

            <!-- Badge phân công: Assigned to me -->
            <!-- <span
              class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#eef2ff] text-[#4f46e5]"
            >
              <User class="h-3 w-3 text-[#4f46e5]" />
              Assigned to me
            </span> -->
          </div>

          <!-- Bên phải: Nhóm actions (Pagination, Favorite, More, Share, Edit Job) -->
          <div class="flex items-center gap-1.5 self-end sm:self-auto">
            <!-- Nút Previous Job -->
            <button
              type="button"
              @click="goToPrevJob"
              :disabled="!prevJob"
              class="w-7 h-7 rounded-full border border-gray-200 bg-white flex items-center justify-center transition-colors"
              :class="prevJob ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 cursor-pointer shadow-2xs' : 'text-gray-300 opacity-40 cursor-not-allowed select-none bg-gray-50'"
              :title="prevJob ? `Job trước: ${prevJob.title}` : 'Không có job trước đó'"
            >
              <ChevronLeft class="h-3.5 w-3.5" />
            </button>

            <!-- Nút Next Job -->
            <button
              type="button"
              @click="goToNextJob"
              :disabled="!nextJob"
              class="w-7 h-7 rounded-full border border-gray-200 bg-white flex items-center justify-center transition-colors"
              :class="nextJob ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 cursor-pointer shadow-2xs' : 'text-gray-300 opacity-40 cursor-not-allowed select-none bg-gray-50'"
              :title="nextJob ? `Job tiếp theo: ${nextJob.title}` : 'Không có job tiếp theo'"
            >
              <ChevronRight class="h-3.5 w-3.5" />
            </button>

            <!-- Nút Favorite (Trái tim đỏ) -->
            <!-- <button
              type="button"
              class="w-7 h-7 rounded-full border border-gray-200 bg-white flex items-center justify-center hover:bg-red-50 transition-colors cursor-pointer"
              :title="isFavorite ? 'Bỏ yêu thích' : 'Yêu thích'"
              @click="isFavorite = !isFavorite"
            >
              <Heart
                class="h-3.5 w-3.5 transition-colors"
                :class="isFavorite ? 'fill-[#ef4444] text-[#ef4444]' : 'text-gray-400'"
              />
            </button> -->

            <!-- Nút More actions (...) với dropdown -->
            <div class="relative">
              <button
                type="button"
                @click="showMoreActions = !showMoreActions"
                class="w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors cursor-pointer"
                title="More actions"
              >
                <MoreHorizontal class="h-3.5 w-3.5" />
              </button>

              <!-- Dropdown menu -->
              <div
                v-if="showMoreActions"
                class="absolute right-0 top-full mt-1 w-48 rounded-lg bg-white border border-gray-200 shadow-md py-1 z-30 text-xs"
              >
                <!-- Khi job chưa đóng: Gửi duyệt AI / Đăng tin -->
                <button
                  v-if="job.status !== 'closed'"
                  type="button"
                  @click="onSubmitForScan"
                  :disabled="actionPending || job.status === 'ai_scanning'"
                  class="w-full px-3 py-1.5 text-left flex items-center gap-2 transition"
                  :class="job.status === 'ai_scanning' ? 'text-gray-400 bg-gray-50 cursor-not-allowed opacity-60' : 'text-gray-700 hover:bg-gray-50 cursor-pointer'"
                >
                  <Loader2 v-if="job.status === 'ai_scanning'" class="w-3.5 h-3.5 animate-spin text-amber-500" />
                  <Send v-else-if="job.status === 'draft'" class="w-3.5 h-3.5 text-[#5b4eea]" />
                  <RotateCcw v-else class="w-3.5 h-3.5 text-[#5b4eea]" />
                  <span>{{ job.status === 'ai_scanning' ? 'Đang quét AI...' : (job.status === 'draft' ? 'Đăng tin (Gửi duyệt AI)' : 'Gửi duyệt lại AI') }}</span>
                </button>

                <!-- Nâng cấp gói -->
                <button
                  type="button"
                  @click="openUpgradeModal"
                  class="w-full px-3 py-1.5 text-left text-[#5b4eea] hover:bg-indigo-50 flex items-center gap-2 cursor-pointer font-medium"
                >
                  <Sparkles class="w-3.5 h-3.5 text-[#5b4eea]" />
                  <span>Nâng cấp gói (Gia hạn)</span>
                </button>

                <!-- Khi job đang đóng: Mở lại job -->
                <button
                  v-if="job.status === 'closed'"
                  type="button"
                  @click="onReopen"
                  class="w-full px-3 py-1.5 text-left text-emerald-600 hover:bg-emerald-50 flex items-center gap-2 cursor-pointer border-t border-gray-100 font-semibold"
                >
                  <RotateCcw class="w-3.5 h-3.5 text-emerald-600" />
                  <span>Mở lại job</span>
                </button>

                <!-- Khi job chưa đóng: Đóng job -->
                <button
                  v-else
                  type="button"
                  @click="onDelete"
                  class="w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer border-t border-gray-100"
                >
                  <Trash2 class="w-3.5 h-3.5 text-red-500" />
                  <span>Đóng job</span>
                </button>
              </div>
            </div>

            <!-- Nút Share -->
            <button
              type="button"
              class="w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors cursor-pointer"
              title="Share"
            >
              <Share2 class="h-3.5 w-3.5" />
            </button>

            <!-- Nút Edit Job (disabled khi AI đang quét) -->
            <button
              type="button"
              @click="onEdit"
              :disabled="job.status === 'ai_scanning'"
              class="h-7 px-2.5 rounded-lg border border-gray-200 bg-white flex items-center gap-1.5 text-xs font-semibold text-gray-700 transition-colors shadow-2xs ml-0.5"
              :class="job.status === 'ai_scanning' ? 'opacity-50 cursor-not-allowed bg-gray-50 text-gray-400' : 'hover:bg-gray-50 hover:text-gray-900 cursor-pointer'"
              :title="job.status === 'ai_scanning' ? 'Không thể chỉnh sửa khi AI đang quét nội dung' : 'Edit Job'"
            >
              <Pencil class="h-3 w-3 text-gray-500" />
              <span>Edit Job</span>
            </button>

            <!-- Nút Đăng tin (Duyệt AI) khi job là Draft -->
            <button
              v-if="job.status === 'draft'"
              type="button"
              @click="onSubmitForScan"
              :disabled="actionPending"
              class="h-7 px-3 rounded-lg bg-[#5b4eea] hover:bg-[#4e42d6] text-white flex items-center gap-1.5 text-xs font-semibold transition-colors shadow-2xs ml-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Đăng tin - Gửi AI kiểm duyệt nội dung để công khai"
            >
              <Loader2 v-if="actionPending" class="h-3 w-3 animate-spin" />
              <Send v-else class="h-3 w-3" />
              <span>Đăng tin (Duyệt AI)</span>
            </button>

            <!-- Khi job đang quét AI: Hiển thị trạng thái Đang quét (disabled hoàn toàn chống spam) -->
            <button
              v-else-if="job.status === 'ai_scanning'"
              type="button"
              disabled
              class="h-7 px-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center gap-1.5 text-xs font-semibold shadow-2xs ml-0.5 opacity-80 cursor-not-allowed select-none"
              title="Hệ thống AI đang quét nội dung tin tuyển dụng... Vui lòng đợi trong giây lát"
            >
              <Loader2 class="h-3 w-3 animate-spin text-amber-600" />
              <span>Đang quét AI...</span>
            </button>

            <!-- Nút Gửi duyệt lại khi job bị gắn cờ -->
            <button
              v-else-if="job.status === 'ai_flagged'"
              type="button"
              @click="onSubmitForScan"
              :disabled="actionPending"
              class="h-7 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 text-xs font-semibold transition-colors shadow-2xs ml-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Gửi duyệt lại AI sau khi chỉnh sửa"
            >
              <Loader2 v-if="actionPending" class="h-3 w-3 animate-spin" />
              <RotateCcw v-else class="h-3 w-3" />
              <span>Gửi duyệt lại AI</span>
            </button>

            <!-- Nút Mở lại job (khi job đang đóng) -->
            <button
              v-else-if="job.status === 'closed'"
              type="button"
              @click="onReopen"
              class="h-7 px-2.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 transition-colors shadow-2xs ml-0.5 cursor-pointer"
              title="Mở lại tin tuyển dụng"
            >
              <RotateCcw class="h-3 w-3 text-emerald-600" />
              <span>Mở lại job</span>
            </button>
          </div>
        </div>

        <!-- Dòng Metadata bên dưới tiêu đề -->
        <div class="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-xs text-gray-500 mt-2.5">
          <!-- Vị trí làm việc -->
          <div class="flex items-center gap-1.5">
            <MapPin class="h-3.5 w-3.5 text-gray-400" />
            <span>{{ locationLine }}</span>
          </div>

          <!-- Loại hình công việc -->
          <div class="flex items-center gap-1.5">
            <Briefcase class="h-3.5 w-3.5 text-gray-400" />
            <span>{{ jobTypeLabel }}</span>
          </div>

          <!-- Cấp bậc công việc -->
          <div class="flex items-center gap-1.5">
            <GraduationCap class="h-3.5 w-3.5 text-gray-400" />
            <span>{{ jobLevelLabel }}</span>
          </div>

          <!-- Mức lương -->
          <div class="flex items-center gap-1.5">
            <Banknote class="h-3.5 w-3.5 text-gray-400" />
            <span class="font-medium text-gray-700">{{ salaryLabel }}</span>
          </div>

          <!-- Ngày đăng -->
          <div v-if="job.publishedAt" class="flex items-center gap-1.5">
            <Calendar class="h-3.5 w-3.5 text-gray-400" />
            <span>Đăng ngày {{ formatDate(job.publishedAt) }}</span>
          </div>
        </div>

        <!-- Banner hướng dẫn đăng tin khi Job ở trạng thái Draft hoặc đang quét AI -->
        <!-- <div
          v-if="job.status === 'draft' || job.status === 'ai_scanning'"
          class="mt-3.5 p-3 rounded-lg border flex items-center justify-between gap-3 text-xs"
          :class="job.status === 'ai_scanning' ? 'bg-amber-50/70 border-amber-200' : 'bg-indigo-50/70 border-indigo-100'"
        >
          <div class="flex items-center gap-2.5 min-w-0" :class="job.status === 'ai_scanning' ? 'text-amber-950' : 'text-indigo-950'">
            <div
              class="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
              :class="job.status === 'ai_scanning' ? 'bg-amber-100 text-amber-600' : 'bg-[#5b4eea]/15 text-[#5b4eea]'"
            >
              <Sparkles v-if="job.status === 'draft'" class="w-3.5 h-3.5" />
            </div>
           
            <p v-if="job.status === 'draft'" class="leading-tight text-xs text-indigo-900">
              <span class="font-bold">Tin đang ở trạng thái Bản nháp:</span> Chưa hiển thị công khai với ứng viên. Hãy nhấn <strong class="text-[#5b4eea]">"Đăng tin (Duyệt AI)"</strong> để AI kiểm duyệt nội dung và tự động xuất bản khi đạt chuẩn.
            </p>
          </div>
          <button
            type="button"
            @click="onSubmitForScan"
            :disabled="actionPending || job.status === 'ai_scanning'"
            class="shrink-0 h-7 px-3 rounded-md text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
            :class="job.status === 'ai_scanning' ? 'bg-amber-500 opacity-70 cursor-not-allowed select-none' : 'bg-[#5b4eea] hover:bg-[#4e42d6] cursor-pointer disabled:opacity-50'"
          >
            <Loader2 v-if="actionPending || job.status === 'ai_scanning'" class="h-3 w-3 animate-spin" />
            <Send v-else class="h-3 w-3" />
            <span>{{ job.status === 'ai_scanning' ? 'Đang quét...' : 'Đăng tin ngay' }}</span>
          </button>
        </div> -->
      </div>

      <!-- ===================================================================
           KHU VỰC C: NAVIGATION TABS ROW (4 TABS)
           =================================================================== -->
      <nav
        class="px-6 lg:px-8 flex items-center gap-6 sm:gap-8 border-b border-gray-200 bg-white text-xs select-none"
        aria-label="Job Detail Tabs"
      >
        <!-- Tab 1: Thông tin (Information) -->
        <button
          type="button"
          class="flex items-center gap-1.5 py-3 font-medium transition-colors border-b-2 -mb-[1px]"
          :class="
            activeTab === 'information'
              ? 'text-[#5b4eea] border-[#5b4eea] font-semibold'
              : 'text-gray-500 border-transparent hover:text-gray-700'
          "
          @click="activeTab = 'information'"
        >
          <Info
            class="h-3.5 w-3.5"
            :class="activeTab === 'information' ? 'text-[#5b4eea]' : 'text-gray-400'"
          />
          <span>Thông tin</span>
        </button>

        <!-- Tab 2: Đơn ứng tuyển (Application) -->
        <button
          type="button"
          class="flex items-center gap-1.5 py-3 font-medium transition-colors border-b-2 -mb-[1px]"
          :class="
            activeTab === 'application'
              ? 'text-[#5b4eea] border-[#5b4eea] font-semibold'
              : 'text-gray-500 border-transparent hover:text-gray-700'
          "
          @click="activeTab = 'application'"
        >
          <FileText
            class="h-3.5 w-3.5"
            :class="activeTab === 'application' ? 'text-[#5b4eea]' : 'text-gray-400'"
          />
          <span>Đơn ứng tuyển</span>
          <span
            class="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-semibold"
            :class="
              activeTab === 'application'
                ? 'bg-[#5b4eea]/10 text-[#5b4eea]'
                : 'bg-gray-100 text-gray-500'
            "
          >
            {{ appTotal || job.appliesCount || 0 }}
          </span>
        </button>

        <!-- Tab 3: Bài kiểm tra (Test) -->
        <button
          type="button"
          class="flex items-center gap-1.5 py-3 font-medium transition-colors border-b-2 -mb-[1px]"
          :class="
            activeTab === 'test'
              ? 'text-[#5b4eea] border-[#5b4eea] font-semibold'
              : 'text-gray-500 border-transparent hover:text-gray-700'
          "
          @click="activeTab = 'test'"
        >
          <CheckSquare
            class="h-3.5 w-3.5"
            :class="activeTab === 'test' ? 'text-[#5b4eea]' : 'text-gray-400'"
          />
          <span>Bài kiểm tra</span>
          <span
            v-if="testList.length"
            class="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-semibold"
            :class="
              activeTab === 'test'
                ? 'bg-[#5b4eea]/10 text-[#5b4eea]'
                : 'bg-gray-100 text-gray-500'
            "
          >
            {{ testList.length }}
          </span>
        </button>

        <!-- Tab 4: Đánh giá (Feedback) -->
        <button
          type="button"
          class="flex items-center gap-1.5 py-3 font-medium transition-colors border-b-2 -mb-[1px]"
          :class="
            activeTab === 'feedback'
              ? 'text-[#5b4eea] border-[#5b4eea] font-semibold'
              : 'text-gray-500 border-transparent hover:text-gray-700'
          "
          @click="activeTab = 'feedback'"
        >
          <Star
            class="h-3.5 w-3.5"
            :class="activeTab === 'feedback' ? 'text-[#5b4eea]' : 'text-gray-400'"
          />
          <span>Đánh giá</span>
          <span
            v-if="job.feedbackStats?.count"
            class="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-semibold"
            :class="
              activeTab === 'feedback'
                ? 'bg-[#5b4eea]/10 text-[#5b4eea]'
                : 'bg-gray-100 text-gray-500'
            "
          >
            {{ job.feedbackStats.count }}
          </span>
        </button>
      </nav>

      <!-- ===================================================================
           NỘI DUNG TAB 1: THÔNG TIN (Layout 2 cột: 67% - 33%)
           =================================================================== -->
      <main v-if="activeTab === 'information'" class="flex-1 min-w-0 bg-white">
        <div class="flex flex-col lg:flex-row">
          <!-- =================================================================
               CỘT TRÁI (67% chiều rộng): AI Moderation & Job Description
               ================================================================= -->
          <section
            class="w-full lg:w-[67%] p-4 sm:p-5 lg:p-6 lg:pr-7 min-w-0"
            aria-label="Thông tin chính việc làm"
          >
            <!-- -------------------------------------------------------------
                 KHU VỰC E: CỘT TRÁI - CARD AI KIỂM DUYỆT (AI MODERATION)
                 ------------------------------------------------------------- -->
            <div
              v-if="currentScan"
              class="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-2xs mb-6"
            >
              <!-- Dải thông báo ở trên cùng: đổi màu tương ứng với verdict -->
              <div
                class="border-b px-3.5 py-2 flex items-center justify-between gap-2 transition-colors bg-[#f6effe] text-black-800"
              >
                <div class="flex items-center gap-2">
                  <Info  class="h-3.5 w-3.5 text-[#5b4eea]" />
                  <p class="text-[11px] text-[#5b4eea] font-normal leading-tight">
                      Chi tiết kiểm duyệt bằng AI Chỉ phục vụ nội bộ, ứng viên không nhìn thấy.
                  </p>
                </div>

                <span
                  class="text-[10px] font-semibold px-2 py-0.5 rounded shrink-0"
                  :class="currentScan.verdict === 'flagged' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'"
                >
                  {{ currentScan.verdict === 'flagged' ? 'Chưa đạt chuẩn' : 'Đã duyệt tự động' }}
                </span>
              </div>

              <!-- Tiêu đề AI Moderation -->
              <div class="px-3.5 pt-3 pb-2.5 flex items-center justify-between flex-wrap gap-2 border-b border-gray-100">
                <div class="flex items-center gap-2">
                  <ScanLine class="w-4 h-4 text-[#5b4eea]" />
                  <h2 class="text-sm font-bold text-gray-900 leading-none">AI Kiểm duyệt</h2>
                  
                </div>

                <!-- Nút gửi quét lại -->
                <button
                  type="button"
                  @click="onSubmitForScan"
                  :disabled="actionPending || job.status === 'ai_scanning'"
                  class="px-2.5 py-1 rounded-md text-[11px] font-semibold transition flex items-center gap-1 shadow-2xs"
                  :class="job.status === 'ai_scanning' ? 'text-amber-700 bg-amber-50 border border-amber-200 opacity-80 cursor-not-allowed select-none' : 'text-[#5b4eea] bg-[#5b4eea]/10 hover:bg-[#5b4eea]/20 cursor-pointer disabled:opacity-50'"
                  :title="job.status === 'ai_scanning' ? 'AI đang trong quá trình quét, vui lòng đợi' : 'Gửi AI kiểm duyệt lại toàn bộ nội dung'"
                >
                  <RotateCcw class="w-3 h-3" :class="{ 'animate-spin': actionPending || job.status === 'ai_scanning' }" />
                  <span>{{ job.status === 'ai_scanning' ? 'Đang quét...' : 'Quét lại' }}</span>
                </button>
              </div>

              <!-- 4 Thông tin bố trí ngang hàng (Kết quả AI moderation) -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 px-3.5 py-3.5">
                <!-- 1. Kết quả kiểm duyệt (Verdict) -->
                <div class="flex items-center gap-2.5 min-w-0">
                  <div
                    class="w-8 h-8 rounded-full border flex items-center justify-center shrink-0"
                    :class="currentScan.verdict === 'flagged' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-emerald-50 border-emerald-200 text-emerald-600'"
                  >
                    <AlertTriangle v-if="currentScan.verdict === 'flagged'" class="h-4 w-4" />
                    <CheckCircle2 v-else class="h-4 w-4" />
                  </div>
                  <div class="min-w-0">
                    <div class="text-[10px] sm:text-[11px] text-gray-400 font-medium leading-tight">Kết quả kiểm duyệt</div>
                    <div
                      class="text-xs font-bold text-gray-900 mt-0.5 truncate font-mono"
                    >
                      {{ currentScan.verdict === 'flagged' ? 'Bị gắn cờ' : 'Đã duyệt' }}
                    </div>
                  </div>
                </div>

                <!-- 2. Điểm tuân thủ (AI Score) -->
                <div class="flex items-center gap-2.5 min-w-0">
                  <div
                    class="w-8 h-8 rounded-full border flex items-center justify-center shrink-0"
                    :class="currentScan.verdict === 'flagged' ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-emerald-50 border-emerald-200 text-emerald-600'"
                  >
                    <ShieldAlert v-if="currentScan.verdict === 'flagged'" class="h-4 w-4" />
                    <ShieldCheck v-else class="h-4 w-4" />
                  </div>
                  <div class="min-w-0">
                    <div class="text-[10px] sm:text-[11px] text-gray-400 font-medium leading-tight">Điểm tuân thủ AI</div>
                    <div class="text-xs font-bold text-gray-900 mt-0.5 flex items-center gap-1.5">
                      <span class="text-xs font-bold text-gray-900 mt-0.5 truncate font-mono">
                        {{ scanScorePct }}%
                      </span>
                      <span v-if="currentScan.score" class="text-[10px] text-gray-400 font-normal">({{ currentScan.score }}/1.0)</span>
                    </div>
                  </div>
                </div>

                <!-- 3. Mô hình kiểm duyệt (Model) -->
                <div class="flex items-center gap-2.5 min-w-0">
                  <div
                    class="w-8 h-8 rounded-full bg-indigo-50/80 border border-indigo-100 flex items-center justify-center text-[#5b4eea] shrink-0"
                  >
                    <Cpu class="h-4 w-4" />
                  </div>
                  <div class="min-w-0">
                    <div class="text-[10px] sm:text-[11px] text-gray-400 font-medium leading-tight">Mô hình AI</div>
                    <div class="text-xs font-bold text-gray-900 mt-0.5 truncate font-mono">
                      {{ currentScan.model || 'Gemini 2.5' }}
                    </div>
                  </div>
                </div>

                <!-- 4. Thời gian quét (Scanned At) -->
                <div class="flex items-center gap-2.5 min-w-0">
                  <div
                    class="w-8 h-8 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-600 shrink-0"
                  >
                    <Clock class="h-4 w-4" />
                  </div>
                  <div class="min-w-0">
                    <div class="text-[10px] sm:text-[11px] text-gray-400 font-medium leading-tight">Thời gian quét</div>
                    <div class="text-xs font-bold text-gray-900 mt-0.5 truncate">
                      {{ formatDateTime(currentScan.scannedAt) || 'Vừa xong' }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- Thanh Xem thêm / Thu gọn chi tiết kiểm duyệt -->
              <div class="px-3.5 py-2.5 bg-gray-50/70 border-t border-gray-100 flex items-center justify-between">
                <div class="flex items-center gap-2 text-xs">
                  <span
                    v-if="currentFlags.length > 0"
                    class="flex items-center gap-1.5 text-red-600 font-medium text-[11px] sm:text-xs"
                  >
                    <AlertTriangle class="w-3.5 h-3.5 text-red-500 shrink-0" />
                    <span>Có {{ currentFlags.length }} cảnh báo vi phạm cần xử lý</span>
                  </span>
                  <span
                    v-else
                    class="flex items-center gap-1.5 text-emerald-600 font-medium text-[11px] sm:text-xs"
                  >
                    <CheckCircle2 class="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>Không phát hiện vi phạm quy định</span>
                  </span>
                </div>

                <!-- Nút Xem thêm / Thu gọn -->
                <button
                  type="button"
                  @click="showModerationDetail = !showModerationDetail"
                  class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-[#5b4eea] hover:bg-[#5b4eea]/10 transition-colors cursor-pointer select-none"
                >
                  <span>{{ showModerationDetail ? 'Thu gọn' : 'Xem thêm' }}</span>
                  <ChevronDown
                    class="w-3.5 h-3.5 transition-transform duration-200"
                    :class="{ 'rotate-180': showModerationDetail }"
                  />
                </button>
              </div>

              <!-- CHI TIẾT CẢNH BÁO HOẶC THÔNG BÁO HỢP LỆ (Ẩn ban đầu, chỉ hiện khi bấm Xem thêm) -->
              <div
                v-show="showModerationDetail"
                class="px-3 pb-2 pt-2.5 border-t border-gray-100 bg-white"
              >
                <!-- TH1: Danh sách flags vi phạm -->
                <div v-if="currentFlags.length > 0" class="space-y-3">
                  

                  <div
                    v-for="flag in currentFlags"
                    :key="flag.id"
                    class="rounded-lg border border-red-200 bg-red-50/30 p-3 text-xs space-y-2"
                  >
                    <!-- Tiêu đề lỗi: Severity + Category + Field -->
                    <div class="flex items-center justify-between flex-wrap gap-1.5">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white uppercase tracking-wider">
                          {{ flag.severity === 'block' ? 'Chặn (Block)' : 'Cảnh báo (Warn)' }}
                        </span>
                        <span class="font-semibold text-gray-900">
                          {{ CATEGORY_MAP[flag.category] || flag.category }}
                        </span>
                      </div>
                      <span class="text-[11px] text-gray-600 bg-white px-2 py-0.5 rounded border border-gray-200">
                        Vị trí: <strong>{{ FIELD_MAP[flag.field] || flag.field }}</strong>
                      </span>
                    </div>

                    <!-- Trích dẫn vi phạm (quote) -->
                    <div v-if="flag.quote" class="bg-white border-l-4 border-red-500 rounded-r p-2.5">
                      <div class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Trích dẫn vi phạm:</div>
                      <blockquote class="italic text-red-700 font-semibold text-xs">
                        "{{ flag.quote }}"
                      </blockquote>
                    </div>

                    <!-- Lý do AI phân tích (reasoning) -->
                    <div class="text-gray-700 leading-relaxed">
                      <strong class="text-gray-900 font-semibold">Lý do: </strong>
                      {{ flag.reasoning }}
                    </div>

                    <!-- Gợi ý sửa (suggestion) -->
                    <div v-if="flag.suggestion" class="rounded-md bg-blue-50 border border-blue-100 p-2.5 text-blue-900 flex items-start gap-1.5">
                      <span class="shrink-0 text-sm">💡</span>
                      <div>
                        <strong class="font-semibold">Gợi ý sửa đổi: </strong>
                        <span>{{ flag.suggestion }}</span>
                      </div>
                    </div>

                    <!-- Căn cứ pháp lý (lawRef) -->
                    <div v-if="flag.lawRef" class="text-[11px] text-gray-500 flex items-center gap-1.5 pt-0.5">
                      <span>📜</span>
                      <span>Căn cứ pháp lý: <strong>{{ flag.lawRef }}</strong></span>
                    </div>
                  </div>
                </div>

                <!-- TH2: Không vi phạm (Approved) -->
                <div
                  v-else
                  class="rounded-lg bg-emerald-50/60 border border-emerald-200 p-3.5 flex items-start gap-3 mt-1"
                >
                  <CheckCircle2 class="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div class="text-xs space-y-1">
                    <div class="font-bold text-emerald-900">
                      Nội dung đạt chuẩn - Không phát hiện vi phạm
                    </div>
                    <p class="text-emerald-700 leading-relaxed">
                      Hệ thống AI không phát hiện bất kỳ dấu hiệu phân biệt đối xử, ngôn từ thù ghét, thông tin lừa đảo hoặc vi phạm Bộ luật Lao động Việt Nam nào trong tiêu đề, mô tả và yêu cầu tuyển dụng.
                    </p>
                    <div class="text-[11px] text-emerald-600 pt-1 font-mono">
                      <span v-if="currentScan.id">Scan ID: #{{ currentScan.id.substring(0, 8) }} · </span>
                      Điểm an toàn: {{ scanScorePct }}%
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Trường hợp chưa có scan data -->
            <div
              v-else
              class="rounded-xl border border-gray-200 overflow-hidden shadow-2xs bg-white p-4 mb-6"
            >
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <div class="flex items-center gap-2">
                  <ScanLine class="w-4 h-4 text-[#5b4eea]" />
                  <h2 class="text-sm font-bold text-gray-900 leading-none">AI Kiểm duyệt  </h2>
                  
                </div>
                <button
                  v-if="job.status !== 'closed'"
                  type="button"
                  @click="onSubmitForScan"
                  :disabled="actionPending || job.status === 'ai_scanning'"
                  class="px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs"
                  :class="job.status === 'ai_scanning' ? 'bg-amber-50 border border-amber-200 text-amber-700 opacity-80 cursor-not-allowed select-none' : 'bg-[#5b4eea] text-white hover:bg-[#4e42d6] cursor-pointer disabled:opacity-50'"
                >
                  <Loader2 v-if="actionPending || job.status === 'ai_scanning'" class="w-3.5 h-3.5 animate-spin text-amber-600" />
                  <Send v-else-if="job.status === 'draft'" class="w-3.5 h-3.5" />
                  <RotateCcw v-else class="w-3.5 h-3.5" />
                  <span>{{ job.status === 'ai_scanning' ? 'Đang quét AI...' : (job.status === 'draft' ? 'Đăng tin & Kiểm duyệt AI' : 'Gửi duyệt AI ngay') }}</span>
                </button>
              </div>
              <p class="text-xs text-gray-500 mt-2">
                {{ job.status === 'ai_scanning'
                  ? 'Hệ thống AI đang quét nội dung tin tuyển dụng... Kết quả sẽ tự động cập nhật khi hoàn tất.'
                  : (job.status === 'draft'
                    ? 'Tin tuyển dụng đang ở trạng thái Bản nháp. Nhấn "Đăng tin & Kiểm duyệt AI" để gửi tin cho AI kiểm tra tính hợp lệ và tự động xuất bản ra công chúng.'
                    : 'Tin tuyển dụng chưa có kết quả kiểm duyệt từ AI. Nhấn nút bên trên để kiểm duyệt ngay.') }}
              </p>
            </div>

            <!-- -------------------------------------------------------------
                 KHU VỰC F: CỘT TRÁI - JOB DESCRIPTION & BENEFITS
                 ------------------------------------------------------------- -->
            <div class="space-y-5">
              <!-- Tiêu đề Mô tả công việc -->
              <div v-if="job.description">
                <div class="flex items-center gap-2 mb-2">
                  <FileText class="h-4 w-4 text-gray-700" />
                  <h2 class="text-sm font-bold text-gray-900">Mô tả công việc</h2>
                </div>
                <div class="text-xs leading-[1.7] text-gray-600 whitespace-pre-line text-justify md:text-left">
                  <template v-if="!isDescExpanded && isDescLong">
                    <span>{{ getTruncatedText(job.description) }}... </span>
                    <button
                      type="button"
                      @click="isDescExpanded = true"
                      class="font-semibold text-gray-900 hover:underline cursor-pointer inline select-none"
                    >
                      Xem thêm
                    </button>
                  </template>
                  <template v-else>
                    <span>{{ job.description }} </span>
                    <button
                      v-if="isDescLong"
                      type="button"
                      @click="isDescExpanded = false"
                      class="font-semibold text-gray-900 hover:underline cursor-pointer inline select-none ml-1"
                    >
                      Thu gọn
                    </button>
                  </template>
                </div>
              </div>

              <!-- Yêu cầu công việc -->
              <div v-if="job.requirements" class="pt-2">
                <div class="flex items-center gap-2 mb-2">
                  <CheckSquare class="h-4 w-4 text-gray-700" />
                  <h2 class="text-sm font-bold text-gray-900">Yêu cầu công việc</h2>
                </div>
                <div class="text-xs leading-[1.7] text-gray-600 whitespace-pre-line">
                  <template v-if="!isReqExpanded && isReqLong">
                    <span>{{ getTruncatedText(job.requirements) }}... </span>
                    <button
                      type="button"
                      @click="isReqExpanded = true"
                      class="font-semibold text-gray-900 hover:underline cursor-pointer inline select-none"
                    >
                      Xem thêm
                    </button>
                  </template>
                  <template v-else>
                    <span>{{ job.requirements }} </span>
                    <button
                      v-if="isReqLong"
                      type="button"
                      @click="isReqExpanded = false"
                      class="font-semibold text-gray-900 hover:underline cursor-pointer inline select-none ml-1"
                    >
                      Thu gọn
                    </button>
                  </template>
                </div>
              </div>

              <!-- Lợi ích -->
              <div v-if="job.benefits" class="pt-2">
                <div class="flex items-center gap-2 mb-2">
                  <Star class="h-4 w-4 text-gray-700" />
                  <h2 class="text-sm font-bold text-gray-900">Quyền lợi & Phúc lợi</h2>
                </div>
                <div class="text-xs leading-[1.7] text-gray-600 whitespace-pre-line">
                  <template v-if="!isBenExpanded && isBenLong">
                    <span>{{ getTruncatedText(job.benefits) }}... </span>
                    <button
                      type="button"
                      @click="isBenExpanded = true"
                      class="font-semibold text-gray-900 hover:underline cursor-pointer inline select-none"
                    >
                      Xem thêm
                    </button>
                  </template>
                  <template v-else>
                    <span>{{ job.benefits }} </span>
                    <button
                      v-if="isBenLong"
                      type="button"
                      @click="isBenExpanded = false"
                      class="font-semibold text-gray-900 hover:underline cursor-pointer inline select-none ml-1"
                    >
                      Thu gọn
                    </button>
                  </template>
                </div>
              </div>

              <!-- Kỹ năng yêu cầu -->
              <div v-if="job.requiredSkills?.length" class="pt-2">
                <h3 class="text-xs font-bold text-gray-900 mb-2">Kỹ năng chuyên môn</h3>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="skill in job.requiredSkills"
                    :key="skill"
                    class="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200"
                  >
                    {{ skill }}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <!-- =================================================================
               CỘT PHẢI (33% chiều rộng): Closing Date, Job Detail, Hiring Manager
               ================================================================= -->
          <aside
            class="w-full lg:w-[33%] p-4 sm:p-5 lg:p-6 lg:pl-7 border-t lg:border-t-0 lg:border-l border-gray-200 min-w-0"
            aria-label="Thông tin bổ sung việc làm"
          >
            <!-- -------------------------------------------------------------
                 KHU VỰC G: CỘT PHẢI - JOB VACANCY CLOSING DATE
                 ------------------------------------------------------------- -->
            <div class="mb-5">
              <!-- Tiêu đề + Nút Edit -->
              <div class="flex items-center justify-between mb-2.5">
                <div class="flex items-center gap-1.5">
                  <Calendar class="h-4 w-4 text-gray-700" />
                  <h2 class="text-xs sm:text-[13px] font-bold text-gray-900 leading-none whitespace-nowrap">
                    Ngày kết thúc nhận đơn
                  </h2>
                </div>
                <button
                  type="button"
                  @click="onEdit"
                  class="inline-flex items-center gap-1 text-xs font-semibold text-[#5b4eea] hover:text-[#4a3fd6] transition-colors ml-2 cursor-pointer"
                >
                  <Pencil class="h-3 w-3" />
                  <span>Edit</span>
                </button>
              </div>

              <!-- Danh sách ngày công bố / hạn chót -->
              <div class="space-y-1.5 text-xs">
                <div class="flex items-center">
                  <Calendar class="h-3.5 w-3.5 text-gray-400 shrink-0 mr-2" />
                  <span class="text-gray-500 w-[78px] shrink-0">Ngày đăng</span>
                  <span class="text-gray-900 font-medium">: {{ formatDate(job.publishedAt) || 'Chưa công bố' }}</span>
                </div>
                <div class="flex items-center">
                  <Clock class="h-3.5 w-3.5 text-gray-400 shrink-0 mr-2" />
                  <span class="text-gray-500 w-[78px] shrink-0">Hạn chót</span>
                  <span class="text-gray-900 font-medium">: {{ formatDate(job.deadline) || 'Không giới hạn' }}</span>
                </div>
              </div>

              <!-- Khung Days Remaining + Progress bar -->
              <div v-if="job.deadline" class="mt-3 rounded-xl bg-[#f8f5fd] border border-[#eee4fc] p-3">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-medium text-gray-500">Thời gian còn lại</span>
                  <div class="flex items-center gap-1.5 text-xs font-bold text-gray-900">
                    <Hourglass class="h-3.5 w-3.5 text-gray-700" />
                    <span>{{ daysRemaining }} ngày</span>
                  </div>
                </div>

                <!-- Thanh tiến trình màu tím -->
                <div class="mt-2.5 h-1.5 w-full bg-[#ebdcfc] rounded-full overflow-hidden">
                  <div class="h-full bg-[#5b4eea] rounded-full w-[45%] transition-all"></div>
                </div>
              </div>
            </div>

            <!-- -------------------------------------------------------------
                 KHU VỰC H: CỘT PHẢI - JOB DETAIL
                 ------------------------------------------------------------- -->
            <div class="mb-5">
              <!-- Tiêu đề Job Detail -->
              <div class="flex items-center gap-1.5 mb-2.5">
                <BookOpen class="h-4 w-4 text-gray-700" />
                <h2 class="text-sm font-bold text-gray-900 leading-none">Chi tiết công việc</h2>
              </div>

              <!-- Danh sách 6 thông tin chi tiết -->
              <div class="space-y-2 text-xs">
                <div
                  v-for="item in jobDetailsList"
                  :key="item.label"
                  class="flex items-center"
                >
                  <component :is="item.icon" class="h-3.5 w-3.5 text-gray-400 shrink-0 mr-2" />
                  <span class="text-gray-500 w-[74px] shrink-0">{{ item.label }}</span>
                  <span class="text-gray-900 font-medium whitespace-nowrap">: {{ item.value }}</span>
                </div>
              </div>
            </div>

            <!-- -------------------------------------------------------------
                 KHU VỰC I: CỘT PHẢI - HIRING MANAGER
                 ------------------------------------------------------------- -->
            <div>
              <!-- Dải thông báo nội bộ màu tím nhạt -->
              <div
                class="rounded-lg bg-[#f6effe] border border-[#ebdcfc] px-3 py-1.5 flex items-center gap-1.5 mb-3"
              >
                <Info class="h-3.5 w-3.5 text-[#5b4eea] shrink-0" />
                <p class="text-[11px] text-[#5b4eea] font-normal leading-tight">
                  This hiring manager is for internal use only.
                </p>
              </div>

              <!-- Tiêu đề + Nút + Assign -->
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-1.5">
                  <User class="h-4 w-4 text-gray-700" />
                  <h2 class="text-sm font-bold text-gray-900 leading-none">Hiring Manager</h2>
                </div>
                <button
                  type="button"
                  class="inline-flex items-center gap-0.5 text-xs font-semibold text-[#5b4eea] hover:text-[#4a3fd6] transition-colors cursor-pointer"
                >
                  <span>+ Assign</span>
                </button>
              </div>

              <!-- Danh sách thành viên phụ trách -->
              <div class="space-y-2.5">
                <div
                  v-for="manager in visibleManagers"
                  :key="manager.id"
                  class="flex items-center justify-between py-1 group"
                >
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div
                      class="w-7 h-7 rounded-full text-white flex items-center justify-center font-bold text-xs shrink-0"
                      :class="manager.initialBg || 'bg-[#2563eb]'"
                    >
                      {{ manager.initial || manager.name?.charAt(0)?.toUpperCase() || 'M' }}
                    </div>

                    <!-- Tên & Chức vụ -->
                    <div class="min-w-0">
                      <div class="text-xs font-bold text-gray-900 truncate leading-tight">
                        {{ manager.name }}
                      </div>
                      <div class="text-[10px] text-gray-400 truncate leading-tight mt-0.5">
                        {{ manager.role }}
                      </div>
                    </div>
                  </div>

                  <!-- Nút remove -->
                  <button
                    type="button"
                    class="text-gray-300 hover:text-red-500 transition-colors p-1 cursor-pointer"
                    title="Gỡ người quản lý"
                    @click="removeManager(manager.id)"
                  >
                    <MinusCircle class="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <!-- ===================================================================
           NỘI DUNG TAB 2: ĐƠN ỨNG TUYỂN (APPLICATION)
           =================================================================== -->
      <!-- ===================================================================
           NỘI DUNG TAB 2: ĐƠN ỨNG TUYỂN (APPLICATION)
           =================================================================== -->
      <section v-else-if="activeTab === 'application'" class="p-4 sm:p-6 lg:p-8 bg-[#f8fafc]/50 min-h-[500px]">
        <!-- Top bar: Tiêu đề + Bộ lọc trạng thái + Tìm kiếm -->
        <div class="mb-5 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 class="text-base font-semibold text-gray-900 tracking-tight">
              Danh sách đơn ứng tuyển ({{ appTotal }})
            </h2>
            <p class="text-[12px] text-gray-500 mt-0.5">
              Quản lý các đơn ứng tuyển và duy trì quy trình tuyển dụng cho vị trí <strong class="text-gray-700 font-medium">{{ job.title }}</strong>.
            </p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <!-- Tìm kiếm theo tên / email ứng viên -->
            <div class="relative w-full sm:w-[220px]">
              <input
                v-model="appSearchKeyword"
                type="text"
                placeholder="Tìm tên, email..."
                class="w-full h-9 pl-8 pr-3 text-[12px] rounded-lg border border-[#e3e8ef] bg-white text-gray-800 placeholder-[#a0acbc] outline-none focus:border-[#5b4eea] focus:ring-1 focus:ring-[#5b4eea]/20 transition shadow-2xs"
              />
              <Search class="absolute left-2.5 top-2.5 h-4 w-4 text-[#a0acbc] pointer-events-none" />
            </div>

            <!-- Dropdown lọc theo trạng thái đơn -->
            <div ref="appStatusSelectRoot" class="relative w-full sm:w-[170px]">
              <button
                type="button"
                class="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-[#e3e8ef] bg-white px-3 text-[12px] text-gray-700 transition hover:border-[#c7d2e0] shadow-2xs cursor-pointer"
                aria-label="Lọc theo trạng thái"
                @click="appStatusSelectOpen = !appStatusSelectOpen"
              >
                <span class="truncate text-left">{{ appStatusFilterLabel }}</span>
                <ChevronDown
                  class="h-3.5 w-3.5 shrink-0 text-[#a0acbc] transition"
                  :class="appStatusSelectOpen ? 'rotate-180' : ''"
                />
              </button>
              <div
                v-if="appStatusSelectOpen"
                class="absolute right-0 z-20 mt-1 max-h-60 w-full overflow-y-auto scrollbar-thin rounded-lg border border-[#e3e8ef] bg-white py-1 shadow-lg"
              >
                <button
                  v-for="opt in STATUS_FILTER_OPTIONS"
                  :key="opt.label"
                  type="button"
                  class="block w-full px-3 py-2 text-left text-[12px] transition hover:bg-[#eef5ff] cursor-pointer"
                  :class="appSelectedStatus === opt.value ? 'font-semibold text-[#5b4eea] bg-[#5b4eea]/5' : 'text-gray-700'"
                  @click="pickAppStatus(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- Nút Tải lại -->
            <button
              type="button"
              class="grid h-9 w-9 place-items-center rounded-lg border border-[#e3e8ef] bg-white hover:bg-gray-50 text-gray-500 transition shadow-2xs cursor-pointer"
              title="Tải lại danh sách"
              @click="fetchJobApplications(1)"
            >
              <RotateCcw class="h-3.5 w-3.5" :class="appLoading ? 'animate-spin' : ''" />
            </button>
          </div>
        </div>

        <!-- Khung danh sách (Bỏ cột Việc làm vì chỉ load đơn của job này) -->
        <section class="overflow-hidden rounded-xl border border-[#e7ebf1] bg-white shadow-2xs">
          <div class="px-4 py-3 flex items-center justify-between border-b border-[#eef1f5] bg-white">
            <h3 class="text-[14px] font-semibold text-gray-800">
              Tất cả các đơn ứng tuyển
            </h3>
            <span class="text-[12px] text-gray-400 font-medium">Tổng số: {{ appTotal }}</span>
          </div>

          <!-- Column headers (BỎ CỘT VIỆC LÀM) -->
          <div
            class="grid grid-cols-[1.5fr_0.8fr_0.8fr] sm:grid-cols-[2fr_1fr_1fr_0.8fr] items-center border-b border-[#eef1f5] bg-gray-50/50 px-4 py-3 text-[12px] font-medium text-[#7c889a] select-none"
          >
            <div>Ứng viên</div>
            <div>Giai đoạn</div>
            <div>
              <button
                type="button"
                class="inline-flex items-center gap-1 transition hover:text-[#334155] cursor-pointer"
                title="Sắp xếp theo điểm phù hợp"
                @click="toggleAppMatchSort"
              >
                <span>Phù hợp</span>
                <ArrowUpDown v-if="appMatchSort === 'none'" class="h-3 w-3" />
                <ArrowDown v-else-if="appMatchSort === 'desc'" class="h-3 w-3 text-[#5b4eea]" />
                <ArrowUp v-else class="h-3 w-3 text-[#5b4eea]" />
              </button>
            </div>
            <div class="hidden sm:block">Thời gian</div>
          </div>

          <!-- Loading State -->
          <div v-if="appLoading" class="p-12 text-center">
            <Loader2 class="h-6 w-6 animate-spin text-[#5b4eea] mx-auto mb-2" />
            <p class="text-xs text-gray-500">Đang tải danh sách hồ sơ ứng tuyển...</p>
          </div>

          <!-- Empty State -->
          <div v-else-if="displayedApplications.length === 0" class="p-12 text-center">
            <div class="w-12 h-12 rounded-full bg-indigo-50 text-[#5b4eea] flex items-center justify-center mx-auto mb-3">
              <Users class="h-6 w-6 opacity-70" />
            </div>
            <p class="text-sm font-semibold text-gray-700">Chưa có đơn ứng tuyển nào</p>
            <p class="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
              {{ appSelectedStatus ? 'Không có đơn ứng tuyển nào khớp với bộ lọc trạng thái.' : 'Các hồ sơ nộp vào vị trí này sẽ xuất hiện tại đây.' }}
            </p>
          </div>

          <!-- Rows (BỎ CỘT VIỆC LÀM) -->
          <div v-else class="divide-y divide-[#eef1f5]">
            <div
              v-for="(a, i) in displayedApplications"
              :key="`${a.email}-${i}`"
              class="grid grid-cols-[1.5fr_0.8fr_0.8fr] sm:grid-cols-[2fr_1fr_1fr_0.8fr] items-center px-4 py-2.5 text-[13px] cursor-pointer transition hover:bg-gray-50/80 group"
              @click="openAppDetail(a)"
            >
              <!-- Ứng viên (Avatar + Tên + Email) -->
              <div class="flex min-w-0 items-center gap-2">
                <div
                  class="relative h-8 w-8 shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-indigo-50 to-indigo-100 ring-1 ring-black/5"
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
                    class="absolute inset-0 grid place-items-center text-[#5b4eea] font-bold text-[12px]"
                  >
                    {{ avatarInitial(a.name) }}
                  </span>
                </div>
                <div class="min-w-0">
                  <div class="truncate font-semibold text-gray-900 group-hover:text-[#5b4eea] transition-colors" :title="a.name">
                    {{ truncate(a.name, 18) }}
                  </div>
                  <div class="hidden sm:block truncate text-[11px] text-[#94a3b8]" :title="a.email">
                    {{ truncate(a.email, 22) }}
                  </div>
                </div>
              </div>

              <!-- Giai đoạn (Status badge) -->
              <div>
                <span
                  class="inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium"
                  :class="[STATUS_CHIP[a.status]?.bg || 'bg-[#eef0f2]', STATUS_CHIP[a.status]?.text || 'text-[#64748b]']"
                >
                  {{ STATUS_LABEL[a.status] || a.status }}
                </span>
              </div>

              <!-- Phù hợp (Match %) -->
              <div>
                <div v-if="a.match === null">
                  <span class="text-[11px] text-[#94a3b8] italic">Chưa có điểm</span>
                </div>
                <div v-else>
                  <div
                    class="font-semibold tabular-nums text-[12px]"
                    :class="MATCH_LEVEL_STYLE[matchLevelOf(a.match)].text"
                  >
                    {{ a.match }}%
                  </div>
                  <div class="mt-1 h-1.5 w-[60px] sm:w-[85px] rounded-full bg-[#e8eef8] overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-500 ease-out"
                      :class="MATCH_LEVEL_STYLE[matchLevelOf(a.match)].bar"
                      :style="{ width: `${a.match}%` }"
                    ></div>
                  </div>
                </div>
              </div>

              <!-- Thời gian (Applied time) -->
              <div class="hidden sm:block text-[12px] text-[#475569]" :title="formatAppDate(a.date)">
                {{ formatAppTime(a.date) }}
              </div>
            </div>
          </div>

          <!-- Pagination footer -->
          <div
            v-if="displayedApplications.length > 0"
            class="flex items-center justify-between border-t border-[#eef1f5] px-4 py-3 text-[12px] text-[#7c889a]"
          >
            <span>
              Showing
              <strong class="text-[#334155]">{{ appTotal === 0 ? 0 : (appPage - 1) * appLimit + 1 }}</strong>
              to
              <strong class="text-[#334155]">{{ Math.min(appTotal, (appPage - 1) * appLimit + applicationList.length) }}</strong>
              of <strong class="text-[#334155]">{{ appTotal }}</strong> applications
            </span>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-lg border border-[#e3e8ef] text-[#7c889a] hover:bg-[#f8fafc] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                :disabled="appPage <= 1"
                aria-label="Trang trước"
                @click="goToAppPage(appPage - 1)"
              >
                <ChevronLeft class="h-3.5 w-3.5" />
              </button>

              <template v-for="(p, idx) in appPaginationPages" :key="`${p}-${idx}`">
                <span
                  v-if="p === '…'"
                  class="h-8 min-w-8 px-2 inline-flex items-center justify-center text-[#7c889a]"
                >…</span>
                <button
                  v-else
                  type="button"
                  class="h-8 min-w-8 px-2.5 inline-flex items-center justify-center rounded-lg text-[12px] font-medium transition cursor-pointer"
                  :class="p === appPage
                    ? 'bg-[#1769e8] text-white'
                    : 'border border-[#e3e8ef] text-[#334155] hover:bg-[#f8fafc]'"
                  @click="goToAppPage(p)"
                >{{ p }}</button>
              </template>

              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-lg border border-[#e3e8ef] text-[#7c889a] hover:bg-[#f8fafc] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                :disabled="appPage >= appTotalPages"
                aria-label="Trang sau"
                @click="goToAppPage(appPage + 1)"
              >
                <ChevronRight class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </section>

        <!-- Quick Detail Modal khi click vào row -->
        <div
          v-if="showAppDetailModal"
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          @click.self="closeAppDetailModal"
        >
          <div class="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <!-- Modal Header -->
            <div class="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div class="flex items-center gap-3 min-w-0">
                <div class="relative h-11 w-11 shrink-0 rounded-xl overflow-hidden bg-gradient-to-br from-indigo-50 to-indigo-100 ring-1 ring-black/5">
                  <img
                    v-if="selectedAppItem?.avatarUrl"
                    :src="selectedAppItem.avatarUrl"
                    :alt="selectedAppItem.name"
                    class="h-full w-full object-cover"
                  />
                  <span v-else class="grid h-full w-full place-items-center font-bold text-[#5b4eea] text-sm">
                    {{ avatarInitial(selectedAppItem?.name || '') }}
                  </span>
                </div>
                <div class="min-w-0">
                  <h3 class="font-bold text-gray-900 text-sm sm:text-base truncate">
                    {{ selectedAppItem?.name }}
                  </h3>
                  <p class="text-xs text-gray-400 truncate">{{ selectedAppItem?.email }}</p>
                </div>
              </div>
              <button
                type="button"
                class="h-8 w-8 rounded-lg hover:bg-gray-200/60 text-gray-400 hover:text-gray-700 grid place-items-center transition cursor-pointer"
                @click="closeAppDetailModal"
              >
                <X class="h-4 w-4" />
              </button>
            </div>

            <!-- Modal Body -->
            <div class="p-5 overflow-y-auto space-y-4 scrollbar-thin">
              <div v-if="appDetailLoading" class="py-8 text-center">
                <Loader2 class="h-6 w-6 animate-spin text-[#5b4eea] mx-auto mb-2" />
                <p class="text-xs text-gray-400">Đang tải hồ sơ ứng viên...</p>
              </div>
              <template v-else>
                <!-- Trạng thái & Chuyển trạng thái -->
                <div class="p-3.5 rounded-xl border border-gray-100 bg-gray-50/50 flex items-center justify-between gap-3 flex-wrap">
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-500 font-medium">Trạng thái:</span>
                    <span
                      class="inline-flex rounded-md px-2.5 py-1 text-xs font-semibold"
                      :class="[STATUS_CHIP[selectedAppItem?.status || 'pending']?.bg, STATUS_CHIP[selectedAppItem?.status || 'pending']?.text]"
                    >
                      {{ STATUS_LABEL[selectedAppItem?.status || 'pending'] }}
                    </span>
                  </div>

                  <!-- Quick Action Buttons -->
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <button
                      v-if="selectedAppItem?.status !== 'screening' && selectedAppItem?.status !== 'hired' && selectedAppItem?.status !== 'rejected'"
                      type="button"
                      :disabled="updatingAppStatus"
                      class="px-2.5 py-1 rounded-md text-xs font-medium bg-[#5b4eea] text-white hover:bg-[#4e42d6] transition cursor-pointer disabled:opacity-50"
                      @click="changeAppStatus(selectedAppItem!.applicationId, 'screening')"
                    >
                      Sàng lọc
                    </button>
                    <button
                      v-if="selectedAppItem?.status === 'screening'"
                      type="button"
                      :disabled="updatingAppStatus"
                      class="px-2.5 py-1 rounded-md text-xs font-medium bg-[#1769e8] text-white hover:bg-blue-700 transition cursor-pointer disabled:opacity-50"
                      @click="changeAppStatus(selectedAppItem!.applicationId, 'interview')"
                    >
                      Mời phỏng vấn
                    </button>
                    <button
                      v-if="selectedAppItem?.status !== 'rejected' && selectedAppItem?.status !== 'hired'"
                      type="button"
                      :disabled="updatingAppStatus"
                      class="px-2 py-1 rounded-md text-xs font-medium border border-rose-200 text-rose-600 hover:bg-rose-50 transition cursor-pointer disabled:opacity-50"
                      @click="changeAppStatus(selectedAppItem!.applicationId, 'rejected')"
                    >
                      Từ chối
                    </button>
                  </div>
                </div>

                <!-- Điểm phù hợp AI -->
                <div class="p-3.5 rounded-xl border border-gray-100 bg-white">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                      <Sparkles class="h-3.5 w-3.5 text-[#5b4eea]" />
                      Độ phù hợp AI (Match Score)
                    </span>
                    <span
                      v-if="selectedAppItem?.match !== null"
                      class="text-xs font-bold"
                      :class="MATCH_LEVEL_STYLE[matchLevelOf(selectedAppItem?.match || 0)].text"
                    >
                      {{ selectedAppItem?.match }}% — {{ MATCH_LEVEL_STYLE[matchLevelOf(selectedAppItem?.match || 0)].label }}
                    </span>
                    <span v-else class="text-xs text-gray-400 italic">Chưa có điểm</span>
                  </div>

                  <!-- Reasoning rationale nếu có -->
                  <p v-if="selectedAppDetail?.aiMatchReasoning?.rationale" class="text-xs text-gray-600 bg-gray-50 rounded-lg p-2.5 leading-relaxed">
                    {{ selectedAppDetail.aiMatchReasoning.rationale }}
                  </p>

                  <!-- Skills match -->
                  <div v-if="selectedAppDetail?.aiMatchReasoning?.matchedSkills?.length" class="mt-2.5">
                    <span class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Kỹ năng khớp:</span>
                    <div class="flex flex-wrap gap-1">
                      <span
                        v-for="sk in selectedAppDetail.aiMatchReasoning.matchedSkills"
                        :key="sk"
                        class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-medium"
                      >
                        ✓ {{ sk }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Thư ứng tuyển (Cover Letter) -->
                <div v-if="selectedAppDetail?.coverLetter" class="p-3.5 rounded-xl border border-gray-100 bg-white">
                  <span class="text-xs font-semibold text-gray-700 block mb-1.5">Thư ứng tuyển:</span>
                  <p class="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed bg-gray-50 p-2.5 rounded-lg">
                    {{ selectedAppDetail.coverLetter }}
                  </p>
                </div>

                <!-- File CV đính kèm -->
                <div v-if="selectedAppDetail?.cv" class="p-3.5 rounded-xl border border-gray-100 bg-white flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <FileText class="h-5 w-5 text-[#5b4eea] shrink-0" />
                    <div class="min-w-0">
                      <p class="text-xs font-semibold text-gray-800 truncate">
                        {{ selectedAppDetail.cv.title || 'Hồ sơ ứng viên (CV)' }}
                      </p>
                      <p class="text-[11px] text-gray-400">Đính kèm trong đơn ứng tuyển</p>
                    </div>
                  </div>
                  <a
                    v-if="selectedAppDetail.cv.url"
                    :href="selectedAppDetail.cv.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="h-7 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-medium text-gray-700 inline-flex items-center gap-1 transition shrink-0 cursor-pointer"
                  >
                    <ExternalLink class="h-3 w-3" />
                    <span>Xem file</span>
                  </a>
                </div>
              </template>
            </div>

            <!-- Modal Footer -->
            <div class="p-4 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <button
                type="button"
                class="text-xs font-medium text-[#1769e8] hover:underline flex items-center gap-1 cursor-pointer"
                @click="router.push('/employer/applications')"
              >
                <span>Mở trong Quản lý ứng tuyển</span>
                <ExternalLink class="h-3 w-3" />
              </button>
              <button
                type="button"
                class="px-4 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-medium text-gray-700 transition cursor-pointer shadow-2xs"
                @click="closeAppDetailModal"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- ===================================================================
           NỘI DUNG TAB 3: BÀI KIỂM TRA (TEST)
           =================================================================== -->
      <section v-else-if="activeTab === 'test'" class="p-4 sm:p-6 lg:p-8 bg-[#f8fafc]/50 min-h-[500px]">
        <!-- Top bar: Tiêu đề + Thống kê + Nút hành động (Sinh đề IQ / Tiếng Anh) -->
        <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-base font-bold text-gray-900">Bài kiểm tra năng lực</h2>
              <span
                v-if="testList.length"
                class="px-2 py-0.5 text-xs font-semibold rounded-full bg-[#5b4eea]/10 text-[#5b4eea]"
              >
                {{ testList.length }} bài test
              </span>
            </div>
            <p class="text-xs text-gray-500 mt-1">
              Bộ đề trắc nghiệm AI dành cho ứng viên ứng tuyển vào vị trí này.
              <span v-if="job?.requiredSkills?.length" class="text-gray-400">
                · Kỹ năng trọng tâm: {{ job.requiredSkills.slice(0, 4).join(', ') }}
              </span>
            </p>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <!-- Nút làm mới -->
            <button
              type="button"
              :disabled="testLoading"
              class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition shadow-2xs disabled:opacity-50 cursor-pointer"
              title="Tải lại danh sách bài kiểm tra"
              @click="fetchJobTests"
            >
              <RotateCcw class="h-3.5 w-3.5" :class="testLoading ? 'animate-spin' : ''" />
              <span>Làm mới</span>
            </button>

            <!-- Nút Tạo đề IQ -->
            <button
              type="button"
              :disabled="generatingTestType !== null || testLoading"
              class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 text-xs font-semibold hover:bg-purple-100 transition shadow-2xs disabled:opacity-50 cursor-pointer"
              @click="handleGenerateTest('iq')"
            >
              <Loader2 v-if="generatingTestType === 'iq'" class="h-3.5 w-3.5 animate-spin" />
              <Cpu v-else class="h-3.5 w-3.5" />
              <span>{{ generatingTestType === 'iq' ? 'Đang tạo IQ…' : 'Tạo đề IQ (AI)' }}</span>
            </button>

            <!-- Nút Tạo đề Tiếng Anh -->
            <button
              type="button"
              :disabled="generatingTestType !== null || testLoading"
              class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 transition shadow-2xs disabled:opacity-50 cursor-pointer"
              @click="handleGenerateTest('english')"
            >
              <Loader2 v-if="generatingTestType === 'english'" class="h-3.5 w-3.5 animate-spin" />
              <Globe v-else class="h-3.5 w-3.5" />
              <span>{{ generatingTestType === 'english' ? 'Đang tạo English…' : 'Tạo đề Tiếng Anh (AI)' }}</span>
            </button>
          </div>
        </div>

        <!-- Tip hướng dẫn -->
        <div class="mb-6 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 via-white to-purple-50/80 p-4 flex items-start gap-3">
          <Sparkles class="h-5 w-5 text-[#5b4eea] shrink-0 mt-0.5" />
          <div class="text-xs text-gray-600 leading-relaxed min-w-0">
            <span class="font-semibold text-gray-900">Quy trình kiểm tra sàng lọc:</span>
            Sau khi đề được tạo và chuyển sang trạng thái <strong class="text-emerald-700">Sẵn sàng</strong>, bạn có thể xem lại chi tiết nội dung kèm đáp án. Tại tab <strong class="text-[#5b4eea]">Đơn ứng tuyển</strong>, bạn có thể gửi link làm bài trực tiếp cho từng ứng viên ở giai đoạn Sàng lọc (Screening).
          </div>
        </div>

        <!-- Loading State -->
        <div v-if="testLoading && !testList.length" class="py-16 text-center">
          <Loader2 class="h-8 w-8 animate-spin text-[#5b4eea] mx-auto mb-3" />
          <p class="text-sm font-medium text-gray-600">Đang tải danh sách bài kiểm tra...</p>
        </div>

        <!-- Error State -->
        <div v-else-if="testError" class="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
          <AlertCircle class="h-8 w-8 text-rose-500 mx-auto mb-2" />
          <p class="text-sm font-semibold text-rose-900 mb-1">Không thể tải bài kiểm tra</p>
          <p class="text-xs text-rose-600 mb-4">{{ testError }}</p>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 transition cursor-pointer"
            @click="fetchJobTests"
          >
            <RotateCcw class="h-3.5 w-3.5" /> Thử lại
          </button>
        </div>

        <!-- Empty State -->
        <div
          v-else-if="testList.length === 0"
          class="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-10 text-center"
        >
          <div class="w-14 h-14 rounded-2xl bg-[#5b4eea]/10 text-[#5b4eea] flex items-center justify-center mx-auto mb-4">
            <CheckSquare class="h-7 w-7" />
          </div>
          <h3 class="text-base font-bold text-gray-900 mb-1.5">Chưa có bài kiểm tra nào cho tin tuyển dụng này</h3>
          <p class="text-xs text-gray-500 max-w-md mx-auto mb-6 leading-relaxed">
            Hệ thống AI có thể tự động tạo bộ câu hỏi trắc nghiệm logic (IQ) hoặc Tiếng Anh phù hợp với mô tả công việc, giúp bạn đánh giá ứng viên khách quan và tiết kiệm thời gian.
          </p>

          <div class="flex items-center justify-center gap-3 flex-wrap">
            <button
              type="button"
              :disabled="generatingTestType !== null || testLoading"
              class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#5b4eea] text-white text-xs font-semibold hover:bg-[#4a3fd6] transition shadow-xs disabled:opacity-50 cursor-pointer"
              @click="handleGenerateTest('iq')"
            >
              <Loader2 v-if="generatingTestType === 'iq'" class="h-4 w-4 animate-spin" />
              <Cpu v-else class="h-4 w-4" />
              <span>Tạo đề IQ (AI)</span>
            </button>

            <button
              type="button"
              :disabled="generatingTestType !== null || testLoading"
              class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50 transition shadow-2xs disabled:opacity-50 cursor-pointer"
              @click="handleGenerateTest('english')"
            >
              <Loader2 v-if="generatingTestType === 'english'" class="h-4 w-4 animate-spin" />
              <Globe v-else class="h-4 w-4" />
              <span>Tạo đề Tiếng Anh (AI)</span>
            </button>
          </div>
        </div>

        <!-- List State: Grid Cards -->
        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            v-for="t in testList"
            :key="t.id"
            class="rounded-xl border border-gray-200 bg-white p-5 shadow-2xs hover:border-[#5b4eea]/40 transition flex flex-col justify-between"
          >
            <div>
              <!-- Card Header -->
              <div class="flex items-start justify-between gap-3 mb-3">
                <div class="flex items-center gap-3">
                  <div
                    class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    :class="t.testType === 'iq' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'"
                  >
                    <Cpu v-if="t.testType === 'iq'" class="h-5 w-5" />
                    <Globe v-else class="h-5 w-5" />
                  </div>
                  <div>
                    <h3 class="text-sm font-bold text-gray-900 leading-snug">
                      {{ t.testType === 'iq' ? 'Bài test IQ & Tư duy logic' : 'Bài test Tiếng Anh tổng quát' }}
                    </h3>
                    <div class="flex items-center gap-2 mt-0.5">
                      <span v-if="t.level" class="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                        Cấp độ: {{ t.level }}
                      </span>
                      <span class="text-[11px] text-gray-400">·</span>
                      <span class="text-[11px] text-gray-400">
                        {{ formatDate(t.createdAt) }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Status Badge -->
                <div>
                  <span
                    v-if="t.status === 'ready'"
                    class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
                  >
                    <CheckCircle2 class="h-3 w-3" /> Sẵn sàng
                  </span>
                  <span
                    v-else-if="t.status === 'generating'"
                    class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    <Loader2 class="h-3 w-3 animate-spin" /> Đang tạo đề…
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200"
                  >
                    <AlertCircle class="h-3 w-3" /> Thất bại
                  </span>
                </div>
              </div>

              <!-- Metadata Grid -->
              <div class="grid grid-cols-3 gap-2 py-3 px-3.5 my-3 rounded-lg bg-gray-50/80 border border-gray-100 text-center">
                <div>
                  <div class="text-[11px] text-gray-400">Số câu hỏi</div>
                  <div class="text-xs font-bold text-gray-800 mt-0.5">
                    {{ t.questionCount }} câu
                  </div>
                </div>
                <div class="border-x border-gray-200/60">
                  <div class="text-[11px] text-gray-400">Thời gian</div>
                  <div class="text-xs font-bold text-gray-800 mt-0.5">
                    {{ t.durationMin ? `${t.durationMin} phút` : '—' }}
                  </div>
                </div>
                <div>
                  <div class="text-[11px] text-gray-400">Tổng điểm</div>
                  <div class="text-xs font-bold text-gray-800 mt-0.5">
                    {{ t.totalPoints ?? 100 }} đ
                  </div>
                </div>
              </div>
            </div>

            <!-- Card Actions -->
            <div class="pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
              <span class="text-[11px] text-gray-400">
                Mã đề: <code class="text-gray-600 font-mono">{{ t.id.slice(0, 8) }}</code>
              </span>

              <div class="flex items-center gap-2">
                <!-- Nút xem đề thi & đáp án (khi ready) -->
                <button
                  v-if="t.status === 'ready'"
                  type="button"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-[#5b4eea] text-gray-700 hover:text-white text-xs font-semibold transition cursor-pointer"
                  @click="openReviewTest(t.id)"
                >
                  <Eye class="h-3.5 w-3.5" />
                  <span>Xem đề thi & đáp án</span>
                </button>

                <!-- Nút Tạo lại cho từng đề thi (khi ready hoặc failed) -->
                <button
                  v-if="t.status === 'ready' || t.status === 'failed'"
                  type="button"
                  :disabled="regeneratingTestId === t.id || generatingTestType !== null"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition shadow-2xs cursor-pointer disabled:opacity-50"
                  :class="t.status === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' : ''"
                  :title="t.status === 'failed' ? 'Thử tạo lại đề thi này' : 'Dùng AI để sinh lại bộ câu hỏi mới'"
                  @click="requestRegenerateTest(t)"
                >
                  <Loader2 v-if="regeneratingTestId === t.id" class="h-3.5 w-3.5 animate-spin" />
                  <RotateCcw v-else class="h-3.5 w-3.5" />
                  <span>{{ t.status === 'failed' ? 'Thử tạo lại' : 'Tạo lại' }}</span>
                </button>

                <span v-else-if="t.status === 'generating'" class="text-xs text-blue-600 italic inline-flex items-center gap-1">
                  <Loader2 class="h-3 w-3 animate-spin" /> AI đang soạn thảo...
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ===================================================================
           NỘI DUNG TAB 4: ĐÁNH GIÁ (FEEDBACK)
           =================================================================== -->
      <section v-else-if="activeTab === 'feedback'" class="p-6 sm:p-8">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-base font-bold text-gray-900">Đánh giá từ ứng viên</h2>
            <p class="text-xs text-gray-500 mt-0.5">
              Điểm trung bình: <strong class="text-[#5b4eea]">{{ job.feedbackStats?.average || 0 }}/5 ★</strong>
              ({{ job.feedbackStats?.count || 0 }} lượt đánh giá)
            </p>
          </div>
        </div>

        <div v-if="job.feedbacks && job.feedbacks.length > 0" class="space-y-3">
          <div
            v-for="fb in job.feedbacks"
            :key="fb.id"
            class="rounded-xl border border-gray-200 p-4 bg-white shadow-2xs"
          >
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-[#5b4eea]/10 text-[#5b4eea] flex items-center justify-center font-bold text-xs">
                  {{ fb.candidateName ? fb.candidateName.charAt(0).toUpperCase() : 'U' }}
                </div>
                <div>
                  <div class="text-xs font-bold text-gray-900">{{ fb.candidateName || 'Ứng viên ẩn danh' }}</div>
                  <div class="text-[10px] text-gray-400">Ứng viên</div>
                </div>
              </div>
              <!-- Star rating -->
              <div class="flex items-center text-amber-400 gap-0.5">
                <span v-for="s in 5" :key="s" class="text-xs">
                  {{ s <= fb.rating ? '★' : '☆' }}
                </span>
              </div>
            </div>
            <p class="text-xs text-gray-600 bg-gray-50 rounded-lg p-2.5">
              "{{ fb.comment }}"
            </p>
          </div>
        </div>

        <div v-else class="rounded-xl border border-dashed border-gray-300 p-8 text-center bg-gray-50/50">
          <Star class="h-10 w-10 text-amber-400 mx-auto mb-3 opacity-80" />
          <p class="text-sm font-semibold text-gray-700">Chưa có đánh giá nào từ ứng viên</p>
          <p class="text-xs text-gray-400 mt-1">Đánh giá và phản hồi của ứng viên sau phỏng vấn sẽ xuất hiện tại đây</p>
        </div>
      </section>
    </div>

    <!-- ===================================================================
         KHU VỰC J: FLOATING CHAT BUTTON (NÚT CHAT NỔI MÀU TÍM)
         =================================================================== -->
    <button
      type="button"
      class="absolute bottom-5 right-5 z-20 w-11 h-11 rounded-full bg-[#5b4eea] hover:bg-[#4b3fd0] text-white shadow-[0_6px_20px_rgba(91,78,234,0.38)] flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer"
      title="Hỗ trợ trực tuyến"
      aria-label="Mở cửa sổ chat hỗ trợ"
    >
      <svg class="h-5 w-5 fill-current" viewBox="0 0 24 24">
        <path
          d="M12 2C6.477 2 2 6.03 2 11c0 2.214.887 4.244 2.375 5.812L3.06 20.94a.75.75 0 00.97.94l4.242-1.767c1.173.57 2.478.887 3.728.887 5.523 0 10-4.03 10-9s-4.477-9-10-9zm-4 10a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm4 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm4 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z"
        />
      </svg>
    </button>

    <!-- ============ Delete confirm modal ============ -->
    <ConfirmModal
      :open="deleteOpen"
      title="Đóng job này?"
      :message="`Job '${job?.title ?? ''}' sẽ chuyển sang trạng thái 'Đã đóng' và không còn hiển thị với ứng viên. Bạn có chắc muốn tiếp tục?`"
      confirm-text="Đóng job"
      variant="danger"
      @cancel="cancelDelete"
      @confirm="confirmDelete"
    />

    <!-- ============ Reopen confirm modal ============ -->
    <ConfirmModal
      :open="reopenOpen"
      title="Mở lại job này?"
      :message="`Job '${job?.title ?? ''}' sẽ chuyển về trạng thái 'Bản nháp'. Bạn có thể cập nhật thông tin và gửi AI kiểm duyệt để đăng lại. Bạn có chắc muốn tiếp tục?`"
      confirm-text="Mở lại job"
      variant="default"
      @cancel="cancelReopen"
      @confirm="confirmReopen"
    />

    <!-- ============ Edit job modal ============ -->
    <EditJobModal
      v-if="job?.id"
      v-model:open="editOpen"
      :job-id="job.id"
      @saved="onEditSaved"
    />

    <!-- ============ Upgrade Pricing modal khi hết lượt kiểm duyệt AI ============ -->
    <Teleport to="body">
      <UpgradePricing
        v-if="showUpgradeModal"
        :open="showUpgradeModal"
        title="Nâng cấp gói dịch vụ của bạn"
        features-title="Mở khóa thêm lượt kiểm duyệt AI"
        @update:open="showUpgradeModal = $event"
        @close="showUpgradeModal = false"
        @success="onUpgradeSuccess"
      />
    </Teleport>

    <!-- ============ Regenerate AI Test confirm modal ============ -->
    <ConfirmModal
      :open="confirmRegenerateOpen"
      title="Tạo lại đề kiểm tra?"
      :message="`Bạn có chắc chắn muốn dùng AI để tạo lại bộ câu hỏi mới cho đề ${testToRegenerate?.testType === 'iq' ? 'IQ' : 'Tiếng Anh'}? Bộ câu hỏi hiện tại sẽ được cập nhật mới.`"
      confirm-text="Tạo lại đề"
      variant="default"
      @cancel="confirmRegenerateOpen = false; testToRegenerate = null"
      @confirm="confirmRegenerate"
    />

    <!-- ============ Review AI Test Modal ============ -->
    <AiTestReviewModal
      :open="reviewModalOpen"
      :test="reviewTestDetail"
      :loading="reviewLoading"
      @close="reviewModalOpen = false"
    />
  </div>
</template>

<style scoped>
/* Đảm bảo toàn bộ mockup Job Detail dùng font Poppins đồng bộ */
.font-poppins,
.font-poppins * {
  font-family: 'Poppins', system-ui, -apple-system, sans-serif;
}

/* Giữ font mono chuyên dụng cho model name và scan ID */
.font-poppins .font-mono,
.font-poppins code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
}
</style>
