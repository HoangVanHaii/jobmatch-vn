<script setup lang="ts">
/**
 * ApplicationMockupView — port mockup.html sang Vue + call `GET
 * /applications/company` để lấy list apply của employer. Field nào
 * thiếu từ API (vd role, email nếu anonymous) thì fallback về mock data
 * hoặc derive hợp lý từ field có sẵn.
 *
 * Mount flow:
 *   1. `onMounted` gọi `applicationApi.listByCompany({ page: 1, limit: 20 })`.
 *   2. Map `EmployerApplicationRow[]` → `Candidate[]` (shape UI mockup).
 *   3. Nếu API lỗi / trả rỗng → dùng MOCK_CANDIDATES để trang không trống.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  Search,
  Filter,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Mail,
  Phone,
  User,
  Sparkles,
  Box,
  Code2,
  Briefcase,
  BadgeCheck,
  Calendar,
  CalendarPlus,
  ArrowRight,
  X as CloseIcon,
  Box as BoxIcon,
} from 'lucide-vue-next';
import { applicationApi } from '@services/application.api';
import type {
  ApplicationDetail,
  ApplicationStatus,
  EmployerApplicationRow,
} from '@/types/application';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';

dayjs.locale('vi');

interface Candidate {
  name: string;
  email: string;
  position: string;
  role: 'Design' | 'Engineering' | 'Product' | 'Marketing';
  /** Stage tiếng Việt — hiển thị thẳng trong list + detail panel. Key nội
   *  bộ vẫn là tiếng Anh (`'Interview' | 'Screening' | 'Assessment' | 'New'`)
   *  để tra `STAGE_STYLE`; tiếng Việt lấy qua `STAGE_LABEL`. */
  stage: 'Interview' | 'Screening' | 'Assessment' | 'New';
  match: number;
  date: string;
  img: number;
  /** Application id để debug / future detail fetch. */
  applicationId?: string;
}

const MOCK_CANDIDATES: Candidate[] = [
  { name: 'Robert Fernandez', email: 'robert.f@outlook.com', position: 'Graphic Designer', role: 'Design', stage: 'Interview', match: 80, date: '2026-08-29T08:12:00.000Z', img: 33, applicationId: 'mock-app-001' },
  { name: 'David Kim', email: 'david.kim@example.com', position: 'Frontend Engineer', role: 'Engineering', stage: 'Screening', match: 77, date: '2026-08-29T11:45:00.000Z', img: 12, applicationId: 'mock-app-002' },
  { name: 'Emma Wilson', email: 'emma.w@gmail.com', position: 'Product Manager', role: 'Product', stage: 'Assessment', match: 95, date: '2026-08-28T14:20:00.000Z', img: 44, applicationId: 'mock-app-003' },
  { name: 'Thomas Welbeck', email: 'thomas.w@gmail.com', position: 'Backend Engineer', role: 'Engineering', stage: 'New', match: 55, date: '2026-08-27T09:08:00.000Z', img: 11, applicationId: 'mock-app-004' },
  { name: 'Laila Hermansyah', email: 'laila.h@gmail.com', position: 'Digital Marketing', role: 'Marketing', stage: 'Assessment', match: 84, date: '2026-08-27T16:30:00.000Z', img: 32, applicationId: 'mock-app-005' },
  { name: 'Kintaro Hamada', email: 'kintaro.hamada@gmail.com', position: 'Product Research', role: 'Product', stage: 'Screening', match: 72, date: '2026-08-25T10:05:00.000Z', img: 53, applicationId: 'mock-app-006' },
  { name: 'Sarah Miller', email: 'sarah.miller@gmail.com', position: 'Product Designer', role: 'Design', stage: 'Interview', match: 83, date: '2026-08-24T13:50:00.000Z', img: 47, applicationId: 'mock-app-007' },
  { name: 'Tony Cooper', email: 'tony.c@servermail.com', position: 'SEO Specialist', role: 'Marketing', stage: 'Screening', match: 86, date: '2026-08-24T17:22:00.000Z', img: 12, applicationId: 'mock-app-008' },
  { name: 'Willie Barrington', email: 'willie.d@speedmail.com', position: 'Network Security', role: 'Engineering', stage: 'Assessment', match: 88, date: '2026-08-23T07:15:00.000Z', img: 15, applicationId: 'mock-app-009' },
  { name: 'Nicole Hernandez', email: 'nicole.h@globalmail.com', position: 'Product Designer', role: 'Design', stage: 'Interview', match: 83, date: '2026-08-22T15:40:00.000Z', img: 68, applicationId: 'mock-app-010' },
  // Mock candidate KHÔNG có ảnh — dùng để demo fallback sang chữ cái đầu.
  { name: 'Anna Tran', email: 'anna.t@example.com', position: 'UX Researcher', role: 'Design', stage: 'New', match: 65, date: '2026-08-20T12:00:00.000Z', img: 0, applicationId: 'mock-app-011' },
];

/**
 * Lấy chữ cái đầu của tên (uppercase) — dùng làm avatar fallback (không
 * load ảnh từ pravatar vì data thật từ API có thể không có URL ảnh).
 */
const avatarInitial = (name: string): string => {
  const t = name.trim();
  return t ? t.charAt(0).toLocaleUpperCase('vi-VN') : '?';
};

/**
 * Format ISO date string → "D Thg M, YYYY" tiếng Việt (vd "9 Thg 9, 2026").
 * Dùng cho cả mock (ISO trong MOCK_CANDIDATES) lẫn API response
 * (`appliedAt`) để hiển thị đồng nhất. Locale `vi` đã set global ở đầu file.
 */
const formatDate = (iso: string): string => {
  const d = dayjs(iso);
  return d.isValid() ? d.format('D [Thg] M, YYYY') : iso;
};

const candidates = ref<Candidate[]>(MOCK_CANDIDATES);
/** True nếu dữ liệu hiện tại đến từ API (không phải mock fallback). */
const fromApi = ref(false);

/**
 * Pagination state — track realtime, không phải hardcode "of 455 candidates"
 * như mock cũ. `total` lấy từ response `ListEmployerResult.total`; `page`
 * + `limit` echo request. Khi API fail → total = 0, pagination sẽ collapse
 * về 1 page (chỉ render mock fallback).
 */
const page = ref(1);
const limit = ref(20);
const total = ref(0);
const loading = ref(false);

/** Row đang được select — mặc định là phần tử đầu tiên (sau khi load).
 *  Mỗi ứng viên có thể apply nhiều job → mỗi row là 1 application distinct.
 *  Selection key dùng `applicationId` (unique) thay vì email/name/position. */
const selectedCandidate = ref<Candidate>(MOCK_CANDIDATES[6]!);

/** True nếu row `c` đang được select — so sánh bằng `applicationId`. */
const isSelected = (c: Candidate): boolean =>
  selectedCandidate.value.applicationId === c.applicationId;

/**
 * Skills array hiển thị trong detail panel. Mặc định dùng mock data
 * (Figma/Design Systems/UX Research/...) để trang không trống. Khi click
 * row → `selectCandidate()` gọi `applicationApi.getById(id)` → nếu
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
const visibleSkills = computed(() => skills.value.slice(0, SKILL_VISIBLE_MAX));
const hiddenSkillsCount = computed(() => Math.max(0, skills.value.length - SKILL_VISIBLE_MAX));
const hiddenSkills = computed(() => skills.value.slice(SKILL_VISIBLE_MAX));

/**
 * Click 1 row → set `selectedCandidate` ngay (để highlight + render
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
  skills?: string[];
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

const selectCandidate = async (c: Candidate): Promise<void> => {
  selectedCandidate.value = c;
  if (!c.applicationId || c.applicationId.startsWith('mock-app-')) return;
  const seq = ++detailReqSeq;
  detailLoading.value = true;
  try {
    const { data } = await applicationApi.getById(c.applicationId);
    if (seq !== detailReqSeq) return;
    const detail: ApplicationDetail = data.data;
    detailData.value = detail;
    // Lấy `cv.parsedData` jsonb — chứa name/email/phone/github/skills.
    // Fallback null nếu CV null → giữ nguyên giá trị cũ (mock).
    const parsed = (detail.cv?.parsedData ?? null) as CvParsedShape | null;
    if (parsed) parsedData.value = parsed;
    const cvSkills = Array.isArray(parsed?.skills) ? parsed!.skills! : [];
    if (cvSkills.length > 0) skills.value = cvSkills;
  } catch {
    // Network / 401 / 404 → giữ mock skills hiện tại.
    if (seq === detailReqSeq) detailLoading.value = false;
  } finally {
    if (seq === detailReqSeq) detailLoading.value = false;
  }
};

/** Styling cho role chip — match với mockup (bg + text + icon). */
const ROLE_STYLE: Record<Candidate['role'], { bg: string; text: string; icon: typeof Box }> = {
  Design: { bg: 'bg-[#f3e8ff]', text: 'text-[#a855f7]', icon: Box },
  Engineering: { bg: 'bg-[#fff0df]', text: 'text-[#f97316]', icon: Code2 },
  Product: { bg: 'bg-[#dcf8ec]', text: 'text-[#10b981]', icon: Briefcase },
  Marketing: { bg: 'bg-[#e7efff]', text: 'text-[#2563eb]', icon: BadgeCheck },
};

/** Styling cho stage chip — match với mockup. */
const STAGE_STYLE: Record<Candidate['stage'], { bg: string; text: string }> = {
  Interview: { bg: 'bg-[#eaf2ff]', text: 'text-[#1769e8]' },
  Screening: { bg: 'bg-[#fff1e7]', text: 'text-[#f97316]' },
  Assessment: { bg: 'bg-[#f7e9ff]', text: 'text-[#b24be7]' },
  New: { bg: 'bg-[#eef0f2]', text: 'text-[#64748b]' },
};

/**
 * Stage tiếng Việt — đồng bộ với `AppliedJobsView` (candidate-side) để
 * cùng 1 ứng viên nhìn status ở 2 trang là 1 chuỗi. Tra trực tiếp qua
 * `STAGE_LABEL[stage]` khi render.
 */
const STAGE_LABEL: Record<Candidate['stage'], string> = {
  Interview: 'Phỏng vấn',
  Screening: 'Sàng lọc',
  Assessment: 'Đánh giá',
  New: 'Mới',
};

/**
 * Map status → stage mockup. Backend enum `ApplicationStatus` (pending/viewed/
 * screening/interview/offered/hired/rejected/withdrawn) gom về 4 stage hiển thị.
 *   - pending / viewed → "New"
 *   - screening → "Screening"
 *   - interview / offered / hired → "Interview"
 *   - rejected / withdrawn → "Assessment" (đánh dấu terminal)
 */
const STATUS_TO_STAGE: Record<ApplicationStatus, Candidate['stage']> = {
  pending: 'New',
  viewed: 'New',
  screening: 'Screening',
  interview: 'Interview',
  offered: 'Interview',
  hired: 'Interview',
  rejected: 'Assessment',
  withdrawn: 'Assessment',
};

/** Heuristic: derive role từ jobTitle — backend chỉ trả string, không có enum. */
const inferRole = (jobTitle: string | null): Candidate['role'] => {
  const t = (jobTitle ?? '').toLowerCase();
  if (/(design|ui|ux|graphic)/.test(t)) return 'Design';
  if (/(engineer|developer|dev |backend|frontend|fullstack|security|devops)/.test(t)) return 'Engineering';
  if (/(product|manager|pm|research)/.test(t)) return 'Product';
  if (/(marketing|seo|growth|content|brand)/.test(t)) return 'Marketing';
  return 'Engineering';
};

/** Hash string → 1-70 (pravatar chỉ có ảnh 1..70). */
const hashToImg = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 70) + 1;
};

/**
 * Cắt chuỗi dài về `max` ký tự + thêm "..." — dùng cho Candidate name và
 * Job title trong list (column hẹp, không đủ chỗ cho tên dài từ API).
 */
const truncate = (s: string | null | undefined, max = 20): string => {
  const v = (s ?? '').trim();
  return v.length > max ? `${v.slice(0, max)}…` : v;
};

/** Map 1 row `EmployerApplicationRow` → `Candidate` UI shape. Field nào
 *  null → fallback sang mock (MOCK_CANDIDATES lấy theo index, hoặc giá
 *  trị mặc định hợp lý). */
const mapRow = (row: EmployerApplicationRow, fallbackIdx: number): Candidate => {
  const fb = MOCK_CANDIDATES[fallbackIdx % MOCK_CANDIDATES.length]!;
  const matchNum = row.aiMatchScore != null ? Math.round(Number(row.aiMatchScore)) : fb.match;
  return {
    name: row.candidateName ?? `Ứng viên #${fallbackIdx + 1}`,
    email: row.candidateEmail ?? (row.isAnonymous ? '(ẩn danh)' : fb.email),
    position: row.jobTitle ?? fb.position,
    role: inferRole(row.jobTitle),
    stage: STATUS_TO_STAGE[row.status],
    match: Number.isFinite(matchNum) ? matchNum : fb.match,
    date: dayjs(row.appliedAt).isValid() ? dayjs(row.appliedAt).format('MMM D, YYYY') : fb.date,
    img: hashToImg(row.id),
    applicationId: row.id,
  };
};

/**
 * Fetch 1 page từ API. `pageNum` optional — nếu không truyền thì giữ nguyên
 * `page.value` hiện tại. Update cả `candidates` + `total` từ response để
 * pagination hiển thị đúng số.
 */
const fetchPage = async (pageNum?: number): Promise<void> => {
  if (typeof pageNum === 'number') page.value = pageNum;
  loading.value = true;
  try {
    const { data } = await applicationApi.listByCompany({ page: page.value, limit: limit.value });
    const rows = data.data?.rows ?? [];
    candidates.value = rows.map((r, i) => mapRow(r, i));
    total.value = data.data?.total ?? rows.length;
    // Cập nhật page/limit echo từ response (BE có thể clamp nếu vượt max).
    if (typeof data.data?.page === 'number') page.value = data.data.page;
    if (typeof data.data?.limit === 'number') limit.value = data.data.limit;
    if (candidates.value.length > 0) {
      // Auto-fetch detail của row đầu tiên để populate Skills array từ
      // response `aiMatchReasoning.matchedSkills`. `selectCandidate` set
      // `selectedCandidate` + gọi API; mock row sẽ skip API trong helper.
      await selectCandidate(candidates.value[0]!);
    }
    fromApi.value = true;
  } catch {
    // Network / 401 / 500 → fallback mock + reset total = 0 để pagination
    // collapse về 1 page thay vì "of 455".
    candidates.value = MOCK_CANDIDATES;
    total.value = 0;
    fromApi.value = false;
    selectedCandidate.value = MOCK_CANDIDATES[6]!;
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  void fetchPage(1);
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
type TabKey = 'Tổng quan' | 'Thư' | 'Notes' | 'So khớp';
const activeTab = ref<TabKey>('Tổng quan');
const tabs: TabKey[] = ['Tổng quan', 'Thư', 'Notes', 'So khớp'];

/**
 * AI match reasoning — extract từ `detailData` để bind vào tab "So khớp".
 * Match AppliedJobsView pattern (mirror ở ApplicationDetailPanel).
 */
const aiReasoning = computed(() => detailData.value?.aiMatchReasoning ?? null);
const coverLetter = computed(() => detailData.value?.coverLetter ?? null);

/** Ngày tạo job relative — không có sẵn trong mock, dùng trực tiếp date. */
const selectedMatchText = computed(() => `${selectedCandidate.value.match}%`);

const selectedRoleStyle = computed(() => ROLE_STYLE[selectedCandidate.value.role]);
const selectedStageStyle = computed(() => STAGE_STYLE[selectedCandidate.value.stage]);

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
  () => RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, selectedCandidate.value.match)) / 100),
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
  () => selectedCandidate.value.match,
  (m) => animateCount(m),
  { immediate: true },
);

/**
 * Per-row animated match % cho list — key theo applicationId để mỗi row
 * có giá trị đếm riêng. Khi `candidates` thay đổi (fetch page mới) → reset
 * tất cả về 0 rồi chạy rAF tween lên target, kết hợp với `transition-all`
 * ở CSS để progress bar fill mượt song song với số nhảy.
 */
const animatedMatches = ref<Record<string, number>>({});
let rowRaf: number | null = null;

const animateRows = (list: Candidate[]): void => {
  if (rowRaf !== null) cancelAnimationFrame(rowRaf);
  const ids = list.map((c) => c.applicationId ?? c.email);
  const targets = new Map(ids.map((id, i) => [id, list[i]!.match]));
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
  () => candidates.value,
  (list) => animateRows(list),
  { immediate: true },
);

onUnmounted(() => {
  if (countRaf !== null) cancelAnimationFrame(countRaf);
  if (rowRaf !== null) cancelAnimationFrame(rowRaf);
});
</script>

<template>
  <div class="bg-[#f7f9fc] font-poppins text-[#17233c]">
    <div
      class="flex h-screen overflow-hidden bg-white shadow-[0_10px_40px_rgba(31,52,85,.08)]"
    >
      <!-- ============ Main: list ============ -->
      <main class="min-w-0 flex-1 lg:p-6 overflow-y-auto scrollbar-thin">
        <div class="mb-5 flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h1 class="text-[28px] font-bold tracking-[-.6px]">Candidates</h1>
            <p class="text-[12px] text-[#8190a5]">Manage candidates and keep your hiring process moving.</p>
          </div>
          <div class="flex items-center gap-2">
            <div
              class="flex h-10 w-[215px] items-center gap-2 rounded-lg border border-[#e3e8ef] bg-white px-3 text-[12px] text-[#a0acbc]"
            >
              <Search class="h-4 w-4" />
              <span>Search...</span>
            </div>
            <button
              type="button"
              class="flex h-10 items-center gap-2 rounded-lg border border-[#e3e8ef] px-3 text-[12px] font-medium"
            >
              <Filter class="h-4 w-4" /> Filter
            </button>
            <button type="button" class="grid h-10 w-10 place-items-center rounded-lg border border-[#e3e8ef]">
              <MoreHorizontal class="h-4 w-4" />
            </button>
          </div>
        </div>

        <section class="overflow-hidden rounded-md border border-[#e7ebf1] bg-white">
          <div class="px-2 pb-2 pt-2">
            <h2 class="text-[15px] font-semibold">All Candidate</h2>
          </div>

          <!-- Column headers -->
          <div
            class="grid grid-cols-[1.7fr_1.7fr_1fr_1fr_0.7fr] items-center border-y border-[#eef1f5] px-4 py-3 text-[11px] font-medium text-[#7c889a]"
          >
            <div>Candidate</div>
            <div>Position</div>
            <div>Stage</div>
            <div>Match</div>
            <div>Applied</div>
          </div>

          <!-- Rows -->
          <div
            v-for="(c, i) in candidates"
            :key="`${c.email}-${i}`"
            class="grid grid-cols-[1.7fr_1.7fr_1fr_1fr_0.7fr] items-center px-4 py-2.5 text-[11px] border-b border-[#eef1f5] cursor-pointer transition"
            :class="isSelected(c) ? 'bg-[#edf4ff]' : 'bg-white hover:bg-gray-50'"
            @click="selectCandidate(c)"
          >
            <!-- Candidate -->
            <div class="flex min-w-0 items-center gap-2">
              <div
                class="h-8 w-8 shrink-0 rounded-full grid place-items-center bg-gradient-to-br from-primary-50 to-primary-100 text-primary-700 font-bold text-[12px] ring-1 ring-black/5"
                :aria-label="c.name"
              >
                {{ avatarInitial(c.name) }}
              </div>
              <div class="min-w-0">
                <div class="truncate font-semibold" :title="c.name">{{ truncate(c.name, 14) }}</div>
                <div class="truncate text-[9px] text-[#94a3b8]" :title="c.email">{{ truncate(c.email, 18) }}</div>
              </div>
            </div>

            <!-- Position -->
            <div class="flex min-w-0 items-center">
              <div class="min-w-0">
                <div class="truncate font-medium" :title="c.position">{{ truncate(c.position, 24) }}</div>
                <span class="text-[9px]" :class="ROLE_STYLE[c.role].text">{{ c.role }}</span>
              </div>
            </div>

            <!-- Stage -->
            <div>
              <span
                class="inline-flex rounded-md px-1 py-0.5 text-[10px] font-medium"
                :class="[STAGE_STYLE[c.stage].bg, STAGE_STYLE[c.stage].text]"
              >{{ STAGE_LABEL[c.stage] }}</span>
            </div>

            <!-- Match -->
            <div>
              <div
                class="font-semibold tabular-nums"
                :class="MATCH_LEVEL_STYLE[matchLevelOf(animatedMatches[c.applicationId ?? c.email] ?? c.match)].text"
              >
                {{ animatedMatches[c.applicationId ?? c.email] ?? 0 }}%
              </div>
              <div class="mt-1 h-1.5 w-[85px] rounded-full bg-[#e8eef8]">
                <!--
                  Bar color bám theo animated % (không phải target) → bắt đầu
                  luôn ở màu đỏ (rose) khi % = 0, rồi chuyển amber khi vượt
                  50%, rồi emerald khi vượt 80%. `transition-colors` để đổi
                  màu mượt song song với fill width.
                -->
                <div
                  class="h-full rounded-full transition-all duration-[1100ms] ease-out"
                  :class="MATCH_LEVEL_STYLE[matchLevelOf(animatedMatches[c.applicationId ?? c.email] ?? c.match)].bar"
                  :style="{ width: `${animatedMatches[c.applicationId ?? c.email] ?? 0}%` }"
                ></div>
              </div>
            </div>

            <!-- Applied -->
            <div class="text-[10px] text-[#475569]">{{ formatDate(c.date) }}</div>
          </div>

          <!-- Pagination footer — bind theo state thật từ API response. -->
          <div
            class="flex items-center justify-between border-t border-[#eef1f5] px-4 py-3 text-[11px] text-[#7c889a]"
          >
            <span>
              Showing
              <strong class="text-[#334155]">{{ candidates.length === 0 ? 0 : (page - 1) * limit + 1 }}</strong>
              to
              <strong class="text-[#334155]">{{ (page - 1) * limit + candidates.length }}</strong>
              of <strong class="text-[#334155]">{{ total }}</strong> candidates
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

              <span class="ml-2">{{ limit }} / page</span>
            </div>
          </div>
        </section>
      </main>

      <!-- ============ Detail panel ============ -->
      <aside class="w-[32%] min-w-[390px] max-w-[500px] shrink-0 border-l border-[#e9edf3] bg-white p-0 overflow-y-auto scrollbar-thin">
        <div class="rounded-xl border border-[#e7ebf1] bg-white">
          <!--
            Header block — chia 2 phần tách biệt để tránh bị rối khi panel
            hẹp:
              1. Row 1 (Identity): avatar + (name + role) | close button.
              2. Row 2 (Match Score): ring + label "Strong match" đặt full-width,
                 tách khỏi identity để dễ scan.
          -->
          <div class="relative border-b border-[#edf0f4] px-5 pt-5 pb-5">
            <button
              type="button"
              class="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-lg border border-[#e1e7ef] text-[#64748b] hover:bg-gray-50 transition"
              aria-label="Đóng"
            >
              <CloseIcon class="h-4 w-4" />
            </button>

            <!-- Row 1: Avatar + identity -->
            <div class="flex items-center gap-4 pr-12">
              <div
                class="h-20 w-20 shrink-0 rounded-full grid place-items-center bg-gradient-to-br from-primary-50 to-primary-100 text-primary-700 font-bold text-[28px] ring-4 ring-[#f1f4f8]"
                :aria-label="selectedCandidate.name"
              >
                {{ avatarInitial(selectedCandidate.name) }}
              </div>
              <div class="min-w-0 flex-1">
                <h2 class="text-[22px] font-bold leading-tight truncate">
                  {{ selectedCandidate.name }}
                </h2>
                <div class="mt-2 flex items-center gap-2 min-w-0">
                  <span
                    class="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                    :class="[selectedRoleStyle.bg, selectedRoleStyle.text]"
                  >
                    <component :is="selectedRoleStyle.icon" class="h-4 w-4" />
                  </span>
                  <div class="min-w-0">
                    <div class="text-[13px] font-semibold truncate">{{ selectedCandidate.position }}</div>
                    <span class="text-[10px] font-medium" :class="selectedRoleStyle.text">
                      {{ selectedCandidate.role }}
                    </span>
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
                       số chạy qua ngưỡng. -->
                  <circle
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
                  :class="MATCH_LEVEL_STYLE[matchLevelOf(animatedMatch)].text"
                >
                  {{ animatedMatch }}%
                </div>
              </div>
              <div class="min-w-0">
                <div class="text-[10px] text-[#94a3b8]">Match Score</div>
                <div
                  class="text-[12px] font-semibold"
                  :class="MATCH_LEVEL_STYLE[matchLevelOf(animatedMatch)].text"
                >
                  {{ MATCH_LEVEL_STYLE[matchLevelOf(animatedMatch)].label }}
                </div>
              </div>
            </div>

            <!-- Tabs -->
            <div class="mt-5 flex gap-7 text-[12px] font-medium text-[#64748b]">
              <button
                v-for="t in tabs"
                :key="t"
                type="button"
                class="pb-3 border-b-2 transition"
                :class="activeTab === t ? 'border-[#1769e8] text-[#1769e8]' : 'border-transparent'"
                @click="activeTab = t"
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
              <h3 class="text-[13px] font-semibold">Candidate Overview</h3>
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
                  <div class="mt-1 font-semibold text-[#334155]">LinkedIn</div>
                  <div class="mt-5 text-[10px] text-[#94a3b8]">Applied</div>
                  <div class="mt-1 font-semibold text-[#334155]">{{ formatDate(selectedCandidate.date) }}</div>
                </div>
              </div>
            </div>

            <div>
              <h3 class="mb-2 text-[13px] font-semibold">Skills</h3>
              <div class="flex flex-wrap gap-2">
                <!--
                  Skills render từ `skills` ref — max 6 chip pill, các skill
                  còn lại gom vào 1 chip "+N" (hover để xem list đầy đủ).
                  Mặc định dùng MOCK_SKILLS, override bằng data thật từ
                  `applicationApi.getById` (matchedSkills) khi user click row
                  hoặc auto-load row đầu tiên sau khi fetchPage xong.
                -->
                <span v-for="s in visibleSkills" :key="s" class="pill">{{ s }}</span>
                <span
                  v-if="hiddenSkillsCount > 0"
                  class="pill"
                  :title="hiddenSkills.join(', ')"
                >+{{ hiddenSkillsCount }}</span>
                <span v-if="detailLoading" class="pill text-[#94a3b8]">…</span>
              </div>
            </div>

            <div class="rounded-xl border border-[#cfe0ff] bg-[#eef5ff] p-4">
              <div class="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#1769e8]">
                <Sparkles class="h-4 w-4" /> AI Summary
              </div>
              <p class="text-[11px] leading-5 text-[#53657d]">
                Strong product designer background with excellent experience in designing scalable,
                user-centered web and mobile products. Recently worked on B2B SaaS products. Looking for
                new opportunities to make an impact.
              </p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-xl border border-[#e6ebf1] p-4">
                <div class="text-[12px] font-semibold">Current Stage</div>
                <span
                  class="mt-3 inline-flex rounded-full px-3 py-2 text-[11px] font-medium"
                  :class="[selectedStageStyle.bg, selectedStageStyle.text]"
                >{{ STAGE_LABEL[selectedCandidate.stage] }}</span>
              </div>
              <div class="rounded-xl border border-[#e6ebf1] p-4">
                <div class="text-[12px] font-semibold">Next Interview</div>
                <div class="mt-3 flex items-center gap-3">
                  <span
                    class="grid h-9 w-9 place-items-center rounded-full bg-[#eaf2ff] text-[#1769e8]"
                  >
                    <Calendar class="h-4 w-4" />
                  </span>
                  <div>
                    <div class="text-[11px] font-semibold">Tomorrow</div>
                    <div class="text-[10px] text-[#64748b]">10:30 AM</div>
                  </div>
                  <ChevronRight class="ml-auto h-4 w-4 text-[#1769e8]" />
                </div>
              </div>
            </div>
            <div v-show="activeTab === 'Thư'" class="space-y-3">
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
            <div v-show="activeTab === 'Notes'" class="space-y-3">
              <h3 class="text-[13px] font-semibold">Ghi chú nội bộ</h3>
              <div class="rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] p-6 flex flex-col items-center justify-center text-center">
                <Inbox class="w-8 h-8 text-[#94a3b8] mb-2" />
                <p class="text-[12.5px] text-[#64748b]">
                  Tính năng ghi chú đang phát triển — sẽ sớm có mặt.
                </p>
              </div>
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
            <div class="sticky bottom-0 z-10 -mx-5 mt-4 bg-white border-t border-[#edf0f4] px-5 py-4">
              <div class="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  class="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#dce4ef] bg-white text-[11px] font-semibold text-[#1769e8]"
                >
                  <CalendarPlus class="h-4 w-4" /> Schedule Interview
                </button>
                <button
                  type="button"
                  class="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#1769e8] text-[11px] font-semibold text-white shadow-sm"
                >
                  View Full Profile <ArrowRight class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
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
