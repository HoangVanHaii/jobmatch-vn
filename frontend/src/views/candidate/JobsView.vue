<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useJobStore } from '@stores/job';
import { useDebounce } from '@composables/useDebounce';
import { jobApi } from '@services/job.api';
import { savedJobApi } from '@services/savedJob.api';
import type { JobListItem, JobLevel, JobType, ListJobQuery } from '@/types/job';
import {
  Briefcase,
  BookOpen,
  Clock,
  Code,
  Crown,
  FileSignature,
  GraduationCap,
  Laptop,
  MapPin,
  SearchX,
  Sprout,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-vue-next';

dayjs.extend(relativeTime);
dayjs.locale('vi');

/* ============================================================================
 * URL query ↔ filter state
 *
 * URL là nguồn chân truth cho search/filter/pagination: mỗi lần filter thay
 * đổi thì sync vào query string (xem `syncQueryToUrl`), và lúc mount đọc
 * ngược lại để khôi phục — nhờ vậy browser Back từ Job Detail (hoặc F5,
 * share link) trả về đúng list như trước khi rời trang.
 * ========================================================================== */
const route = useRoute();

/** Đọc 1 query param dạng string (value có thể là string[] — trường hợp đó bỏ). */
const queryString = (key: string): string | null => {
  const v = route.query[key];
  return typeof v === 'string' && v !== '' ? v : null;
};
/** Đọc query param số — null khi thiếu/âm/không parse được. */
const queryNum = (key: string): number | null => {
  const v = queryString(key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
/**
 * Đọc query param multi-value (multi-select filter): nhận cả CSV
 * `?type=full-time,internship` lẫn repeated key `?type=a&type=b` (Vue Router
 * trả string[]). Split + trim + bỏ rỗng + dedupe. Giá trị lạ CHƯA lọc ở đây —
 * phần hydrate chỉ tick option khớp enum load từ API, nên giá trị lạ tự bị
 * bỏ và không bao giờ gửi lên BE.
 */
const queryCsv = (key: string): string[] => {
  const raw = route.query[key];
  const parts = (Array.isArray(raw) ? raw : [raw])
    .filter((v): v is string => typeof v === 'string')
    .flatMap((v) => v.split(','));
  return Array.from(new Set(parts.map((s) => s.trim()).filter(Boolean)));
};

/** Filters đọc từ URL lúc mount — dùng để init state bên dưới. `type`/`level`
 *  chưa validate chống enum thật — chỉ được dùng khi khớp option load từ API
 *  (xem onMounted), URL lạ không bao giờ gửi thẳng lên BE. */
const initialFilters = {
  search: queryString('keyword') ?? '',
  location: queryString('location'),
  jobType: queryCsv('type') as JobType[],
  jobLevel: queryCsv('level') as JobLevel[],
  salaryMin: queryNum('salaryMin'),
  salaryMax: queryNum('salaryMax'),
  page: Math.max(1, queryNum('page') ?? 1),
};

/** true trong lúc khôi phục state từ URL — chặn watcher tự fetch; khi hydrate
 *  xong, onMounted gọi đúng 1 lần `fetchList` với filter từ URL (xem cuối
 *  onMounted). */
let isHydrating = true;


/** Open state riêng cho dropdown Location trên search bar — tách khỏi
 *  `locationDropdownOpen` của sidebar để 2 dropdown có thể mở độc lập. */
const searchBarLocationOpen = ref(false);
/** Tương tự cho dropdown JobType trên search bar — tách khỏi sidebar. */
const searchBarJobTypeOpen = ref(false);

/** Template refs cho 3 dropdown container — dùng với `onClickOutside` để đóng
 *  khi user click ra ngoài (xem `onMounted`). Mỗi dropdown có wrapper `.relative`
 *  riêng; ref trỏ vào wrapper đó để ignore click trong dropdown (chọn item). */
const sidebarLocationRef = useTemplateRef<HTMLElement>('sidebarLocation');
const searchBarLocationRef = useTemplateRef<HTMLElement>('searchBarLocation');
const searchBarJobTypeRef = useTemplateRef<HTMLElement>('searchBarJobType');

/** Label hiển thị trên button JobType search bar — multi-select: 0 chọn →
 *  null (placeholder "Hình thức"); 1 chọn → label option; nhiều → "N hình
 *  thức" (đếm để label không làm vỡ layout khi chọn nhiều). */
const searchBarJobTypeLabel = computed<string | null>(() => {
  const picked = jobTypes.value.filter((o) => o.checked);
  if (picked.length === 0) return null;
  if (picked.length === 1) return picked[0].label;
  return `${picked.length} hình thức`;
});

/** Các filter đang active hiển thị dưới "Search result" — list string ngắn
 *  (vd ["Tại Hà Nội", "Toàn thời gian", "Senior"]). Giúp user biết đang
 *  filter gì mà không cần mở lại sidebar. Rỗng = không có filter nào. */
/** Active filter chip — mỗi chip có label + class Tailwind (color + bg) để
 *  hiển thị theo brand. Dùng cho cả JobSearchView chip + JobDetailView badge. */
const JOB_TYPE_CHIP: Record<JobType, { class: string; icon: typeof Briefcase }> = {
  'full-time': { class: 'text-blue-600 bg-blue-50', icon: Briefcase },
  'part-time': { class: 'text-indigo-600 bg-indigo-50', icon: Clock },
  contract:    { class: 'text-amber-600 bg-amber-50', icon: FileSignature },
  internship:  { class: 'text-green-600 bg-green-50', icon: GraduationCap },
  freelance:   { class: 'text-purple-600 bg-purple-50', icon: Laptop },
};
const JOB_LEVEL_CHIP: Record<JobLevel, { class: string; icon: typeof Briefcase }> = {
  intern:  { class: 'text-slate-600 bg-slate-50', icon: Sprout },
  fresher: { class: 'text-cyan-600 bg-cyan-50',   icon: Sparkles },
  junior:  { class: 'text-sky-600 bg-sky-50',     icon: BookOpen },
  mid:     { class: 'text-teal-600 bg-teal-50',   icon: Code },
  senior:  { class: 'text-orange-600 bg-orange-50',icon: Briefcase },
  lead:    { class: 'text-pink-600 bg-pink-50',   icon: Crown },
  manager: { class: 'text-rose-600 bg-rose-50',   icon: Users },
};
const LOCATION_CHIP = { class: 'text-slate-600 bg-slate-50', icon: MapPin };

/** Active filter chips — array object thay vì string để chứa class+icon. */
interface FilterChip {
  key: string;          // unique key cho v-for
  label: string;
  class: string;
  icon: typeof Briefcase;
}
const activeFilterChips = computed<FilterChip[]>(() => {
  const chips: FilterChip[] = [];
  if (selectedLocation.value) {
    chips.push({
      key: `loc-${selectedLocation.value}`,
      label: `Tại ${selectedLocation.value}`,
      class: LOCATION_CHIP.class,
      icon: LOCATION_CHIP.icon,
    });
  }
  // Multi-select: mỗi option đang checked là 1 chip riêng (key chứa enum key
  // để v-for diff đúng khi thêm/bớt).
  for (const t of jobTypes.value) {
    if (!t.checked) continue;
    const meta = JOB_TYPE_CHIP[t.key];
    chips.push({
      key: `type-${t.key}`,
      label: t.label,
      class: meta.class,
      icon: meta.icon,
    });
  }
  for (const l of jobLevels.value) {
    if (!l.checked) continue;
    const meta = JOB_LEVEL_CHIP[l.key];
    chips.push({
      key: `level-${l.key}`,
      label: l.label,
      class: meta.class,
      icon: meta.icon,
    });
  }
  // Salary chip — chỉ hiển thị khi slider khác full bounds.
  const [lo, hi] = salaryRange.value;
  const atMin = lo > salaryBounds.value.min + 1;
  const atMax = hi < salaryBounds.value.max - 1;
  if (atMin || atMax) {
    chips.push({
      key: 'salary',
      label: `${formatVnd(lo)} – ${formatVnd(hi)}`,
      class: 'text-emerald-600 bg-emerald-50',
      icon: Wallet,
    });
  }
  return chips;
});

/** Click 1 option JobType từ dropdown search bar — toggle độc lập option đó
 *  (multi-select, đồng bộ tự động với sidebar vì cùng ref `jobTypes`).
 *  KHÔNG đóng dropdown sau mỗi lần chọn — user tick nhiều option liên tiếp,
 *  đóng bằng onClickOutside khi click ra ngoài. `null` ("Tất cả") → bỏ tick
 *  toàn bộ. */
const onSearchBarJobTypeSelect = (key: JobType | null): void => {
  if (key === null) {
    for (const t of jobTypes.value) {
      t.checked = false;
    }
    return;
  }
  const target = jobTypes.value.find((o) => o.key === key);
  if (target) target.checked = !target.checked;
};


/** Filter sidebar — collapsed state cho từng section. Mặc định mở 4 section
 *  hiển thị content (Location / Job Type / Experience / Salary). */
const expanded = ref<Record<string, boolean>>({
  location: true,
  jobType: true,
  experience: true,
  salary: true,
});


const toggleSection = (key: string): void => {
  expanded.value[key] = !expanded.value[key];
};


/** Job Type checkboxes — UI giữ nguyên từ mockup, key ánh xạ sang enum backend.
 *  Multi-select: nhiều checkbox có thể checked cùng lúc, BE nhận CSV
 *  `?jobType=a,b` và lọc IN. Click checkbox đang checked → bỏ tick.
 *
 *  Lưu ý: `remote` và `student` không phải enum JobType thật của BE — map:
 *    - `remote`      → toggle `remoteOk=true` (xem watcher bên dưới)
 *    - `student`     → không map (mockup-only), giữ như dummy
 *    - các key còn lại map trực tiếp vào `ListJobQuery.jobType`.
 */
/**
 * JobType enum values load từ `GET /jobs/job-types` — sync với BE enum
 * `job_type`. Mapping `key → label` ở client để hiển thị tiếng Việt thân thiện
 * (vd "full-time" → "Toàn thời gian"). Mỗi option có `checked` để UI dùng
 * multi-select (xem `onJobTypeToggle`).
 *
 * Cũ từng hardcode 5 option (full-time/part-time/remote/student/contract) —
 * 'remote' map sang `remoteOk=true` (khác field), 'student' là mockup-only.
 * Sau khi sync API, chỉ giữ các giá trị đúng enum `job_type`. Remote vẫn
 * có thể toggle qua checkbox riêng (chưa làm — TODO).
 */
interface JobTypeOption {
  key: JobType;
  label: string;
  checked: boolean;
}
/** Map enum value → label tiếng Anh cho dropdown. Extend khi BE thêm value. */
const JOB_TYPE_LABELS: Record<JobType, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  freelance: 'Freelance',
};
/** Runtime options built từ API response + label map. */
const jobTypes = ref<JobTypeOption[]>([]);


/**
 * JobLevel enum values load từ `GET /jobs/job-levels` — sync với BE enum
 * `job_level`. Mapping `key → label` ở client tương tự `JOB_TYPE_LABELS`.
 */
interface JobLevelOption {
  key: JobLevel;
  label: string;
  checked: boolean;
}
const JOB_LEVEL_LABELS: Record<JobLevel, string> = {
  intern: 'Intern',
  fresher: 'Fresher',
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  lead: 'Lead',
  manager: 'Manager',
};
/** Runtime options built từ API response + label map. */
const jobLevels = ref<JobLevelOption[]>([]);


/** Toggle một option JobType — multi-select checkbox: mỗi option độc lập,
 *  click option đang checked → bỏ tick, chưa checked → tick thêm. */
const onJobTypeToggle = (clicked: JobTypeOption): void => {
  clicked.checked = !clicked.checked;
};


/** Location filter — `null` nghĩa là "Anywhere" (không filter).
 *  Danh sách city load từ `jobApi.cities()` (BE đã strip prefix).
 *  Init từ URL khi có (hydrate — xem `initialFilters`). */
const selectedLocation = ref<string | null>(initialFilters.location);
const cities = ref<string[]>([]);
const locationsLoading = ref(false);
const locationsError = ref<string | null>(null);
/** Đóng/mở dropdown city. */
const locationDropdownOpen = ref(false);


/**
 * Salary histogram — mock bars (chưa nối aggregate API; TODO thay bằng
 * `width_bucket(salary_min, ...)` query khi cần).
 */
const salaryBars: number[] = [
  18, 22, 28, 35, 38, 42, 55, 60, 70, 75, 80, 65, 70, 75, 85, 90, 70, 60,
];


/**
 * Salary range bounds (VND) load từ `GET /jobs/salary-range` lúc mount.
 * Fallback 0 → 200tr VND khi API chưa về/DB rỗng — slider vẫn render
 * không crash; filter sẽ trả rỗng nếu ngoài range thật.
 */
const SALARY_FALLBACK_BOUNDS = { min: 0, max: 200_000_000 };
const salaryBounds = ref<{ min: number; max: number }>(SALARY_FALLBACK_BOUNDS);

/**
 * Slider value (VND, tuyệt đối — không phải percent). Initial từ URL khi có,
 * không thì full bounds. Khi user kéo thumb → setTimeout 300ms → fetchList
 * với overlap filter.
 */
const salaryRange = ref<[number, number]>([
  initialFilters.salaryMin ?? SALARY_FALLBACK_BOUNDS.min,
  initialFilters.salaryMax ?? SALARY_FALLBACK_BOUNDS.max,
]);

/** JobType list — collapse về 2 option đầu (theo mockup), "View All" toggle
 *  mở rộng. Reset khi user đổi filter hoặc re-mount — không persist. */
const showAllJobTypes = ref(false);
const VISIBLE_JOB_TYPES_COUNT = 2;
const visibleJobTypes = computed<JobTypeOption[]>(() => {
  if (showAllJobTypes.value) return jobTypes.value;
  return jobTypes.value.slice(0, VISIBLE_JOB_TYPES_COUNT);
});


/** Format VND thành chuỗi hiển thị ngắn gọn — "15 triệu", "1.5 tỷ". */
const formatVnd = (v: number): string => {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} tỷ`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)} triệu`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return `${v.toLocaleString('vi-VN')}đ`;
};

/** Map VND value → percent của slider track (0–100) dựa trên salaryBounds.
 *  Dùng cho `left:` style của 2 thumb. */
const salaryToPercent = (v: number): number => {
  const { min, max } = salaryBounds.value;
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
};

/**
 * Drag state cho 2 thumb — track thumb đang kéo + vị trí X ban đầu.
 * Dùng `setPointerCapture` để thumb tracking tiếp tục khi con trỏ ra ngoài
 * element (vd kéo nhanh). `select-none touch-none` ở track ngăn select text +
 * native touch scroll khi đang kéo.
 */
let draggingThumb: 0 | 1 | null = null;
let dragStartX = 0;
let dragStartValue = 0;
const MIN_GAP_VND = 100_000;

const onSalaryThumbDown = (which: 0 | 1, e: PointerEvent): void => {
  draggingThumb = which;
  dragStartX = e.clientX;
  dragStartValue = salaryRange.value[which];
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
};

const onSalaryThumbMove = (e: PointerEvent): void => {
  if (draggingThumb === null) return;
  const trackEl = (e.currentTarget as HTMLElement).parentElement;
  if (!trackEl) return;
  const trackWidth = trackEl.getBoundingClientRect().width;
  if (trackWidth <= 0) return;
  const { min, max } = salaryBounds.value;
  if (max <= min) return;
  const deltaPct = ((e.clientX - dragStartX) / trackWidth) * 100;
  // Map delta percent → VND dựa trên full range span.
  const deltaVnd = (deltaPct / 100) * (max - min);
  const next = dragStartValue + deltaVnd;
  const clamped = Math.max(min, Math.min(max, Math.round(next)));
  const [lo, hi] = salaryRange.value;
  // Đảm bảo min gap giữa 2 thumb để tránh invalid filter.
  if (draggingThumb === 0) {
    salaryRange.value = [Math.min(clamped, hi - MIN_GAP_VND), hi];
  } else {
    salaryRange.value = [lo, Math.max(clamped, lo + MIN_GAP_VND)];
  }
};

const onSalaryThumbUp = (e: PointerEvent): void => {
  if (draggingThumb === null) return;
  draggingThumb = null;
  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
};

const paginationPages = computed<(number | '…')[]>(() => {
  const total = totalPages.value;
  const current = page.value;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('…');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('…');
  pages.push(total);
  return pages;
});

const goToPage = (n: number): void => {
  if (n < 1 || n > totalPages.value || n === page.value) return;
  store.setPage(n);
  syncQueryToUrl();
  // Scroll job list lên top — UX tốt hơn khi chuyển trang.
  // Dùng `nextTick` chờ DOM update sau khi `items` thay đổi.
  void Promise.resolve().then(() => {
    const article = document.querySelector('article');
    article?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
};


/* ============================================================================
 * API integration
 * ========================================================================== */
const store = useJobStore();
const router = useRouter();
const { items, total, page, pageSize, totalPages, loading } = storeToRefs(store);

/**
 * Hiển thị count linh động — ưu tiên `total` (từ pagination) nhưng fallback
 * sang `items.length` khi `total === 0` mà vẫn có data (vd: store bị stale
 * sau khi reset/refresh race, hoặc pagination thiếu field).
 * Cả hai đều set cùng lúc trong fetchList nhưng template render qua
 * computed này để Vue reactivity đảm bảo consistent snapshot.
 */
const resultCount = computed<number>(() => items.value.length || total.value || 0);

/** Search keyword — bind với input, debounce rồi fetch lại list. Init từ URL
 *  TRƯỚC `useDebounce` để `debouncedKeyword` khởi tạo cùng giá trị (watcher
 *  debounce không fire lúc hydrate — không gây fetch thừa khi mount). */
const searchKeyword = ref(initialFilters.search);
const debouncedKeyword = useDebounce(searchKeyword, 300);

const savedJobIds = ref<Set<string>>(new Set());
const savedJobsLoading = ref(false);

watch(debouncedKeyword, (kw) => {
  const trimmed = kw.trim();
  void store.fetchList({ search: trimmed || undefined }, 1);
  syncQueryToUrl();
});

/** Watch Location — tương tự keyword: luôn set `locationCity` (undefined khi
 *  clear để spread xoá key cũ trong `query.value`). Guard `isHydrating`:
 *  giá trị init từ URL không được tự fetch (fetch tổng chạy ở onMounted). */
watch(selectedLocation, (city) => {
  if (isHydrating) return;
  void store.fetchList({ locationCity: city || undefined }, 1);
  syncQueryToUrl();
});

/** Watch combined jobTypes + jobLevels + salaryRange — batch 1 lần khi user
 *  toggle filter/kéo slider. Dùng 1 watcher cho 3 filter nguồn → thay đổi
 *  nhiều filter liên tiếp gom thành 1 request.
 *
 *  Dùng `setTimeout(200)` debounce: clear timer cũ + set timer mới → chỉ tick
 *  cuối cùng chạy callback → 1 fetchList duy nhất. 200ms gom trọn 1 lần kéo
 *  slider (bỏ qua micro-pause tay < 200ms) mà vẫn nhanh khi click checkbox.
 *  Guard `isHydrating`: khi populate options từ API lúc mount (cả khi khôi
 *  phục checked từ URL), watcher fire nhưng phải bỏ — fetch tổng chạy đúng
 *  1 lần ở cuối onMounted. */
let filterBatchHandle: ReturnType<typeof setTimeout> | null = null;
watch(
  [jobTypes, jobLevels, salaryRange],
  () => {
    if (isHydrating) return;
    if (filterBatchHandle) clearTimeout(filterBatchHandle);
    filterBatchHandle = setTimeout(() => {
      filterBatchHandle = null;
      void store.fetchList(currentFilterQuery(), 1);
      syncQueryToUrl();
    }, 200);
  },
  { deep: true },
);

/**
 * Build `ListJobQuery` từ state UI hiện tại — dùng chung cho fetch (batch
 * watcher + hydrate) và sync URL. Mọi key luôn có mặt (undefined khi trống)
 * → spread trong `fetchList` ghi đè sạch query stale (Pinia store sống qua
 * các lần remount khi back từ Job Detail).
 *
 * `checked` chỉ có nghĩa sau khi options load từ API — nhờ vậy enum lạ trong
 * URL tự bị bỏ qua: không option nào khớp → key undefined, không gửi lên BE.
 */
const currentFilterQuery = (): ListJobQuery => {
  const selectedTypes = jobTypes.value.filter((o) => o.checked).map((o) => o.key);
  const selectedLevels = jobLevels.value.filter((o) => o.checked).map((o) => o.key);
  const [lo, hi] = salaryRange.value;
  // Skip salary filter khi slider ở đúng bounds (tolerance 1 VND cho
  // float precision edge case) → tránh request thừa + index scan.
  const atMinBound = lo <= salaryBounds.value.min + 1;
  const atMaxBound = hi >= salaryBounds.value.max - 1;
  return {
    search: debouncedKeyword.value.trim() || undefined,
    locationCity: selectedLocation.value ?? undefined,
    // Multi-select: mảng (serializer http.ts ép String() thành CSV). Rỗng →
    // undefined để store xoá key qua merge spread, không truyền [].
    jobType: selectedTypes.length > 0 ? selectedTypes : undefined,
    jobLevel: selectedLevels.length > 0 ? selectedLevels : undefined,
    salaryMin: atMinBound ? undefined : Math.round(lo),
    salaryMax: atMaxBound ? undefined : Math.round(hi),
  };
};

/**
 * Sync filter + page hiện tại vào URL bằng `router.replace` (không push —
 * tránh phình history khi gõ chữ/kéo slider). URL mới ghi đè trên cùng 1
 * history entry → browser Back từ Job Detail quay về đúng trạng thái list.
 */
const syncQueryToUrl = (): void => {
  const q = currentFilterQuery();
  const query: Record<string, string> = {};
  if (q.search) query.keyword = q.search;
  if (q.locationCity) query.location = q.locationCity;
  // Multi-select → CSV, thứ tự ổn định theo thứ tự option hiện có.
  if (Array.isArray(q.jobType) && q.jobType.length > 0) query.type = q.jobType.join(',');
  if (Array.isArray(q.jobLevel) && q.jobLevel.length > 0) query.level = q.jobLevel.join(',');
  if (q.salaryMin != null) query.salaryMin = String(q.salaryMin);
  if (q.salaryMax != null) query.salaryMax = String(q.salaryMax);
  if (page.value > 1) query.page = String(page.value);
  void router.replace({ query });
};

/** Toggle JobLevel option — multi-select, logic giống `onJobTypeToggle`. */
const onJobLevelToggle = (clicked: JobLevelOption): void => {
  clicked.checked = !clicked.checked;
};

onMounted(() => {
    document.documentElement.classList.add('no-page-scroll');

});

onBeforeUnmount(() => {
    document.documentElement.classList.remove('no-page-scroll');

});
onMounted(async () => {
  // KHÔNG fetch jobs ở đây — fetch ban đầu chạy đúng 1 lần ở cuối hàm này
  // (sau khi options/cities/bounds đã load) với filter đọc từ URL, thay vì
  // để watcher tự fetch khi populate options (tránh race nhiều request đè
  // nhau như trước).
  // Song song: load cities + jobTypes + saved jobs của user.
  locationsLoading.value = true;
  savedJobsLoading.value = true;
  await Promise.allSettled([
    jobApi.cities()
      .then(({ data }) => { cities.value = data.data; })
      .catch((e) => {
        locationsError.value = e instanceof Error ? e.message : 'Không tải được danh sách địa điểm';
      })
      .finally(() => { locationsLoading.value = false; }),
    jobApi.jobTypes()
      .then(({ data }) => {
        // Build jobTypes từ enum values API + label map. Nếu BE thêm value
        // mới chưa có trong JOB_TYPE_LABELS → fallback raw enum value.
        // `checked` theo URL (hydrate) — giá trị lạ trong URL không khớp
        // option nào → không có gì checked, tự loại khỏi filter.
        jobTypes.value = data.data.map((key) => ({
          key: key as JobType,
          label: JOB_TYPE_LABELS[key as JobType] ?? key,
          // Hydrate multi-select: tick mọi giá trị URL khớp enum — giá trị lạ
          // không khớp option nào → tự bị bỏ, không bao giờ gửi lên BE.
          checked: initialFilters.jobType.includes(key as JobType),
        }));
        // Option khôi phục nằm ngoài 2 option đầu → mở "Xem hết" để user
        // thấy checkbox đang checked.
        const topKeys = jobTypes.value.slice(0, VISIBLE_JOB_TYPES_COUNT).map((o) => o.key);
        if (initialFilters.jobType.some((t) => !topKeys.includes(t))) {
          showAllJobTypes.value = true;
        }
      })
      .catch((e) => { console.error('Load job-types failed:', e); }),
    jobApi.jobLevels()
      .then(({ data }) => {
        // Tương tự jobTypes: build options từ API + label map, fallback raw
        // enum value nếu BE thêm value mới chưa có trong map. `checked` theo
        // URL (hydrate).
        jobLevels.value = data.data.map((key) => ({
          key: key as JobLevel,
          label: JOB_LEVEL_LABELS[key as JobLevel] ?? key,
          // Hydrate multi-select — tương tự jobTypes.
          checked: initialFilters.jobLevel.includes(key as JobLevel),
        }));
      })
      .catch((e) => { console.error('Load job-levels failed:', e); }),
    jobApi.salaryRange()
      .then(({ data }) => {
        const min = data.data.min;
        const max = data.data.max;
        // Chỉ set bounds khi BE trả về hợp lệ (max > min > 0); nếu không
        // thì giữ fallback để slider không crash.
        if (min != null && max != null && max > min && max > 0) {
          salaryBounds.value = { min, max };
          if (isHydrating && (initialFilters.salaryMin != null || initialFilters.salaryMax != null)) {
            // Khôi phục từ URL: giữ range user đã chọn, clamp vào bounds thật.
            const lo = Math.max(min, Math.min(max, salaryRange.value[0]));
            const hi = Math.max(min, Math.min(max, salaryRange.value[1]));
            salaryRange.value = lo <= hi ? [lo, hi] : [min, max];
          } else {
            salaryRange.value = [min, max];
          }
        }
      })
      .catch((e) => { console.error('Load salary-range failed:', e); }),
    savedJobApi.list({ page: 1, limit: 100 })
      .then(({ data }) => {
        // Populate Set từ pagination trang đầu (max 100 job lưu). Với user
        // lưu >100 job có thể miss — chấp nhận cho UX scope hiện tại; nếu
        // cần chính xác, có thể loop page đến totalPages.
        data.data.forEach((item) => savedJobIds.value.add(item.job.id));
      })
      .catch(() => { /* 401 (chưa login) → để Set rỗng, icon hiển thị outline */ })
      .finally(() => { savedJobsLoading.value = false; }),
  ]);

  // Hydrate xong → mở khoá watcher và fetch đúng 1 lần với filter từ URL
  // (URL trống → filter mặc định). resetFilters trước để không kế thừa query
  // stale trong store (store sống qua remount khi back từ Job Detail, và
  // dùng chung với JobSearchView).
  isHydrating = false;
  store.resetFilters();
  void store.fetchList(currentFilterQuery(), initialFilters.page);

  // Đóng dropdown khi click ra ngoài container — dùng onClickOutside của
  // @vueuse/core (auto cleanup khi unmount). Mỗi dropdown 1 handler riêng,
  // ignore click trong chính nó (chọn item) để không đóng nhầm.
  if (sidebarLocationRef.value) {
    onClickOutside(sidebarLocationRef, () => { locationDropdownOpen.value = false; });
  }
  if (searchBarLocationRef.value) {
    onClickOutside(searchBarLocationRef, () => { searchBarLocationOpen.value = false; });
  }
  if (searchBarJobTypeRef.value) {
    onClickOutside(searchBarJobTypeRef, () => { searchBarJobTypeOpen.value = false; });
  }
});


/* ============================================================================
 * Format helpers
 * ========================================================================== */
const formatSalary = (j: JobListItem): string => {
  if (!j.salaryVisible) return 'Thoả thuận';
  const { salaryMin, salaryMax } = j;
  if (!salaryMin && !salaryMax) return 'Thoả thuận';
  const toM = (s: string): string => `${(Number(s) / 1_000_000).toFixed(0)} triệu`;
  if (salaryMin && salaryMax) return `${toM(salaryMin)} – ${toM(salaryMax)}`;
  if (salaryMin) return `Từ ${toM(salaryMin)}`;
  return `Đến ${toM(salaryMax!)}`;
};

/**
 * Format JobType cho badge trên job card — dùng chung `JOB_TYPE_LABELS` để
 * đồng nhất với dropdown filter (cùng string 1 chỗ).
 */
const formatJobType = (t: JobType | null): string => {
  if (!t) return '';
  return JOB_TYPE_LABELS[t] ?? t;
};

/** Tạo hex ổn định từ chuỗi (dùng cho gradient logo khi không có logoUrl). */
const stringHash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const COMPANY_COLORS = ['#3B82F6', '#1E40AF', '#E11D48', '#0EA5E9', '#10B981', '#8B5CF6', '#F59E0B'];
const companyColor = (j: JobListItem): string =>
  COMPANY_COLORS[stringHash(j.companyId || j.companyName || j.id) % COMPANY_COLORS.length];


/** Phân loại trạng thái tuyển dụng — mirror DB enum `hiring_status` (migration 0038).
 *  Employer set thủ công lúc tạo/sửa job; FE chỉ đọc + render badge tương ứng. */
type HiringStatus = 'urgent' | 'active' | 'normal';


interface JobCard {
  id: string;
  slug: string | null;
  title: string;
  company: string;
  companyColor: string;
  /** Logo URL từ API (`companies.logoUrl` qua LEFT JOIN). Null → fallback
   *  placeholder gradient + icon như cũ. */
  companyLogoUrl: string | null;
  location: string;
  /** Rating trung bình 1–5 từ `job_feedbacks`. `null` khi job chưa có
   *  feedback → UI ẩn icon sao + số. */
  ratingAvg: number | null;
  /** Số feedback. Companion của `ratingAvg`. */
  ratingCount: number;
  /** Description từ list API — BE trả field `descriptions`. */
  descriptions?: string | null;
  /** Mock-only fields (không từ API), giữ để tương thích template. */
  bullets?: string[];
  paragraph?: string;
  /** API list chỉ trả jobType → map thành badge đơn giản. */
  badges: { label: string; variant: 'boosted' | 'responsive' | 'urgent' | 'choice' }[];
  /** Phân loại tuyển dụng — dùng cho badge Urgently / Actively. */
  hiringStatus: HiringStatus;
  postedAt: string;
  salary: string;
  workType: string;
  viewsCount: number;
  appliesCount: number;
}

const toJobCard = (j: JobListItem): JobCard => {
  const badges: JobCard['badges'] = [];
  // Badge urgency dựa trên `hiringStatus` từ DB — chỉ render 1 trong 2 loại,
  // tránh trùng lặp ("Urgently" + "Actively" cùng lúc gây nhiễu). `normal`
  // thì không render badge urgency nào.
  if (j.hiringStatus === 'urgent') {
    badges.push({ label: 'Urgently Hiring', variant: 'urgent' });
  } else if (j.hiringStatus === 'active') {
    badges.push({ label: 'Actively Hiring', variant: 'choice' });
  }
  if (j.jobType) {
    badges.push({ label: formatJobType(j.jobType), variant: 'responsive' });
  }
  const workType = j.remoteOk
    ? 'Remote'
    : j.jobType === 'part-time'
      ? 'Part-time'
      : (j.location?.city ?? 'Onsite');
  return {
    id: j.id,
    slug: j.slug,
    title: j.title,
    company: j.companyName ?? 'Công ty ẩn danh',
    companyColor: companyColor(j),
    companyLogoUrl: j.companyLogoUrl ?? null,
    location: j.location?.city ?? '—',
    ratingAvg: j.ratingAvg ?? null,
    ratingCount: j.ratingCount ?? 0,
    descriptions: j.descriptions ?? null,
    badges,
    hiringStatus: j.hiringStatus,
    postedAt: dayjs(j.publishedAt ?? j.createdAt).format('DD-MM-YYYY · HH:mm'),
    salary: formatSalary(j),
    workType,
    viewsCount: j.viewsCount ?? 0,
    appliesCount: j.appliesCount ?? 0,
  };
};

const jobs = computed<JobCard[]>(() => items.value.map(toJobCard));


const clearKeyword = (): void => {
  searchKeyword.value = '';
};

/**
 * Nút Search — bấm là fetch ngay với keyword đang gõ (bỏ chờ debounce 300ms).
 *
 * 2 nhánh để tránh double request:
 *  - Keyword KHÁC lần fetch trước → chỉ đẩy vào `debouncedKeyword`, watcher
 *    fire fetch + sync URL (timer debounce cũ sau đó set lại cùng giá trị →
 *    không fire thêm lần nữa).
 *  - Keyword GIỐNG lần fetch trước (auto-fetch đã chạy sau 300ms) → watcher
 *    sẽ KHÔNG fire nếu chỉ gán giá trị → tự gọi fetch + sync trực tiếp.
 */
const onSearchSubmit = (): void => {
  const next = searchKeyword.value;
  if (debouncedKeyword.value === next) {
    const trimmed = next.trim();
    void store.fetchList({ search: trimmed || undefined }, 1);
    syncQueryToUrl();
  } else {
    debouncedKeyword.value = next;
  }
};

/**
 * Reset TẤT CẢ filter về trạng thái rỗng — keyword, location, jobType,
 * jobLevel. Gọi 1 lần → các watcher tương ứng (keyword 300ms debounced,
 * location/jobType/jobLevel sync) sẽ fetch lại list với filter rỗng.
 *
 * Lưu ý: KHÔNG gọi `store.fetchList` ở đây — để watchers lo, tránh 2 request
 * song song có thể đè nhau.
 */
const clearAllFilters = (): void => {
  clearKeyword();
  selectedLocation.value = null;
  for (const t of jobTypes.value) t.checked = false;
  for (const l of jobLevels.value) l.checked = false;
  // Reset salary slider về full bounds — watcher sẽ fire sau debounce 50ms
  // với salaryMin/salaryMax = undefined → backend skip filter.
  salaryRange.value = [salaryBounds.value.min, salaryBounds.value.max];
};

const onCardClick = (j: JobCard): void => {
  const path = j.slug ?? j.id;
  void router.push(`/candidate/viec-lam/${path}`);
};

/**
 * Toggle save/unsave job — gọi `POST /saved-jobs` hoặc `DELETE /saved-jobs/:id`.
 * Optimistic update: cập nhật `savedJobIds` TRƯỚC khi API resolve, rollback
 * nếu request fail. UX mượt hơn vì không cần spinner cho thao tác 1-click.
 *
 * @click.stop ở template đã chặn bubble lên card (không trigger `onCardClick`).
 */
const onToggleSaveJob = async (jobId: string): Promise<void> => {
  const wasSaved = savedJobIds.value.has(jobId);
  // Optimistic toggle
  if (wasSaved) {
    savedJobIds.value.delete(jobId);
  } else {
    savedJobIds.value.add(jobId);
  }
  try {
    if (wasSaved) {
      await savedJobApi.unsave(jobId);
    } else {
      await savedJobApi.save(jobId);
    }
  } catch (e) {
    // Rollback nếu API fail (vd 401 chưa login, 404 job bị xoá, network).
    if (wasSaved) {
      savedJobIds.value.add(jobId);
    } else {
      savedJobIds.value.delete(jobId);
    }
    console.error('Toggle save job failed:', e);
  }
};
</script>


<template>
  <!-- Outer = full viewport height + flex column. `overflow-hidden` chặn body
       scroll toàn trang — chỉ cho phép scroll trong 2 cột (sidebar + main).
       `flex-1 min-h-0` quan trọng để cho phép children overflow. -->
    <div class="h-screen overflow-clip w-full bg-white font-poppins text-[#0F172A] flex flex-col">
    <!-- ============ Body: sidebar + main ============ -->
    <div class="w-full grid grid-cols-12 lg:grid-rows-[minmax(0,1fr)] gap-4 flex-1 min-h-0">
      <!-- ============ Sidebar filter (cuộn riêng, ẩn thanh cuộn) ============ -->
      <aside class="col-span-12 lg:col-span-3 xl:col-span-3 overflow-y-auto scrollbar-none">
        <div class="bg-white rounded-2xl rounded-tr-none border-r border-[#E5E7EB] p-5">
          <!-- Job Searcher -->
          <div class="flex items-center justify-between mb-5">
            <h2 class="text-[18px] font-bold text-[#0F172A] inline-flex items-center gap-1.5">
              Tìm kiếm việc làm
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 text-[#0F172A]">
                <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </h2>
          </div>


          <!-- Location -->
          <section class="border-b border-[#E5E7EB] py-3.5">
            <button
              type="button"
              class="w-full flex items-center justify-between text-left"
              @click="toggleSection('location')"
            >
              <span class="text-[14px] font-medium text-[#0F172A]">Vị trí</span>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
                class="w-4 h-4 text-[#64748B] transition-transform"
                :class="expanded.location ? '' : 'rotate-180'">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
              </svg>
            </button>
            <div v-if="expanded.location" class="mt-3 bg-[#F1F5F9] rounded-lg p-2.5">
              <div ref="sidebarLocation" class="relative">
                <button
                  type="button"
                  class="w-full h-10 px-3 rounded-lg bg-white border border-[#E5E7EB] flex items-center gap-2 text-[13px] text-[#0F172A] hover:bg-[#F8FAFC] transition"
                  @click="locationDropdownOpen = !locationDropdownOpen"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-4 h-4 text-[#64748B]">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                  </svg>
                  <span class="flex-1 text-left">
                    {{ selectedLocation ?? 'Mọi địa điểm' }}
                  </span>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
                    class="w-3.5 h-3.5 text-[#64748B] transition-transform"
                    :class="locationDropdownOpen ? 'rotate-180' : ''">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                <!-- Dropdown city list -->
                <div
                  v-if="locationDropdownOpen"
                  class="absolute z-10 mt-1 w-full max-h-60 overflow-auto bg-white border border-[#E5E7EB] rounded-lg shadow-md"
                >
                  <button
                    type="button"
                    class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
                    :class="!selectedLocation ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
                    @click="selectedLocation = null; locationDropdownOpen = false"
                  >Mọi địa điểm</button>
                  <p v-if="locationsLoading" class="px-3 py-2 text-[12.5px] text-[#64748B]">Đang tải...</p>
                  <p v-else-if="locationsError" class="px-3 py-2 text-[12.5px] text-[#DC2626]">{{ locationsError }}</p>
                  <template v-else>
                    <button
                      v-for="city in cities"
                      :key="city"
                      type="button"
                      class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
                      :class="selectedLocation === city ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
                      @click="selectedLocation = city; locationDropdownOpen = false"
                    >{{ city }}</button>
                    <p v-if="!cities.length" class="px-3 py-2 text-[12.5px] text-[#64748B]">Chưa có địa điểm nào.</p>
                  </template>
                </div>
              </div>
            </div>
          </section>


          <!-- Job Type -->
          <section class="border-b border-[#E5E7EB] py-3.5">
            <button
              type="button"
              class="w-full flex items-center justify-between text-left"
              @click="toggleSection('jobType')"
            >
              <span class="text-[14px] font-medium text-[#0F172A]">Hình thức</span>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
                class="w-4 h-4 text-[#64748B] transition-transform"
                :class="expanded.jobType ? '' : 'rotate-180'">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
              </svg>
            </button>
            <ul v-if="expanded.jobType" class="mt-3 space-y-2.5 bg-[#F1F5F9] rounded-lg p-3">
              <li v-for="t in visibleJobTypes" :key="t.key" class="flex items-center gap-2.5">
                <label class="relative inline-flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    :checked="t.checked"
                    @change="onJobTypeToggle(t)"
                    class="peer sr-only"
                  />
                  <span
                    class="h-[18px] w-[18px] rounded border-2 grid place-items-center transition"
                    :class="t.checked
                      ? 'bg-[#1E40AF] border-[#1E40AF]'
                      : 'bg-white border-[#CBD5E1] group-hover:border-[#94A3B8]'"
                  >
                    <svg v-if="t.checked" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" class="w-3 h-3">
                      <path fill-rule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd" />
                    </svg>
                  </span>
                  <span class="text-[13px] text-[#334155] group-hover:text-[#0F172A]" :class="t.checked ? 'font-semibold text-[#0F172A]' : ''">{{ t.label }}</span>
                </label>
              </li>
              <li v-if="jobTypes.length > VISIBLE_JOB_TYPES_COUNT" class="flex items-center justify-between pt-1">
                <button
                  type="button"
                  class="text-[13px] font-medium text-[#1E40AF] hover:underline"
                  @click="showAllJobTypes = !showAllJobTypes"
                >{{ showAllJobTypes ? 'Thu gọn' : 'Xem hết' }}</button>
                <span class="text-[11px] font-semibold text-white bg-[#1E40AF] rounded-full px-2 py-0.5">{{ jobTypes.length }}</span>
              </li>
            </ul>
          </section>


          <!-- Salary Range -->
          <section class="border-b border-[#E5E7EB] py-3.5">
            <button
              type="button"
              class="w-full flex items-center justify-between text-left"
              @click="toggleSection('salary')"
            >
              <span class="text-[14px] font-medium text-[#0F172A]">Mức lương</span>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
                class="w-4 h-4 text-[#64748B] transition-transform"
                :class="expanded.salary ? '' : 'rotate-180'">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
              </svg>
            </button>
            <div v-if="expanded.salary" class="mt-3 bg-[#F1F5F9] rounded-lg p-3">
              <!-- Histogram -->
              <div class="flex items-end gap-[3px] h-[78px] mb-3">
                <span
                  v-for="(h, i) in salaryBars"
                  :key="i"
                  class="flex-1 rounded-t-sm bg-[#93C5FD]"
                  :style="{ height: h + '%' }"
                ></span>
              </div>
              <!-- Range slider — slider value là VND tuyệt đối (không phải %).
                   Position thumb tính bằng (value - bounds.min) / (bounds.max - bounds.min) * 100.
                   Pointer events: pointerdown bắt đầu drag, pointermove update,
                   pointerup kết thúc — dùng setPointerCapture để tracking tiếp tục
                   khi con trỏ ra ngoài thumb. select-none + touch-none trên track
                   ngăn select text + native scroll khi đang kéo. -->
              <div class="relative h-4 mb-2 select-none touch-none">
                <!-- Track line -->
                <div class="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-[#1E40AF]"></div>
                <!-- Left thumb -->
                <span
                  class="absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white border-2 border-[#1E40AF] shadow cursor-grab active:cursor-grabbing touch-none"
                  :style="{ left: `calc(${salaryToPercent(salaryRange[0])}% - 8px)` }"
                  @pointerdown="onSalaryThumbDown(0, $event)"
                  @pointermove="onSalaryThumbMove($event)"
                  @pointerup="onSalaryThumbUp($event)"
                  @pointercancel="onSalaryThumbUp($event)"
                ></span>
                <!-- Right thumb -->
                <span
                  class="absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white border-2 border-[#1E40AF] shadow cursor-grab active:cursor-grabbing touch-none"
                  :style="{ left: `calc(${salaryToPercent(salaryRange[1])}% - 8px)` }"
                  @pointerdown="onSalaryThumbDown(1, $event)"
                  @pointermove="onSalaryThumbMove($event)"
                  @pointerup="onSalaryThumbUp($event)"
                  @pointercancel="onSalaryThumbUp($event)"
                ></span>
              </div>
              <div class="flex items-center justify-between text-[11.5px] text-[#64748B]">
                <span>{{ formatVnd(salaryRange[0]) }}</span>
                <span>{{ formatVnd(salaryRange[1]) }}</span>
              </div>
            </div>
          </section>


          <!-- Experience Level -->
          <section class="py-3.5">
            <button
              type="button"
              class="w-full flex items-center justify-between text-left"
              @click="toggleSection('experience')"
            >
              <span class="text-[14px] font-medium text-[#0F172A]">Cấp bậc</span>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
                class="w-4 h-4 text-[#64748B] transition-transform"
                :class="expanded.experience ? '' : 'rotate-180'">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
              </svg>
            </button>
            <div v-if="expanded.experience" class="mt-3 bg-[#F1F5F9] rounded-lg p-3">
              <p v-if="!jobLevels.length && !locationsLoading" class="text-[12.5px] text-[#64748B]">
                Đang tải...
              </p>
              <ul v-else class="space-y-2.5">
                <li v-for="l in jobLevels" :key="l.key" class="flex items-center gap-2.5">
                  <label class="relative inline-flex items-center gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      :checked="l.checked"
                      @change="onJobLevelToggle(l)"
                      class="peer sr-only"
                    />
                    <span
                      class="h-[18px] w-[18px] rounded border-2 grid place-items-center transition"
                      :class="l.checked
                        ? 'bg-[#1E40AF] border-[#1E40AF]'
                        : 'bg-white border-[#CBD5E1] group-hover:border-[#94A3B8]'"
                    >
                      <svg v-if="l.checked" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" class="w-3 h-3">
                        <path fill-rule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd" />
                      </svg>
                    </span>
                    <span class="text-[13px] text-[#334155] group-hover:text-[#0F172A]" :class="l.checked ? 'font-semibold text-[#0F172A]' : ''">{{ l.label }}</span>
                  </label>
                </li>
              </ul>
            </div>
          </section>


        </div>
      </aside>


      <!-- ============ Main content ============ -->
      <main class="col-span-12 lg:col-span-9 xl:col-span-9 min-w-0 overflow-y-auto thin-scrollbar">
        <!-- Card gộp: search bar (trên) + result header (dưới), ngăn bởi border-t. -->
        <div class="bg-white rounded-2xl ">
          <!-- ============ Search bar (trên) ============ -->
          <div class="px-4 py-3">
            <!-- Bỏ `overflow-hidden` để dropdown Location/JobType không bị clip
                 khi mở ra dưới (vẫn giữ `rounded-[10px]` để bo góc ngoài). -->
            <div
              class="flex items-stretch h-[42px] w-full
                    rounded-[10px] border border-[#E2E8F0] bg-white"
            >
              <!-- Keyword -->
              <div class="relative flex-1 min-w-[180px] rounded-l-[10px] overflow-hidden">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                  class="absolute left-4 top-1/2 -translate-y-1/2
                        w-[18px] h-[18px] text-[#2563EB]"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
                </svg>

                <input
                  v-model="searchKeyword"
                  type="text"
                  placeholder="Tên việc làm, kỹ năng..."
                  class="w-full h-full
                        pl-[44px] pr-10
                        bg-white
                        border-0
                        text-[14px] text-[#1E293B]
                        placeholder-[#94A3B8]
                        focus:outline-none"
                />
                <!-- Nút X clear keyword — chỉ hiện khi có text, click xoá
                     và gọi clearKeyword() để trigger watcher debounced
                     (300ms sau khi xoá sẽ fire fetchList). -->
                <button
                  v-if="searchKeyword"
                  type="button"
                  class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded-full text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition"
                  title="Xoá từ khoá"
                  aria-label="Xoá từ khoá"
                  @click="clearKeyword"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>


              <!-- Location — dropdown bind `selectedLocation` chung với sidebar
                   filter (2 nơi đồng bộ, click 1 chỗ thì cả 2 cập nhật). -->
              <!-- Mobile: ẩn Location/JobType trên search bar (chật chữ, đẩy
                   nút Search tràn màn hình) — filter vẫn còn ở sidebar. -->
              <div ref="searchBarLocation" class="relative h-full border-l border-[#E2E8F0] hidden lg:block">
                <button
                  type="button"
                  class="flex items-center gap-2 h-full px-4 bg-white text-[13px] text-[#334155] hover:bg-[#F8FAFC] transition whitespace-nowrap"
                  @click="searchBarLocationOpen = !searchBarLocationOpen"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-[17px] h-[17px] text-[#64748B]">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                  </svg>
                  <span :class="selectedLocation ? 'font-medium text-[#0F172A]' : 'text-[#94A3B8]'">
                    {{ selectedLocation ?? 'Mọi địa điểm' }}
                  </span>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
                    class="w-3.5 h-3.5 text-[#64748B] transition-transform"
                    :class="searchBarLocationOpen ? 'rotate-180' : ''">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                <div
                  v-if="searchBarLocationOpen"
                  class="absolute z-50 right-0 mt-1 w-full max-h-60 overflow-auto bg-white border border-[#E5E7EB] rounded-lg shadow-md"
                >
                  <button
                    type="button"
                    class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
                    :class="!selectedLocation ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
                    @click="selectedLocation = null; searchBarLocationOpen = false"
                  >Mọi địa điểm</button>
                  <p v-if="locationsLoading" class="px-3 py-2 text-[12.5px] text-[#64748B]">Đang tải...</p>
                  <p v-else-if="locationsError" class="px-3 py-2 text-[12.5px] text-[#DC2626]">{{ locationsError }}</p>
                  <template v-else>
                    <button
                      v-for="city in cities"
                      :key="city"
                      type="button"
                      class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
                      :class="selectedLocation === city ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
                      @click="selectedLocation = city; searchBarLocationOpen = false"
                    >{{ city }}</button>
                    <p v-if="!cities.length" class="px-3 py-2 text-[12.5px] text-[#64748B]">Chưa có địa điểm nào.</p>
                  </template>
                </div>
              </div>


              <!-- JobType — dropdown bind `jobTypes` chung với sidebar filter.
                   Sync 2 chiều: chọn ở search bar sẽ update sidebar và ngược lại. -->
              <div ref="searchBarJobType" class="relative h-full border-l border-[#E2E8F0] hidden lg:block">
                <button
                  type="button"
                  class="flex items-center gap-2 h-full px-4 bg-white text-[13px] text-[#334155] hover:bg-[#F8FAFC] transition whitespace-nowrap"
                  @click="searchBarJobTypeOpen = !searchBarJobTypeOpen"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-[17px] h-[17px] text-[#64748B]">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.838 2.175-1.052.14-2.062.317-3.182.628a21.7 21.7 0 0 1-3.46.517c-1.094.073-2.186.073-3.28 0a21.7 21.7 0 0 1-3.46-.517c-1.12-.31-2.13-.488-3.182-.628A2.193 2.193 0 0 1 3 18.4v-4.25m18.75 0a2.18 2.18 0 0 0 .75-1.64V7.288c0-1.075-.779-1.987-1.838-2.123A53.892 53.892 0 0 0 12 4.5c-2.952 0-5.829.219-8.662.665C2.279 5.301 1.5 6.213 1.5 7.288v5.222c0 .61.31 1.182.75 1.64m18.75 0a2.18 2.18 0 0 1-.75 1.64m-18 0a2.18 2.18 0 0 1-.75 1.64M16.5 7.5V5.25A2.25 2.25 0 0 0 14.25 3h-4.5A2.25 2.25 0 0 0 7.5 5.25V7.5" />
                  </svg>
                  <span :class="searchBarJobTypeLabel ? 'font-medium text-[#0F172A]' : 'text-[#94A3B8]'">
                    {{ searchBarJobTypeLabel ?? 'Hình thức' }}
                  </span>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
                    class="w-3.5 h-3.5 text-[#64748B] transition-transform"
                    :class="searchBarJobTypeOpen ? 'rotate-180' : ''">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                <div
                  v-if="searchBarJobTypeOpen"
                  class="absolute z-50 right-0 mt-1 w-full max-h-60 overflow-auto bg-white border border-[#E5E7EB] rounded-lg shadow-md"
                >
                  <button
                    type="button"
                    class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
                    :class="!searchBarJobTypeLabel ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
                    @click="onSearchBarJobTypeSelect(null)"
                  >Tất cả</button>
                  <button
                    v-for="t in jobTypes"
                    :key="t.key"
                    type="button"
                    class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
                    :class="t.checked ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
                    @click="onSearchBarJobTypeSelect(t.key)"
                  >{{ t.label }}</button>
                </div>
              </div>


              <!-- Search -->
              <button
                type="button"
                class="shrink-0 h-full
                      px-7
                      bg-[#1E4A8A]
                      hover:bg-[#173B70]
                      text-white
                      text-[14px]
                      font-medium
                      transition
                      rounded-r-[10px]"
                @click="onSearchSubmit"
              >
                Search
              </button>
            </div>
          </div>


          <!-- ============ Result header (dưới) ============ -->
          <!-- Layout: "Đang hiển thị: N" bên trái, filter chips + X clear bên phải,
               cùng 1 hàng ngang. Filter chips wrap nếu không đủ chỗ. -->
          <div class="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#E5E7EB] flex-wrap">
            <h1 class="text-[20px] font-medium text-[#0F172A] whitespace-nowrap shrink-0">
              Đang hiển thị: <span class="text-[#1E40AF]">{{ resultCount }}</span>
            </h1>
            <!-- Active filter chips + nút X clear — bên phải, wrap nếu dài.
                 Rỗng → ẩn cả cụm. -->
            <div v-if="activeFilterChips.length" class="flex items-center gap-1.5 flex-wrap justify-end min-w-0">
              <span
                v-for="chip in activeFilterChips"
                :key="chip.key"
                :class="['inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full', chip.class]"
              >
                <component :is="chip.icon" class="w-3 h-3 shrink-0" />
                {{ chip.label }}
              </span>
              <button
                type="button"
                class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[#DC2626] hover:bg-[#FEF2F2] transition shrink-0"
                title="Xoá tất cả bộ lọc"
                @click="clearAllFilters"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>


        <!-- ============ Job cards ============ -->
        <div class="space-y-3 p-4">
          <article
            v-for="j in jobs"
            :key="j.id"
            class="bg-white rounded-2xl border border-[#E5E7EB] p-4 hover:shadow-md transition"
          >
            <!-- ============ HÀNG 1: logo | info | salary/workType/save ============ -->
            <div class="flex items-start gap-3">
              <!-- (1) Logo -->
              <div
                class="shrink-0 h-16 w-16 rounded-lg overflow-hidden grid place-items-center text-white font-bold text-[14px]"
                :style="!j.companyLogoUrl
                  ? { background: `linear-gradient(135deg, ${j.companyColor} 0%, ${j.companyColor}AA 100%)` }
                  : { background: '#F8FAFC' }"
              >
                <img
                  v-if="j.companyLogoUrl"
                  :src="j.companyLogoUrl"
                  :alt="j.company"
                  class="w-full h-full object-cover"
                  loading="lazy"
                  @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                />
                <svg
                  v-else
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="w-7 h-7 opacity-80"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008V7.5Z" />
                </svg>
              </div>


              <!-- (2) Title + company + rating + views/applies -->
              <div class="flex-1 min-w-0">
                <h3
                  class="text-[15.5px] font-semibold text-[#0F172A] cursor-pointer hover:text-[#1E40AF] transition"
                  @click="onCardClick(j)"
                >{{ j.title }}</h3>
                <p class="text-[12.5px] text-[#64748B] mt-1">
                  <a href="#" class="font-semibold text-[#1E40AF] hover:underline">{{ j.company }}</a>
                  <span class="text-[#64748B]"> in</span> {{ j.location }}
                  <span
                    v-if="j.ratingAvg !== null && j.ratingCount > 0"
                    class="inline-flex items-center gap-1 ml-1 align-middle"
                    :title="`${j.ratingCount} đánh giá`"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#F59E0B" class="w-3.5 h-3.5">
                      <path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006Z" clip-rule="evenodd" />
                    </svg>
                    <span class="text-[#0F172A] font-semibold">{{ Number(j.ratingAvg).toFixed(1) }}</span>
                  </span>
                </p>
                <div class="mt-1 flex items-center gap-3 text-[11.5px] text-[#64748B]">
                  <span class="inline-flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-3.5 h-3.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                    {{ j.viewsCount }}
                  </span>
                  <span class="inline-flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-3.5 h-3.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6v3.75m0 0 3-3m-3 3-3-3m6 9 3-3m-3 3-3 3M9 6.75v.008M9 9.75v.008M9 12.75v.008M9 15.75v.008M12 6.75v.008M12 9.75v.008M12 12.75v.008M12 15.75v.008" />
                    </svg>
                    {{ j.appliesCount }}
                  </span>
                </div>
              </div>


              <!-- (3) Salary + workType + save icon (góc trên phải) -->
              <div class="shrink-0 flex flex-col items-end gap-1">
                <p class="text-[13px] font-semibold text-[#0F172A] whitespace-nowrap">{{ j.salary }}</p>
                <p class="text-[12px] text-[#64748B] inline-flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="w-3.5 h-3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  {{ j.workType }}
                </p>
                <button
                  type="button"
                  class="inline-flex items-center justify-center w-8 h-8 rounded-full transition"
                  :class="savedJobIds.has(j.id)
                    ? 'text-[#1E40AF] hover:bg-[#EFF6FF]'
                    : 'text-[#94A3B8] hover:text-[#1E40AF] hover:bg-[#F1F5F9]'"
                  :title="savedJobIds.has(j.id) ? 'Bỏ lưu job' : 'Lưu job'"
                  @click.stop="onToggleSaveJob(j.id)"
                >
                  <!-- Filled khi đã lưu, outline khi chưa — phản hồi rõ ràng state. -->
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    stroke-width="1.8"
                    stroke="currentColor"
                    class="w-[18px] h-[18px]"
                    :fill="savedJobIds.has(j.id) ? 'currentColor' : 'none'"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                  </svg>
                </button>
              </div>
            </div>


            <!-- ============ HÀNG 2: description + badges ============ -->
            <div class="mt-0 w-[90%]">
              <ul v-if="j.bullets" class="space-y-1 text-[12.5px] text-[#64748B] list-disc pl-5">
                <li v-for="b in j.bullets" :key="b">{{ b }}</li>
              </ul>
              <p v-else-if="j.descriptions" class="text-[12.5px] text-[#64748B] leading-[1.55] line-clamp-2">
                {{ j.descriptions }}
              </p>
              <p v-else-if="j.paragraph" class="text-[12.5px] text-[#64748B] leading-[1.55]">
                {{ j.paragraph }}
              </p>
              <!-- Badges (Urgently Hiring / JobType...) -->
              <div class="mt-2 flex items-center gap-2 flex-wrap">
                <span
                  v-for="b in j.badges"
                  :key="b.label"
                  class="text-[11.5px] font-medium px-2.5 py-0.5 rounded-md"
                  :class="{
                    'bg-[#FEF3C7] text-[#B45309]': b.variant === 'boosted',
                    'bg-[#DBEAFE] text-[#1E40AF]': b.variant === 'responsive',
                    'bg-[#FCE7F3] text-[#BE185D]': b.variant === 'urgent',
                    'bg-[#D1FAE5] text-[#047857]': b.variant === 'choice',
                  }"
                >{{ b.label }}</span>
              </div>
            </div>


            <!-- ============ HÀNG 3: postedAt (trái) + View details (phải) ============ -->
            <div class="mt-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
              <p class="text-[11.5px] text-[#94A3B8]">Lúc {{ j.postedAt }}</p>
              <button
                type="button"
                class="self-start sm:self-auto h-9 px-5 rounded-lg bg-[#1E40AF] hover:bg-[#1E3A8A] text-white text-[12.5px] font-semibold transition shadow-sm"
                @click="onCardClick(j)"
              >
                Xem chi tiết
              </button>
            </div>
          </article>

          <!-- Empty state: chỉ hiện khi fetch xong mà 0 kết quả (gate !loading để tránh nháy). -->
          <div v-if="!jobs.length && !loading" class="py-16 flex flex-col items-center gap-2 text-center">
            <SearchX class="w-10 h-10 text-[#94A3B8]" aria-hidden="true" />
            <p class="text-[14px] font-semibold text-[#0F172A]">Không có việc làm phù hợp</p>
            <p class="text-[12.5px] text-[#64748B]">Thử xoá bớt bộ lọc hoặc mở rộng phạm vi tìm kiếm.</p>
            <button
              type="button"
              class="mt-2 h-9 px-5 rounded-lg bg-[#1E40AF] hover:bg-[#1E3A8A] text-white text-[12.5px] font-semibold transition shadow-sm"
              @click="clearAllFilters"
            >Xoá bộ lọc</button>
          </div>
        </div>


        <!-- ============ Pagination ============ -->
        <!-- Ẩn khi chỉ có 1 page. Hiển thị: "Trang X / Y" + nút Prev/Next +
             danh sách page numbers (với "…" cho range thu gọn). -->
        <nav
          v-if="totalPages > 1"
          class="flex items-center justify-between gap-3 px-4 py-4 border-t border-[#E5E7EB]"
          aria-label="Phân trang"
        >
          <p class="text-[12.5px] text-[#64748B]">
            Trang
            <span class="font-semibold text-[#0F172A]">{{ page }}</span>
            /
            <span class="font-semibold text-[#0F172A]">{{ totalPages }}</span>
            <span class="ml-2">({{ total }} kết quả)</span>
          </p>

          <div class="flex items-center gap-1">
            <!-- Prev -->
            <button
              type="button"
              class="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-[#E5E7EB] text-[#0F172A] hover:bg-[#F8FAFC] transition disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="page <= 1"
              aria-label="Trang trước"
              @click="goToPage(page - 1)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>

            <!-- Page numbers + ellipsis -->
            <template v-for="(p, idx) in paginationPages" :key="`${p}-${idx}`">
              <span
                v-if="p === '…'"
                class="h-9 min-w-9 px-2 inline-flex items-center justify-center text-[12.5px] text-[#64748B]"
                aria-hidden="true"
              >…</span>
              <button
                v-else
                type="button"
                class="h-9 min-w-9 px-3 inline-flex items-center justify-center rounded-lg text-[12.5px] font-medium transition"
                :class="p === page
                  ? 'bg-[#1E40AF] text-white'
                  : 'border border-[#E5E7EB] text-[#0F172A] hover:bg-[#F8FAFC]'"
                :aria-current="p === page ? 'page' : undefined"
                @click="goToPage(p)"
              >{{ p }}</button>
            </template>

            <!-- Next -->
            <button
              type="button"
              class="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-[#E5E7EB] text-[#0F172A] hover:bg-[#F8FAFC] transition disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="page >= totalPages"
              aria-label="Trang sau"
              @click="goToPage(page + 1)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </nav>
      </main>
    </div>
  </div>
</template>


<style scoped>
/*
 * Poppins — load qua Google Fonts ở `index.html` (preconnect + <link>).
 * Class `font-poppins` đến từ Tailwind utility (cấu hình trong
 * `tailwind.config.js` → `theme.extend.fontFamily.poppins`). Không cần khai
 * báo scoped `.font-poppins` ở đây nữa.
 */

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/**
 * Thanh cuộn mỏng (~6px) cho sidebar filter và job list panel — webkit (Chrome,
 * Edge, Safari) dùng `::-webkit-scrollbar`; Firefox dùng `scrollbar-width: thin`.
 * Track nền trong suốt để không bị "khối" đen khi không hover.
 */
.thin-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: #CBD5E1 transparent;
}
.thin-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.thin-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.thin-scrollbar::-webkit-scrollbar-thumb {
  background: #CBD5E1;
  border-radius: 9999px;
}
.thin-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #94A3B8;
}

/**
 * Ẩn thanh cuộn nhưng VẪN scroll được — dùng cho sidebar filter (ít content,
 * không cần visual cue; người dùng vẫn scroll bằng wheel/touch). Firefox
 * dùng `scrollbar-width: none`, webkit dùng `display: none` (che cả thumb
 * + track).
 */
.scrollbar-none {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
</style>
