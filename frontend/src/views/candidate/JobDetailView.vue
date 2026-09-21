<script setup lang="ts">
/**
 * Candidate JobDetailView — refactor theo mockups/job-detail.html (2-cột dashboard).
 *
 * Layout: header + tabs + 12-col grid (col-8 main + col-4 sidebar).
 *   - Left: About / Meta / Applicants details (chart) / Key Responsibilities /
 *     Skills / Feedbacks.
 *   - Right: Your Scope (real aiMatchScore) / Upgrade PRO (mock).
 *
 * Apply/Save/Share/Quick-chat/Feedback → move vào dropdown "More" (trừ Apply
 * vẫn là CTA chính trên header) + section Feedbacks xuống cuối left col.
 *
 * Mockup data (chart series, region, key responsibilities, scope criteria
 * breakdown) — hard-code ở `frontend/src/utils/jobMockup.ts` theo plan đã duyệt.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Crown,
  Eye,
  FileSignature,
  Globe,
  Github,
  GraduationCap,
  ImagePlus,
  Laptop,
  Linkedin,
  Loader2,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Send,
  Share2,
  Sparkles,
  Sprout,
  Star,
  Twitter,
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Users,
  X,
  HelpCircle,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);
dayjs.locale('vi');
import { storeToRefs } from 'pinia';
import { jobApi } from '@services/job.api';
import { companyApi } from '@services/company.api';
import { chatApi } from '@services/chat.api';
import { useToastStore } from '@stores/toast';
import { useSavedJobStore } from '@stores/savedJob';
import { useAuthStore } from '@stores/auth';
import { uploadApi, formatFileSize } from '@services/upload.api';
import { fileIconInfo } from '@utils/fileIcon';
import CompanyMap from '@components/candidate/CompanyMap.vue';
import {
  APPLICANTS_CHART_DATA,
  MOCK_KEY_RESPONSIBILITIES,
} from '@utils/jobMockup';
import type { ApplicantsOverTimePoint } from '@/types/job';
import type { Company } from '@/types/company';
import type { Socket } from 'socket.io-client';
import { getSocket } from '@services/socket';
import ApplyJob from '@components/job/ApplyJob.vue';
import type {
  ApplicationMatchReadyPayload,
  ApplicationMatchSkippedPayload,
} from '@/types/application';
import type { JobApplicationStatus, JobDetail, JobFeedback } from '@/types/job';

const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const savedJobStore = useSavedJobStore();
const auth = useAuthStore();
const { savedIds } = storeToRefs(savedJobStore);

const job = ref<JobDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const applyModalOpen = ref(false);

// ============================================================================
// "More" dropdown — chứa Save / Share / Quick chat / Feedback (scroll)
// ============================================================================
const moreMenuOpen = ref(false);
const moreBtnEl = ref<HTMLElement | null>(null);
/** Click outside dropdown → đóng. */
const onDocClick = (e: MouseEvent): void => {
  if (!moreMenuOpen.value) return;
  const t = e.target as Node | null;
  if (moreBtnEl.value && t && !moreBtnEl.value.contains(t)) {
    moreMenuOpen.value = false;
  }
};
onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));

// ============================================================================
// Quick-chat (mini composer) — popover góc dưới phải
// ============================================================================
const chatOpen = ref(false);
const chatDraft = ref('');
const chatSending = ref(false);

interface MiniAttachment {
  id: string;
  previewUrl: string | null;
  file: File;
  kind: 'image' | 'file';
}
const chatAttachments = ref<MiniAttachment[]>([]);
const uploadingImage = ref(false);
const miniFileInputEl = ref<HTMLInputElement | null>(null);

const toggleChat = (): void => {
  chatOpen.value = !chatOpen.value;
  moreMenuOpen.value = false;
  if (!chatOpen.value) chatDraft.value = '';
};

const onMiniPaste = (e: ClipboardEvent): void => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length === 0) return;
  e.preventDefault();
  for (const file of files) {
    const id = `mini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isImage = file.type.startsWith('image/');
    chatAttachments.value = [
      ...chatAttachments.value,
      {
        id,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        file,
        kind: isImage ? 'image' : 'file',
      },
    ];
  }
};

const removeMiniAttachment = (id: string): void => {
  const target = chatAttachments.value.find((a) => a.id === id);
  if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
  chatAttachments.value = chatAttachments.value.filter((a) => a.id !== id);
};

const onMiniPickFile = (): void => {
  miniFileInputEl.value?.click();
};
const onMiniFileInputChange = (e: Event): void => {
  const target = e.target as HTMLInputElement;
  const files = target.files;
  if (!files || files.length === 0) return;
  for (const file of Array.from(files)) {
    const id = `mini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isImage = file.type.startsWith('image/');
    chatAttachments.value = [
      ...chatAttachments.value,
      {
        id,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        file,
        kind: isImage ? 'image' : 'file',
      },
    ];
  }
  target.value = '';
};

const sendChat = async (): Promise<void> => {
  const j = job.value;
  if (!j) return;
  const content = chatDraft.value.trim();
  const hasContent = content.length > 0;
  const hasAttachments = chatAttachments.value.length > 0;
  if ((!hasContent && !hasAttachments) || chatSending.value || uploadingImage.value) return;
  if (!j.postedBy) {
    toast.push({
      variant: 'error',
      title: 'Không gửi được tin nhắn',
      body: 'Job này chưa có thông tin nhà tuyển dụng.',
    });
    return;
  }

  chatSending.value = true;
  try {
    const convRes = await chatApi.createOrGet({
      peerUserId: j.postedBy,
    });
    const conversationId = convRes.data.data.id;

    let attachments: import('@/types/chat').ChatAttachmentDraft[] | undefined;
    if (hasAttachments) {
      uploadingImage.value = true;
      try {
        const uploaded = await Promise.all(
          chatAttachments.value.map(async (a) => {
            const result = await uploadApi.uploadChatAttachment(a.file);
            return {
              url: result.url,
              key: result.key,
              mime: result.mime,
              sizeBytes: result.size,
              name: result.name,
              kind: result.kind,
            };
          }),
        );
        attachments = uploaded;
      } finally {
        uploadingImage.value = false;
      }
    }

    await chatApi.sendMessage(conversationId, { content, attachments });

    toast.push({
      variant: 'success',
      title: 'Đã gửi tin nhắn',
      body: 'Nhà tuyển dụng sẽ nhận được thông báo.',
    });
    chatDraft.value = '';
    for (const a of chatAttachments.value) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    chatAttachments.value = [];
    chatOpen.value = false;
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { code?: string } } } }).response?.data?.error?.code
        : undefined;
    const body =
      code === 'FORBIDDEN' || code === 'NOT_AUTHENTICATED'
        ? 'Vui lòng đăng nhập lại.'
        : 'Vui lòng thử lại sau ít phút.';
    toast.push({
      variant: 'error',
      title: 'Không gửi được tin nhắn',
      body,
    });
  } finally {
    chatSending.value = false;
  }
};

let socket: Socket | null = null;

// ============================================================================
// Computed — slug, save state, labels, mockup-bound fields
// ============================================================================
const jobSlug = computed<string>(() => String(route.params.slug ?? ''));
const saved = computed(() => (job.value ? savedIds.value.has(job.value.id) : false));

const companyInitial = computed((): string => {
  const name = job.value?.companyName;
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
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

const jobTypeLabel = computed((): string =>
  formatJobType(job.value?.jobType),
);

/** Meta cho JobType — label tiếng Anh + icon + class Tailwind (color + bg)
 *  cho badge. Dùng cho cả Overview header badge lẫn Company tab jobs list
 *  + JobSearchView active filter chip → đồng nhất visual toàn app. */
const JOB_TYPE_META: Record<string, { label: string; icon: typeof Briefcase; class: string }> = {
  'full-time': { label: 'Full-time',  icon: Briefcase,     class: 'text-blue-600 bg-blue-50' },
  'part-time': { label: 'Part-time',  icon: Clock,         class: 'text-indigo-600 bg-indigo-50' },
  contract:    { label: 'Contract',   icon: FileSignature, class: 'text-amber-600 bg-amber-50' },
  internship:  { label: 'Internship', icon: GraduationCap, class: 'text-green-600 bg-green-50' },
  freelance:   { label: 'Freelance',  icon: Laptop,        class: 'text-purple-600 bg-purple-50' },
};

/** Meta cho JobLevel — label + icon + class. Mỗi level có icon riêng để
 *  phân biệt trực quan (Sprout cho intern, Code cho mid, Crown cho lead, v.v.) */
const JOB_LEVEL_META: Record<string, { label: string; icon: typeof Briefcase; class: string }> = {
  intern:  { label: 'Intern',   icon: Sprout,    class: 'text-slate-600 bg-slate-50' },
  fresher: { label: 'Fresher',  icon: Sparkles,  class: 'text-cyan-600 bg-cyan-50' },
  junior:  { label: 'Junior',   icon: BookOpen,  class: 'text-sky-600 bg-sky-50' },
  mid:     { label: 'Mid-level',icon: Code,       class: 'text-teal-600 bg-teal-50' },
  senior:  { label: 'Senior',   icon: Briefcase, class: 'text-orange-600 bg-orange-50' },
  lead:    { label: 'Lead',     icon: Crown,     class: 'text-pink-600 bg-pink-50' },
  manager: { label: 'Manager',  icon: Users,     class: 'text-rose-600 bg-rose-50' },
};

/** Format JobType/Level — nếu có meta thì trả về class+icon+label,
 *  fallback raw string (cho enum cũ chưa map). */
const getJobTypeMeta = (t: string | null | undefined) =>
  t ? JOB_TYPE_META[t] ?? null : null;
const getJobLevelMeta = (l: string | null | undefined) =>
  l ? JOB_LEVEL_META[l] ?? null : null;
const formatJobType = (t: string | null | undefined): string =>
  getJobTypeMeta(t)?.label ?? (t ?? '');
const formatJobLevel = (l: string | null | undefined): string =>
  getJobLevelMeta(l)?.label ?? (l ?? '');

/** Location meta — hiện chỉ có 1 dạng (icon MapPin + gray) vì location
 *  là string dynamic từ API. */
const LOCATION_META = {
  icon: MapPin,
  class: 'text-slate-600 bg-slate-50',
};

const workApproachLabel = computed((): string => {
  const j = job.value;
  if (!j) return '—';
  if (j.remoteOk) return 'Remote OK';
  return j.location?.city ? `Onsite · ${j.location.city}` : 'Onsite';
});

const publishedLabel = computed((): string => {
  if (!job.value?.publishedAt) return '';
  return dayjs(job.value.publishedAt).format('DD/MM/YYYY');
});

const compactNumber = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
};

// ============================================================================
// About — collapse description với "...see more"
// ============================================================================
const descriptionExpanded = ref(false);
const ABOUT_COLLAPSED_CHARS = 280;

/** Lấy 1 đoạn đầu (~280 chars) để hiển thị collapsed. */
const truncatedDescription = computed((): string => {
  const text = job.value?.description ?? '';
  if (descriptionExpanded.value || text.length <= ABOUT_COLLAPSED_CHARS) return text;
  return `${text.slice(0, ABOUT_COLLAPSED_CHARS).trimEnd()}…`;
});

const canExpandDescription = computed(() =>
  Boolean(job.value?.description && job.value.description.length > ABOUT_COLLAPSED_CHARS),
);

// ============================================================================
// Key Responsibilities — collapse list với "...see more" (giống About)
// ============================================================================
const responsibilitiesExpanded = ref(false);
const RESPONSIBILITIES_COLLAPSED_COUNT = 4;

/** Toàn bộ responsibilities đã parse từ job.requirements hoặc mockup fallback. */
const allResponsibilities = computed<string[]>(() => {
  const reqs = job.value?.requirements;
  if (reqs) {
    return reqs.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return MOCK_KEY_RESPONSIBILITIES;
});

/** Subset hiển thị — collapse về 4 item đầu khi chưa expand. */
const visibleResponsibilities = computed<string[]>(() => {
  const all = allResponsibilities.value;
  if (responsibilitiesExpanded.value || all.length <= RESPONSIBILITIES_COLLAPSED_COUNT) return all;
  return all.slice(0, RESPONSIBILITIES_COLLAPSED_COUNT);
});

const canExpandResponsibilities = computed(() =>
  allResponsibilities.value.length > RESPONSIBILITIES_COLLAPSED_COUNT,
);

// ============================================================================
// Handlers
// ============================================================================
const goBack = (): void => {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push('/candidate/viec-lam');
  }
};

const onApply = (): void => {
  if (!job.value) return;
  applyModalOpen.value = true;
};

const onApplied = (_applicationId: string): void => {
  void fetchDetail();
  void fetchMyApplicationStatus();
};

const onSave = async (): Promise<void> => {
  if (!job.value) return;
  const wasSaved = saved.value;
  const ok = await savedJobStore.toggle(job.value.id);
  moreMenuOpen.value = false;
  if (ok) {
    toast.push({
      variant: 'success',
      title: wasSaved ? 'Đã bỏ lưu' : 'Đã lưu job',
      body: job.value.title,
    });
  } else {
    toast.push({
      variant: 'error',
      title: wasSaved ? 'Bỏ lưu thất bại' : 'Lưu job thất bại',
      body: 'Vui lòng thử lại',
    });
  }
};

const onShare = async (): Promise<void> => {
  moreMenuOpen.value = false;
  try {
    const url = window.location.href;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      toast.push({ variant: 'success', title: 'Đã sao chép liên kết' });
    } else {
      toast.push({ variant: 'info', title: url });
    }
  } catch {
    toast.push({ variant: 'error', title: 'Không sao chép được liên kết' });
  }
};

/** Click "Feedback" trong More menu → scroll xuống section Feedbacks. */
const feedbackSectionEl = ref<HTMLElement | null>(null);
const scrollToFeedback = (): void => {
  moreMenuOpen.value = false;
  setTimeout(() => {
    feedbackSectionEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
};

// ============================================================================
// Fetch detail + my feedback + my application status
// ============================================================================
const fetchDetail = async () => {
  if (!jobSlug.value) return;
  loading.value = true;
  error.value = null;
  try {
    const { data } = await jobApi.bySlug(jobSlug.value);
    job.value = data.data;
    void fetchApplicantsOverTime(data.data.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Không tải được chi tiết job';
    job.value = null;
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  void fetchDetail();
  void savedJobStore.fetchIds();
  void fetchMyFeedback();
  void fetchMyApplicationStatus();

  if (auth.isAuthenticated) {
    socket = getSocket();
    if (!socket.connected) socket.connect();
    socket.on('application:match-ready', onMatchReady);
    socket.on('application:match-skipped', onMatchSkipped);
  }
});

onUnmounted(() => {
  if (socket) {
    socket.off('application:match-ready', onMatchReady);
    socket.off('application:match-skipped', onMatchSkipped);
  }
});

watch(jobSlug, async () => {
  descriptionExpanded.value = false;
  responsibilitiesExpanded.value = false;
  chatOpen.value = false;
  moreMenuOpen.value = false;
  await fetchDetail();
  await fetchMyFeedback();
  await fetchMyApplicationStatus();
});

// ============================================================================
// Auth + application status
// ============================================================================
const isCandidateLoggedIn = computed(() =>
  auth.isAuthenticated && auth.user?.role === 'candidate',
);

const applicationList = ref<JobApplicationStatus[]>([]);
const loadingApplicationStatus = ref(false);

// ============================================================================
// Applicants-over-time chart (JobDetailView)
// ============================================================================
// Initial fallback = mockup data (APPLICANTS_CHART_DATA) — tránh flash rỗng
// khi API chưa về. Khi job load xong sẽ fetch API `/applicants-over-time` và
// replace nếu thành công; fail → giữ mockup.
const applicantsChartData = ref<{ series: ApplicantsOverTimePoint[]; peak: ApplicantsOverTimePoint | null }>({
  series: APPLICANTS_CHART_DATA.series,
  peak: APPLICANTS_CHART_DATA.peak,
});

/** viewBox constants — dùng cho cả path generator và template. */
const CHART_W = 720;
const CHART_H = 210;
const CHART_X0 = 60;       // x điểm đầu tiên
const CHART_X1 = 700;      // x điểm cuối
const CHART_Y_TOP = 20;    // y đỉnh chart
const CHART_Y_BOT = 190;   // y đáy chart
const CHART_PAD_LEFT = 32; // gridline trái

/** Max count trong series — dùng scale trục Y. Fallback 100 tránh chia 0. */
const chartMax = computed(() => {
  const m = applicantsChartData.value.series.reduce((acc, p) => Math.max(acc, p.count), 0);
  return m > 0 ? m : 100;
});

/** Y-axis tick values (4 ticks, chia đều từ 0 → max). */
const chartYTicks = computed<number[]>(() => {
  const m = chartMax.value;
  return [m, Math.round(m * 0.5), Math.round(m * 0.25), Math.round(m * 0.1)];
});

/** Y position cho count value (linear scale). */
const chartYFor = (v: number): number => {
  const m = chartMax.value || 1;
  return CHART_Y_BOT - (v / m) * (CHART_Y_BOT - CHART_Y_TOP);
};

/** X position cho index i trong series (chia đều từ X0 → X1). */
const chartXFor = (i: number, n: number): number => {
  if (n <= 1) return CHART_X0;
  return CHART_X0 + (i * (CHART_X1 - CHART_X0)) / (n - 1);
};

/** Tính path "M ... C ..." cubic-bezier cho area/line, fit series. */
const chartPath = computed(() => {
  const series = applicantsChartData.value.series;
  const n = series.length;
  if (!n) return { line: '', area: '' };
  const pts = series.map((p, i) => ({ x: chartXFor(i, n), y: chartYFor(p.count) }));
  // Smooth bezier đơn giản — control points lệch ngang 1/3 đoạn kề.
  let line = `M ${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const cx1 = prev.x + (cur.x - prev.x) / 3;
    const cx2 = cur.x - (cur.x - prev.x) / 3;
    line += ` C ${cx1},${prev.y} ${cx2},${cur.y} ${cur.x},${cur.y}`;
  }
  const area = `${line} L ${pts[n - 1]!.x},${CHART_Y_BOT} L ${pts[0]!.x},${CHART_Y_BOT} Z`;
  return { line, area };
});

/** Index của peak trong series (null nếu peak null). */
const chartPeakIndex = computed(() => {
  const peak = applicantsChartData.value.peak;
  if (!peak) return -1;
  return applicantsChartData.value.series.findIndex((p) => p.date === peak.date && p.count === peak.count);
});

const fetchApplicantsOverTime = async (jobId: string): Promise<void> => {
  try {
    const { data } = await jobApi.applicantsOverTime(jobId, 10);
    if (data.data.series.length) {
      applicantsChartData.value = {
        series: data.data.series,
        peak: data.data.peak,
      };
    }
  } catch {
    // Giữ mockup fallback — chart vẫn render được.
  }
};

// ============================================================================
// Tab state + Company detail
// ============================================================================
type ActiveTab = 'overview' | 'company';
const activeTab = ref<ActiveTab>('overview');

const company = ref<Company | null>(null);
const loadingCompany = ref(false);

const fetchCompany = async (companyId: string): Promise<void> => {
  loadingCompany.value = true;
  try {
    const { data } = await companyApi.getById(companyId);
    company.value = data.data;
  } catch {
    company.value = null;
  } finally {
    loadingCompany.value = false;
  }
};

const selectTab = (tab: ActiveTab): void => {
  activeTab.value = tab;
  // Lazy-load Company detail lần đầu switch tab (tránh fetch thừa khi user
  // chỉ xem Overview).
  if (tab === 'company' && !company.value && job.value?.companyId) {
    void fetchCompany(job.value.companyId);
  }
};

/** Format address JSONB thành chuỗi ngắn (city, district). */
const formatCompanyAddress = (addr: Record<string, unknown> | null | undefined): string => {
  if (!addr) return '';
  const city = typeof addr.city === 'string' ? addr.city : '';
  const district = typeof addr.district === 'string' ? addr.district : '';
  return [city, district].filter(Boolean).join(', ');
};

/**
 * Normalize country từ address — trả về 'Vietnam' nếu:
 *   - address.country chứa "vietnam" (case-insensitive), HOẶC
 *   - address.country null/undefined/empty (default cho job tại VN).
 * Trả về '' nếu country là giá trị khác (Mỹ, Nhật, ... — hiển thị raw).
 */
const normalizeCountry = (addr: Record<string, unknown> | null | undefined): string => {
  if (!addr) return 'Vietnam';
  const c = addr.country;
  if (typeof c !== 'string' || c.trim() === '') return 'Vietnam';
  return /vietnam/i.test(c) ? 'Vietnam' : c;
};

/** Map platform key (github/twitter/linkedin) → label + brand color + lucide icon.
 *  Brand colors theo guideline chính thức; key lạ fallback `Globe` + gray. */
const PLATFORM_META: Record<string, { label: string; icon: typeof Github; color: string }> = {
  linkedin:  { label: 'LinkedIn',  icon: Linkedin, color: 'text-[#0A66C2]' },
  twitter:   { label: 'Twitter',   icon: Twitter,  color: 'text-[#1DA1F2]' },
  x:         { label: 'X',         icon: Twitter,  color: 'text-[#000000]' },
  github:    { label: 'GitHub',    icon: Github,   color: 'text-[#181717]' },
  facebook:  { label: 'Facebook',  icon: Globe,    color: 'text-[#1877F2]' },
  youtube:   { label: 'YouTube',   icon: Globe,    color: 'text-[#FF0000]' },
  instagram: { label: 'Instagram', icon: Globe,    color: 'text-[#E4405F]' },
  tiktok:    { label: 'TikTok',    icon: Globe,    color: 'text-[#000000]' },
  website:   { label: 'Website',   icon: Globe,    color: 'text-[#64748B]' },
};

/** Chuẩn hoá URL social — nếu thiếu protocol thì thêm `https://`. */
const normalizeSocialUrl = (raw: string): string => {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
};

/** Social links lọc — chỉ show link có value hợp lệ + gắn icon + brand color. */
interface SocialLink {
  key: string;
  label: string;
  href: string;
  icon: typeof Github;
  color: string;
}
const socialLinks = computed<SocialLink[]>(() => {
  const s = company.value?.social;
  if (!s) return [];
  const out: SocialLink[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'string' || v.trim().length === 0) continue;
    const key = k.toLowerCase();
    const meta = PLATFORM_META[key] ?? { label: k, icon: Globe, color: 'text-[#64748B]' };
    out.push({ key, label: meta.label, href: normalizeSocialUrl(v), icon: meta.icon, color: meta.color });
  }
  return out;
});

/** Country hiển thị cờ VN:
 *   - address.country null/empty → default VN
 *   - country chứa "vietnam" (case-insens.) → VN
 *   - country khác → trả về raw string (không có icon) */
const showVietnamFlag = computed<boolean>(() => {
  const addr = company.value?.address;
  const country = addr && typeof addr.country === 'string' ? addr.country.trim() : '';
  if (!country) return true;
  return /vietnam/i.test(country);
});
const countryName = computed<string>(() => {
  const addr = company.value?.address;
  const country = addr && typeof addr.country === 'string' ? addr.country.trim() : '';
  return country && !/vietnam/i.test(country) ? country : '';
});

/**
 * Lat/Lng từ `company.address` JSONB để render map. Trả về `null` nếu thiếu
 * → template `v-if` ẩn block Location (không render map rỗng).
 * Validate range để tránh render với data rác (lat 0, lng 0 = off-coast).
 */
const companyMapCoords = computed<{ lat: number; lng: number } | null>(() => {
  const addr = company.value?.address;
  if (!addr) return null;
  const lat = typeof addr.lat === 'number' ? addr.lat : null;
  const lng = typeof addr.lng === 'number' ? addr.lng : null;
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
});

/** Full address text hiển thị dưới map — gộp street address + city/district
 *  + country flag + raw country name. Rỗng → null (template ẩn). */
const companyAddressText = computed<string | null>(() => {
  const addr = company.value?.address as Record<string, unknown> | null | undefined;
  if (!addr) return null;
  const street = typeof addr.address === 'string' ? addr.address.trim() : '';
  const city = formatCompanyAddress(addr);
  const parts: string[] = [];
  if (street) parts.push(street);
  if (city) parts.push(city);
  return parts.length > 0 ? parts.join(' · ') : null;
});

/** Extract `city` từ `Job.location` JSONB (helper cho template — TS không cho `as` cast trong template). */
const jobLocationCity = (loc: Record<string, unknown> | null | undefined): string => {
  if (!loc) return '';
  const c = loc.city;
  return typeof c === 'string' ? c : '';
};

const appliedCvIds = computed(() =>
  applicationList.value.map((a) => a.cvId).filter((id): id is string => Boolean(id)),
);

const fetchMyApplicationStatus = async (): Promise<void> => {
  if (!isCandidateLoggedIn.value || !jobSlug.value) {
    applicationList.value = [];
    return;
  }
  loadingApplicationStatus.value = true;
  try {
    const { data } = await jobApi.myApplicationStatus(jobSlug.value);
    applicationList.value = data.data;
  } catch {
    applicationList.value = [];
  } finally {
    loadingApplicationStatus.value = false;
  }
};

/** Helper: state AI matching cho 1 application (scoring/terminal/none). */
type MatchState = 'scoring' | 'failed' | 'ready' | 'none';
const getMatchState = (app: JobApplicationStatus): MatchState => {
  if (app.aiMatchScore != null) return 'ready';
  const terminal = ['hired', 'rejected', 'withdrawn'];
  if (app.aiMatchReason === 'quota_exceeded' || app.aiMatchReason === 'failed') return 'failed';
  if (app.aiMatchReason == null && !terminal.includes(app.status)) return 'scoring';
  return 'none';
};

/**
 * Build 3 bars cho card "Your Scope" từ per-criterion scores thật (BE trả qua
 * `JobApplicationStatus.aiExperienceScore / aiIndustryScore / aiSkillsScore`).
 * Null fallback 0% — FE vẫn render 3 bars để layout cân, kèm footer note.
 */
interface ScopeBar {
  label: string;
  percent: number;
  color: string;
}
const criteriaForApp = (app: JobApplicationStatus): ScopeBar[] => [
  {
    label: 'Kinh nghiệm',
    percent: app.aiExperienceScore ?? 0,
    color: '#10B981',
  },
  {
    label: 'Ngành',
    percent: app.aiIndustryScore ?? 0,
    color: '#8B5CF6',
  },
  {
    label: 'Kỹ năng',
    percent: app.aiSkillsScore ?? 0,
    color: '#F59E0B',
  },
];

/** True khi application CHƯA có per-criterion scores (cũ hoặc terminal). */
const hasCriterionScores = (app: JobApplicationStatus): boolean =>
  app.aiExperienceScore != null &&
  app.aiIndustryScore != null &&
  app.aiSkillsScore != null;

const goToMyApplication = (applicationId: string): void => {
  void router.push({ name: 'candidate-applications', query: { application: applicationId } });
};

const formatAppliedStatus = (status: JobApplicationStatus['status']): string => {
  const m: Record<JobApplicationStatus['status'], string> = {
    pending: 'Đã nộp',
    viewed: 'Đã xem',
    screening: 'Đang xét duyệt',
    interview: 'Mời phỏng vấn',
    offered: 'Đã nhận offer',
    hired: 'Trúng tuyển',
    rejected: 'Bị từ chối',
    withdrawn: 'Đã rút',
  };
  return m[status] ?? status;
};

// ============================================================================
// Realtime: patch aiMatchScore khi worker chấm xong
// ============================================================================
const onMatchReady = (payload: ApplicationMatchReadyPayload): void => {
  if (!job.value) return;
  if (payload.jobId && payload.jobId !== job.value.id) return;
  const row = applicationList.value.find(
    (a) => a.applicationId === payload.applicationId,
  );
  if (!row) return;
  if (payload.reason) row.aiMatchReason = payload.reason;
  if (payload.matchPercent != null) row.aiMatchScore = payload.matchPercent;
};

const onMatchSkipped = (payload: ApplicationMatchSkippedPayload): void => {
  if (!job.value) return;
  if (payload.jobId && payload.jobId !== job.value.id) return;
  const row = applicationList.value.find(
    (a) => a.applicationId === payload.applicationId,
  );
  if (!row) return;
  row.aiMatchReason = payload.reason;
};

// ============================================================================
// Feedback — candidate đánh giá job (rating + comment)
// ============================================================================
const myFeedback = ref<JobFeedback | null>(null);
const feedbackRating = ref<number>(0);
const feedbackComment = ref<string>('');
const submittingFeedback = ref(false);

const isEditingFeedback = computed(() => myFeedback.value != null);
const canRateFeedback = computed(
  () => isCandidateLoggedIn.value && applicationList.value.length > 0,
);

const fetchMyFeedback = async (): Promise<void> => {
  if (!isCandidateLoggedIn.value || !job.value) {
    myFeedback.value = null;
    return;
  }
  try {
    const { data } = await jobApi.myFeedback(job.value.id);
    myFeedback.value = data.data;
    if (myFeedback.value) {
      feedbackRating.value = myFeedback.value.rating;
      feedbackComment.value = myFeedback.value.comment ?? '';
    } else {
      feedbackRating.value = 0;
      feedbackComment.value = '';
    }
  } catch {
    myFeedback.value = null;
  }
};

const submitFeedback = async (): Promise<void> => {
  if (!job.value || !isCandidateLoggedIn.value) {
    toast.push({
      variant: 'info',
      title: 'Đăng nhập để đánh giá',
      body: 'Bạn cần đăng nhập với tài khoản ứng viên.',
    });
    void router.push({ name: 'login' });
    return;
  }
  if (feedbackRating.value < 1) {
    toast.push({ variant: 'error', title: 'Vui lòng chọn số sao' });
    return;
  }
  submittingFeedback.value = true;
  try {
    const { data } = await jobApi.createFeedback(job.value.id, {
      rating: feedbackRating.value,
      comment: feedbackComment.value.trim() || null,
    });
    myFeedback.value = data.data;
    await fetchDetail();
    toast.push({
      variant: 'success',
      title: isEditingFeedback.value ? 'Đã cập nhật đánh giá' : 'Cảm ơn bạn đã đánh giá',
    });
  } catch (err: unknown) {
    const status =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { status?: number; data?: { code?: string } } }).response?.status
        : undefined;
    const code =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { code?: string } } }).response?.data?.code
        : undefined;

    if (status === 403 && code === 'NOT_APPLIED') {
      toast.push({
        variant: 'info',
        title: 'Bạn cần ứng tuyển trước',
        body: 'Hãy nộp hồ sơ cho job này rồi quay lại đánh giá nhé.',
      });
    } else {
      toast.push({
        variant: 'error',
        title: 'Không gửi được đánh giá',
        body: 'Vui lòng thử lại sau.',
      });
    }
  } finally {
    submittingFeedback.value = false;
  }
};

const cancelEditFeedback = (): void => {
  feedbackRating.value = myFeedback.value?.rating ?? 0;
  feedbackComment.value = myFeedback.value?.comment ?? '';
};
</script>

<template>
  <div class="h-full bg-white">
    <!-- ============ Loading ============ -->
    <div
      v-if="loading && !job"
      class="h-full flex items-center justify-center"
    >
      <Loader2 class="w-5 h-5 text-[#94A3B8] animate-spin" />
    </div>

    <!-- ============ Error / Not found ============ -->
    <div
      v-else-if="error || !job"
      class="h-full flex flex-col items-center justify-center px-6 text-center"
    >
      <div class="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-3">
        <AlertCircle class="w-6 h-6 text-red-500" />
      </div>
      <h3 class="text-sm font-semibold text-[#0F172A]">Không tải được chi tiết job</h3>
      <p class="text-xs text-[#64748B] mt-1">{{ error ?? 'Job không tồn tại hoặc đã bị đóng.' }}</p>
      <button
        type="button"
        class="mt-4 px-3 py-1.5 text-xs rounded-md border border-[#EEF1F5] bg-white text-[#334155] hover:bg-[#F8FAFB] transition"
        @click="goBack"
      >
        Quay lại
      </button>
    </div>

    <!-- ============ Main content ============ -->
    <template v-else>
      <main class="px-6 pt-5 pb-10 h-full overflow-y-auto">
        <!-- Job header -->
        <div class="flex items-center justify-between gap-4 mb-3">
          <div class="flex items-center gap-2 min-w-0">
            <button
              type="button"
              aria-label="Quay lại"
              title="Quay lại"
              class="h-7 w-7 grid place-items-center rounded-md hover:bg-[#F8FAFB] text-[#64748B] transition"
              @click="goBack"
            >
              <ArrowLeft class="w-4 h-4" />
            </button>
            <h2 class="text-[15px] font-semibold tracking-tight text-[#0F172A] truncate">
              {{ job.title }}
            </h2>
            <span class="text-[11px] text-[#64748B] whitespace-nowrap">
              {{ compactNumber(job.appliesCount) }} Lượt ứng tuyển
            </span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-label="Trợ giúp"
              title="Trợ giúp"
              class="h-8 w-8 grid place-items-center rounded-md border border-[#EEF1F5] bg-white text-[#334155] hover:bg-[#F8FAFB]"
            >
              <HelpCircle class="w-4 h-4" />
            </button>
            <button
              type="button"
              class="h-8 px-3.5 rounded-md bg-[#1677FF] text-white text-[12px] font-medium hover:bg-[#0E5FD9] transition inline-flex items-center gap-1.5"
              @click="onApply"
            >
              <Send class="w-3.5 h-3.5" />
              Ứng tuyển
            </button>
            <div class="relative" ref="moreBtnEl">
              <button
                type="button"
                aria-label="More"
                title="Thêm"
                class="h-8 w-8 grid place-items-center rounded-md border border-[#EEF1F5] bg-white text-[#334155] hover:bg-[#F8FAFB]"
                @click.stop="moreMenuOpen = !moreMenuOpen"
              >
                <MoreHorizontal class="w-4 h-4" />
              </button>
              <Transition name="more">
                <div
                  v-if="moreMenuOpen"
                  class="absolute right-0 top-10 z-30 w-48 rounded-lg border border-[#EEF1F5] bg-white shadow-lg py-1 text-[12.5px]"
                >
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F8FAFB] text-[#334155] transition"
                    @click="onSave"
                  >
                    <Bookmark v-if="!saved" class="w-3.5 h-3.5" />
                    <BookmarkCheck v-else class="w-3.5 h-3.5 text-[#1677FF]" />
                    {{ saved ? 'Bỏ lưu job' : 'Lưu job' }}
                  </button>
                  <button
                    v-if="isCandidateLoggedIn && job.postedBy"
                    type="button"
                    class="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F8FAFB] text-[#334155] transition"
                    @click.stop="toggleChat"
                  >
                    <MessageCircle class="w-3.5 h-3.5" />
                    Nhắn nhanh
                  </button>
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F8FAFB] text-[#334155] transition"
                    @click="onShare"
                  >
                    <Share2 class="w-3.5 h-3.5" />
                    Chia sẻ
                  </button>
                  <div class="my-1 border-t border-[#EEF1F5]"></div>
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F8FAFB] text-[#334155] transition"
                    @click="scrollToFeedback"
                  >
                    <Star class="w-3.5 h-3.5" />
                    Đánh giá
                  </button>
                </div>
              </Transition>
            </div>
          </div>
        </div>

        <!-- Tabs -->
        <div class="border-b border-[#EEF1F5] mb-4">
          <div class="flex items-center gap-6">
            <button
              class="relative py-2.5 text-[12.5px] font-medium transition"
              :class="activeTab === 'overview' ? 'text-[#1677FF]' : 'text-[#64748B] hover:text-[#334155]'"
              @click="selectTab('overview')"
            >
              Tổng quan
              <span
                v-if="activeTab === 'overview'"
                class="absolute left-0 right-0 -bottom-px h-[2px] bg-[#1677FF] rounded-full"
              ></span>
            </button>
            <button
              class="relative py-2.5 text-[12.5px] font-medium transition"
              :class="activeTab === 'company' ? 'text-[#1677FF]' : 'text-[#64748B] hover:text-[#334155]'"
              @click="selectTab('company')"
            >
              Công ty
              <span
                v-if="activeTab === 'company'"
                class="absolute left-0 right-0 -bottom-px h-[2px] bg-[#1677FF] rounded-full"
              ></span>
            </button>
          </div>
        </div>

        <!-- Overview tab -->
        <template v-if="activeTab === 'overview'">
        <!-- Grid -->
        <div class="grid grid-cols-12 gap-5">
          <!-- ============ Left col ============ -->
          <div class="col-span-12 lg:col-span-8 min-w-0">
            <!-- About -->
            <section class="mb-5">
              <h3 class="text-[13.5px] font-semibold text-[#0F172A] mb-1.5">Mô tả</h3>
              <p class="text-[12.5px] leading-[1.55] text-[#64748B] whitespace-pre-line">
                {{ truncatedDescription }}
                <span
                  v-if="canExpandDescription && !descriptionExpanded"
                  class="text-[#334155] cursor-pointer hover:underline ml-1"
                  @click="descriptionExpanded = true"
                >...see more</span>
                <span
                  v-if="canExpandDescription && descriptionExpanded"
                  class="text-[#334155] cursor-pointer hover:underline ml-1"
                  @click="descriptionExpanded = false"
                >...see less</span>
              </p>
            </section>

            <!-- Meta card -->
            <section class="mb-5 rounded-lg border border-[#EEF1F5] bg-white p-4">
              <div class="grid grid-cols-3 gap-x-4 gap-y-3">
                <div>
                  <div class="text-[10.5px] text-[#64748B] mb-0.5">Ngành</div>
                  <div class="text-[12.5px] font-semibold text-[#0F172A]">
                    {{ job.industry ?? '—' }}
                  </div>
                </div>
                <div>
                  <div class="text-[10.5px] text-[#64748B] mb-0.5">Hình thức</div>
                  <div class="text-[12.5px] font-semibold text-[#0F172A]">
                    {{ jobTypeLabel || '—' }}
                  </div>
                </div>
                <div>
                  <div class="text-[10.5px] text-[#64748B] mb-0.5">Cách thức</div>
                  <div class="text-[12.5px] font-semibold text-[#0F172A]">
                    {{ workApproachLabel }}
                  </div>
                </div>
                <div>
                  <div class="text-[10.5px] text-[#64748B] mb-0.5">Kinh nghiệm</div>
                  <div class="text-[12.5px] font-semibold text-[#0F172A]">
                    {{ experienceLabel || '—' }}
                  </div>
                </div>
                <div>
                  <div class="text-[10.5px] text-[#64748B] mb-0.5">Lương</div>
                  <div class="text-[12.5px] font-semibold text-[#0F172A]">
                    {{ salaryLabel || '—' }}
                  </div>
                </div>
                <div>
                  <div class="text-[10.5px] text-[#64748B] mb-0.5">Yêu cầu</div>
                  <div class="text-[12.5px] font-semibold text-[#0F172A]">
                    {{  '—' }}
                  </div>
                </div>
              </div>
            </section>

            <!-- Applicants details -->
            <section class="mb-5 rounded-lg border border-[#EEF1F5] bg-white p-4 pt-3.5">
              <div class="flex items-start justify-between mb-2">
                <h3 class="text-[13.5px] font-semibold text-[#0F172A]">Tuyển dụng gần đây</h3>
                
              </div>
              <div class="flex items-end justify-between mt-1 mb-1 gap-3 flex-wrap">
                <div class="flex items-end gap-2 min-w-0">
                  <span class="text-[32px] font-semibold tracking-tight text-[#0F172A] leading-none">
                    {{ compactNumber(job.appliesCount) }}
                  </span>
                  <span class="text-[12px] text-[#64748B] mb-1 whitespace-nowrap">
                    Tổng lượt ứng tuyển
                    <span class="mx-1 text-[#CBD5E1]">·</span>
                    <span class="inline-flex items-center gap-1">
                      <Eye class="w-3 h-3 inline" />
                      {{ compactNumber(job.viewsCount) }} 
                    </span>
                    <span class="mx-1 text-[#CBD5E1]">·</span>
                    <span class="inline-flex items-center gap-1">
                      <Star class="w-3 h-3 inline text-yellow-400" />
                      <template v-if="job.feedbackStats.count > 0">
                        {{ job.feedbackStats.average }}
                        <span class="text-[#94A3B8]">({{ job.feedbackStats.count }})</span>
                      </template>
                      <template v-else>Chưa có</template>
                    </span>
                  </span>
                </div>
                <div v-if="publishedLabel" class="text-[11px] text-[#64748B] shrink-0">
                  Đăng vào: {{ publishedLabel }}
                </div>
              </div>
              <!-- Chart SVG — render dynamic từ `applicantsChartData` (API hoặc mockup fallback) -->
              <div class="h-[210px] w-full mt-1">
                <svg viewBox="0 0 720 210" class="w-full h-full" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#1677FF" stop-opacity="0.28" />
                      <stop offset="100%" stop-color="#1677FF" stop-opacity="0" />
                    </linearGradient>
                  </defs>
                  <!-- Y-axis labels (4 ticks, scale theo max) -->
                  <g font-size="10" fill="#94A3B8" font-family="Inter">
                    <text v-for="(t, i) in chartYTicks" :key="`y-${i}`"
                      :x="0" :y="chartYFor(t) + 4">{{ t }}</text>
                  </g>
                  <!-- Gridlines -->
                  <g stroke="#EEF1F5" stroke-width="1">
                    <line v-for="(t, i) in chartYTicks" :key="`grid-${i}`"
                      :x1="CHART_PAD_LEFT" :x2="CHART_W"
                      :y1="chartYFor(t)" :y2="chartYFor(t)" />
                  </g>
                  <!-- Reference vertical at peak + tooltip -->
                  <template v-if="chartPeakIndex >= 0">
                    <line
                      :x1="chartXFor(chartPeakIndex, applicantsChartData.series.length)"
                      :y1="CHART_Y_TOP"
                      :x2="chartXFor(chartPeakIndex, applicantsChartData.series.length)"
                      :y2="CHART_Y_BOT"
                      stroke="#1677FF" stroke-width="1" stroke-dasharray="2 3"
                    />
                    <g
                      :transform="`translate(${chartXFor(chartPeakIndex, applicantsChartData.series.length) - 32}, 4)`"
                    >
                      <rect width="64" height="20" rx="4" fill="#0F172A" />
                      <text x="32" y="13" text-anchor="middle" fill="#fff" font-size="10" font-family="Inter">
                        {{ applicantsChartData.peak?.date }} · {{ applicantsChartData.peak?.count }} app.
                      </text>
                    </g>
                    <circle
                      :cx="chartXFor(chartPeakIndex, applicantsChartData.series.length)"
                      :cy="chartYFor(applicantsChartData.peak?.count ?? 0)"
                      r="3.5" fill="#1677FF" stroke="#fff" stroke-width="1.5"
                    />
                  </template>
                  <!-- Area -->
                  <path :d="chartPath.area" fill="url(#areaFill)" />
                  <!-- Line -->
                  <path :d="chartPath.line" fill="none" stroke="#1677FF" stroke-width="2"
                    stroke-linejoin="round" stroke-linecap="round" />
                  <!-- X-axis labels -->
                  <g font-size="10" fill="#94A3B8" font-family="Inter" text-anchor="middle">
                    <text v-for="(p, i) in applicantsChartData.series" :key="`x-${p.date}-${i}`"
                      :x="chartXFor(i, applicantsChartData.series.length)"
                      y="204">{{ p.date }}</text>
                  </g>
                </svg>
              </div>
            </section>

            <!-- Key Responsibilities -->
            <section class="mb-5">
              <h3 class="text-[13.5px] font-semibold text-[#0F172A] mb-2">Yêu cầu công việc</h3>
              <ul class="space-y-1.5 text-[12.5px] leading-[1.55] text-[#334155]">
                <li
                  v-for="r in visibleResponsibilities"
                  :key="r"
                  class="flex gap-2"
                >
                  <span class="mt-[7px] h-1 w-1 rounded-full bg-[#64748B] shrink-0"></span>
                  <span>{{ r }}</span>
                </li>
              </ul>
              <button
                v-if="canExpandResponsibilities"
                class="mt-2 text-[12px] text-[#334155] hover:text-[#0F172A] hover:underline transition"
                @click="responsibilitiesExpanded = !responsibilitiesExpanded"
              >{{ responsibilitiesExpanded ? '...see less' : '...see more' }}</button>
            </section>

            <!-- Skills -->
            <section v-if="job.requiredSkills?.length" class="mb-2">
              <h3 class="text-[13.5px] font-semibold text-[#0F172A] mb-2">Kỹ năng cần có</h3>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="skill in job.requiredSkills"
                  :key="skill"
                  class="px-2.5 py-1 rounded-md border border-[#EEF1F5] bg-white text-[11.5px] text-[#334155]"
                >
                  {{ skill }}
                </span>
              </div>
            </section>

            <!-- Feedbacks -->
            <section
              ref="feedbackSectionEl"
              id="feedback-section"
              class="mt-8 rounded-lg border border-[#EEF1F5] bg-white p-5"
            >
              <header class="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h3 class="text-[13.5px] font-semibold text-[#0F172A] inline-flex items-center gap-2">
                  <Star class="w-4 h-4 fill-[#F59E0B] text-[#F59E0B]" />
                  Đánh giá từ ứng viên
                </h3>
                <div v-if="job.feedbackStats.count > 0" class="inline-flex items-center gap-1.5 text-xs">
                  <span class="inline-flex items-center gap-0.5 text-[#F59E0B] font-bold">
                    <Star class="w-3.5 h-3.5 fill-[#F59E0B] text-[#F59E0B]" />
                    {{ job.feedbackStats.average }}
                  </span>
                  <span class="text-[#64748B]">({{ job.feedbackStats.count }} lượt)</span>
                </div>
              </header>

              <div
                v-if="isCandidateLoggedIn"
                class="border border-[#EEF1F5] rounded-lg p-4 bg-[#F8FAFB] mb-4"
              >
                <div
                  v-if="!canRateFeedback"
                  class="mb-3 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900"
                >
                  <AlertCircle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Bạn cần <strong>ứng tuyển job này bằng ít nhất 1 CV</strong> trước khi đánh giá.
                  </span>
                </div>
                <p class="text-[11px] font-bold tracking-wider text-[#64748B] mb-2.5">
                  {{ isEditingFeedback ? 'SỬA ĐÁNH GIÁ CỦA BẠN' : 'CHIA SẺ TRẢI NGHIỆM CỦA BẠN' }}
                </p>
                <div
                  class="flex items-center gap-1.5 mb-3 transition"
                  :class="!canRateFeedback ? 'opacity-50 pointer-events-none' : ''"
                >
                  <button
                    v-for="n in 5"
                    :key="n"
                    type="button"
                    class="p-0 transition hover:scale-110"
                    :aria-label="`${n} sao`"
                    :disabled="!canRateFeedback"
                    @click="feedbackRating = n"
                  >
                    <Star
                      class="w-6 h-6 transition"
                      :class="n <= feedbackRating
                        ? 'fill-[#F59E0B] text-[#F59E0B]'
                        : 'text-[#CBD5E1]'"
                      :stroke-width="1.5"
                    />
                  </button>
                  <span v-if="feedbackRating > 0" class="ml-2 text-xs font-semibold text-[#334155]">
                    {{ feedbackRating }}/5
                  </span>
                </div>
                <textarea
                  v-model="feedbackComment"
                  rows="3"
                  maxlength="2000"
                  :disabled="!canRateFeedback"
                  placeholder="Cảm nhận của bạn về quy trình tuyển dụng, môi trường làm việc, JD, v.v."
                  class="w-full text-[13px] font-sans text-[#0F172A] placeholder-[#94A3B8] border border-[#EEF1F5] rounded-[8px] px-3 py-2 focus:outline-none focus:border-[#1677FF] resize-y min-h-[64px] disabled:bg-[#F8FAFB] disabled:cursor-not-allowed"
                />
                <div class="mt-2.5 flex items-center justify-between gap-2.5 flex-wrap">
                  <p class="text-[11px] text-[#64748B]">
                    Bạn chỉ có thể gửi 1 đánh giá cho job này — có thể chỉnh sửa sau.
                  </p>
                  <div class="flex items-center gap-2 shrink-0">
                    <button
                      v-if="isEditingFeedback"
                      type="button"
                      class="px-3 py-1.5 text-[12.5px] font-semibold rounded-lg border border-[#EEF1F5] bg-white text-[#334155] hover:bg-[#F8FAFB] transition"
                      :disabled="submittingFeedback"
                      @click="cancelEditFeedback"
                    >
                      Huỷ
                    </button>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 px-[18px] py-2 text-[12px] font-bold rounded-md bg-[#1677FF] hover:bg-[#0E5FD9] text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                      :disabled="submittingFeedback || feedbackRating < 1 || !canRateFeedback"
                      @click="submitFeedback"
                    >
                      <Loader2 v-if="submittingFeedback" class="w-3.5 h-3.5 animate-spin" />
                      {{ submittingFeedback
                        ? 'Đang gửi...'
                        : (isEditingFeedback ? 'Cập nhật' : 'Gửi đánh giá') }}
                    </button>
                  </div>
                </div>
              </div>

              <div
                v-if="job.feedbacks.length === 0"
                class="flex flex-col items-center text-center py-5 text-[#94A3B8]"
              >
                <Star class="w-[30px] h-[30px] mb-2.5 text-[#E4C876]" :stroke-width="1.6" />
                <div class="text-[13px] font-bold text-[#334155] mb-0.5">
                  Hãy là người đầu tiên đánh giá
                </div>
                <div class="text-[12px]">Chia sẻ trải nghiệm để giúp ứng viên khác cân nhắc.</div>
              </div>

              <div v-else class="space-y-3">
                <article
                  v-for="fb in job.feedbacks"
                  :key="fb.id"
                  class="rounded-lg border p-4 transition"
                  :class="fb.isMine
                    ? 'border-[#1677FF]/40 bg-[#E6F1FF]/40'
                    : 'border-[#EEF1F5] bg-white'"
                >
                  <header class="flex items-start justify-between gap-3 mb-2">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p class="text-sm font-semibold text-[#0F172A] truncate">
                          {{ fb.candidateName ?? 'Ứng viên ẩn danh' }}
                        </p>
                        <span
                          v-if="fb.isMine"
                          class="text-[10px] font-bold text-[#1677FF] bg-[#E6F1FF] rounded-full px-2 py-0.5"
                        >
                          Đánh giá của bạn
                        </span>
                      </div>
                      <p class="text-[11px] text-[#64748B] mt-0.5">
                        {{ dayjs(fb.createdAt).format('DD/MM/YYYY') }}
                      </p>
                    </div>
                    <div class="inline-flex items-center gap-0.5 shrink-0">
                      <Star
                        v-for="n in 5"
                        :key="n"
                        class="w-3.5 h-3.5"
                        :class="n <= fb.rating
                          ? 'fill-[#F59E0B] text-[#F59E0B]'
                          : 'text-[#CBD5E1]'"
                      />
                    </div>
                  </header>
                  <p
                    v-if="fb.comment"
                    class="text-sm text-[#334155] whitespace-pre-line leading-[1.7]"
                  >
                    {{ fb.comment }}
                  </p>
                  <p v-else class="text-xs italic text-[#64748B]">(Không có nhận xét)</p>
                </article>
              </div>
            </section>
          </div>

          <!-- ============ Right col ============ -->
          <aside class="col-span-12 lg:col-span-4 min-w-0">
            <!-- Your Scope — 1 card / CV applied. Hiển thị CV title + match score + bars. -->
            <section class="rounded-lg border border-[#EEF1F5] bg-white p-4 pt-3.5 mb-4">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-[13.5px] font-semibold text-[#0F172A]">
                  So khớp gần đây
                  <span
                    v-if="applicationList.length > 0"
                    class="ml-1 text-[11px] font-medium text-[#64748B]"
                  >({{ applicationList.length }})</span>
                </h3>
                <button
                  class="h-6 w-6 grid place-items-center rounded-md hover:bg-[#F8FAFB] text-[#64748B]"
                  aria-label="More"
                >
                  <MoreHorizontal class="w-3.5 h-3.5" />
                </button>
              </div>

              <!-- Chưa login -->
              <div v-if="!isCandidateLoggedIn" class="text-center text-[#64748B] py-6">
                <p class="text-[12px] mb-2">Đăng nhập để xem điểm phù hợp với job này.</p>
                <button
                  type="button"
                  class="text-[12px] font-semibold text-[#1677FF] hover:underline"
                  @click="router.push({ name: 'login' })"
                >Đăng nhập</button>
              </div>

              <!-- Login rồi nhưng chưa apply -->
              <div
                v-else-if="applicationList.length === 0"
                class="text-center text-[#64748B] py-6"
              >
                <p class="text-[12px] mb-3">Apply để xem điểm phù hợp của bạn với job này.</p>
                <button
                  type="button"
                  class="h-8 px-3.5 rounded-md bg-[#1677FF] text-white text-[12px] font-medium hover:bg-[#0E5FD9] transition"
                  @click="onApply"
                >Ứng tuyển</button>
              </div>

              <!-- Stack 1 card / CV đã apply -->
              <div v-else class="space-y-4">
                <article
                  v-for="app in applicationList"
                  :key="app.applicationId"
                  class="rounded-md border border-[#EEF1F5] p-3 bg-[#F8FAFB]/40 hover:cursor-pointer"
                  @click="goToMyApplication(app.applicationId)"
                >
                  <!--
                    Header card: "Your Scope" mini-label + tên CV (đây là key UX —
                    mỗi apply tạo 1 entry "Your Scope with <tên CV>").
                  -->
                  <header class="flex items-start justify-between gap-2 mb-2.5">
                    <div class="min-w-0 flex-1">
                      <p class="text-[12.5px] font-semibold text-[#0F172A] truncate mt-0.5">
                        {{ app.cvTitle ?? '(CV đã xoá)' }}
                      </p>
                    </div>
                    <button
                      type="button"
                      class="shrink-0 h-6 w-6 grid place-items-center rounded-md hover:bg-white text-[#64748B]"
                      :aria-label="`Xem chi tiết đơn ${app.cvTitle ?? ''}`"
                      :title="`Mở chi tiết đơn ${app.cvTitle ?? ''}`"
                      @click="goToMyApplication(app.applicationId)"
                    >
                      <MoreHorizontal class="w-3.5 h-3.5" />
                    </button>
                  </header>

                  <!-- Ready: hiển thị điểm + 3 bars + criteria list -->
                  <template v-if="getMatchState(app) === 'ready'">
                    <div class="flex items-end gap-2 mb-2.5">
                      <span class="text-[32px] font-semibold tracking-tight text-[#0F172A] leading-none">
                        {{ app.aiMatchScore }}%
                      </span>
                      <span class="text-[11px] text-[#64748B] mb-1.5">Total Match</span>
                    </div>
                    <div class="flex items-end justify-between gap-3 mb-3">
                      <div
                        v-for="c in criteriaForApp(app)"
                        :key="c.label"
                        class="flex-1 flex flex-col items-center justify-end gap-1"
                      >
                        <span
                          class="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          :style="{ color: c.color, backgroundColor: c.color + '26' }"
                        >{{ c.percent }}%</span>
                        <div
                          class="w-full h-1.5 rounded-full"
                          :style="{ backgroundColor: c.color }"
                        ></div>
                      </div>
                    </div>
                    <ul class="space-y-1.5">
                      <li
                        v-for="c in criteriaForApp(app)"
                        :key="`row-${app.applicationId}-${c.label}`"
                        class="flex items-center justify-between text-[11.5px]"
                      >
                        <span class="flex items-center gap-2 text-[#334155]">
                          <span
                            class="h-1.5 w-1.5 rounded-full"
                            :style="{ backgroundColor: c.color }"
                          ></span>
                          {{ c.label }}
                        </span>
                        <span class="text-[#0F172A] font-medium">{{ c.percent }}%</span>
                      </li>
                    </ul>
                  </template>

                  <!-- Scoring: worker đang chạy -->
                  <div
                    v-else-if="getMatchState(app) === 'scoring'"
                    class="flex items-center gap-2 py-3 text-[12px] text-[#64748B]"
                  >
                    <Loader2 class="w-3.5 h-3.5 animate-spin" />
                    <span>Đang chấm điểm phù hợp...</span>
                  </div>

                  <!-- Failed: quota_exceeded hoặc worker fail -->
                  <div
                    v-else-if="getMatchState(app) === 'failed'"
                    class="flex items-center gap-2 py-3 text-[12px] text-amber-600"
                  >
                    <AlertCircle class="w-3.5 h-3.5" />
                    <span>Không thể chấm điểm lúc này.</span>
                  </div>

                  <!-- None: terminal status, không có score — không show gì thêm -->
                  <div v-else class="text-[11.5px] text-[#94A3B8] italic py-2">
                    Điểm chưa khả dụng.
                  </div>

                  <!-- Footer: status + thời gian apply -->
                  <footer class="mt-2.5 pt-2.5 border-t border-[#EEF1F5] flex items-center justify-between text-[10px] text-[#64748B]">
                    <span>{{ formatAppliedStatus(app.status) }}</span>
                    <span>{{ dayjs(app.appliedAt).fromNow() }}</span>
                  </footer>
                </article>
              </div>
            </section>

            <!-- Upgrade PRO -->
            <section
              class="rounded-lg border border-[#EEF1F5] p-4 flex items-center justify-between hover:cursor-pointer hover:shadow-sm transition"
              style="background: linear-gradient(135deg, #FFFBEB 0%, #FFFFFF 60%, #FEF3C7 100%);"
              @click="router.push({name: 'pricing'})"
            >
              <div>
                <h3 class="text-[13.5px] font-semibold text-[#0F172A] mb-0.5">Nâng cấp lên gói PRO</h3>
                <p class="text-[11px] text-[#64748B] leading-snug">
                  Mở khóa thêm số lần chấm điểm phù hợp và nhiều tính năng khác.
                </p>
              </div>
              <div class="h-9 w-9 rounded-full bg-white border border-amber-200 grid place-items-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 4l3 12h14l3-12-6 7-5-7-5 7-6-7zM5 21h14"/>
                </svg>
              </div>
            </section>
          </aside>
        </div>
        </template>
        <!-- /Overview tab -->

        <!-- Company tab -->
        <div v-else>
          <!-- Loading -->
          <div v-if="loadingCompany" class="text-center py-12 text-[12.5px] text-[#64748B]">
            Đang tải thông tin công ty...
          </div>
          <!-- Empty / error -->
          <div
            v-else-if="!company"
            class="text-center py-12 text-[12.5px] text-[#64748B]"
          >
            Không tải được thông tin công ty.
          </div>
          <!-- Loaded: 2-col grid (info left, open jobs right) -->
          <div v-else class="grid grid-cols-12 gap-5">
            <!-- ============ Left: Company info ============ -->
            <div class="col-span-12 lg:col-span-8 min-w-0">
              <!-- Company header card -->
              <section class="mb-5 rounded-lg border border-[#EEF1F5] bg-white p-5">
                <div class="flex items-start gap-4">
                  <!-- Logo: object-cover để fill vuông 56×56 (logo có thể crop nhẹ
                       2 bên nhưng luôn full-bleed, tránh khoảng trắng thừa). -->
                  <div
                    class="h-14 w-14 rounded-lg bg-[#F8FAFB] border border-[#EEF1F5] flex items-center justify-center text-[#94A3B8] text-[14px] font-semibold overflow-hidden shrink-0"
                  >
                    <img
                      v-if="company.logoUrl"
                      :src="company.logoUrl"
                      :alt="company.name"
                      class="h-full w-full object-cover"
                    />
                    <template v-else>{{ company.name.slice(0, 2).toUpperCase() }}</template>
                  </div>
                  <div class="flex-1 min-w-0">
                    <h2 class="text-[16px] font-semibold text-[#0F172A] leading-tight flex items-center gap-1.5">
                      <span class="truncate flex-1 min-w-0">{{ company.name }}</span>
                      <!-- Cờ VN ở phía cuối (bên phải) — `shrink-0` để không bị
                           truncate đẩy ra ngoài viewport. Dùng chung
                           `showVietnamFlag` computed (true nếu country null/empty
                           hoặc chứa "vietnam"). -->
                      <svg
                        v-if="showVietnamFlag"
                        width="22"
                        height="16"
                        viewBox="0 0 30 20"
                        class="rounded-[2px] border border-[#EEF1F5] shrink-0"
                        role="img"
                        aria-label="Vietnam"
                        title="Vietnam"
                      >
                        <rect width="30" height="20" fill="#DA251D" />
                        <path fill="#FFFF00" d="M15 4.2 16.36 8.05 20.45 8.05 17.05 10.45 18.4 14.3 15 11.9 11.6 14.3 12.95 10.45 9.55 8.05 13.64 8.05 Z" />
                      </svg>
                      <span v-if="countryName" class="text-[10.5px] text-[#64748B] shrink-0">{{ countryName }}</span>
                    </h2>
                    <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#64748B]">
                      <span v-if="company.industry">{{ company.industry }}</span>
                      <!-- sizeRange + icon Users (sau size) -->
                      <span v-if="company.sizeRange" class="inline-flex items-center gap-1">
                        <span class="text-[#CBD5E1]">·</span>
                        {{ company.sizeRange }}
                        <Users class="w-3 h-3 text-[#94A3B8] shrink-0" aria-hidden="true" />
                      </span>
                      <!-- Address + cờ VN (nếu là Vietnam hoặc country null/empty thì show flag) -->
                      <span
                        v-if="formatCompanyAddress(company.address ?? null)"
                        class="inline-flex items-center gap-1.5"
                      >
                        <span class="text-[#CBD5E1]">·</span>
                        {{ formatCompanyAddress(company.address ?? null) }}
                        <span
                          v-if="showVietnamFlag"
                          class="inline-flex items-center"
                          title="Vietnam"
                        >
                          <svg
                            width="16"
                            height="11"
                            viewBox="0 0 30 20"
                            class="rounded-[2px] border border-[#EEF1F5] shrink-0"
                            role="img"
                            aria-label="Vietnam"
                          >
                            <rect width="30" height="20" fill="#DA251D" />
                            <path
                              fill="#FFFF00"
                              d="M15 4.2 16.36 8.05 20.45 8.05 17.05 10.45 18.4 14.3 15 11.9 11.6 14.3 12.95 10.45 9.55 8.05 13.64 8.05 Z"
                            />
                          </svg>
                        </span>
                        <span v-if="countryName" class="text-[#64748B] text-[10.5px]">
                          · {{ countryName }}
                        </span>
                      </span>
                    </div>
                    <div v-if="company.website" class="mt-2">
                      <a
                        :href="company.website"
                        target="_blank"
                        rel="noopener"
                        class="text-[11.5px] text-[#1677FF] hover:underline"
                      >{{ company.website }}</a>
                    </div>
                  </div>
                </div>
                <!-- Social links — icon brand color (LinkedIn blue, Twitter blue,
                     GitHub black, v.v.) + label. Hover: nền nhạt theo brand color. -->
                <div v-if="socialLinks.length" class="mt-4 flex flex-wrap gap-2">
                  <a
                    v-for="l in socialLinks"
                    :key="l.key"
                    :href="l.href"
                    target="_blank"
                    rel="noopener noreferrer"
                    :title="l.href"
                    :class="['inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#EEF1F5] text-[11px] transition hover:bg-black/[0.04]', l.color]"
                  >
                    <component :is="l.icon" class="w-3 h-3 shrink-0" />
                    {{ l.label }}
                  </a>
                </div>
              </section>

              <!-- About company -->
              <section v-if="company.description">
                <h3 class="text-[13.5px] font-semibold text-[#0F172A] mb-1.5">Giới thiệu công ty</h3>
                <p class="text-[12.5px] leading-[1.55] text-[#64748B] whitespace-pre-line">
                  {{ company.description }}
                </p>
              </section>
            </div>

            <!-- ============ Right: Map + Open jobs list ============ -->
            <aside class="col-span-12 lg:col-span-4 min-w-0 space-y-4">
              <!-- Map nhỏ ở trên — click vào marker popup hiện company name -->
              <section v-if="companyMapCoords">
                <h3 class="text-[13.5px] font-semibold text-[#0F172A] mb-2">Vị trí</h3>
                <div class="h-48 w-full overflow-hidden rounded-lg border border-[#EEF1F5]">
                  <CompanyMap
                    :lat="companyMapCoords.lat"
                    :lng="companyMapCoords.lng"
                    :label="company.name"
                  />
                </div>
                <!-- Địa chỉ text dưới map (street + city/district), kèm cờ VN
                     hoặc raw country name nếu khác Vietnam. -->
                <p
                  v-if="companyAddressText || showVietnamFlag || countryName"
                  class="mt-2 flex items-center gap-1.5 text-[11.5px] leading-[1.5] text-[#64748B]"
                >
                  <MapPin class="w-3 h-3 shrink-0" />
                  <span class="flex-1 min-w-0">{{ companyAddressText }}</span>
                  <svg
                    v-if="showVietnamFlag"
                    width="14"
                    height="10"
                    viewBox="0 0 30 20"
                    class="rounded-[2px] border border-[#EEF1F5] shrink-0"
                    role="img"
                    aria-label="Vietnam"
                  >
                    <rect width="30" height="20" fill="#DA251D" />
                    <path fill="#FFFF00" d="M15 4.2 16.36 8.05 20.45 8.05 17.05 10.45 18.4 14.3 15 11.9 11.6 14.3 12.95 10.45 9.55 8.05 13.64 8.05 Z" />
                  </svg>
                  <span v-if="countryName" class="text-[10.5px] shrink-0">{{ countryName }}</span>
                </p>
              </section>

              <section v-if="company.jobs && company.jobs.length">
                <h3 class="text-[13.5px] font-semibold text-[#0F172A] mb-2.5">
                  Công việc đang tuyển
                  <span class="text-[#94A3B8] font-normal">({{ company.jobs.length }})</span>
                </h3>
                <ul class="space-y-2">
                  <li
                    v-for="j in company.jobs"
                    :key="j.id"
                    class="rounded-lg border border-[#EEF1F5] bg-white p-3 hover:border-[#1677FF]/40 transition"
                  >
                    <router-link
                      :to="{ name: 'candidate-job-detail', params: { slug: j.slug ?? j.id } }"
                      class="block"
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                          <h4 class="text-[12.5px] font-semibold text-[#0F172A] truncate">
                            {{ j.title }}
                          </h4>
                          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <!-- JobLevel badge — color + icon theo meta -->
                            <span
                              v-if="getJobLevelMeta(j.jobLevel)"
                              :class="['inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium', getJobLevelMeta(j.jobLevel)!.class]"
                            >
                              <component
                                :is="getJobLevelMeta(j.jobLevel)!.icon"
                                class="w-3 h-3 shrink-0"
                              />
                              {{ formatJobLevel(j.jobLevel) }}
                            </span>
                            <!-- JobType badge -->
                            <span
                              v-if="getJobTypeMeta(j.jobType)"
                              :class="['inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium', getJobTypeMeta(j.jobType)!.class]"
                            >
                              <component
                                :is="getJobTypeMeta(j.jobType)!.icon"
                                class="w-3 h-3 shrink-0"
                              />
                              {{ formatJobType(j.jobType) }}
                            </span>
                            <!-- Location badge -->
                            <span
                              v-if="jobLocationCity(j.location)"
                              :class="['inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium', LOCATION_META.class]"
                            >
                              <component
                                :is="LOCATION_META.icon"
                                class="w-3 h-3 shrink-0"
                              />
                              {{ jobLocationCity(j.location) }}
                            </span>
                          </div>
                        </div>
                        <ChevronRight class="w-4 h-4 text-[#CBD5E1] shrink-0 mt-0.5" />
                      </div>
                    </router-link>
                  </li>
                </ul>
              </section>
            </aside>
          </div>
        </div>
        <!-- /Company tab -->
      </main>

      <!-- Apply modal — Teleport to body (bên trong component), v-if="open" tự
           handle ẩn/hiện, KHÔNG cần v-if="job" ở parent vì component đã
           tự guard `:job` undefined khi fetch CV. -->
      <ApplyJob
        :job="job"
        :applied-cv-ids="appliedCvIds"
        v-model:open="applyModalOpen"
        @applied="onApplied"
      />

      <!--
        Quick chat popover — fixed góc dưới phải. Mở từ More menu hoặc khi
        user đã ở trong context chat với employer của job này.
      -->
      <Teleport to="body">
        <Transition name="chat-pop">
          <div
            v-if="chatOpen"
            class="fixed bottom-4 right-6 z-50 w-80 rounded-xl border border-[#EEF1F5] bg-white shadow-xl"
          >
            <header class="flex items-center justify-between px-3 py-2 border-b border-[#EEF1F5]">
              <div class="flex items-center gap-2 min-w-0">
                <div class="h-7 w-7 rounded-full bg-[#F8FAFB] grid place-items-center text-[#0F172A] shrink-0">
                  <span class="text-[10px] font-semibold">{{ companyInitial }}</span>
                </div>
                <p class="text-[12px] font-semibold text-[#0F172A] truncate">
                  {{ job.companyName ?? 'Nhà tuyển dụng' }}
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng"
                class="h-6 w-6 grid place-items-center rounded-md text-[#64748B] hover:bg-[#F8FAFB]"
                @click="toggleChat"
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </header>
            <div class="p-2.5">
              <div v-if="chatAttachments.length > 0" class="flex flex-wrap gap-1.5 mb-2">
                <div
                  v-for="att in chatAttachments"
                  :key="att.id"
                  class="relative rounded-md overflow-hidden border border-[#EEF1F5] group"
                  :class="att.kind === 'image' ? 'h-12 w-12' : 'h-12 min-w-[160px] max-w-[200px] px-2 py-1 bg-[#F8FAFB]'"
                >
                  <template v-if="att.kind === 'image' && att.previewUrl">
                    <img :src="att.previewUrl" :alt="att.file.name" class="h-full w-full object-cover" />
                  </template>
                  <template v-else>
                    <div class="flex items-center gap-1.5 h-full min-w-0">
                      <component
                        :is="fileIconInfo(att.file.type, att.file.name).icon"
                        class="w-3.5 h-3.5 shrink-0"
                        :class="fileIconInfo(att.file.type, att.file.name).color"
                      />
                      <span class="text-[10px] font-medium text-[#0F172A] truncate flex-1 min-w-0">
                        {{ att.file.name }}
                      </span>
                      <span class="text-[9px] text-[#64748B] shrink-0">{{ formatFileSize(att.file.size) }}</span>
                    </div>
                  </template>
                  <button
                    type="button"
                    aria-label="Xoá file"
                    class="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                    @click="removeMiniAttachment(att.id)"
                  >
                    <X class="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
              <div class="flex items-start gap-1.5">
                <button
                  type="button"
                  :disabled="chatSending || uploadingImage"
                  aria-label="Đính kèm file"
                  class="shrink-0 w-9 h-9 rounded-lg bg-[#F8FAFB] hover:bg-[#EEF1F5] text-[#64748B] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition"
                  @click="onMiniPickFile"
                >
                  <ImagePlus class="w-3.5 h-3.5" />
                </button>
                <input
                  ref="miniFileInputEl"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,application/zip"
                  multiple
                  class="hidden"
                  @change="onMiniFileInputChange"
                />
                <textarea
                  v-model="chatDraft"
                  :disabled="chatSending || uploadingImage"
                  :maxlength="500"
                  rows="2"
                  placeholder="Nhắn nhanh cho nhà tuyển dụng... (có thể paste ảnh)"
                  class="flex-1 text-xs border border-[#EEF1F5] rounded-lg px-2.5 py-2 focus:border-[#1677FF] focus:ring-1 focus:ring-[#1677FF] outline-none resize-none disabled:opacity-50 disabled:bg-[#F8FAFB]"
                  @keydown.enter.exact.prevent="sendChat"
                  @paste="onMiniPaste"
                />
                <button
                  type="button"
                  aria-label="Gửi tin nhắn"
                  class="shrink-0 inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-semibold rounded-lg bg-[#1677FF] hover:bg-[#0E5FD9] text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="chatSending || uploadingImage || (!chatDraft.trim() && chatAttachments.length === 0)"
                  @click="sendChat"
                >
                  <Loader2 v-if="chatSending || uploadingImage" class="w-3.5 h-3.5 animate-spin" />
                  <Send v-else class="w-3.5 h-3.5" />
                </button>
              </div>
              <p class="mt-1 text-[10px] text-[#94A3B8] text-right">
                {{ chatDraft.length }}/500 · Enter để gửi
              </p>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
/* Dropdown "More" — fade + slide nhẹ. */
.more-enter-active,
.more-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.more-enter-from,
.more-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Quick chat popover — slide-up + fade. */
.chat-pop-enter-active,
.chat-pop-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.chat-pop-enter-from,
.chat-pop-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
