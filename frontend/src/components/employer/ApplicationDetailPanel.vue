<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  Mail,
  Phone,
  User,
  Sparkles,
  Calendar,
  ArrowRight,
  RefreshCw,
  Loader2,
  Check,
  Flag,
  Eye,
  FileText,
  ExternalLink,
  Download,
  AlertCircle,
  Inbox,
  X,
} from 'lucide-vue-next';
import { applicationApi } from '@services/application.api';
import { cvApi } from '@services/cv.api';
import { getSocket } from '@services/socket';
import { extractErrorMessage, extractErrorCode } from '@services/http';
import { useToastStore } from '@stores/toast';
import ReferencesModal from '@components/employer/ReferencesModal.vue';
import AiTestReviewModal from '@components/employer/AiTestReviewModal.vue';
import AiTestResultModal from '@components/employer/AiTestResultModal.vue';
import {
  aiTestApi,
  type AiTestSummary,
  type TestAssignmentRow,
  type AiTestDetail,
  type AiTestType,
  type AssignmentDetail,
} from '@services/aiTest.api';
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue';
import CvDetailView from '@components/cv/CvDetailView.vue';
import { buildRenderData } from '@/composables/cvRenderData';
import { clampTemplateId } from '@/utils/cvTemplates';
import { formatDate } from '@/utils/format';
import type { Cv } from '@/types/cv';
import type {
  ApplicationDetail,
  ApplicationItem,
  ApplicationStatus,
} from '@/types/application';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';

dayjs.locale('vi');

const props = defineProps<{
  application: ApplicationItem | null;
  isScoring?: boolean;
}>();

const emit = defineEmits<{
  'status-changed': [payload: { applicationId: string; status: ApplicationStatus; stage?: string | null }];
  'recompute-match': [applicationId: string];
  'close': [];
}>();

const toast = useToastStore();

const avatarInitial = (name: string): string => {
  const t = name.trim();
  return t ? t.charAt(0).toLocaleUpperCase('vi-VN') : '?';
};

// ---------------------------------------------------------------------------
// AI match ring & score animation
// ---------------------------------------------------------------------------
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

const RING_RADIUS = 24;
const RING_STROKE = 4;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const ringOffset = computed(
  () => RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, props.application?.match ?? 0)) / 100),
);

const animatedMatch = ref(0);
let countRaf: number | null = null;

const animateCount = (target: number): void => {
  if (countRaf !== null) cancelAnimationFrame(countRaf);
  const start = performance.now();
  const duration = 1200;
  const from = 0;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    animatedMatch.value = Math.round(from + (target - from) * eased);
    if (t < 1) {
      countRaf = requestAnimationFrame(step);
    } else {
      countRaf = null;
    }
  };
  countRaf = requestAnimationFrame(step);
};

watch(
  () => props.application?.match,
  (m) => animateCount(m ?? 0),
  { immediate: true },
);

// ---------------------------------------------------------------------------
// Retry AI match
// ---------------------------------------------------------------------------
const recomputing = ref(false);

const recomputeMatch = async (): Promise<void> => {
  const appId = props.application?.applicationId;
  if (!appId || appId.startsWith('mock-app-')) return;
  recomputing.value = true;
  try {
    await applicationApi.recomputeMatch(appId);
    if (detailData.value?.id === appId) {
      detailData.value.aiMatchScore = null;
      detailData.value.aiMatchReasoning = null;
    }
    emit('recompute-match', appId);
    toast.push({
      variant: 'info',
      title: 'Đang chấm lại AI match',
      body: 'Điểm sẽ tự cập nhật khi xong (trừ quota ai_cv_match của candidate).',
    });
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Chấm lại thất bại',
      body: extractErrorMessage(e, 'Vui lòng thử lại.'),
    });
  } finally {
    recomputing.value = false;
  }
};

// ---------------------------------------------------------------------------
// Detail data & skills
// ---------------------------------------------------------------------------
interface CvParsedShape {
  name?: string;
  email?: string;
  phone?: string;
  github?: string;
  skills?: Array<string | { name?: string; level?: number }>;
}

const MOCK_SKILLS = ['Figma', 'Design Systems', 'UX Research', 'Prototyping', 'User Flow', 'Wireframing'];
const skills = ref<string[]>(MOCK_SKILLS);
const detailLoading = ref(false);
let detailReqSeq = 0;

const SKILL_VISIBLE_MAX = 6;
const skillsExpanded = ref(false);
const visibleSkills = computed(() =>
  skillsExpanded.value ? skills.value : skills.value.slice(0, SKILL_VISIBLE_MAX),
);
const hiddenSkillsCount = computed(() => Math.max(0, skills.value.length - SKILL_VISIBLE_MAX));

watch(skills, () => {
  skillsExpanded.value = false;
});

const parsedData = ref<CvParsedShape | null>(null);
const detailData = ref<ApplicationDetail | null>(null);

const loadDetail = async (appId?: string): Promise<void> => {
  if (!appId || appId.startsWith('mock-app-')) {
    detailData.value = null;
    parsedData.value = null;
    skills.value = MOCK_SKILLS;
    return;
  }
  const seq = ++detailReqSeq;
  detailLoading.value = true;
  try {
    const { data } = await applicationApi.getById(appId);
    if (seq !== detailReqSeq) return;
    const detail: ApplicationDetail = data.data;
    detailData.value = detail;
    const parsed = (detail.cv?.parsedData ?? null) as CvParsedShape | null;
    if (parsed) parsedData.value = parsed;
    const cvSkills = Array.isArray(parsed?.skills)
      ? parsed!.skills!
          .map((s) => (typeof s === 'string' ? s : (s?.name ?? '').trim()))
          .filter((s) => s.length > 0)
      : [];
    if (cvSkills.length > 0) skills.value = cvSkills;
  } catch {
    if (seq === detailReqSeq) detailLoading.value = false;
  } finally {
    if (seq === detailReqSeq) detailLoading.value = false;
  }
};

watch(
  () => props.application?.applicationId,
  (newId) => void loadDetail(newId),
  { immediate: true },
);

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
type TabKey = 'Tổng quan' | 'Thư' | 'CV' | 'So khớp';
const activeTab = ref<TabKey>('Tổng quan');
const tabs: TabKey[] = ['Tổng quan', 'Thư', 'CV', 'So khớp'];
const gotoActiveTab = (tab: TabKey): void => {
  activeTab.value = tab;
};

const aiReasoning = computed(() => detailData.value?.aiMatchReasoning ?? null);
const coverLetter = computed(() => detailData.value?.coverLetter ?? null);

// ---------------------------------------------------------------------------
// References modal
// ---------------------------------------------------------------------------
const referencesOpen = ref(false);
const canOpenReferences = computed(() => {
  const id = props.application?.applicationId;
  return !!id && !id.startsWith('mock-app-');
});

// ---------------------------------------------------------------------------
// Status actions & labels
// ---------------------------------------------------------------------------
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

const currentStatus = computed<ApplicationStatus>(() => props.application?.status ?? 'pending');
const selectedStatusLabel = computed(() => STATUS_LABEL[currentStatus.value] ?? currentStatus.value);
const selectedStatusChip = computed(() => STATUS_CHIP[currentStatus.value] ?? { bg: 'bg-[#eef0f2]', text: 'text-[#64748b]' });

const nextAction = computed<{ label: string; next: ApplicationStatus } | null>(() => {
  switch (currentStatus.value) {
    case 'pending':
    case 'viewed':
      return { label: 'Đưa vào sàng lọc', next: 'screening' };
    case 'screening':
      return { label: 'Mời Phỏng vấn', next: 'interview' };
    case 'interview':
      return { label: 'Gửi Offer', next: 'offered' };
    case 'offered':
      return { label: 'Hire', next: 'hired' };
    default:
      return null;
  }
});

const updatingStatus = ref(false);

const changeStatus = async (next: ApplicationStatus): Promise<void> => {
  const appId = props.application?.applicationId;
  if (!appId || appId.startsWith('mock-app-')) return;
  const previousStatus = currentStatus.value;
  updatingStatus.value = true;
  try {
    await applicationApi.updateStatus(appId, { status: next });
    if (detailData.value?.id === appId) detailData.value.status = next;
    emit('status-changed', { applicationId: appId, status: next });
    toast.push({
      variant: 'success',
      title: 'Cập nhật thành công',
      body: next === 'screening' && previousStatus === 'rejected'
        ? 'Đã đưa đơn ứng tuyển trở lại giai đoạn Sàng lọc.'
        : `Đã chuyển trạng thái sang ${STATUS_LABEL[next] ?? next}.`,
    });
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Cập nhật trạng thái thất bại',
      body: extractErrorMessage(e, 'Vui lòng thử lại.'),
    });
  } finally {
    updatingStatus.value = false;
  }
};

// ---------------------------------------------------------------------------
// AI test (Phase 3)
// ---------------------------------------------------------------------------
const aiTestLoading = ref(false);
const aiTestReviewLoading = ref(false);
const assigningTest = ref(false);
const jobTests = ref<AiTestSummary[]>([]);
const assignments = ref<TestAssignmentRow[]>([]);
const reviewOpen = ref(false);
const reviewTest = ref<AiTestDetail | null>(null);

const resultOpen = ref(false);
const resultLoading = ref(false);
const resultDetail = ref<AssignmentDetail | null>(null);

const openResult = async (assignmentId: string): Promise<void> => {
  resultOpen.value = true;
  resultLoading.value = true;
  try {
    const { data } = await aiTestApi.getAssignmentDetail(assignmentId);
    resultDetail.value = data.data;
  } catch (e) {
    resultOpen.value = false;
    toast.push({
      variant: 'error',
      title: 'Không tải được bài làm',
      body: extractErrorMessage(e, 'Vui lòng thử lại.'),
    });
  } finally {
    resultLoading.value = false;
  }
};

let aiTestPollTimer: ReturnType<typeof setInterval> | null = null;
const awaitingTestId = ref<string | null>(null);

const loadAiTestData = async (): Promise<void> => {
  const detail = detailData.value;
  if (!detail?.jobId) return;
  try {
    const [testsRes, assignRes] = await Promise.all([
      aiTestApi.listForJob(detail.jobId),
      aiTestApi.listAssignments(detail.id),
    ]);
    jobTests.value = testsRes.data.data;
    assignments.value = assignRes.data.data;
  } catch {
    // best-effort
  }
};

const isScreeningOrLater = computed(() => {
  const s = props.application?.status;
  return !!s && s !== 'pending' && s !== 'viewed';
});

watch(
  [() => detailData.value?.jobId, isScreeningOrLater],
  ([jobId, showTest]) => {
    if (jobId && showTest) void loadAiTestData();
  },
  { immediate: true },
);

const readyTestFor = (type: AiTestType): AiTestSummary | undefined =>
  jobTests.value.find((t) => t.testType === type && t.status === 'ready');

const generatingTestFor = (type: AiTestType): AiTestSummary | undefined =>
  jobTests.value.find((t) => t.testType === type && t.status === 'generating');

const openReview = async (testId: string): Promise<void> => {
  aiTestReviewLoading.value = true;
  reviewOpen.value = true;
  try {
    const { data } = await aiTestApi.getDetail(testId);
    reviewTest.value = data.data;
  } catch (e) {
    reviewOpen.value = false;
    toast.push({
      variant: 'error',
      title: 'Không tải được đề',
      body: extractErrorMessage(e, 'Vui lòng thử lại.'),
    });
  } finally {
    aiTestReviewLoading.value = false;
  }
};

const startTest = async (type: AiTestType): Promise<void> => {
  const detail = detailData.value;
  if (!detail || aiTestLoading.value) return;
  const ready = readyTestFor(type);
  if (ready) {
    void openReview(ready.id);
    return;
  }
  aiTestLoading.value = true;
  try {
    const { data } = await aiTestApi.generate(detail.jobId, type);
    const gen = data.data;
    if (gen.status === 'ready') {
      await openReview(gen.testId);
      return;
    }
    jobTests.value = [
      ...jobTests.value.filter((t) => t.id !== gen.testId),
      {
        id: gen.testId,
        testType: type,
        level: null,
        status: 'generating',
        totalPoints: null,
        durationMin: null,
        questionCount: 0,
        createdAt: new Date().toISOString(),
      },
    ];
    awaitingTestId.value = gen.testId;
    const started = Date.now();
    if (aiTestPollTimer) clearInterval(aiTestPollTimer);
    aiTestPollTimer = setInterval(() => {
      if (Date.now() - started > 90_000) {
        clearInterval(aiTestPollTimer!);
        aiTestPollTimer = null;
        return;
      }
      void aiTestApi
        .listForJob(detail.jobId)
        .then(async ({ data }) => {
          jobTests.value = data.data;
          const t = data.data.find((x) => x.id === gen.testId);
          if (t?.status === 'ready') {
            if (aiTestPollTimer) clearInterval(aiTestPollTimer);
            aiTestPollTimer = null;
            await openReview(gen.testId);
          } else if (t?.status === 'failed') {
            if (aiTestPollTimer) clearInterval(aiTestPollTimer);
            aiTestPollTimer = null;
            toast.push({ variant: 'error', title: 'Sinh đề thất bại', body: 'Bấm "Giao bài" để thử lại.' });
          }
        })
        .catch(() => {/* keep polling */});
    }, 4000);
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Tạo đề thất bại',
      body: extractErrorMessage(e, 'Vui lòng thử lại.'),
    });
  } finally {
    aiTestLoading.value = false;
  }
};

const assignTestToCandidate = async (): Promise<void> => {
  const detail = detailData.value;
  const test = reviewTest.value;
  if (!detail || !test || assigningTest.value || props.application?.status !== 'screening') return;
  assigningTest.value = true;
  try {
    await aiTestApi.assign(detail.id, test.id);
    toast.push({
      variant: 'success',
      title: 'Đã gửi bài test',
      body: 'Email link làm bài đang được gửi qua n8n. Stage tự chuyển sang bài test.',
    });
    reviewOpen.value = false;
    await loadAiTestData();
  } catch (e) {
    const code = extractErrorCode(e);
    toast.push({
      variant: 'error',
      title: 'Gửi bài test thất bại',
      body: `${extractErrorMessage(e, 'Vui lòng thử lại.')}${code ? ` [${code}]` : ''}`,
    });
  } finally {
    assigningTest.value = false;
  }
};

const onAiTestReady = (payload: { testId?: string; testType?: AiTestType }): void => {
  if (!payload?.testId) return;
  jobTests.value = jobTests.value.map((t) =>
    t.id === payload.testId ? { ...t, status: 'ready' as const } : t,
  );
  if (awaitingTestId.value === payload.testId) {
    awaitingTestId.value = null;
    if (aiTestPollTimer) {
      clearInterval(aiTestPollTimer);
      aiTestPollTimer = null;
    }
    void openReview(payload.testId);
  }
};

const onAiTestGraded = (payload: { applicationId?: string }): void => {
  if (payload?.applicationId === props.application?.applicationId) {
    void loadAiTestData();
  }
};

// ---------------------------------------------------------------------------
// CV Preview & Lightbox
// ---------------------------------------------------------------------------
const cvSnapshot = computed(() => detailData.value?.cv ?? null);
const cvFileUrl = computed(() => cvSnapshot.value?.url ?? null);
const cvTemplateId = computed(() => clampTemplateId(cvSnapshot.value?.template));
const cvRenderData = computed(() => {
  const snap = cvSnapshot.value;
  if (!snap || cvFileUrl.value) return null;
  return buildRenderData({
    parsedData: (snap.parsedData ?? null) as Record<string, unknown> | null,
    title: snap.title,
  });
});
const cvIsPdf = computed(() => !!cvFileUrl.value && /\.pdf(\?|#|$)/i.test(cvFileUrl.value));

const cvLightboxOpen = ref(false);
const downloadingPdf = ref(false);

const downloadCvPdf = async (): Promise<void> => {
  const cvId = detailData.value?.cvId;
  if (!cvId || downloadingPdf.value) return;
  downloadingPdf.value = true;
  try {
    const res = await cvApi.downloadPdf(cvId);
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(cvSnapshot.value?.title?.trim() || 'cv').replace(/\s+/g, '-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Tải PDF thất bại',
      body: extractErrorMessage(e, 'Vui lòng thử lại sau.'),
    });
  } finally {
    downloadingPdf.value = false;
  }
};

const cvForLightbox = computed<Cv | null>(() => {
  const snap = cvSnapshot.value;
  if (!snap) return null;
  const url = snap.url ?? '';
  const appliedAt = detailData.value?.appliedAt ?? new Date().toISOString();
  return {
    id: detailData.value?.id ?? 'cv-snapshot',
    candidateId: snap.candidateId,
    title: snap.title,
    fileUrl: snap.url,
    fileType: url ? (/\.pdf(\?|#|$)/i.test(url) ? 'application/pdf' : null) : null,
    isPrimary: false,
    status: 'ready',
    source: url ? 'upload' : 'direct',
    templateId: snap.template,
    parsedData: (snap.parsedData ?? null) as Record<string, unknown> | null,
    ai_analysis: null,
    failureReason: null,
    scoreUpdatedAt: null,
    createdAt: appliedAt,
    updatedAt: appliedAt,
  };
});

const cvWrapEl = ref<HTMLElement | null>(null);
const cvInnerEl = ref<HTMLElement | null>(null);
const cvScale = ref(1);
const cvInnerH = ref(0);
let cvRO: ResizeObserver | null = null;

const measureCv = (): void => {
  if (cvWrapEl.value) {
    const w = cvWrapEl.value.clientWidth;
    if (w > 0) cvScale.value = w / 794;
  }
  if (cvInnerEl.value) cvInnerH.value = cvInnerEl.value.offsetHeight;
};

watch([activeTab, cvSnapshot], () => {
  if (activeTab.value !== 'CV') return;
  void nextTick(() => {
    measureCv();
    cvRO?.disconnect();
    cvRO = new ResizeObserver(measureCv);
    if (cvWrapEl.value) cvRO.observe(cvWrapEl.value);
    if (cvInnerEl.value) cvRO.observe(cvInnerEl.value);
  });
});

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------
const onStatusChanged = (payload: { applicationId?: string; status?: ApplicationStatus; stage?: string | null }): void => {
  if (!payload?.applicationId || payload.applicationId !== props.application?.applicationId) return;
  if (detailData.value?.id === payload.applicationId) {
    if (payload.status) detailData.value.status = payload.status;
    detailData.value.stage = payload.stage ?? null;
  }
};

const onApplicationScored = (payload: { applicationId?: string; matchPercent?: number }): void => {
  if (payload?.applicationId && payload.applicationId === props.application?.applicationId) {
    void applicationApi
      .getById(payload.applicationId)
      .then(({ data }) => { detailData.value = data.data; })
      .catch(() => {/* best-effort */});
  }
};

onMounted(() => {
  getSocket().on('ai-test:ready', onAiTestReady);
  getSocket().on('ai-test:graded', onAiTestGraded);
  getSocket().on('application:status-changed', onStatusChanged);
  getSocket().on('application:scored', onApplicationScored);
});

onUnmounted(() => {
  if (countRaf !== null) cancelAnimationFrame(countRaf);
  if (aiTestPollTimer) clearInterval(aiTestPollTimer);
  cvRO?.disconnect();
  cvRO = null;
  getSocket().off('ai-test:ready', onAiTestReady);
  getSocket().off('ai-test:graded', onAiTestGraded);
  getSocket().off('application:status-changed', onStatusChanged);
  getSocket().off('application:scored', onApplicationScored);
});

defineExpose({
  reload: () => loadDetail(props.application?.applicationId),
});
</script>

<template>
  <aside class="w-full lg:w-[32%] lg:min-w-[390px] lg:max-w-[500px] lg:shrink-0 border-t lg:border-t-0 lg:border-l border-[#e9edf3] bg-white p-0 overflow-y-auto overflow-x-hidden scrollbar-thin">
    <div class="border-none bg-white lg:min-w-[390px]">
      <!-- Empty state khi chưa chọn application -->
      <div v-if="!application || !application.applicationId" class="p-8 text-center text-[#94a3b8]">
        <Inbox class="w-10 h-10 mx-auto mb-2 text-[#cbd5e1]" />
        <p class="text-[13px]">Vui lòng chọn một đơn ứng tuyển để xem chi tiết.</p>
      </div>

      <template v-else>
        <!-- Header block -->
        <div class="relative border-b border-[#edf0f4] px-5 pt-5 pb-5">
          <!-- Close button -->
          <button
            type="button"
            class="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#334155] transition"
            title="Đóng chi tiết"
            aria-label="Đóng chi tiết ứng viên"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>

          <!-- Row 1: Avatar + identity -->
          <div class="flex items-center gap-4 pr-12">
            <div
              class="relative h-20 w-20 shrink-0 rounded-xl overflow-hidden bg-gradient-to-br from-primary-50 to-primary-100 ring-4 ring-[#f1f4f8]"
              :aria-label="application.name"
            >
              <img
                v-if="application.avatarUrl"
                :src="application.avatarUrl"
                :alt="application.name"
                class="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
                @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
              />
              <span
                v-else
                class="absolute inset-0 grid place-items-center text-primary-700 font-bold text-[28px]"
              >
                {{ avatarInitial(application.name) }}
              </span>
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="text-[22px] font-bold leading-tight truncate">
                {{ application.name }}
              </h2>
              <div class="mt-2 flex items-center gap-2 min-w-0">
                <div class="min-w-0">
                  <div class="text-[13px] font-semibold truncate">{{ application.position }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Row 2: Match Score -->
          <div class="mt-5 flex items-center gap-3 rounded-xl bg-[#f8fafc] p-3">
            <div class="relative h-14 w-14 shrink-0">
              <svg
                class="absolute inset-0 -rotate-90"
                width="56"
                height="56"
                viewBox="0 0 56 56"
                aria-hidden="true"
              >
                <!-- Track -->
                <circle
                  cx="28"
                  cy="28"
                  :r="RING_RADIUS"
                  fill="none"
                  stroke="#e3e8ef"
                  :stroke-width="RING_STROKE"
                />
                <!-- Progress ring -->
                <circle
                  :key="`${application.applicationId}-${application.match}`"
                  cx="28"
                  cy="28"
                  :r="RING_RADIUS"
                  fill="none"
                  :stroke="MATCH_LEVEL_STYLE[matchLevelOf(animatedMatch)].ring"
                  :stroke-width="RING_STROKE"
                  stroke-linecap="round"
                  :stroke-dasharray="RING_CIRCUMFERENCE"
                  :stroke-dashoffset="ringOffset"
                  :style="{ '--ring-target': ringOffset }"
                  class="match-ring"
                />
              </svg>
              <div
                class="absolute inset-0 grid place-items-center text-[12px] font-bold tabular-nums"
                :class="isScoring || application.match === null ? 'text-[#94a3b8]' : MATCH_LEVEL_STYLE[matchLevelOf(animatedMatch)].text"
              >
                <Loader2 v-if="isScoring" class="h-4 w-4 animate-spin" />
                <span v-else-if="application.match === null">—</span>
                <span v-else>{{ animatedMatch }}%</span>
              </div>
            </div>
            <div class="min-w-0">
              <div class="text-[10px] text-[#94a3b8]">Match Score</div>
              <div
                class="text-[12px] font-semibold"
                :class="isScoring || application.match === null ? 'text-[#94a3b8]' : MATCH_LEVEL_STYLE[matchLevelOf(animatedMatch)].text"
              >
                <span v-if="isScoring">Đang chấm…</span>
                <span v-else-if="application.match === null">Chưa có điểm</span>
                <span v-else>{{ MATCH_LEVEL_STYLE[matchLevelOf(animatedMatch)].label }}</span>
              </div>
            </div>
            <button
              type="button"
              class="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#e3e8ef] bg-white text-[#64748b] transition hover:border-[#cfe0ff] hover:text-[#1769e8] disabled:opacity-40 disabled:cursor-not-allowed"
              title="Chấm lại điểm AI match"
              :disabled="recomputing || !canOpenReferences"
              @click="recomputeMatch"
            >
              <RefreshCw class="h-3.5 w-3.5" :class="recomputing ? 'animate-spin' : ''" />
            </button>
          </div>

          <!-- Tabs -->
          <div class="mt-3 flex gap-6 text-[12px] font-medium text-[#64748b]">
            <button
              v-for="t in tabs"
              :key="t"
              type="button"
              class="border-b-2 transition"
              :class="activeTab === t ? 'border-[#1769e8] text-[#1769e8]' : 'border-transparent'"
              @click="gotoActiveTab(t)"
            >{{ t }}</button>
          </div>
        </div>

        <!-- Body content -->
        <div class="p-5">
          <!-- Tab 1: Tổng quan -->
          <div v-show="activeTab === 'Tổng quan'" class="space-y-4">
            <h3 class="text-[13px] font-semibold">Tổng quan</h3>
            <div class="rounded-xl border border-[#e8edf3] p-4">
              <div class="grid grid-cols-2 gap-y-4 text-[11px] text-[#64748b]">
                <div class="space-y-3">
                  <div class="flex gap-2 items-center truncate">
                    <Mail class="h-4 w-4 shrink-0" />
                    <span class="truncate">{{ parsedData?.email ?? application.email }}</span>
                  </div>
                  <div class="flex gap-2 items-center truncate">
                    <Phone class="h-4 w-4 shrink-0" />
                    <span class="truncate">{{ parsedData?.phone ?? 'Chưa cập nhật' }}</span>
                  </div>
                  <div class="flex gap-2 items-center truncate">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0">
                      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                      <path d="M9 18c-4.51 2-5-2-7-2.5" />
                    </svg>
                    <a
                      v-if="parsedData?.github"
                      :href="parsedData.github"
                      target="_blank"
                      rel="noopener"
                      class="truncate text-[#1e40af] hover:underline"
                    >{{ parsedData.github }}</a>
                    <span v-else class="truncate text-[#94a3b8]">Chưa cập nhật GitHub</span>
                  </div>
                  <div class="flex gap-2 items-center truncate">
                    <User class="h-4 w-4 shrink-0" />
                    <span class="truncate">{{ parsedData?.name ?? application.name }}</span>
                  </div>
                </div>
                <div class="border-l border-[#edf0f4] pl-5">
                  <div class="text-[10px] text-[#94a3b8]">Source</div>
                  <div class="mt-1 font-semibold text-[#334155]">JobMatch</div>
                  <div class="mt-5 text-[10px] text-[#94a3b8]">Applied</div>
                  <div class="mt-1 font-semibold text-[#334155]">{{ formatDate(application.date) }}</div>
                </div>
              </div>
            </div>

            <!-- Skills -->
            <div>
              <h3 class="mb-2 text-[13px] font-semibold">Kỹ năng</h3>
              <div class="flex flex-wrap gap-2">
                <span v-for="s in visibleSkills" :key="s" class="pill">{{ s }}</span>
                <button
                  v-if="!skillsExpanded && hiddenSkillsCount > 0"
                  type="button"
                  class="pill hover:bg-[#eef2ff] cursor-pointer"
                  :title="`Xem thêm ${hiddenSkillsCount} skills`"
                  @click="skillsExpanded = true"
                >+{{ hiddenSkillsCount }}</button>
                <button
                  v-else-if="skillsExpanded && skills.length > SKILL_VISIBLE_MAX"
                  type="button"
                  class="pill hover:bg-[#eef2ff] cursor-pointer"
                  title="Thu gọn"
                  @click="skillsExpanded = false"
                >−</button>
                <span v-if="detailLoading" class="pill text-[#94a3b8]">…</span>
              </div>
            </div>

            <!-- AI rationale -->
            <div class="rounded-xl border border-[#cfe0ff] bg-[#eef5ff] p-4">
              <div class="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#1769e8]">
                <Sparkles class="h-4 w-4" /> Nhận xét từ AI
              </div>
              <p class="text-[11px] leading-5 text-[#53657d]">
                {{ aiReasoning?.rationale ?? 'AI chưa chấm điểm ứng viên này, vui lòng quay lại sau.' }}
              </p>
            </div>

            <!-- Bài test sàng lọc -->
            <div
              v-if="isScreeningOrLater && canOpenReferences"
              class="rounded-xl border border-[#e6ebf1] p-4"
            >
              <div class="flex items-center justify-between">
                <div class="text-[12px] font-semibold">Bài test sàng lọc</div>
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-md border border-[#e3e8ef] text-[#64748b] transition hover:border-[#cfe0ff] hover:text-[#1769e8]"
                  title="Làm mới trạng thái bài test"
                  @click="loadAiTestData"
                >
                  <RefreshCw class="h-3 w-3" />
                </button>
              </div>
              <p class="mt-1 text-[10px] text-[#94a3b8]">
                Đề theo job — sinh 1 lần, dùng chung cho mọi ứng viên. Chọn loại test:
              </p>
              <div class="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  :disabled="aiTestLoading || !!generatingTestFor('iq')"
                  class="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[#dce4ef] bg-white text-[11px] font-semibold text-[#1769e8] transition hover:bg-[#eef5ff] disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="startTest('iq')"
                >
                  <Loader2
                    v-if="aiTestLoading || generatingTestFor('iq')"
                    class="h-3.5 w-3.5 animate-spin"
                  />
                  {{
                    generatingTestFor('iq')
                      ? 'Đang tạo đề…'
                      : readyTestFor('iq')
                        ? 'Review đề IQ'
                        : 'Tạo đề IQ'
                  }}
                </button>
                <button
                  type="button"
                  :disabled="aiTestLoading || !!generatingTestFor('english')"
                  class="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[#dce4ef] bg-white text-[11px] font-semibold text-[#1769e8] transition hover:bg-[#eef5ff] disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="startTest('english')"
                >
                  <Loader2
                    v-if="aiTestLoading || generatingTestFor('english')"
                    class="h-3.5 w-3.5 animate-spin"
                  />
                  {{
                    generatingTestFor('english')
                      ? 'Đang tạo đề…'
                      : readyTestFor('english')
                        ? 'Review đề English'
                        : 'Tạo đề English'
                  }}
                </button>
              </div>

              <!-- Assignments đã gửi / đã nộp -->
              <ul v-if="assignments.length" class="mt-3 space-y-2">
                <li
                  v-for="a in assignments"
                  :key="a.id"
                  class="flex items-center gap-2 rounded-lg bg-[#f8fafc] px-3 py-2 text-[11px]"
                >
                  <span class="font-medium text-[#334155]">
                    {{ a.testType === 'iq' ? 'IQ' : 'English' }}
                  </span>
                  <span
                    v-if="a.status === 'submitted'"
                    class="font-semibold"
                    :class="Number(a.score) >= 60 ? 'text-emerald-700' : 'text-amber-700'"
                  >
                    Đã nộp — {{ a.score }}%
                  </span>
                  <span v-else-if="a.status === 'in_progress'" class="text-[#64748b]">
                    Đang làm bài — hạn {{ a.expiresAt ? dayjs(a.expiresAt).format('DD/MM') : '—' }}
                  </span>
                  <span v-else-if="a.status === 'sent'" class="text-[#64748b]">
                    Đã gửi — hạn {{ a.expiresAt ? dayjs(a.expiresAt).format('DD/MM') : '—' }}
                  </span>
                  <span v-else-if="a.status === 'pending'" class="text-amber-700">
                    Chờ gửi email (n8n chưa gửi được — bấm giao lại)
                  </span>
                  <span v-else class="text-[#94a3b8]">{{ a.status }}</span>
                  <span
                    v-if="a.flags?.length"
                    class="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                    :title="a.flags.join(', ')"
                  >
                    ⚠ nghi ngờ
                  </span>
                  <button
                    v-if="a.status === 'submitted'"
                    type="button"
                    class="ml-auto text-[10.5px] font-semibold text-[#1769e8] underline underline-offset-2 transition hover:text-[#0f5ccc]"
                    @click="openResult(a.id)"
                  >
                    Xem bài làm
                  </button>
                </li>
              </ul>
            </div>

            <!-- Giai đoạn chi tiết & Bước tiếp theo -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="rounded-xl border border-[#e6ebf1] p-4">
                <div class="text-[12px] font-semibold">Giai đoạn chi tiết</div>
                <p class="mt-1 text-[10px] text-[#94a3b8]">
                  Trạng thái: <span class="font-medium" :class="selectedStatusChip.text">{{ selectedStatusLabel }}</span>
                </p>
                <div class="mt-2.5">
                  <span
                    v-if="detailData?.stage"
                    class="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1.5 text-[11px] font-medium text-gray-700"
                  >
                    <Flag class="h-3 w-3" /> {{ detailData.stage }}
                  </span>
                  <span v-else class="text-[11px] italic text-[#94a3b8]">Chưa có giai đoạn chi tiết</span>
                </div>
              </div>
              <div class="rounded-xl border border-[#e6ebf1] p-4">
                <div class="text-[12px] font-semibold">Bước tiếp theo</div>

                <template v-if="application.status === 'pending' || application.status === 'viewed'">
                  <p class="mt-1.5 text-[11px] leading-4 text-[#64748b]">
                    Duyệt hồ sơ rồi chuyển sang Sàng lọc để bắt đầu đánh giá.
                  </p>
                  <button
                    type="button"
                    :disabled="updatingStatus || !canOpenReferences"
                    class="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[#1769e8] text-[11px] font-semibold text-white transition hover:bg-[#0f5ccc] disabled:opacity-40 disabled:cursor-not-allowed"
                    @click="changeStatus('screening')"
                  >
                    <ArrowRight class="h-3.5 w-3.5" /> Chuyển Screening
                  </button>
                </template>

                <template v-else-if="application.status === 'screening'">
                  <p class="mt-1.5 text-[11px] leading-4 text-[#64748b]">
                    Công cụ sàng lọc ứng viên.
                  </p>
                  <button
                    type="button"
                    :disabled="!canOpenReferences"
                    class="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[#1769e8] text-[11px] font-semibold text-white transition hover:bg-[#0f5ccc] disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Gửi email xác minh người tham chiếu"
                    @click="referencesOpen = true"
                  >
                    Xác minh tham chiếu
                  </button>
                </template>

                <template v-else-if="application.status === 'interview'">
                  <p class="mt-1.5 text-[11px] leading-4 text-[#64748b]">
                    Theo dõi lịch phỏng vấn ở trang Interviews.
                  </p>
                  <div
                    class="mt-2.5 flex h-9 w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#dce4ef] text-[11px] font-medium text-[#94a3b8]"
                    title="Tích hợp lịch phỏng vấn vào panel — sắp ra mắt"
                  >
                    <Calendar class="h-3.5 w-3.5" /> Lên lịch phỏng vấn — sắp ra mắt
                  </div>
                </template>

                <template v-else-if="application.status === 'offered'">
                  <p class="mt-1.5 text-[11px] leading-4 text-[#64748b]">
                    Offer đã gửi — chờ ứng viên phản hồi, sau đó bấm Hire.
                  </p>
                </template>

                <template v-else-if="application.status === 'rejected'">
                  <p class="mt-1.5 text-[11px] leading-4 text-[#64748b]">
                    Đơn đã bị từ chối. Bạn có thể đưa lại vào quy trình sàng lọc để tiếp tục đánh giá.
                  </p>
                  <button
                    type="button"
                    :disabled="updatingStatus || !canOpenReferences"
                    class="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[#1769e8] text-[11px] font-semibold text-white transition hover:bg-[#0f5ccc] disabled:opacity-40 disabled:cursor-not-allowed"
                    @click="changeStatus('screening')"
                  >
                    <Loader2 v-if="updatingStatus" class="h-3.5 w-3.5 animate-spin" />
                    <RefreshCw v-else class="h-3.5 w-3.5" />
                    Đưa lại vào sàng lọc
                  </button>
                </template>

                <template v-else>
                  <p class="mt-1.5 text-[11px] leading-4 text-[#64748b]">
                    Đơn đã ở trạng thái cuối — không còn bước tiếp theo.
                  </p>
                </template>
              </div>
            </div>
          </div>

          <!-- Tab 2: Thư xin việc -->
          <div v-show="activeTab == 'Thư'" class="space-y-3">
            <h3 class="text-[13px] font-semibold">Thư xin việc</h3>
            <div
              v-if="coverLetter"
              class="rounded-xl border border-[#e8edf3] p-4 text-[12.5px] leading-relaxed text-[#334155] whitespace-pre-wrap break-words"
            >
              {{ coverLetter }}
            </div>
            <div
              v-else
              class="rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-6 flex flex-col items-center justify-center text-center"
            >
              <Inbox class="w-8 h-8 text-[#94a3b8] mb-2" />
              <p class="text-[12.5px] text-[#64748b]">
                Ứng viên chưa gửi thư xin việc cho đơn này.
              </p>
            </div>
          </div>

          <!-- Tab 3: CV -->
          <div v-show="activeTab === 'CV'">
            <div v-if="!cvSnapshot" class="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-6 text-center">
              <FileText class="mb-2 h-8 w-8 text-[#94a3b8]" />
              <p class="text-[12.5px] text-[#64748b]">Ứng viên apply không kèm CV.</p>
            </div>
            <template v-else>
              <div class="mb-3 flex items-center justify-between gap-2 rounded-xl border border-[#e7ebf1] bg-white px-3 py-2">
                <div class="flex min-w-0 items-center gap-2">
                  <FileText class="h-4 w-4 shrink-0 text-[#94a3b8]" />
                  <p class="truncate text-[12px] font-semibold text-[#334155]">
                    {{ cvSnapshot.title || 'CV ứng viên' }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded-md border border-[#e3e8ef] text-[#64748b] transition hover:border-[#cfe0ff] hover:text-[#1769e8]"
                    title="Xem CV đầy đủ"
                    @click="cvLightboxOpen = true"
                  >
                    <Eye class="h-3 w-3" />
                  </button>
                  <a
                    v-if="cvFileUrl"
                    :href="cvFileUrl"
                    target="_blank"
                    rel="noopener"
                    class="grid h-7 w-7 place-items-center rounded-md border border-[#e3e8ef] text-[#64748b] transition hover:border-[#cfe0ff] hover:text-[#1769e8]"
                    title="Mở tab mới"
                  >
                    <ExternalLink class="h-3 w-3" />
                  </a>
                  <a
                    v-if="cvFileUrl"
                    :href="cvFileUrl"
                    download
                    class="grid h-7 w-7 place-items-center rounded-md border border-[#e3e8ef] text-[#64748b] transition hover:border-[#cfe0ff] hover:text-[#1769e8]"
                    title="Tải về"
                  >
                    <Download class="h-3 w-3" />
                  </a>
                  <button
                    v-if="cvRenderData"
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded-md border border-[#e3e8ef] text-[#64748b] transition hover:border-[#cfe0ff] hover:text-[#1769e8] disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Tải PDF"
                    :disabled="downloadingPdf"
                    @click="downloadCvPdf"
                  >
                    <Loader2 v-if="downloadingPdf" class="h-3 w-3 animate-spin" />
                    <Download v-else class="h-3 w-3" />
                  </button>
                </div>
              </div>

              <!-- Template CV -->
              <div
                v-if="cvRenderData"
                ref="cvWrapEl"
                class="relative w-full overflow-hidden rounded-lg border border-[#e7ebf1] bg-white"
                :style="{ height: cvInnerH ? `${Math.round(cvInnerH * cvScale)}px` : '640px' }"
              >
                <div
                  ref="cvInnerEl"
                  class="absolute left-0 top-0 origin-top-left bg-white"
                  :style="{ width: '794px', transform: `scale(${cvScale})` }"
                >
                  <CVTemplateRenderer :template-id="cvTemplateId" :data="cvRenderData" language="vi" />
                </div>
                <div v-if="cvScale === 1" class="absolute inset-0 bg-white" />
              </div>

              <!-- Upload PDF -->
              <iframe
                v-else-if="cvIsPdf"
                :src="cvFileUrl + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH'"
                class="block aspect-[210/298] w-full rounded-lg border border-[#e7ebf1] bg-white"
                title="CV preview"
              />

              <!-- File khác -->
              <div v-else class="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-6 text-center">
                <FileText class="mb-2 h-6 w-6 text-[#94a3b8]" />
                <p class="text-[12.5px] text-[#64748b]">Không xem trước được định dạng này.</p>
                <a
                  v-if="cvFileUrl"
                  :href="cvFileUrl"
                  target="_blank"
                  rel="noopener"
                  class="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-[#e3e8ef] bg-white px-3 text-[11px] font-medium text-[#334155] transition hover:bg-[#f8fafc]"
                >
                  <Download class="h-3 w-3" /> Mở / tải file
                </a>
              </div>
            </template>
          </div>

          <!-- Tab 4: So khớp -->
          <div v-show="activeTab === 'So khớp'" class="space-y-4">
            <h3 class="text-[13px] font-semibold">AI Matching</h3>

            <section
              v-if="aiReasoning || detailData?.aiMatchScore != null"
              class="rounded-[14px] border border-violet-100 overflow-hidden"
              style="background: linear-gradient(180deg, #F4EEFE 0%, #FBFAFF 100%);"
            >
              <div class="flex items-center gap-1.5 px-4 pt-4">
                <Sparkles class="w-3.5 h-3.5 text-violet-600" />
                <h4 class="text-[13px] font-bold text-violet-700">AI Matching</h4>
              </div>

              <!-- Score radial ring + label -->
              <div class="p-4 flex items-center gap-3.5">
                <template v-if="detailData?.aiMatchScore != null">
                  <div class="relative shrink-0 w-16 h-16">
                    <svg width="64" height="64" viewBox="0 0 64 64" class="-rotate-90">
                      <circle cx="32" cy="32" r="27" fill="none" stroke="#E6DCFB" stroke-width="7" />
                      <circle
                        :key="`ai-${detailData.aiMatchScore}`"
                        cx="32" cy="32" r="27" fill="none"
                        :stroke="MATCH_LEVEL_STYLE[matchLevelOf(Number(detailData.aiMatchScore))].ring"
                        stroke-width="7" stroke-linecap="round"
                        :stroke-dasharray="169.6"
                        :stroke-dashoffset="169.6 * (1 - Math.max(0, Math.min(100, Number(detailData.aiMatchScore))) / 100)"
                        class="match-ring"
                        :style="{ '--ring-target': 169.6 * (1 - Math.max(0, Math.min(100, Number(detailData.aiMatchScore))) / 100) }"
                      />
                    </svg>
                    <div class="absolute inset-0 grid place-items-center text-[15px] font-extrabold text-violet-700">
                      {{ Math.round(Number(detailData.aiMatchScore)) }}%
                    </div>
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-[13px] font-bold text-gray-900">
                      Mức độ phù hợp:
                      <span :class="MATCH_LEVEL_STYLE[matchLevelOf(Number(detailData.aiMatchScore))].text">
                        {{ MATCH_LEVEL_STYLE[matchLevelOf(Number(detailData.aiMatchScore))].label }}
                      </span>
                    </p>
                    <p v-if="aiReasoning?.rationale" class="text-[11.5px] text-gray-600 mt-1 leading-relaxed">
                      {{ aiReasoning.rationale }}
                    </p>
                  </div>
                </template>
                <span v-else class="inline-flex items-center gap-1.5 text-xs text-amber-700">
                  <Loader2 class="w-3.5 h-3.5 animate-spin" /> Đang so khớp
                </span>
              </div>

              <!-- Terminal state badge -->
              <div v-if="aiReasoning?.reason === 'quota_exceeded'" class="px-4 pb-3">
                <span class="inline-flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertCircle class="w-3.5 h-3.5" /> Hết lượt AI match
                </span>
              </div>
              <div v-if="aiReasoning?.reason === 'failed'" class="px-4 pb-3">
                <span class="inline-flex items-center gap-1.5 text-xs text-rose-700">
                  <AlertCircle class="w-3.5 h-3.5" /> AI match tạm lỗi
                </span>
              </div>

              <!-- Matched skills -->
              <div v-if="aiReasoning?.matchedSkills?.length" class="px-4 pb-4">
                <h5 class="text-[12.5px] font-bold text-emerald-700 mb-2">Kỹ năng phù hợp</h5>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="(s, i) in aiReasoning.matchedSkills"
                    :key="`m-${i}`"
                    class="text-[12px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1"
                  >{{ s }}</span>
                </div>
              </div>

              <!-- Missing skills -->
              <div v-if="aiReasoning?.missingSkills?.length" class="px-4 pb-4">
                <h5 class="text-[12.5px] font-bold text-amber-700 mb-2">Còn thiếu</h5>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="(s, i) in aiReasoning.missingSkills"
                    :key="`ms-${i}`"
                    class="text-[12px] font-semibold text-amber-800 bg-amber-100 rounded-md px-2 py-1"
                  >{{ s }}</span>
                </div>
              </div>

              <!-- Strengths -->
              <div v-if="aiReasoning?.strengths?.length" class="px-4 pb-4">
                <h5 class="text-[12.5px] font-bold text-emerald-700 mb-2">Điểm mạnh</h5>
                <ul class="space-y-1.5">
                  <li
                    v-for="(s, i) in aiReasoning.strengths"
                    :key="`s-${i}`"
                    class="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-700"
                  >
                    <Check class="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" stroke-width="3" />
                    <span>{{ s }}</span>
                  </li>
                </ul>
              </div>

              <!-- Concerns -->
              <div v-if="aiReasoning?.concerns?.length" class="px-4 pb-4">
                <h5 class="text-[12.5px] font-bold text-rose-700 mb-2">Điểm cần lưu ý</h5>
                <ul class="space-y-1.5">
                  <li
                    v-for="(s, i) in aiReasoning.concerns"
                    :key="`c-${i}`"
                    class="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-700"
                  >
                    <AlertCircle class="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" stroke-width="2.5" />
                    <span>{{ s }}</span>
                  </li>
                </ul>
              </div>
            </section>

            <div
              v-else
              class="rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-6 flex flex-col items-center justify-center text-center"
            >
              <Sparkles class="w-8 h-8 text-[#94a3b8] mb-2" />
              <p class="text-[12.5px] text-[#64748b]">
                Chưa có kết quả AI matching cho đơn này.
              </p>
            </div>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="sticky bottom-0 z-10 -mx-5 bg-white border-t border-[#edf0f4] px-6 py-3">
          <!-- Khi đơn ở trạng thái rejected: Cho phép HR đưa lại vào sàng lọc -->
          <div v-if="application.status === 'rejected'" class="flex items-center justify-between gap-3">
            <span class="text-[11.5px] text-[#64748b]">
              Đơn đang ở trạng thái <strong class="text-rose-600">Đã từ chối</strong>
            </span>
            <button
              type="button"
              :disabled="updatingStatus || !canOpenReferences"
              class="flex h-9 items-center justify-center gap-2 rounded-lg bg-[#1769e8] px-4 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#0f5ccc] disabled:opacity-40 disabled:cursor-not-allowed"
              title="Đưa lại đơn vào giai đoạn Sàng lọc"
              @click="changeStatus('screening')"
            >
              <Loader2 v-if="updatingStatus" class="h-4 w-4 animate-spin" />
              <RefreshCw v-else class="h-3.5 w-3.5" />
              Đưa lại vào sàng lọc
            </button>
          </div>

          <!-- Các trạng thái có nextAction thông thường -->
          <div v-else-if="nextAction" class="grid grid-cols-2 gap-3">
            <div class="flex items-center justify-center">
              <span
                role="button"
                tabindex="0"
                class="cursor-pointer select-none text-[12px] font-medium text-rose-500 underline underline-offset-2 transition hover:text-rose-600"
                :class="updatingStatus || !canOpenReferences ? 'pointer-events-none opacity-40' : ''"
                title="Từ chối đơn ứng tuyển này"
                @click="changeStatus('rejected')"
                @keydown.enter="changeStatus('rejected')"
              >
                Chưa phù hợp
              </span>
            </div>
            <button
              type="button"
              :disabled="updatingStatus || !canOpenReferences"
              class="flex h-9 items-center justify-center gap-2 rounded-lg bg-[#5b4eea] text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#0f5ccc] disabled:opacity-40 disabled:cursor-not-allowed"
              :title="`Chuyển đơn sang ${nextAction.next}`"
              @click="changeStatus(nextAction.next)"
            >
              <Loader2 v-if="updatingStatus" class="h-4 w-4 animate-spin" />
              <ArrowRight v-else class="h-4 w-4" />
              {{ nextAction.label }}
            </button>
          </div>

          <!-- Trạng thái cuối khác (hired / withdrawn) -->
          <div
            v-else
            class="rounded-lg border border-[#eef1f5] bg-[#f8fafc] px-3 py-2.5 text-center text-[11px] text-[#94a3b8]"
          >
            Đơn đã ở trạng thái cuối ({{ selectedStatusLabel }}) — không còn hành động.
          </div>
        </div>
      </template>
    </div>
    <!-- Modals -->
    <ReferencesModal
      :application-id="application?.applicationId ?? ''"
      :open="referencesOpen"
      @close="referencesOpen = false"
    />

    <AiTestReviewModal
      :open="reviewOpen"
      :test="reviewTest"
      :loading="aiTestReviewLoading"
      :assigning="assigningTest"
      :can-assign="application?.status === 'screening'"
      @close="reviewOpen = false"
      @assign="assignTestToCandidate"
    />

    <AiTestResultModal
      :open="resultOpen"
      :detail="resultDetail"
      :loading="resultLoading"
      @close="resultOpen = false"
    />

    <CvDetailView
      :open="cvLightboxOpen"
      :cv="cvForLightbox"
      readonly
      language="vi"
      :downloading-pdf="downloadingPdf"
      @close="cvLightboxOpen = false"
      @download-pdf="downloadCvPdf"
    />
  </aside>
</template>

<style scoped>
.match-ring {
  animation: draw-ring 1.2s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes draw-ring {
  from {
    stroke-dashoffset: 150.8;
  }
  to {
    stroke-dashoffset: var(--ring-target, 0);
  }
}

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

.pill {
  display: inline-flex;
  border-radius: 9999px;
  border: 1px solid #dce5f3;
  background-color: #f1f5fb;
  padding: 6px 12px;
  font-size: 10px;
  font-weight: 500;
  color: #334155;
}
</style>
