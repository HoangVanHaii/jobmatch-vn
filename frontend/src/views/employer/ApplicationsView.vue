<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  Filter,
  MoreHorizontal,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Mail,
  Phone,
  User,
  Sparkles,
  Calendar,
  ArrowRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Loader2,
  Check,
  Flag,
  Eye,
  FileText,
  ExternalLink,
  Download,
  ShieldCheck,
  X as CloseIcon,
  Box as BoxIcon,
} from 'lucide-vue-next';
import { applicationApi } from '@services/application.api';
import { jobApi, type JobNameItem } from '@services/job.api';
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
import type { Cv } from '@/types/cv';
import type {
  ApplicationDetail,
  ApplicationStatus,
  EmployerApplicationRow,
} from '@/types/application';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';

dayjs.locale('vi');

interface Application {
  name: string;
  /** URL avatar từ backend (userProfiles.avatarUrl). Null/undefined → render
   *  chữ cái đầu của `name` làm fallback. */
  avatarUrl?: string | null;
  email: string;
  position: string;
  /** Stage tiếng Việt — hiển thị thẳng trong list + detail panel. Key nội
   *  bộ vẫn là tiếng Anh (`'Interview' | 'Screening' | 'Assessment' | 'New'`)
   *  để tra `STAGE_STYLE`; tiếng Việt lấy qua `STAGE_LABEL`. */
  /** Status GỐC từ BE (applicationStatusEnum) — nguồn cho hiển thị chip
   *  (STATUS_LABEL/STATUS_CHIP) + action buttons quyết định transition. */
  status: ApplicationStatus;
  /** AI match % — `null` = chưa chấm xong (queue đang chạy/quota hết/lỗi).
   *  FE phân biệt rõ null ("Chưa có điểm") với 0 (điểm thật = 0). */
  match: number | null;
  date: string;
  /** Application id để debug / future detail fetch. */
  applicationId?: string;
}
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
 * Format ISO date string → "D Thg M, YYYY" tiếng Việt (vd "9 Thg 9, 2026").
 * Dùng cho tooltip + detail panel. Locale `vi` đã set global ở đầu file.
 */
const formatDate = (iso: string): string => {
  const d = dayjs(iso);
  return d.isValid() ? d.format('D [Thg] M, YYYY') : iso;
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
    const { data } = await jobApi.listNames();
    jobOptions.value = data.data;
  } catch {
    // Dropdown trống — không chặn trang; "Tất cả" vẫn hoạt động.
  }
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
const recomputing = ref(false);

/**
 * App đang được chấm LẠI — state riêng, KHÔNG trùng "Chưa có điểm":
 *   - null          → không ai đang chấm
 *   - applicationId → row + ring hiển thị spinner "Đang chấm…" thay vì
 *                     "Chưa có điểm". Tự clear khi socket
 *                     'application:scored' mang điểm mới về.
 */
const scoringApplicationId = ref<string | null>(null);
const isScoringSelected = computed(
  () => !!scoringApplicationId.value && selectedApplication.value.applicationId === scoringApplicationId.value,
);

const recomputeMatch = async (): Promise<void> => {
  const appId = selectedApplication.value.applicationId;
  if (!appId || appId.startsWith('mock-app-')) return;
  recomputing.value = true;
  try {
    await applicationApi.recomputeMatch(appId);
    const row = applications.value.find((a) => a.applicationId === appId);
    if (row) row.match = null;
    selectedApplication.value.match = null;
    if (detailData.value?.id === appId) {
      detailData.value.aiMatchScore = null;
      detailData.value.aiMatchReasoning = null;
    }
    // KHÔNG clear trong finally (queue chấm mất vài giây, lâu hơn API call).
    scoringApplicationId.value = appId;
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
/** True nếu dữ liệu hiện tại đến từ API (không phải mock fallback). */
const fromApi = ref(false);

/**
 * Pagination state — track realtime, không phải hardcode "of 455 applications"
 * như mock cũ. `total` lấy từ response `ListEmployerResult.total`; `page`
 * + `limit` echo request. Khi API fail → total = 0, pagination sẽ collapse
 * về 1 page (chỉ render mock fallback).
 */
const page = ref(1);
const limit = ref(7);
const total = ref(0);
const loading = ref(false);

/** Row đang được select — mặc định là phần tử đầu tiên (sau khi load).
 *  Mỗi ứng viên có thể apply nhiều job → mỗi row là 1 application distinct.
 *  Selection key dùng `applicationId` (unique) thay vì email/name/position. */
const selectedApplication = ref<Application>(EMPTY_APPLICATION);

// References modal — xác minh người tham chiếu của application đang select.
// Chỉ mở khi applicationId thật (row từ API); row mock (mock-app-*/rỗng) →
// nút disable vì backend không có application tương ứng.
const referencesOpen = ref(false);
const canOpenReferences = computed(() => {
  const id = selectedApplication.value.applicationId;
  return !!id && !id.startsWith('mock-app-');
});

// ---------------------------------------------------------------------------
// Status actions — 2 nút action bar phản ánh đúng transition tiếp theo theo
// status GỐC của đơn (backend hiện chưa chặn transition matrix, FE tự dẫn
// luồng chuẩn): pending/viewed → screening; screening → interview;
// interview → offered; offered → hired. Nút phụ "Từ chối" (→ rejected) ở
// mọi trạng thái non-terminal. Terminal (hired/rejected/withdrawn) → ẩn
// nút, hiện note.
// ---------------------------------------------------------------------------
const nextAction = computed<{ label: string; next: ApplicationStatus } | null>(() => {
  switch (selectedApplication.value.status) {
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
      return null; // hired / rejected / withdrawn — terminal
  }
});

const updatingStatus = ref(false);

const changeStatus = async (next: ApplicationStatus): Promise<void> => {
  const appId = selectedApplication.value.applicationId;
  if (!appId || appId.startsWith('mock-app-')) return;
  updatingStatus.value = true;
  try {
    await applicationApi.updateStatus(appId, { status: next });
    // Update tại chỗ — selectApplication giữ REF của row nên mutate row
    // cũng cập nhật luôn panel; vẫn set lại tường minh cho rõ.
    const row = applications.value.find((a) => a.applicationId === appId);
    if (row) {
      row.status = next;
    }
    selectedApplication.value.status = next;
    if (detailData.value?.id === appId) detailData.value.status = next;
    toast.push({
      variant: 'success',
      title: 'Đã cập nhật trạng thái',
      body: `Đơn chuyển sang "${next}". Candidate nhận socket 'status-changed'.`,
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

/** True nếu row `a` đang được select — so sánh bằng `applicationId`. */
const isSelected = (a: Application): boolean =>
  selectedApplication.value.applicationId === a.applicationId;

/**
 * Skills array hiển thị trong detail panel. Mặc định dùng mock data
 * (Figma/Design Systems/UX Research/...) để trang không trống. Khi click
 * row → `selectApplication()` gọi `applicationApi.getById(id)` → nếu
 * response có `aiMatchReasoning.matchedSkills` thì ghi đè bằng data thật.
 */
const MOCK_SKILLS = ['Figma', 'Design Systems', 'UX Research', 'Prototyping', 'User Flow', 'Wireframing'];
const skills = ref<string[]>(MOCK_SKILLS);
const detailLoading = ref(false);
let detailReqSeq = 0;

/**
 * Skills derived — slice 6 đầu hiển thị + gom phần còn lại vào chip "+N".
 * Cả 3 computed re-evaluate khi `skills` thay đổi (override từ API hoặc
 * revert về mock). Hover chip "+N" hiển thị full list qua `title`. */
const SKILL_VISIBLE_MAX = 6;
/** Skills hiển thị — khi `expanded` thì render full list, ngược lại slice
 *  theo `SKILL_VISIBLE_MAX` rồi gom phần còn lại vào chip "+N" click để mở. */
const skillsExpanded = ref(false);
const visibleSkills = computed(() =>
  skillsExpanded.value ? skills.value : skills.value.slice(0, SKILL_VISIBLE_MAX),
);
const hiddenSkillsCount = computed(() => Math.max(0, skills.value.length - SKILL_VISIBLE_MAX));
/** Reset expand khi `skills` đổi (vd switch candidate) — tránh trạng thái
 *  expand bị "kẹt" từ candidate trước. */
watch(skills, () => {
  skillsExpanded.value = false;
});

/**
 * Click 1 row → set `selectedApplication` ngay (để highlight + render
 * panel), đồng thời fire `GET /applications/:id` để lấy detail. Dùng
 * `seq` để chống race: chỉ apply response nếu là request mới nhất
 * (user click row khác trước khi request cũ về).
 */
/**
 * Shape tối thiểu của `cv.parsedData` jsonb — backend không export type
 * chi tiết nên ta khai báo local để access các trường contact + skills
 * an toàn. Nếu sau này backend chuẩn hoá thì thay bằng type import từ
 * `@/types`.
 */
interface CvParsedShape {
  name?: string;
  email?: string;
  phone?: string;
  github?: string;
  /** Skills theo 2 shape (schema cvs.ts dùng union, tương thích ngược):
   *  - upload CV (LLM parse) → string[]
   *  - CV tạo tay (direct)   → { name, level 1-5 }[]
   *  FE normalize về tên string khi hiển thị chip. */
  skills?: Array<string | { name?: string; level?: number }>;
}

/** ParsedData của CV hiện tại — null nếu chưa fetch / CV null. Dùng để
 *  render contact block + skill chips trong detail panel. */
const parsedData = ref<CvParsedShape | null>(null);

/**
 * Full `ApplicationDetail` của candidate đang select — dùng cho tab "Thư"
 * (cover letter) + tab "So khớp" (aiMatchReasoning). Null khi mock /
 * chưa fetch / API fail → render fallback hoặc empty state.
 */
const detailData = ref<ApplicationDetail | null>(null);

// Stage KHÔNG còn nhập tay — tự set bởi action buttons:
//   reference check → 'reference-check'; giao IQ/English → 'iq-test'/'english-test'.
// Panel chỉ HIỂN THỊ read-only (xem template card "Giai đoạn chi tiết").

// Đổi ứng viên → load AI test data nếu đang screening.
watch(detailData, (d) => {
  if (d?.status === 'screening' && d.jobId) void loadAiTestData();
});

// ---------------------------------------------------------------------------
// AI test (Phase 3) — section "Bài test sàng lọc" khi status = screening.
//   - generateOrReuse: đề theo (jobId, testType) — có 'ready' dùng lại,
//     chưa có → Gemini sinh nền (poll listForJob tới khi ready).
//   - Review modal đầy đủ (kèm đáp án) → "Gửi cho ứng viên" → assign →
//     BE tự stage 'iq-test'/'english-test' + email n8n.
//   - Socket 'ai-test:graded' → candidate nộp bài, reload assignments.
// ---------------------------------------------------------------------------
const aiTestLoading = ref(false);
const aiTestReviewLoading = ref(false);
const assigningTest = ref(false);
const jobTests = ref<AiTestSummary[]>([]);
const assignments = ref<TestAssignmentRow[]>([]);
const reviewOpen = ref(false);
const reviewTest = ref<AiTestDetail | null>(null);

// Xem bài làm — result lightbox (chỉ assignment đã nộp).
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
/** testId đang chờ sinh — socket 'ai-test:ready' về đúng id này thì mở review. */
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
    // best-effort — section ẩn bớt state, không chặn trang
  }
};

const readyTestFor = (type: AiTestType): AiTestSummary | undefined =>
  jobTests.value.find((t) => t.testType === type && t.status === 'ready');

/** Đề đang 'generating' của type — nút disable + spinner "Đang tạo đề…". */
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
  // Đề ready sẵn → mở review luôn.
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
    // Upsert row 'generating' vào jobTests NGAY — nút chuyển sang
    // "Đang tạo đề…" (disable + spinner) không phải đợi poll đầu tiên.
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
    // Socket 'ai-test:ready' về đúng id này → tắt spinner + tự mở review.
    awaitingTestId.value = gen.testId;
    // generating — poll tới khi ready (tối đa ~90s) làm FALLBACK (socket
    // mất kết nối thì poll vẫn kịp); bình thường socket đến trước.
    toast.push({
      variant: 'info',
      title: 'AI đang sinh đề',
      body: 'Đề sẽ tự mở để review khi hoàn tất (~vài chục giây).',
    });
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
  if (!detail || !test || assigningTest.value) return;
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
    // Toast lỗi đỏ + chi tiết từ BE (message + code) để HR biết lý do cụ thể
    // (vd [ASSIGNMENT_ACTIVE] "Đã có bài test đang chờ ứng viên làm").
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

// Worker sinh đề xong → BE emit 'ai-test:ready' → tắt spinner, cập nhật
// jobTests + tự mở review modal (nếu đúng đề user đang chờ). Poll timer
// vẫn giữ làm fallback — clear khi event đến.
const onAiTestReady = (payload: {
  testId?: string;
  testType?: AiTestType;
}): void => {
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

// Candidate nộp bài → BE emit 'ai-test:graded' → reload assignments + toast.
// KHÔNG early-return trước khi load — nộp ở application khác (tab đang mở
// application khác) vẫn phải refresh list.
const onAiTestGraded = (payload: {
  applicationId?: string;
  score?: number;
  passed?: boolean;
  flags?: string[] | null;
}): void => {
  void loadAiTestData();
  if (payload?.applicationId !== selectedApplication.value.applicationId) return;
  toast.push({
    variant: payload.passed ? 'success' : 'warning',
    title: 'Ứng viên đã nộp bài test',
    body: `Điểm: ${payload.score ?? '?'}%${payload.flags?.length ? ' — có cờ nghi ngờ gian lận.' : ''}`,
  });
};

const selectApplication = async (a: Application): Promise<void> => {
  selectedApplication.value = a;
  if (!a.applicationId || a.applicationId.startsWith('mock-app-')) return;
  const seq = ++detailReqSeq;
  detailLoading.value = true;
  try {
    const { data } = await applicationApi.getById(a.applicationId);
    if (seq !== detailReqSeq) return;
    const detail: ApplicationDetail = data.data;
    detailData.value = detail;
    // coverLetter.value = detail.coverLetter ?? null;
    // Lấy `cv.parsedData` jsonb — chứa name/email/phone/github/skills.
    // Fallback null nếu CV null → giữ nguyên giá trị cũ (mock).
    const parsed = (detail.cv?.parsedData ?? null) as CvParsedShape | null;
    if (parsed) parsedData.value = parsed;
    // Normalize skills về string[] — CV direct lưu {name, level} object,
    // render thẳng `{{ s }}` sẽ ra "[object Object]". Lấy name, bỏ level
    // (chip ở panel này không hiển thị progress bar level như candidate).
    const cvSkills = Array.isArray(parsed?.skills)
      ? parsed!.skills!
          .map((s) => (typeof s === 'string' ? s : (s?.name ?? '').trim()))
          .filter((s) => s.length > 0)
      : [];
    if (cvSkills.length > 0) skills.value = cvSkills;
  } catch {
    // Network / 401 / 404 → giữ mock skills hiện tại.
    if (seq === detailReqSeq) detailLoading.value = false;
  } finally {
    if (seq === detailReqSeq) detailLoading.value = false;
  }
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
    if (applications.value.length > 0) {
      // Auto-fetch detail của row đầu tiên để populate Skills array từ
      // response `aiMatchReasoning.matchedSkills`. `selectApplication` set
      // `selectedApplication` + gọi API; mock row sẽ skip API trong helper.
      await selectApplication(applications.value[0]!);
    }
    fromApi.value = true;
  } catch {
    // Network / 401 / 500 → reset list rỗng + total = 0 để pagination
    // collapse về 1 page thay vì "of 455". Panel detail hiển thị EMPTY.
    applications.value = [];
    total.value = 0;
    fromApi.value = false;
    selectedApplication.value = EMPTY_APPLICATION;
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
// employer. Cập nhật điểm TẠI CHỖ (không refetch): row trong list + ring
// detail nếu đúng application đang select. Refetch detail để tab "So khớp"
// cũng lấy reasoning mới.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Tab CV — render CV snapshot của application GIỐNG candidate view:
//   - CV template (source direct): CVTemplateRenderer với parsedData snapshot,
//     scale-to-fit panel (A4 794px → chiều rộng panel) qua transform + RO.
//   - CV upload PDF: iframe native viewer ẩn toolbar, đúng tỷ lệ A4.
//   - File khác (docx...): fallback nút mở/tải (không preview được).
// Nguồn dữ liệu: detailData.cv = ApplicationCvSnapshot (title/url/template/
// parsedData) — KHÔNG có fileType nên PDF detect bằng extension URL.
// ---------------------------------------------------------------------------
const cvSnapshot = computed(() => detailData.value?.cv ?? null);
const cvFileUrl = computed(() => cvSnapshot.value?.url ?? null);
const cvTemplateId = computed(() => clampTemplateId(cvSnapshot.value?.template));
const cvRenderData = computed(() => {
  const snap = cvSnapshot.value;
  if (!snap || cvFileUrl.value) return null; // có file → ưu tiên preview file
  return buildRenderData({
    parsedData: (snap.parsedData ?? null) as Record<string, unknown> | null,
    title: snap.title,
  });
});
const cvIsPdf = computed(() => !!cvFileUrl.value && /\.pdf(\?|#|$)/i.test(cvFileUrl.value));

// ---------------------------------------------------------------------------
// Lightbox CvDetailView (readonly) — icon eye trong toolbar CV mở full-screen
// lightbox giống candidate. Snapshot thiếu nhiều field của `Cv` → build stub:
//   - fileType: detect từ extension URL (snapshot không lưu fileType)
//   - source: có url → 'upload', không → 'direct' (template)
//   - status: 'ready' (snapshot tồn tại trong application nghĩa là CV đã sẵn)
//   - id: applicationId — chỉ làm key, employer không thao tác được (readonly)
// ---------------------------------------------------------------------------
const cvLightboxOpen = ref(false);

// ---------------------------------------------------------------------------
// Tải PDF cho CV direct (tạo template) — BE Playwright render qua print page.
// CV upload thì file đã có sẵn url → nút Download thường, không qua đây.
// ---------------------------------------------------------------------------
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

const onApplicationScored = (payload: {
  applicationId?: string;
  matchPercent?: number;
}): void => {
  if (!payload?.applicationId || typeof payload.matchPercent !== 'number') return;
  // Điểm mới đã về → thoát state "Đang chấm…" nếu đúng app đó.
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
  if (appId && selectedApplication.value.applicationId === appId) {
    animateCount(row.match);
    void applicationApi
      .getById(appId)
      .then(({ data }) => { detailData.value = data.data; })
      .catch(() => {/* best-effort */});
  }
};

// Stage thay đổi từ server (reference check / giao test → BE auto-set)
// → patch panel đang mở.
const onStatusChanged = (payload: {
  applicationId?: string;
  stage?: string | null;
}): void => {
  if (!payload?.applicationId || payload.applicationId !== selectedApplication.value.applicationId) return;
  if (detailData.value?.id === payload.applicationId) {
    detailData.value.stage = payload.stage ?? null;
  }
};

onMounted(() => {
  void fetchPage(1);
  void loadJobNames();
  document.addEventListener('mousedown', onDocClick, true);
  getSocket().on('application:new', onApplicationNew);
  getSocket().on('application:scored', onApplicationScored);
  getSocket().on('application:status-changed', onStatusChanged);
  getSocket().on('ai-test:graded', onAiTestGraded);
  getSocket().on('ai-test:ready', onAiTestReady);
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

/** Tab đang active ở detail panel — Overview / Profile / Activity / Notes / Files. */
type TabKey = 'Tổng quan' | 'Thư' | 'CV' | 'So khớp';
const activeTab = ref<TabKey>('Tổng quan');
const tabs: TabKey[] = ['Tổng quan', 'Thư', 'CV', 'So khớp'];

/**
 * AI match reasoning — extract từ `detailData` để bind vào tab "So khớp".
 * Match AppliedJobsView pattern (mirror ở ApplicationDetailPanel).
 */
const aiReasoning = computed(() => detailData.value?.aiMatchReasoning ?? null);
const coverLetter = computed(() => detailData.value?.coverLetter ?? null);

/** Ngày tạo job relative — không có sẵn trong mock, dùng trực tiếp date. */
const selectedMatchText = computed(() => `${selectedApplication.value.match}%`);

// ---------------------------------------------------------------------------
// Label + màu chip theo STATUS GỐC (8 giá trị enum) — thay cho hiển thị qua
// stage map 4 mức cũ (offered/hired bị gộp thành "Phỏng vấn" là sai).
// Label tái dùng STATUS_FILTER_OPTIONS để 1 nguồn duy nhất.
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

const selectedStatusLabel = computed(() => STATUS_LABEL[selectedApplication.value.status]);
const selectedStatusChip = computed(() => STATUS_CHIP[selectedApplication.value.status]);

/* ============================================================================
 * Match level — phân cấp mức độ phù hợp để đổi màu progress bar (list) +
 * ring (detail). Mirror với pattern `MATCH_LEVEL` ở AppliedJobsView /
 * ApplicationDetailPanel để đồng nhất UX toàn app.
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

/* ============================================================================
 * Match ring + counter animation
 * ==========================================================================*/
/** Bán kính ring (r) và stroke width — dùng để tính chu vi SVG. */
const RING_RADIUS = 24;
const RING_STROKE = 4;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Target offset = circumference * (1 - match/100). Truyền qua CSS var để
 *  keyframes `draw-ring` animate từ full → target. */
const ringOffset = computed(
  () => RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, selectedApplication.value.match ?? 0)) / 100),
);

/** Number counter hiển thị trong ring — animate từ 0 → match% khi selected
 *  candidate đổi (ease-out cubic, 1.2s) để cảm giác "chạy tới" mượt. */
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
  () => selectedApplication.value.match,
  (m) => animateCount(m ?? 0),
  { immediate: true },
);

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
const gotoActiveTab = (tab: TabKey): void => {
  activeTab.value = tab;
};

// ---------------------------------------------------------------------------
// Scale-to-fit cho tab CV (đặt SAU khai báo activeTab — watch cần nó):
// renderer render ở 794px (A4) — scale xuống bằng đúng chiều rộng wrapper,
// chiều cao wrapper = innerHeight * scale. ResizeObserver đo cả 2 (panel
// resize khi đổi breakpoint, nội dung đổi khi switch application).
// ---------------------------------------------------------------------------
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
  // v-show tab ẩn → width = 0; đợi tab hiển thị + DOM cập nhật rồi đo.
  if (activeTab.value !== 'CV') return;
  void nextTick(() => {
    measureCv();
    cvRO?.disconnect();
    cvRO = new ResizeObserver(measureCv);
    if (cvWrapEl.value) cvRO.observe(cvWrapEl.value);
    if (cvInnerEl.value) cvRO.observe(cvInnerEl.value);
  });
});

onUnmounted(() => {
  cvRO?.disconnect();
  cvRO = null;
});
watch(
  () => applications.value,
  (list) => animateRows(list),
  { immediate: true },
);

onUnmounted(() => {
  if (countRaf !== null) cancelAnimationFrame(countRaf);
  if (rowRaf !== null) cancelAnimationFrame(rowRaf);
  if (aiTestPollTimer) clearInterval(aiTestPollTimer);
  document.removeEventListener('mousedown', onDocClick, true);
  getSocket().off('application:new', onApplicationNew);
  getSocket().off('application:scored', onApplicationScored);
  getSocket().off('application:status-changed', onStatusChanged);
  getSocket().off('ai-test:graded', onAiTestGraded);
  getSocket().off('ai-test:ready', onAiTestReady);
});
</script>

<template>
  <div class="bg-[#f7f9fc] font-poppins text-[#17233c]">
    <div
      class="flex flex-col lg:flex-row lg:h-screen lg:overflow-hidden bg-white shadow-[0_10px_40px_rgba(31,52,85,.08)]"
    >
      <!-- ============ Main: list ============ -->
      <main class="min-w-0 flex-1 p-4 sm:p-5 lg:p-6 overflow-y-auto lg:overflow-y-hidden scrollbar-thin">
        <div class="mb-5 flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Danh sách ứng tuyển</h1>
            <p class="text-[12px] text-[#8190a5]">Quản lý các đơn ứng tuyển và duy trì quy trình tuyển dụng của bạn.</p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <!-- Combobox chọn job — gõ thẳng trong ô để filter options
                 (client-side), click option → filter list ứng tuyển. -->
            <div ref="jobSelectRoot" class="relative w-full sm:w-[260px]">
              <div
                class="flex h-10 items-center gap-2 rounded-lg border border-[#e3e8ef] bg-white px-3 text-[12px]"
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
                  class="h-4 w-4 shrink-0 cursor-pointer text-[#a0acbc] transition hover:text-[#334155]"
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
                class="flex h-10 w-full items-center gap-2 rounded-lg border border-[#e3e8ef] bg-white px-3 text-[12px] transition hover:border-[#c7d2e0]"
                aria-label="Lọc theo trạng thái"
                @click="statusSelectOpen = !statusSelectOpen"
              >
                <span class="w-full truncate text-left text-[#334155]">{{ statusFilterLabel }}</span>
                <ChevronDown
                  class="h-4 w-4 shrink-0 text-[#a0acbc] transition"
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
            <button type="button" class="grid h-10 w-10 place-items-center rounded-lg border border-[#e3e8ef]">
              <MoreHorizontal class="h-4 w-4" />
            </button>
          </div>
        </div>

        <section class="overflow-hidden rounded-xl border border-[#e7ebf1] bg-white">
          <div class="px-2 pb-2 pt-2">
            <h2 class="text-[15px] font-semibold">Tất cả các đơn ứng tuyển</h2>
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

          <!-- Rows -->
          <div
            v-for="(a, i) in displayedApplications"
            :key="`${a.email}-${i}`"
            class="grid grid-cols-[1.5fr_1.2fr_0.7fr_0.7fr] sm:grid-cols-[1.7fr_1.7fr_1fr_1fr_0.7fr] items-center px-4 py-2.5 text-[13px] border-b border-[#eef1f5] cursor-pointer transition"
            :class="isSelected(a) ? 'bg-[#edf4ff]' : 'bg-white hover:bg-gray-50'"
            @click="selectApplication(a)"
          >
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

          <!-- Pagination footer — bind theo state thật từ API response. -->
          <div
            class="flex items-center justify-between border-t border-[#eef1f5] px-4 py-3 text-[12px] text-[#7c889a]"
          >
            <span>
              Showing
              <strong class="text-[#334155]">{{ applications.length === 0 ? 0 : (page - 1) * limit + 1 }}</strong>
              to
              <strong class="text-[#334155]">{{ (page - 1) * limit + applications.length }}</strong>
              of <strong class="text-[#334155]">{{ total }}</strong> applications
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

      <!-- ============ Detail panel ============ -->
      <!-- overflow-x-hidden: tắt thanh cuộn ngang — sticky action bar dùng -mx-5
           tràn ra 20px mỗi bên là nguồn tràn ngang phổ biến nhất. -->
      <aside class="w-full lg:w-[32%] lg:min-w-[390px] lg:max-w-[500px] lg:shrink-0 border-t lg:border-t-0 lg:border-l border-[#e9edf3] bg-white p-0 overflow-y-auto overflow-x-hidden scrollbar-thin">
        <div class="border-none bg-white">
          <!--
            Header block — chia 2 phần tách biệt để tránh bị rối khi panel
            hẹp:
              1. Row 1 (Identity): avatar + (name + position) | close button.
              2. Row 2 (Match Score): ring + label "Strong match" đặt full-width,
                 tách khỏi identity để dễ scan.
          -->
          <div class="relative border-b border-[#edf0f4] px-5 pt-5 pb-5">
          
            <!-- Row 1: Avatar + identity -->
            <div class="flex items-center gap-4 pr-12">
              <div
                class="relative h-20 w-20 shrink-0 rounded-xl overflow-hidden bg-gradient-to-br from-primary-50 to-primary-100 ring-4 ring-[#f1f4f8]"
                :aria-label="selectedApplication.name"
              >
                <img
                  v-if="selectedApplication.avatarUrl"
                  :src="selectedApplication.avatarUrl"
                  :alt="selectedApplication.name"
                  class="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                />
                <span
                  v-else
                  class="absolute inset-0 grid place-items-center text-primary-700 font-bold text-[28px]"
                >
                  {{ avatarInitial(selectedApplication.name) }}
                </span>
              </div>
              <div class="min-w-0 flex-1">
                <h2 class="text-[22px] font-bold leading-tight truncate">
                  {{ selectedApplication.name }}
                </h2>
                <div class="mt-2 flex items-center gap-2 min-w-0">
                  <div class="min-w-0">
                    <div class="text-[13px] font-semibold truncate">{{ selectedApplication.position }}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Row 2: Match Score tách riêng, full-width — màu theo level. -->
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
                  <!-- Progress ring — stroke đổi màu theo animated match (không
                       phải target) → bắt đầu rose rồi chuyển amber/emerald khi
                       số chạy qua ngưỡng. `:key` re-mount element khi match
                       đổi để restart CSS `draw-ring` animation (Vue reuse DOM
                       nếu không có key mới → animation chỉ chạy lần đầu). -->
                  <circle
                    :key="`${selectedApplication.applicationId}-${selectedApplication.match}`"
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
                  :class="isScoringSelected || selectedApplication.match === null ? 'text-[#94a3b8]' : MATCH_LEVEL_STYLE[matchLevelOf(animatedMatch)].text"
                >
                  <Loader2 v-if="isScoringSelected" class="h-4 w-4 animate-spin" />
                  <span v-else-if="selectedApplication.match === null">—</span>
                  <span v-else>{{ animatedMatch }}%</span>
                </div>
              </div>
              <div class="min-w-0">
                <div class="text-[10px] text-[#94a3b8]">Match Score</div>
                <div
                  class="text-[12px] font-semibold"
                  :class="isScoringSelected || selectedApplication.match === null ? 'text-[#94a3b8]' : MATCH_LEVEL_STYLE[matchLevelOf(animatedMatch)].text"
                >
                  <span v-if="isScoringSelected">Đang chấm…</span>
                  <span v-else-if="selectedApplication.match === null">Chưa có điểm</span>
                  <span v-else>{{ MATCH_LEVEL_STYLE[matchLevelOf(animatedMatch)].label }}</span>
                </div>
              </div>
              <!-- Retry — chấm lại điểm AI (POST /:id/recompute-match). Điểm
                   reset về "Chưa có điểm" ngay; kết quả mới đến qua socket
                   'application:scored' → tự update ring + list. -->
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

          <!--
            Body content — switch theo `activeTab`. Dùng `v-show` thay vì
            `v-if`/`v-else-if` chain vì Volar parser strict không chấp nhận
            whitespace giữa các sibling conditional (vue-tsc OK nhưng IDE
            diagnostic báo lỗi). v-show đơn giản hơn + 4 tab chỉ toggle
            visibility, không cần render lại DOM tree mỗi lần chuyển.
          -->
          <div class="p-5">
            <div v-show="activeTab === 'Tổng quan'" class="space-y-4">
              <h3 class="text-[13px] font-semibold">Tổng quan</h3>
            <div class="rounded-xl border border-[#e8edf3] p-4">
              <div class="grid grid-cols-2 gap-y-4 text-[11px] text-[#64748b]">
                <div class="space-y-3">
                  <!--
                    4 trường contact lấy từ `cv.parsedData` (jsonb) — name /
                    email / phone / github. Fallback giá trị hardcoded khi
                    API fail hoặc parsedData null (mock / chưa load).
                  -->
                  <div class="flex gap-2 items-center truncate">
                    <Mail class="h-4 w-4 shrink-0" />
                    <span class="truncate">{{ parsedData?.email ?? 'sarah.m@abcvild.com' }}</span>
                  </div>
                  <div class="flex gap-2 items-center truncate">
                    <Phone class="h-4 w-4 shrink-0" />
                    <span class="truncate">{{ parsedData?.phone ?? '+1 (415) 555-0124' }}</span>
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
                    <span v-else class="truncate">github.com/sarahmiller</span>
                  </div>
                  <div class="flex gap-2 items-center truncate">
                    <User class="h-4 w-4 shrink-0" />
                    <span class="truncate">{{ parsedData?.name ?? 'San Francisco, CA' }}</span>
                  </div>
                </div>
                <div class="border-l border-[#edf0f4] pl-5">
                  <div class="text-[10px] text-[#94a3b8]">Source</div>
                  <div class="mt-1 font-semibold text-[#334155]">Jobmatch</div>
                  <div class="mt-5 text-[10px] text-[#94a3b8]">Applied</div>
                  <div class="mt-1 font-semibold text-[#334155]">{{ formatDate(selectedApplication.date) }}</div>
                </div>
              </div>
            </div>

            <div>
              <h3 class="mb-2 text-[13px] font-semibold">Kỹ năng</h3>
              <div class="flex flex-wrap gap-2">
                <!--
                  Skills render từ `skills` ref — mặc định slice 6 đầu, các
                  skill còn lại gom vào 1 chip "+N" click để xổ ra toàn bộ
                  (toggle `skillsExpanded`). Watch `skills` để reset expand
                  khi switch candidate — tránh trạng thái expand kẹt từ row
                  trước. Mặc định dùng MOCK_SKILLS, override bằng data thật
                  từ `applicationApi.getById` (matchedSkills) khi user click
                  row hoặc auto-load row đầu tiên sau khi fetchPage xong.
                -->
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

            <div class="rounded-xl border border-[#cfe0ff] bg-[#eef5ff] p-4">
              <div class="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#1769e8]">
                <Sparkles class="h-4 w-4" /> Nhận xét từ AI
              </div>
              <p class="text-[11px] leading-5 text-[#53657d]">
                {{ aiReasoning?.rationale ?? 'AI chưa chấm điểm ứng viên này, vui lòng quay lại sau.' }}
              </p>
            </div>

            <!-- Bài test sàng lọc — chỉ hiện khi status = screening. Đề theo
                 job (reuse-or-generate), review modal rồi mới gửi. -->
            <div
              v-if="selectedApplication.status === 'screening' && canOpenReferences"
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
                <!-- IQ — 3 state: generating (spinner "Đang tạo đề…"), ready
                     ("Review đề IQ"), chưa có ("Tạo đề IQ") -->
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
                <!-- English — cùng 3 state -->
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

              <!-- Assignments đã gửi / đã nộp — nhãn tiếng Việt cho mọi status -->
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
                  <!-- Xem bài làm — chỉ assignment đã nộp -->
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

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="rounded-xl border border-[#e6ebf1] p-4">
                <div class="text-[12px] font-semibold">Giai đoạn chi tiết</div>
                <p class="mt-1 text-[10px] text-[#94a3b8]">
                  Trạng thái: <span class="font-medium" :class="selectedStatusChip.text">{{ selectedStatusLabel }}</span>
                </p>
                <!-- Stage READ-ONLY — tự set bởi action (reference check /
                     giao test). HR không nhập tay. -->
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

                <!-- pending/viewed — promote lên screening -->
                <template v-if="selectedApplication.status === 'pending' || selectedApplication.status === 'viewed'">
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

                <!-- screening — reference check + AI test (đã chuyển xuống
                     section "Bài test sàng lọc" riêng bên dưới) -->
                <template v-else-if="selectedApplication.status === 'screening'">
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

                <!-- interview — scheduling chưa wire -->
                <template v-else-if="selectedApplication.status === 'interview'">
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

                <!-- offered — chờ phản hồi -->
                <template v-else-if="selectedApplication.status === 'offered'">
                  <p class="mt-1.5 text-[11px] leading-4 text-[#64748b]">
                    Offer đã gửi — chờ ứng viên phản hồi, sau đó bấm Hire.
                  </p>
                </template>

                <!-- terminal -->
                <template v-else>
                  <p class="mt-1.5 text-[11px] leading-4 text-[#64748b]">
                    Đơn đã ở trạng thái cuối — không còn bước tiếp theo.
                  </p>
                </template>
              </div>
            </div>
            </div>
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
            <div v-show="activeTab === 'CV'">
              <!-- Tab CV — render CV snapshot giống candidate view: template
                   render scale-to-fit, PDF iframe A4, fallback tải file. -->
              <div v-if="!cvSnapshot" class="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-6 text-center">
                <FileText class="mb-2 h-8 w-8 text-[#94a3b8]" />
                <p class="text-[12.5px] text-[#64748b]">Ứng viên apply không kèm CV.</p>
              </div>
              <template v-else>
                <!-- Toolbar: tên CV + actions (chỉ khi có file) -->
                <div class="mb-3 flex items-center justify-between gap-2 rounded-xl border border-[#e7ebf1] bg-white px-3 py-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <FileText class="h-4 w-4 shrink-0 text-[#94a3b8]" />
                    <p class="truncate text-[12px] font-semibold text-[#334155]">
                      {{ cvSnapshot.title || 'CV ứng viên' }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <!-- Eye — mở lightbox CvDetailView full-screen (readonly) -->
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
                    <!-- CV direct (template) — tải PDF qua Playwright render.
                         Không có file url nên cần endpoint render. -->
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

                <!-- Template CV — scale-to-fit panel (A4 794px → panel width) -->
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
                  <!-- Tab vừa mở width=0 → scale=1 → nội dung tràn; ẩn tới khi
                       đo xong (sau nextTick + RO fire) để tránh flash. -->
                  <div v-if="cvScale === 1" class="absolute inset-0 bg-white" />
                </div>

                <!-- Upload PDF — iframe native viewer, đúng tỷ lệ A4 -->
                <iframe
                  v-else-if="cvIsPdf"
                  :src="cvFileUrl + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH'"
                  class="block aspect-[210/298] w-full rounded-lg border border-[#e7ebf1] bg-white"
                  title="CV preview"
                />

                <!-- File khác (docx...) — không preview được → mở/tải -->
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
            <div v-show="activeTab === 'So khớp'" class="space-y-4">
              <h3 class="text-[13px] font-semibold">AI Matching</h3>

              <!--
                AI Match card — re-use radial ring pattern từ ApplicationDetailPanel
                (candidate-side). `aiReasoning` có thể null khi AI chưa chấm →
                empty state. Khi `reason` là `quota_exceeded` / `failed` →
                terminal badge thay vì spinner.
              -->
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

              <!-- Empty state khi AI chưa có data -->
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

          <!--
            Action buttons — sticky bottom trong aside scroll container.
            `bg-white` + top border + padding-top để tách khỏi content phía
            trên khi user scroll.
          -->
            <div class="sticky bottom-0 z-10 -mx-5 bg-white border-t border-[#edf0f4] px-6 py-1">
              <!-- Nút "Xác minh tham chiếu" đã chuyển lên card "Bước tiếp theo"
                   (tab Tổng quan) — tránh trùng 2 nút cùng chức năng. -->
              <div class="grid grid-cols-2 gap-3">
                <template v-if="nextAction">
                  <!-- Từ chối — text-link gạch chân (không phải button) giống
                       style "Tôi không biết người này" ở trang referee. -->
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
                    class="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#5b4eea] text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#0f5ccc] disabled:opacity-40 disabled:cursor-not-allowed"
                    :title="`Chuyển đơn sang ${nextAction.next}`"
                    @click="changeStatus(nextAction.next)"
                  >
                    <Loader2 v-if="updatingStatus" class="h-4 w-4 animate-spin" />
                    <ArrowRight v-else class="h-4 w-4" />
                    {{ nextAction.label }}
                  </button>
                </template>
                <div
                  v-else
                  class="col-span-2 rounded-lg border border-[#eef1f5] bg-[#f8fafc] px-3 py-2.5 text-center text-[11px] text-[#94a3b8]"
                >
                  Đơn đã ở trạng thái cuối ({{ selectedStatusLabel }}) — không còn hành động.
                </div>
              </div>
            </div>
        </div>
      </aside>

    <!-- References modal — Teleport to body, độc lập với panel layout.
         applicationId rỗng (mock/empty) → modal tự guard, không fetch. -->
    <ReferencesModal
      :application-id="selectedApplication.applicationId ?? ''"
      :open="referencesOpen"
      @close="referencesOpen = false"
    />

    <!-- AI test review — lightbox HR duyệt đề trước khi giao. -->
    <AiTestReviewModal
      :open="reviewOpen"
      :test="reviewTest"
      :loading="aiTestReviewLoading"
      :assigning="assigningTest"
      @close="reviewOpen = false"
      @assign="assignTestToCandidate"
    />

    <!-- AI test result — lightbox xem bài làm của ứng viên (đáp án ✓/✗). -->
    <AiTestResultModal
      :open="resultOpen"
      :detail="resultDetail"
      :loading="resultLoading"
      @close="resultOpen = false"
    />

    <!-- CV lightbox — component candidate dùng, chế độ readonly (employer
         chỉ xem, không set-primary/xoá/edit/analyze CV của candidate). -->
    <CvDetailView
      :open="cvLightboxOpen"
      :cv="cvForLightbox"
      readonly
      language="vi"
      :downloading-pdf="downloadingPdf"
      @close="cvLightboxOpen = false"
      @download-pdf="downloadCvPdf"
    />
  </div>
  </div>

</template>

<style scoped>
/*
 * Match ring animation — dashoffset chạy từ full (ring ẩn) về target
 * (ring hiển thị đúng % match). Mỗi lần `ringOffset` đổi → keyframes re-run
 * nhờ `:key` pseudo + class mới (xem template comment).
 */
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
 * Pill chip cho Skills section — match với mockup inline style:
 * rounded-full border + bg + padding + font-medium + text color.
 */
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
