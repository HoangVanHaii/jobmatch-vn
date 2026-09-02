<script setup lang="ts">
/**
 * SavedJobsView — trang "Việc làm đã lưu" tại `/candidate/saved-jobs`.
 *
 * Pattern y hệt JobsView:
 *   - Header phẳng
 *   - 3 dropdown filter (Địa điểm? — không, vì backend `SavedJobListQuery` chỉ
 *     hỗ trợ jobLevel/jobType/remoteOk/industry. Industry là text input.)
 *   - Grid 1/2/3 cols + pagination y hệt MyResumesView
 *   - Empty state + 2 nhánh (no saved / filter trả 0)
 *
 * Khác biệt so với JobsView:
 *   - KHÔNG có search bar full-text (backend không hỗ trợ).
 *   - Có industry input (text) thay cho search.
 *   - Card hiển thị thêm "Đã lưu {{ savedLabel }}" (dayjs relative).
 *   - Save button mặc định ON (luôn hiện BookmarkCheck), click → unsave API
 *     + remove khỏi list (optimistic với rollback nếu fail).
 *   - Khi list trống → hiện CTA "Khám phá việc làm" → /candidate/viec-lam.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
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
  ChevronDown,
  Check,
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
import JobCard from '@components/job/JobCard.vue';
import ConfirmModal from '@components/common/ConfirmModal.vue';
import type { JobListItem, JobLevel, JobType } from '@/types/job';
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

const handleDocClick = (e: MouseEvent): void => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (!target.closest('[data-dropdown]')) openDropdown.value = null;
};
onMounted(() => document.addEventListener('click', handleDocClick));
onUnmounted(() => document.removeEventListener('click', handleDocClick));

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
 * Trigger label helper
 * ==========================================================================*/
const triggerLabel = (key: DropdownKey, currentLabel: string | null): string => {
  if (currentLabel) return currentLabel;
  const defaults: Record<DropdownKey, string> = {
    jobType: 'Loại hình',
    jobLevel: 'Cấp bậc',
    remote: 'Hình thức',
    industry: 'Ngành nghề',
  };
  return defaults[key];
};
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
/** Format "Đã lưu X ngày trước" từ savedAt. */
const savedLabel = (d: Date | string): string => {
  return `Đã lưu ${dayjs(d).fromNow()}`;
};

/** Message cho ConfirmModal — escape quotes ở JS, không phải trong template. */
const confirmMessage = computed(
  () =>
    `Bạn có chắc muốn bỏ lưu "${unsaveConfirmTitle.value}"? Job sẽ bị xoá khỏi danh sách đã lưu nhưng vẫn còn trên hệ thống.`,
);
</script>

<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-7xl mx-auto">
      <!-- ============ Header ============ -->
      <header class="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Việc làm đã lưu</h1>
          <p class="text-sm text-gray-500 mt-1">
            Danh sách các job bạn đã lưu để xem lại sau.
          </p>
        </div>
        <button
          type="button"
          class="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition inline-flex items-center gap-1.5"
          @click="router.push('/candidate/viec-lam')"
        >
          <Plus class="w-4 h-4" /> Khám phá việc làm
        </button>
      </header>

      <!-- ============ Search bar ============ -->
      <div class="mb-3 flex items-center gap-2">
        <div class="relative flex-1 max-w-md">
          <Search
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          />
          <input
            v-model="searchInput"
            type="text"
            placeholder="Tìm theo tên job, công ty..."
            class="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 transition"
          />
          <button
            v-if="searchInput"
            type="button"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
            aria-label="Xoá từ khoá"
            @click="clearSearch"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <span v-if="total > 0" class="text-xs text-gray-500 shrink-0">
          Hiển thị <strong class="text-gray-900">{{ items.length }}</strong> / {{ total }} job đã lưu
        </span>
      </div>

      <!-- ============ Filter row ============ -->
      <div data-dropdown class="mb-2 flex items-center gap-2 flex-wrap">
        <!-- Loại hình -->
        <div data-dropdown class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white transition"
            :class="currentJobType
              ? 'border-primary-200 bg-primary-50 text-primary-700'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50'"
            @click="toggleDropdown('jobType')"
          >
            <Briefcase class="w-3.5 h-3.5" />
            {{ triggerLabel('jobType', currentTriggerLabel('jobType')) }}
            <ChevronDown class="w-3 h-3 opacity-60" />
          </button>
          <div
            v-if="openDropdown === 'jobType'"
            class="absolute left-0 top-full mt-1.5 z-20 w-48 rounded-lg border border-gray-200 bg-white shadow-lg py-1"
            @click.stop
          >
            <template v-for="(opt, idx) in jobTypeOptions" :key="opt.label">
              <button
                type="button"
                class="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 flex items-center justify-between"
                :class="currentJobType === opt.value ? 'text-primary-700 font-medium' : 'text-gray-700'"
                @click="handleJobTypeSelect(opt.value)"
              >
                {{ opt.label }}
                <Check v-if="currentJobType === opt.value" class="w-3.5 h-3.5 text-primary-600" />
              </button>
              <div v-if="idx === 0 && jobTypeOptions.length > 1" class="h-px bg-gray-100 my-1" />
            </template>
          </div>
        </div>

        <!-- Ngành nghề (vị trí thứ 2) -->
        <div data-dropdown class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white transition"
            :class="currentIndustry
              ? 'border-primary-200 bg-primary-50 text-primary-700'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50'"
            @click="toggleDropdown('industry')"
          >
            <Briefcase class="w-3.5 h-3.5" />
            {{ triggerLabel('industry', currentTriggerLabel('industry')) }}
            <ChevronDown class="w-3 h-3 opacity-60" />
          </button>
          <div
            v-if="openDropdown === 'industry'"
            class="absolute left-0 top-full mt-1.5 z-20 w-64 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1"
            @click.stop
          >
            <button
              type="button"
              class="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 flex items-center justify-between"
              :class="currentIndustry === null ? 'text-primary-700 font-medium' : 'text-gray-700'"
              @click="handleIndustrySelect(null)"
            >
              Tất cả ngành nghề
              <Check v-if="currentIndustry === null" class="w-3.5 h-3.5 text-primary-600" />
            </button>
            <div class="h-px bg-gray-100 my-1" />
            <div
              v-if="industriesLoading && industries.length === 0"
              class="px-3 py-2 text-xs text-gray-500 inline-flex items-center gap-1.5"
            >
              <Loader2 class="w-3 h-3 animate-spin" /> Đang tải...
            </div>
            <button
              v-for="ind in industries"
              :key="ind"
              type="button"
              class="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 flex items-center justify-between"
              :class="currentIndustry === ind ? 'text-primary-700 font-medium' : 'text-gray-700'"
              @click="handleIndustrySelect(ind)"
            >
              {{ ind }}
              <Check v-if="currentIndustry === ind" class="w-3.5 h-3.5 text-primary-600" />
            </button>
            <p
              v-if="industries.length === 0 && !industriesLoading"
              class="px-3 py-2 text-xs text-gray-400"
            >
              Không có dữ liệu.
            </p>
          </div>
        </div>

        <!-- Cấp bậc -->
        <div data-dropdown class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white transition"
            :class="currentJobLevel
              ? 'border-primary-200 bg-primary-50 text-primary-700'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50'"
            @click="toggleDropdown('jobLevel')"
          >
            <Globe class="w-3.5 h-3.5" />
            {{ triggerLabel('jobLevel', currentTriggerLabel('jobLevel')) }}
            <ChevronDown class="w-3 h-3 opacity-60" />
          </button>
          <div
            v-if="openDropdown === 'jobLevel'"
            class="absolute left-0 top-full mt-1.5 z-20 w-48 rounded-lg border border-gray-200 bg-white shadow-lg py-1"
            @click.stop
          >
            <template v-for="(opt, idx) in jobLevelOptions" :key="opt.label">
              <button
                type="button"
                class="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 flex items-center justify-between"
                :class="currentJobLevel === opt.value ? 'text-primary-700 font-medium' : 'text-gray-700'"
                @click="handleJobLevelSelect(opt.value)"
              >
                {{ opt.label }}
                <Check v-if="currentJobLevel === opt.value" class="w-3.5 h-3.5 text-primary-600" />
              </button>
              <div v-if="idx === 0 && jobLevelOptions.length > 1" class="h-px bg-gray-100 my-1" />
            </template>
          </div>
        </div>

        <!-- Hình thức -->
        <div data-dropdown class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white transition"
            :class="currentRemote !== null
              ? 'border-primary-200 bg-primary-50 text-primary-700'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50'"
            @click="toggleDropdown('remote')"
          >
            <Building2 class="w-3.5 h-3.5" />
            {{ triggerLabel('remote', currentTriggerLabel('remote')) }}
            <ChevronDown class="w-3 h-3 opacity-60" />
          </button>
          <div
            v-if="openDropdown === 'remote'"
            class="absolute left-0 top-full mt-1.5 z-20 w-48 rounded-lg border border-gray-200 bg-white shadow-lg py-1"
            @click.stop
          >
            <template v-for="(opt, idx) in remoteOptions" :key="opt.label">
              <button
                type="button"
                class="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 flex items-center justify-between"
                :class="currentRemote === opt.value ? 'text-primary-700 font-medium' : 'text-gray-700'"
                @click="handleRemoteSelect(opt.value)"
              >
                {{ opt.label }}
                <Check v-if="currentRemote === opt.value" class="w-3.5 h-3.5 text-primary-600" />
              </button>
              <div v-if="idx === 0 && remoteOptions.length > 1" class="h-px bg-gray-100 my-1" />
            </template>
          </div>
        </div>
      </div>

      <!-- ============ Active chips + "Xoá tất cả" ============ -->
      <div v-if="hasActiveFilter" class="mb-5 flex items-center gap-2 flex-wrap min-h-[28px]">
        <button
          v-for="chip in activeChips"
          :key="chip.key + chip.label"
          type="button"
          class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-primary-50 text-primary-700 border border-primary-100 hover:bg-primary-100 transition"
          @click="chip.onRemove"
        >
          {{ chip.label }}
          <X class="w-3 h-3" />
        </button>
        <button
          type="button"
          class="px-2.5 py-1 text-xs font-medium rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition"
          @click="resetAllFilters"
        >
          Xoá tất cả
        </button>
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
          <h3 class="text-sm font-semibold text-gray-900">Bạn chưa lưu job nào</h3>
          <p class="text-xs text-gray-500 mt-1 max-w-sm">
            Bấm biểu tượng bookmark trên job để lưu lại. Các job đã lưu sẽ hiện ở đây.
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
            Không có job đã lưu nào khớp với bộ lọc hiện tại.
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

      <!-- ============ Grid jobs ============ -->
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <div
          v-for="entry in items"
          :key="entry.job.id"
          class="relative"
        >
          <JobCard
            :job="entry.job"
            :saved="true"
            :pending="pendingIds.has(entry.job.id)"
            @save="askUnsave(entry.job.id, entry.job.title)"
          />
          <!-- Meta "Đã lưu ..." overlay top-right of card -->
          <p class="mt-1.5 px-1 text-[10px] text-gray-400 inline-flex items-center gap-1">
            <BookmarkCheck class="w-3 h-3" />
            {{ savedLabel(entry.savedAt) }}
          </p>
        </div>
      </div>

      <!-- ============ Pagination ============ -->
      <nav
        v-if="total > pageSize"
        class="mt-6 flex items-center justify-between gap-3 flex-wrap bg-white rounded-lg border border-gray-200 px-4 py-3"
      >
        <p class="text-xs text-gray-500">
          Trang <strong class="text-gray-900">{{ page }}</strong> / <strong class="text-gray-900">{{ totalPages }}</strong>
          <span class="mx-1.5 text-gray-300">•</span>
          Tổng <strong class="text-gray-900">{{ total }}</strong> job
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
