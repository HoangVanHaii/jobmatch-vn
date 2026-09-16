<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { useRoute } from 'vue-router';
import { useRouter } from 'vue-router';
import {
  Search,
  X,
  Briefcase,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  BookmarkCheck,
  Globe,
  Building2,
  Inbox,
  Plus,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
import { savedJobApi } from '@services/savedJob.api';
import { jobApi } from '@services/job.api';
import { useToastStore } from '@stores/toast';
import { useSavedJobStore } from '@stores/savedJob';
import { useDebounce } from '@composables/useDebounce';
import { storeToRefs } from 'pinia';
import ConfirmModal from '@components/common/ConfirmModal.vue';
import type { JobLevel, JobListItem, JobType } from '@/types/job';
import type { SavedJobItem } from '@/types/savedJob';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const router = useRouter();
const route = useRoute();
const toast = useToastStore();

/* ============================================================================
 * State
 * ==========================================================================*/
const items = ref<SavedJobItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(12);
const loading = ref(false);
const error = ref<string | null>(null);

const currentJobType = ref<JobType | null>(null);
const currentJobLevel = ref<JobLevel | null>(null);
const currentRemote = ref<boolean | null>(null);
const currentIndustry = ref<string | null>(null); // dropdown — distinct từ API

/* ============================================================================
 * Search (debounced) — giống JobsView: free-text search trên title/companyName
 * ==========================================================================*/
const searchInput = ref('');
const debouncedSearch = useDebounce(searchInput, 400);
watch(debouncedSearch, (q) => {
  void fetchList();
});
const clearSearch = (): void => {
  searchInput.value = '';
};

/** Confirm modal: jobId đang chờ user xác nhận. */
const unsaveConfirmId = ref<string | null>(null);
const unsaveConfirmTitle = ref<string>('');

/* ============================================================================
 * Filter dropdown — đồng bộ pattern với JobsView
 * ==========================================================================*/
type DropdownKey = 'jobType' | 'jobLevel' | 'remote' | 'industry';
const openDropdown = ref<DropdownKey | null>(null);

/** Template refs cho 4 dropdown container — dùng với `onClickOutside` của
 *  @vueuse/core để auto-close khi click ra ngoài. Mỗi dropdown có wrapper
 *  `.relative` riêng; ref trỏ vào wrapper đó. */
const jobTypeRef = useTemplateRef<HTMLElement>('jobTypeRef');
const jobLevelRef = useTemplateRef<HTMLElement>('jobLevelRef');
const remoteRef = useTemplateRef<HTMLElement>('remoteRef');
const industryRef = useTemplateRef<HTMLElement>('industryRef');

onMounted(() => {
  if (jobTypeRef.value) onClickOutside(jobTypeRef, () => { if (openDropdown.value === 'jobType') openDropdown.value = null; });
  if (jobLevelRef.value) onClickOutside(jobLevelRef, () => { if (openDropdown.value === 'jobLevel') openDropdown.value = null; });
  if (remoteRef.value) onClickOutside(remoteRef, () => { if (openDropdown.value === 'remote') openDropdown.value = null; });
  if (industryRef.value) onClickOutside(industryRef, () => { if (openDropdown.value === 'industry') openDropdown.value = null; });
});

const toggleDropdown = (key: DropdownKey): void => {
  openDropdown.value = openDropdown.value === key ? null : key;
};

const jobTypeOptions: Array<{ value: JobType | null; label: string }> = [
  { value: null, label: 'Tất cả loại hình' },
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'contract', label: 'Hợp đồng' },
  { value: 'internship', label: 'Thực tập' },
  { value: 'freelance', label: 'Freelance' },
];
const handleJobTypeSelect = (v: JobType | null): void => {
  currentJobType.value = v;
  openDropdown.value = null;
  void fetchList();
};

const jobLevelOptions: Array<{ value: JobLevel | null; label: string }> = [
  { value: null, label: 'Tất cả cấp bậc' },
  { value: 'intern', label: 'Intern' },
  { value: 'fresher', label: 'Fresher' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'manager', label: 'Manager' },
];
const handleJobLevelSelect = (v: JobLevel | null): void => {
  currentJobLevel.value = v;
  openDropdown.value = null;
  void fetchList();
};

const remoteOptions: Array<{ value: boolean | null; label: string }> = [
  { value: null, label: 'Tất cả hình thức' },
  { value: true, label: 'Có thể remote' },
  { value: false, label: 'Tại văn phòng' },
];
const handleRemoteSelect = (v: boolean | null): void => {
  currentRemote.value = v;
  openDropdown.value = null;
  void fetchList();
};

/* ============================================================================
 * Industry (dropdown) — fetch distinct từ API `/jobs/industries` 1 lần lúc mount.
 * ==========================================================================*/
const industries = ref<string[]>([]);
const industriesLoading = ref(false);
const industriesLoaded = ref(false);
const fetchIndustries = async (): Promise<void> => {
  if (industriesLoaded.value || industriesLoading.value) return;
  industriesLoading.value = true;
  try {
    const { data } = await jobApi.industries();
    industries.value = data.data ?? [];
    industriesLoaded.value = true;
  } catch {
    industries.value = [];
    industriesLoaded.value = true;
  } finally {
    industriesLoading.value = false;
  }
};

const handleIndustrySelect = (v: string | null): void => {
  currentIndustry.value = v;
  openDropdown.value = null;
  void fetchList();
};

/* ============================================================================
 * Active chips + reset
 * ==========================================================================*/
interface ActiveChip {
  key: DropdownKey | 'industry';
  label: string;
  onRemove: () => void;
}
const activeChips = computed<ActiveChip[]>(() => {
  const chips: ActiveChip[] = [];
  if (currentJobType.value) {
    const opt = jobTypeOptions.find((o) => o.value === currentJobType.value);
    chips.push({
      key: 'jobType',
      label: opt?.label ?? currentJobType.value,
      onRemove: () => handleJobTypeSelect(null),
    });
  }
  if (currentJobLevel.value) {
    const opt = jobLevelOptions.find((o) => o.value === currentJobLevel.value);
    chips.push({
      key: 'jobLevel',
      label: opt?.label ?? currentJobLevel.value,
      onRemove: () => handleJobLevelSelect(null),
    });
  }
  if (currentRemote.value !== null) {
    const opt = remoteOptions.find((o) => o.value === currentRemote.value);
    chips.push({
      key: 'remote',
      label: opt?.label ?? '',
      onRemove: () => handleRemoteSelect(null),
    });
  }
  if (currentIndustry.value) {
    chips.push({
      key: 'industry',
      label: currentIndustry.value,
      onRemove: () => handleIndustrySelect(null),
    });
  }
  return chips;
});

const hasActiveFilter = computed(
  () => searchInput.value.trim() !== '' || activeChips.value.length > 0,
);

const resetAllFilters = async (): Promise<void> => {
  searchInput.value = '';
  currentJobType.value = null;
  currentJobLevel.value = null;
  currentRemote.value = null;
  currentIndustry.value = null;
  await fetchList();
};

/* ============================================================================
 * Fetch
 * ==========================================================================*/
const totalPages = computed(() =>
  total.value === 0 ? 1 : Math.ceil(total.value / pageSize.value),
);

let latestSeq = 0;
const fetchList = async (pageNum?: number): Promise<void> => {
  const seq = ++latestSeq;
  if (pageNum) page.value = pageNum;
  loading.value = true;
  error.value = null;
  try {
    const { data } = await savedJobApi.list({
      jobType: currentJobType.value ?? undefined,
      jobLevel: currentJobLevel.value ?? undefined,
      remoteOk: currentRemote.value ?? undefined,
      industry: currentIndustry.value ?? undefined,
      search: searchInput.value.trim() || undefined,
      page: page.value,
      limit: pageSize.value,
    });
    if (seq !== latestSeq) return;
    items.value = data.data;
    total.value = data.pagination.total;
  } catch (e) {
    if (seq !== latestSeq) return;
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  } finally {
    if (seq === latestSeq) loading.value = false;
  }
};

const goToPage = async (p: number): Promise<void> => {
  const target = Math.min(Math.max(1, p), totalPages.value);
  if (target === page.value) return;
  await fetchList(target);
};

/* ============================================================================
 * Unsave — dùng savedJobStore.toggle với onUnsave callback để xoá entry
 * khỏi list chính sau khi API unsave thành công.
 * ==========================================================================*/
const savedJobStore = useSavedJobStore();
const { pendingIds } = storeToRefs(savedJobStore);

const askUnsave = (jobId: string, title: string): void => {
  unsaveConfirmId.value = jobId;
  unsaveConfirmTitle.value = title;
};
const cancelUnsave = (): void => {
  unsaveConfirmId.value = null;
};
const confirmUnsaveAction = async (): Promise<void> => {
  const id = unsaveConfirmId.value;
  if (!id) return;
  unsaveConfirmId.value = null;
  const removedTitle = unsaveConfirmTitle.value;
  const ok = await savedJobStore.toggle(id, {
    onUnsave: () => {
      // Xoá entry khỏi list local. Không rollback ở đây vì store đã lo
      // việc đó nếu API fail.
      const removedIndex = items.value.findIndex((s) => s.job.id === id);
      if (removedIndex >= 0) {
        items.value = items.value.filter((s) => s.job.id !== id);
        total.value = Math.max(0, total.value - 1);
        toast.push({ variant: 'success', title: 'Đã bỏ lưu', body: removedTitle });
      }
    },
  });
  if (ok) {
    // Nếu page hiện tại rỗng + còn page trước → fetch lại page trước.
    if (items.value.length === 0 && page.value > 1) {
      await fetchList(page.value - 1);
    }
  } else {
    toast.push({
      variant: 'error',
      title: 'Bỏ lưu thất bại',
      body: 'Vui lòng thử lại',
    });
  }
};

/* ============================================================================
 * Trigger label helper — trả về label tiếng Việt của filter đang chọn (null
 * nếu chưa chọn). Template dùng `?? 'Fallback'` để hiển thị placeholder.
 * ==========================================================================*/
const currentTriggerLabel = (key: DropdownKey): string | null => {
  switch (key) {
    case 'jobType':
      if (currentJobType.value === null) return null;
      return jobTypeOptions.find((o) => o.value === currentJobType.value)?.label ?? null;
    case 'jobLevel':
      if (currentJobLevel.value === null) return null;
      return jobLevelOptions.find((o) => o.value === currentJobLevel.value)?.label ?? null;
    case 'remote':
      if (currentRemote.value === null) return null;
      return remoteOptions.find((o) => o.value === currentRemote.value)?.label ?? null;
    case 'industry':
      return currentIndustry.value;
  }
};

/* ============================================================================
 * Job Card shape — mirror JobSearchView style để UI/UX giống trang Job Search.
 * Saved Jobs chỉ là 1 filter view khác của cùng 1 nguồn data (JobListItem), nên
 * dùng chung helpers formatSalary / formatJobType / toJobCard để đảm bảo card
 * render GIỐNG HỆT card ở JobSearchView (typography, padding, color, hierarchy).
 * ==========================================================================*/
type HiringStatus = 'urgent' | 'active' | 'normal';

/** Map enum value → label tiếng Anh cho badge — đồng bộ với JobSearchView. */
const JOB_TYPE_LABELS: Record<JobType, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  freelance: 'Freelance',
};

const formatSalary = (j: JobListItem): string => {
  if (!j.salaryVisible) return 'Thoả thuận';
  const { salaryMin, salaryMax } = j;
  if (!salaryMin && !salaryMax) return 'Thoả thuận';
  const toM = (s: string): string => `${(Number(s) / 1_000_000).toFixed(0)} triệu`;
  if (salaryMin && salaryMax) return `${toM(salaryMin)} – ${toM(salaryMax)}`;
  if (salaryMin) return `Từ ${toM(salaryMin)}`;
  return `Đến ${toM(salaryMax!)}`;
};

const formatJobType = (t: JobType | null): string => {
  if (!t) return '';
  return JOB_TYPE_LABELS[t] ?? t;
};

/** Tạo hex ổn định từ chuỗi — dùng cho gradient logo khi không có logoUrl. */
const stringHash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const COMPANY_COLORS = ['#3B82F6', '#1E40AF', '#E11D48', '#0EA5E9', '#10B981', '#8B5CF6', '#F59E0B'];
const companyColor = (j: JobListItem): string =>
  COMPANY_COLORS[stringHash(j.companyId || j.companyName || j.id) % COMPANY_COLORS.length];

interface CardData {
  id: string;
  slug: string | null;
  title: string;
  company: string;
  companyColor: string;
  companyLogoUrl: string | null;
  location: string;
  ratingAvg: number | null;
  ratingCount: number;
  descriptions: string | null;
  badges: { label: string; variant: 'boosted' | 'responsive' | 'urgent' | 'choice' }[];
  hiringStatus: HiringStatus;
  postedAt: string;
  salary: string;
  workType: string;
  viewsCount: number;
  appliesCount: number;
  savedAt: Date | string;
}

const toCardData = (entry: SavedJobItem): CardData => {
  const j = entry.job;
  const badges: CardData['badges'] = [];
  // Badge urgency — mirror JobSearchView: chỉ render 1 trong 2, `normal` thì
  // không render badge nào. Tránh trùng lặp "Urgently" + "Actively".
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
    savedAt: entry.savedAt,
  };
};

const cards = computed<CardData[]>(() => items.value.map(toCardData));

const onCardClick = (j: CardData): void => {
  const path = j.slug ?? j.id;
  void router.push(`/candidate/viec-lam/${path}`);
};

/**
 * Toggle save/unsave job — gọi `POST /saved-jobs` hoặc `DELETE /saved-jobs/:id`.
 * Optimistic update: cập nhật `savedIds` TRƯỚC khi API resolve, rollback
 * nếu request fail. UX mượt hơn vì không cần spinner cho thao tác 1-click.
 *
 * @click.stop ở template đã chặn bubble lên card (không trigger `onCardClick`).
 */
const onToggleSaveJob = async (jobId: string): Promise<void> => {
  const wasSaved = savedJobStore.isSaved(jobId);
  // Optimistic toggle qua store để sync state toàn cục (JobsView, JobDetail
  // cùng nhìn thấy). Confirm modal flow dùng askUnsave → confirmUnsaveAction
  // → store.toggle với onUnsave; còn direct click trên card (không qua modal)
  // thì gọi toggle không có callback.
  await savedJobStore.toggle(jobId);
  // Nếu vừa unsave (đã bỏ lưu) → xoá khỏi list local.
  if (wasSaved) {
    const removedIndex = items.value.findIndex((s) => s.job.id === jobId);
    if (removedIndex >= 0) {
      const removedTitle = items.value[removedIndex].job.title;
      items.value = items.value.filter((s) => s.job.id !== jobId);
      total.value = Math.max(0, total.value - 1);
      toast.push({ variant: 'success', title: 'Đã bỏ lưu', body: removedTitle });
      // Nếu page hiện tại rỗng + còn page trước → fetch lại page trước.
      if (items.value.length === 0 && page.value > 1) {
        await fetchList(page.value - 1);
      }
    }
  }
};

/* ============================================================================
 * Init / navigation
 * ==========================================================================*/
const initFresh = async (): Promise<void> => {
  searchInput.value = '';
  currentJobType.value = null;
  currentJobLevel.value = null;
  currentRemote.value = null;
  currentIndustry.value = null;
  page.value = 1;
  await fetchList(1);
};

onMounted(() => {
  if (items.value.length === 0) void initFresh();
  void fetchIndustries();
  void savedJobStore.fetchIds();
});

watch(
  () => route.path,
  (newPath, oldPath) => {
    if (newPath === '/candidate/saved-jobs' && oldPath !== newPath) {
      void initFresh();
    }
  },
);

/* ============================================================================
 * Helpers cho template
 * ==========================================================================*/
/** Format "Đã lưu X ngày trước" từ savedAt — dùng cho meta bên dưới card. */
const savedLabel = (d: Date | string): string => {
  return `Đã lưu ${dayjs(d).fromNow()}`;
};

/** Message cho ConfirmModal — escape quotes ở JS, không phải trong template. */
const confirmMessage = computed(
  () =>
    `Bạn có chắc muốn bỏ lưu "${unsaveConfirmTitle.value}"? Việc làm sẽ bị xoá khỏi danh sách đã lưu nhưng vẫn còn trên hệ thống.`,
);
</script>

<template>
  <div class="min-h-screen bg-white p-5 md:p-8 font-poppins">
    <div class="max-w-7xl mx-auto">
      <!-- ============ Header ============ -->
      <header class="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Việc làm đã lưu</h1>
          <p class="text-sm text-gray-500 mt-1">
            Danh sách các việc làm bạn đã lưu để xem lại sau.
          </p>
        </div>
        <button
          type="button"
          class="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition inline-flex items-center gap-1.5"
          @click="router.push('/candidate/viec-lam')"
        >
          <Plus class="w-4 h-4" /> Khám phá việc làm
        </button>
      </header>

      <!-- ============ Search bar (Job Search style, responsive) ============ -->
      <!-- Combined search bar mirror JobSearchView:
           - Desktop (lg+): 1 row duy nhất 42px — keyword | Ngành nghề | Cấp bậc
             | Loại hình | Hình thức | Search button. Sections ngăn bởi
             `lg:divide-x divide-[#E2E8F0]`.
           - Mobile (<lg): stack dọc, mỗi section full-width 42px, ngăn bởi
             `divide-y divide-[#E2E8F0]`. Dropdown panels dùng `left-0` thay vì
             `right-0` để không tràn mép phải khi trigger full-width. -->
      <div class="mb-3 flex flex-col lg:flex-row lg:items-stretch w-full rounded-[10px] border border-[#E2E8F0] bg-white divide-y lg:divide-y-0 lg:divide-x divide-[#E2E8F0]">
        <!-- Keyword -->
        <div class="relative w-full lg:flex-1 lg:min-w-[180px] h-[42px] lg:h-auto rounded-t-[10px] lg:rounded-t-none lg:rounded-l-[10px] overflow-hidden">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
            class="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#2563EB] pointer-events-none">
            <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            v-model="searchInput"
            type="text"
            placeholder="Tên việc làm, công ty..."
            class="w-full h-full pl-[44px] pr-10 bg-white border-0 text-[14px] text-[#1E293B] placeholder-[#94A3B8] focus:outline-none"
          />
          <button
            v-if="searchInput"
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded-full text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition"
            title="Xoá từ khoá"
            aria-label="Xoá từ khoá"
            @click="clearSearch"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Ngành nghề -->
        <div ref="industryRef" class="relative w-full lg:w-auto h-[42px] lg:h-auto">
          <button
            type="button"
            class="flex items-center gap-2 w-full h-[42px] lg:h-full px-4 bg-white text-[13px] text-[#334155] hover:bg-[#F8FAFC] transition whitespace-nowrap"
            @click="toggleDropdown('industry')"
          >
            <Briefcase class="w-[17px] h-[17px] text-[#64748B]" />
            <span :class="currentIndustry ? 'font-medium text-[#0F172A]' : 'text-[#94A3B8]'">
              {{ currentIndustry ?? 'Ngành nghề' }}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
              class="w-3.5 h-3.5 text-[#64748B] transition-transform"
              :class="openDropdown === 'industry' ? 'rotate-180' : ''">
              <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          <div
            v-if="openDropdown === 'industry'"
            class="absolute z-50 left-0 lg:left-0 right-0 lg:right-auto mt-1 w-full lg:w-64 max-h-72 overflow-auto bg-white border border-[#E5E7EB] rounded-lg shadow-md"
          >
            <button
              type="button"
              class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
              :class="currentIndustry === null ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
              @click="handleIndustrySelect(null)"
            >Tất cả ngành nghề</button>
            <div
              v-if="industriesLoading && industries.length === 0"
              class="px-3 py-2 text-[12.5px] text-[#64748B] inline-flex items-center gap-1.5"
            >
              <Loader2 class="w-3 h-3 animate-spin" /> Đang tải...
            </div>
            <template v-else>
              <button
                v-for="ind in industries"
                :key="ind"
                type="button"
                class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
                :class="currentIndustry === ind ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
                @click="handleIndustrySelect(ind)"
              >{{ ind }}</button>
              <p v-if="!industries.length" class="px-3 py-2 text-[12.5px] text-[#64748B]">Chưa có ngành nghề nào.</p>
            </template>
          </div>
        </div>

        <!-- Cấp bậc -->
        <div ref="jobLevelRef" class="relative w-full lg:w-auto h-[42px] lg:h-auto">
          <button
            type="button"
            class="flex items-center gap-2 w-full h-[42px] lg:h-full px-4 bg-white text-[13px] text-[#334155] hover:bg-[#F8FAFC] transition whitespace-nowrap"
            @click="toggleDropdown('jobLevel')"
          >
            <Globe class="w-[17px] h-[17px] text-[#64748B]" />
            <span :class="currentJobLevel ? 'font-medium text-[#0F172A]' : 'text-[#94A3B8]'">
              {{ currentTriggerLabel('jobLevel') ?? 'Cấp bậc' }}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
              class="w-3.5 h-3.5 text-[#64748B] transition-transform"
              :class="openDropdown === 'jobLevel' ? 'rotate-180' : ''">
              <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          <div
            v-if="openDropdown === 'jobLevel'"
            class="absolute z-50 left-0 lg:left-auto lg:right-0 mt-1 w-full lg:w-48 max-h-72 overflow-auto bg-white border border-[#E5E7EB] rounded-lg shadow-md"
          >
            <button
              type="button"
              class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
              :class="currentJobLevel === null ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
              @click="handleJobLevelSelect(null)"
            >Tất cả cấp bậc</button>
            <button
              v-for="opt in jobLevelOptions.filter(o => o.value !== null)"
              :key="opt.label"
              type="button"
              class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
              :class="currentJobLevel === opt.value ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
              @click="handleJobLevelSelect(opt.value)"
            >{{ opt.label }}</button>
          </div>
        </div>

        <!-- Loại hình -->
        <div ref="jobTypeRef" class="relative w-full lg:w-auto h-[42px] lg:h-auto">
          <button
            type="button"
            class="flex items-center gap-2 w-full h-[42px] lg:h-full px-4 bg-white text-[13px] text-[#334155] hover:bg-[#F8FAFC] transition whitespace-nowrap"
            @click="toggleDropdown('jobType')"
          >
            <Briefcase class="w-[17px] h-[17px] text-[#64748B]" />
            <span :class="currentJobType ? 'font-medium text-[#0F172A]' : 'text-[#94A3B8]'">
              {{ currentTriggerLabel('jobType') ?? 'Loại hình' }}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
              class="w-3.5 h-3.5 text-[#64748B] transition-transform"
              :class="openDropdown === 'jobType' ? 'rotate-180' : ''">
              <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          <div
            v-if="openDropdown === 'jobType'"
            class="absolute z-50 left-0 lg:left-auto lg:right-0 mt-1 w-full lg:w-48 max-h-72 overflow-auto bg-white border border-[#E5E7EB] rounded-lg shadow-md"
          >
            <button
              type="button"
              class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
              :class="currentJobType === null ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
              @click="handleJobTypeSelect(null)"
            >Tất cả loại hình</button>
            <button
              v-for="opt in jobTypeOptions.filter(o => o.value !== null)"
              :key="opt.label"
              type="button"
              class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
              :class="currentJobType === opt.value ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
              @click="handleJobTypeSelect(opt.value)"
            >{{ opt.label }}</button>
          </div>
        </div>

        <!-- Hình thức -->
        <div ref="remoteRef" class="relative w-full lg:w-auto h-[42px] lg:h-auto">
          <button
            type="button"
            class="flex items-center gap-2 w-full h-[42px] lg:h-full px-4 bg-white text-[13px] text-[#334155] hover:bg-[#F8FAFC] transition whitespace-nowrap"
            @click="toggleDropdown('remote')"
          >
            <Building2 class="w-[17px] h-[17px] text-[#64748B]" />
            <span :class="currentRemote !== null ? 'font-medium text-[#0F172A]' : 'text-[#94A3B8]'">
              {{ currentTriggerLabel('remote') ?? 'Hình thức' }}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
              class="w-3.5 h-3.5 text-[#64748B] transition-transform"
              :class="openDropdown === 'remote' ? 'rotate-180' : ''">
              <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          <div
            v-if="openDropdown === 'remote'"
            class="absolute z-50 left-0 lg:left-auto lg:right-0 mt-1 w-full lg:w-48 bg-white border border-[#E5E7EB] rounded-lg shadow-md"
          >
            <button
              v-for="opt in remoteOptions"
              :key="opt.label"
              type="button"
              class="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F1F5F9] transition"
              :class="currentRemote === opt.value ? 'font-semibold text-[#1E40AF]' : 'text-[#0F172A]'"
              @click="handleRemoteSelect(opt.value)"
            >{{ opt.label }}</button>
          </div>
        </div>

        <!-- Search button -->
        <button
          type="button"
          class="shrink-0 h-[42px] lg:h-auto w-full lg:w-auto px-7 bg-[#1E4A8A] hover:bg-[#173B70] text-white text-[14px] font-medium transition rounded-b-[10px] lg:rounded-b-none lg:rounded-r-[10px] inline-flex items-center justify-center gap-1.5"
          aria-label="Tìm kiếm"
        >
          <Search class="w-4 h-4" />
          <span>Tìm</span>
        </button>
      </div>

      <!-- ============ Result count + active chips + "Xoá tất cả" ============ -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1 py-3 border-t border-[#E5E7EB] mb-2">
        <h1 class="text-[16px] sm:text-[20px] font-medium text-[#0F172A] shrink-0">
          Đang hiển thị: <span class="text-[#1E40AF]">{{ items.length }}</span>
          <span class="text-[12px] sm:text-[14px] text-[#64748B] font-normal">/ {{ total }} việc làm đã lưu</span>
        </h1>
        <!-- Active filter chips + nút X clear — bên phải, wrap nếu dài.
             Rỗng → ẩn cả cụm. -->
        <div v-if="activeChips.length" class="flex items-center gap-1.5 flex-wrap justify-end min-w-0">
          <button
            v-for="chip in activeChips"
            :key="chip.key + chip.label"
            type="button"
            class="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100 hover:bg-primary-100 transition"
            @click="chip.onRemove"
          >
            {{ chip.label }}
            <X class="w-3 h-3" />
          </button>
          <button
            type="button"
            class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[#DC2626] hover:bg-[#FEF2F2] transition shrink-0"
            title="Xoá tất cả bộ lọc"
            @click="resetAllFilters"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- ============ Error ============ -->
      <div
        v-if="error"
        class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex items-center gap-2"
      >
        <AlertCircle class="w-3.5 h-3.5 text-red-500 shrink-0" />
        <p class="text-xs text-red-700">{{ error }}</p>
      </div>

      <!-- ============ Loading (initial) ============ -->
      <div
        v-if="loading && items.length === 0"
        class="bg-white rounded-lg border border-gray-200 flex items-center justify-center py-14"
      >
        <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
      </div>

      <!-- ============ Empty (chưa lưu gì) ============ -->
      <div
        v-else-if="items.length === 0 && total === 0 && !hasActiveFilter"
        class="bg-white rounded-lg border border-gray-200"
      >
        <div class="flex flex-col items-center justify-center py-14 text-center px-6">
          <div class="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center mb-3">
            <BookmarkCheck class="w-5 h-5 text-primary-600" />
          </div>
          <h3 class="text-sm font-semibold text-gray-900">Bạn chưa lưu việc làm nào</h3>
          <p class="text-xs text-gray-500 mt-1 max-w-sm">
            Bấm biểu tượng bookmark trên việc làm để lưu lại. Các việc làm đã lưu sẽ hiện ở đây.
          </p>
          <button
            type="button"
            class="mt-4 px-3 py-1.5 text-xs rounded-md bg-gray-900 text-white hover:bg-gray-800 transition inline-flex items-center gap-1.5"
            @click="router.push('/candidate/viec-lam')"
          >
            <Search class="w-3.5 h-3.5" /> Khám phá việc làm
          </button>
        </div>
      </div>

      <!-- ============ Empty (filter trả 0) ============ -->
      <div
        v-else-if="items.length === 0 && hasActiveFilter"
        class="bg-white rounded-lg border border-gray-200"
      >
        <div class="flex flex-col items-center justify-center py-10 text-center px-6">
          <Inbox class="w-6 h-6 text-gray-300 mb-2" />
          <p class="text-xs text-gray-500 mb-3">
            Không có việc làm đã lưu nào khớp với bộ lọc hiện tại.
          </p>
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition"
            @click="resetAllFilters"
          >
            Xoá bộ lọc
          </button>
        </div>
      </div>

      <!-- ============ Job cards (Job Search style) ============ -->
      <!-- 2-column grid trên desktop theo yêu cầu. Card design = mirror
           JobSearchView (`<article>`) để UI/UX đồng nhất giữa 2 trang.
           Mỗi card gồm 3 hàng:
             1. logo | title+company+location+rating+views/applies | salary+workType+save
             2. description (line-clamp-2) + badges (Urgently / JobType / Remote OK)
             3. postedAt (trái) + "Xem chi tiết" button (phải)
           Meta "Đã lưu X ngày trước" hiển thị dưới card. -->
      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <article
          v-for="j in cards"
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
                :class="savedJobStore.isSaved(j.id)
                  ? 'text-[#1E40AF] hover:bg-[#EFF6FF]'
                  : 'text-[#94A3B8] hover:text-[#1E40AF] hover:bg-[#F1F5F9]'"
                :title="savedJobStore.isSaved(j.id) ? 'Bỏ lưu job' : 'Lưu job'"
                @click.stop="askUnsave(j.id, j.title)"
              >
                <!-- Saved Jobs: luôn filled (job đã được lưu) — click mở
                     confirm modal. Visual giống JobSearchView filled state. -->
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  stroke-width="1.8"
                  stroke="currentColor"
                  class="w-[18px] h-[18px]"
                  fill="currentColor"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                </svg>
              </button>
            </div>
          </div>

          <!-- ============ HÀNG 2: description + badges ============ -->
          <div class="mt-0 w-[90%]">
            <p v-if="j.descriptions" class="text-[12.5px] text-[#64748B] leading-[1.55] line-clamp-2">
              {{ j.descriptions }}
            </p>
            <!-- Badges (Urgently Hiring / Actively Hiring / JobType...) -->
            <div v-if="j.badges.length" class="mt-2 flex items-center gap-2 flex-wrap">
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
            <p class="text-[11.5px] text-[#94A3B8]">
              Lúc {{ j.postedAt }}
              <span class="mx-1 text-[#CBD5E1]">•</span>
              <span class="inline-flex items-center gap-1 text-[#1E40AF]">
                <BookmarkCheck class="w-3 h-3" />
                {{ savedLabel(j.savedAt) }}
              </span>
            </p>
            <button
              type="button"
              class="self-start sm:self-auto h-9 px-5 rounded-lg bg-[#1E40AF] hover:bg-[#1E3A8A] text-white text-[12.5px] font-semibold transition shadow-sm"
              @click="onCardClick(j)"
            >
              Xem chi tiết
            </button>
          </div>
        </article>
      </div>

      <!-- ============ Pagination ============ -->
      <nav
        v-if="total > pageSize"
        class="mt-6 flex items-center justify-between gap-3 flex-wrap bg-white rounded-lg border border-gray-200 px-4 py-3"
      >
        <p class="text-xs text-gray-500">
          Trang <strong class="text-gray-900">{{ page }}</strong> / <strong class="text-gray-900">{{ totalPages }}</strong>
          <span class="mx-1.5 text-gray-300">•</span>
          Tổng <strong class="text-gray-900">{{ total }}</strong> việc làm
        </p>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="page <= 1 || loading"
            @click="goToPage(page - 1)"
          >
            <ChevronLeft class="w-3.5 h-3.5" /> Trước
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="page >= totalPages || loading"
            @click="goToPage(page + 1)"
          >
            Sau <ChevronRight class="w-3.5 h-3.5" />
          </button>
        </div>
      </nav>
    </div>

    <!-- ============ Confirm unsave modal ============ -->
    <ConfirmModal
      :open="unsaveConfirmId !== null"
      title="Bỏ lưu job?"
      :message="confirmMessage"
      confirm-text="Bỏ lưu"
      variant="danger"
      :loading="(unsaveConfirmId !== null && pendingIds.has(unsaveConfirmId))"
      @cancel="cancelUnsave"
      @confirm="confirmUnsaveAction"
    />
  </div>
</template>

<style scoped>
/*
 * line-clamp utility — Tailwind plugin `@tailwindcss/line-clamp` có thể chưa
 * load (xem JobCard.vue). Define manual 2 dòng + ellipsis để không phụ thuộc.
 */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>