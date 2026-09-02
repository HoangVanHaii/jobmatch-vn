<script setup lang="ts">
/**
 * JobsView — trang listing việc làm cho candidate tại `/candidate/viec-lam`.
 *
 * Pattern filter:
 *   - 4 nút dropdown đặt ngang hàng (Địa điểm ưu tiên đầu, sau đó Loại hình /
 *     Cấp bậc / Hình thức). Click → panel absolute hiện ra bên dưới.
 *   - Click ngoài panel hoặc chọn option → đóng panel + apply filter.
 *   - Chip removable hiện dưới thanh filter khi filter active.
 *
 * Locations:
 *   - Lấy từ provinces.open-api.vn (composable useLocations), fallback HN/HCM/ĐN
 *     nếu API trả [] hoặc fail.
 *
 * Pattern y hệt MyResumesView cho phần còn lại:
 *   - Header phẳng, không CTA
 *   - Search input debounce 400ms → fetchList({ search }, 1)
 *   - Grid 1/2/3 cols, pagination "Trước / Sau"
 *   - Local savedIds (Set) để toggle bookmark UI, chưa persist qua API.
 *
 * Gợi ý "Có thể bạn sẽ cần" (suggestions):
 *   - Khi search/filter trả 0 job → hiển thị thêm section bên dưới empty state.
 *   - Nguồn: job mới nhất (không áp filter), fetch 1 lần lúc mount, lưu trong
 *     `suggestedItems`. Không dùng search query vì semantic search cần API riêng.
 *   - UX: hiển thị 3 job đầu + nút "Xem thêm" tăng lên 6 (tối đa). Disable nút
 *     khi đã hiện hết. Save toggle dùng chung `savedIds` với list chính.
 *
 * Navigation:
 *   - Watch route.fullPath: khi user navigate đi rồi quay lại `/candidate/viec-lam`
 *     → reset local filter + store query về rỗng + fetchList({}) để bắt đầu tươi.
 *     Nếu không reset, store giữ filter cũ (vd locationCity = Hà Nội) → backend
 *     trả 0 job với local filter đã reset → hiển thị "chưa có job nào được đăng"
 *     gây nhầm lẫn.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { storeToRefs } from 'pinia';
import {
  Search,
  X,
  Briefcase,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Building2,
  ChevronDown,
  Check,
  MapPin,
  Globe,
} from 'lucide-vue-next';
import { useJobStore } from '@stores/job';
import { useSavedJobStore } from '@stores/savedJob';
import { useDebounce } from '@composables/useDebounce';
import { useLocations, type LocationItem } from '@composables/useLocations';
import { jobApi } from '@services/job.api';
import JobCard from '@components/job/JobCard.vue';
import type { JobLevel, JobListItem, JobType } from '@/types/job';

/* ============================================================================
 * Store binding
 * ==========================================================================*/
const store = useJobStore();
const { items, total, page, pageSize, totalPages, loading, error } = storeToRefs(store);

/* ============================================================================
 * Search (debounced)
 * ==========================================================================*/
const searchInput = ref('');
const debouncedSearch = useDebounce(searchInput, 400);
watch(debouncedSearch, (q) => {
  void store.fetchList({ search: q.trim() || undefined }, 1);
});
const clearSearch = (): void => {
  searchInput.value = '';
};

/* ============================================================================
 * Saved jobs — dùng shared store. fetchIds() 1 lần để build initial set.
 * ==========================================================================*/
const savedJobStore = useSavedJobStore();
const { savedIds, pendingIds } = storeToRefs(savedJobStore);
const handleToggleSave = (jobId: string): void => {
  void savedJobStore.toggle(jobId);
};

/* ============================================================================
 * Filter dropdown — generic composable
 * Generic cho 3 filter ENUM (jobType, jobLevel, remoteOk) + 1 filter string (location).
 * ==========================================================================*/
type DropdownKey = 'location' | 'jobType' | 'jobLevel' | 'remote' | 'industry';
const openDropdown = ref<DropdownKey | null>(null);

/** Click ngoài tất cả dropdown → đóng. */
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

/* ============================================================================
 * Locations (tỉnh/thành) — fetch từ API bên thứ 3
 * ==========================================================================*/
const locations = useLocations();
onMounted(() => {
  void locations.fetch();
});

const currentLocation = ref<string | null>(null);
/**
 * Filter value dùng làm `locationCity` gửi lên backend.
 *  - Khi select 1 tỉnh: lưu shortName (đã strip prefix) làm filter value,
 *    vì data job trong DB thường được employer nhập tay theo dạng ngắn.
 *  - Trigger button + chip hiển thị `name` đầy đủ để user dễ nhận biết.
 */
const filterLocationCity = ref<string | null>(null);
const handleLocationSelect = (shortName: string | null, displayName?: string): void => {
  filterLocationCity.value = shortName;
  currentLocation.value = displayName ?? shortName;
  openDropdown.value = null;
  void store.fetchList({ locationCity: shortName ?? undefined }, 1);
};

/* ============================================================================
 * jobType
 * ==========================================================================*/
const jobTypeOptions: Array<{ value: JobType | null; label: string }> = [
  { value: null, label: 'Tất cả loại hình' },
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'contract', label: 'Hợp đồng' },
  { value: 'internship', label: 'Thực tập' },
  { value: 'freelance', label: 'Freelance' },
];
const currentJobType = ref<JobType | null>(null);
const handleJobTypeSelect = (v: JobType | null): void => {
  currentJobType.value = v;
  openDropdown.value = null;
  void store.fetchList({ jobType: v ?? undefined }, 1);
};

/* ============================================================================
 * jobLevel
 * ==========================================================================*/
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
const currentJobLevel = ref<JobLevel | null>(null);
const handleJobLevelSelect = (v: JobLevel | null): void => {
  currentJobLevel.value = v;
  openDropdown.value = null;
  void store.fetchList({ jobLevel: v ?? undefined }, 1);
};

/* ============================================================================
 * remoteOk
 * ==========================================================================*/
type RemoteValue = boolean | null;
const remoteOptions: Array<{ value: RemoteValue; label: string }> = [
  { value: null, label: 'Tất cả hình thức' },
  { value: true, label: 'Có thể remote' },
  { value: false, label: 'Tại văn phòng' },
];
const currentRemote = ref<RemoteValue>(null);
const handleRemoteSelect = (v: RemoteValue): void => {
  currentRemote.value = v;
  openDropdown.value = null;
  void store.fetchList({ remoteOk: v ?? undefined }, 1);
};

/* ============================================================================
 * Industry — fetch distinct từ API `/jobs/industries` (1 lần lúc mount).
 * Lưu local Set ref → reactive. Loading + empty fallback.
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
    industriesLoaded.value = true; // đánh dấu đã load (failed) để không retry
  } finally {
    industriesLoading.value = false;
  }
};

const currentIndustry = ref<string | null>(null);
const handleIndustrySelect = (v: string | null): void => {
  currentIndustry.value = v;
  openDropdown.value = null;
  void store.fetchList({ industry: v ?? undefined }, 1);
};

/* ============================================================================
 * Active chips — list các filter đang active (để hiển thị removable chip
 * dưới thanh filter giống screenshot user gửi).
 * ==========================================================================*/
interface ActiveChip {
  key: DropdownKey;
  label: string;
  onRemove: () => void;
}

const activeChips = computed<ActiveChip[]>(() => {
  const chips: ActiveChip[] = [];
  if (currentLocation.value) {
    chips.push({
      key: 'location',
      label: currentLocation.value,
      onRemove: () => handleLocationSelect(null),
    });
  }
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
  currentLocation.value = null;
  filterLocationCity.value = null;
  currentJobType.value = null;
  currentJobLevel.value = null;
  currentRemote.value = null;
  currentIndustry.value = null;
  store.resetFilters();
  await store.fetchList({}, 1);
};

/* ============================================================================
 * Dropdown trigger button label helper
 * ==========================================================================*/
const triggerLabel = (key: DropdownKey, currentLabel: string | null): string => {
  if (currentLabel) return currentLabel;
  const defaults: Record<DropdownKey, string> = {
    location: 'Địa điểm',
    jobType: 'Loại hình',
    jobLevel: 'Cấp bậc',
    remote: 'Hình thức',
    industry: 'Ngành nghề',
  };
  return defaults[key];
};

const currentTriggerLabel = (key: DropdownKey): string | null => {
  switch (key) {
    case 'location':
      return currentLocation.value;
    case 'jobType':
      // currentJobType === null → "Tất cả loại hình" là option trong panel,
      // KHÔNG phải label của trigger button. Trả null để triggerLabel fallback
      // về default "Loại hình".
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
 * Pagination
 * ==========================================================================*/
const goToPage = async (p: number): Promise<void> => {
  const target = Math.min(Math.max(1, p), totalPages.value);
  if (target === page.value) return;
  await store.fetchList(undefined, target);
};

/* ============================================================================
 * Suggested jobs — "Có thể bạn sẽ cần"
 * Fetch 1 lần lúc mount: 6 job mới nhất, không filter. Khi search/filter trả 0
 * → hiển thị 3 job đầu, bấm "Xem thêm" tăng lên 6 (tối đa). Disable nút
 * khi đã hiện hết.
 * ==========================================================================*/
const SUGGESTED_STEP = 3;
const SUGGESTED_MAX = 6;
const suggestedItems = ref<JobListItem[]>([]);
const suggestedLoading = ref(false);
const suggestedVisibleCount = ref(SUGGESTED_STEP);

const fetchSuggested = async (): Promise<void> => {
  if (suggestedItems.value.length > 0 || suggestedLoading.value) return;
  suggestedLoading.value = true;
  try {
    const { data } = await jobApi.list({ page: 1, limit: SUGGESTED_MAX });
    suggestedItems.value = data.data;
  } catch {
    // Silent — section sẽ không render nếu list rỗng.
    suggestedItems.value = [];
  } finally {
    suggestedLoading.value = false;
  }
};

/** Số job thực sự hiển thị = min(visibleCount, total trong suggestedItems). */
const visibleSuggested = computed(() =>
  suggestedItems.value.slice(0, suggestedVisibleCount.value),
);
const canShowMore = computed(
  () => suggestedItems.value.length > suggestedVisibleCount.value,
);

const showMoreSuggested = (): void => {
  suggestedVisibleCount.value = Math.min(
    suggestedVisibleCount.value + SUGGESTED_STEP,
    suggestedItems.value.length,
  );
};

/** Có nên hiển thị section gợi ý không — chỉ khi filter trả 0. */
const showSuggestions = computed(
  () =>
    items.value.length === 0 &&
    hasActiveFilter.value &&
    suggestedItems.value.length > 0,
);

/* ============================================================================
 * Mount / navigation — luôn load tươi khi vào /candidate/viec-lam.
 * Reset cả local filter + store query về rỗng rồi mới fetchList({}) để tránh
 * mismatch (xem comment header "Navigation:").
 * ==========================================================================*/
const route = useRoute();

const initFresh = async (): Promise<void> => {
  searchInput.value = '';
  currentLocation.value = null;
  filterLocationCity.value = null;
  currentJobType.value = null;
  currentJobLevel.value = null;
  currentRemote.value = null;
  currentIndustry.value = null;
  store.resetFilters();
  await store.fetchList();
};

onMounted(() => {
  void initFresh();
  void fetchSuggested();
  void fetchIndustries();
  void savedJobStore.fetchIds();
});

// Khi navigate sang trang khác rồi quay lại /candidate/viec-lam → reset & fetch lại.
// Watch theo path (không watch fullPath để tránh fire khi query string đổi).
watch(
  () => route.path,
  (newPath, oldPath) => {
    if (newPath === '/candidate/viec-lam' && oldPath !== newPath) {
      void initFresh();
    }
  },
);
</script>

<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-7xl mx-auto">
      <!-- ============ Header ============ -->
      <header class="mb-6">
        <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Việc làm</h1>
        <p class="text-sm text-gray-500 mt-1">
          Khám phá các cơ hội nghề nghiệp phù hợp với bạn.
        </p>
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
            placeholder="Tìm theo tên job, công ty, kỹ năng..."
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
          Hiển thị <strong class="text-gray-900">{{ items.length }}</strong> / {{ total }} job
        </span>
      </div>

      <!-- ============ Filter dropdown row ============ -->
      <div data-dropdown class="mb-2 flex items-center gap-2 flex-wrap">
        <!-- Địa điểm (ưu tiên đầu) -->
        <div data-dropdown class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white transition"
            :class="filterLocationCity
              ? 'border-primary-200 bg-primary-50 text-primary-700'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50'"
            @click="toggleDropdown('location')"
          >
            <MapPin class="w-3.5 h-3.5" />
            {{ triggerLabel('location', currentLocation) }}
            <ChevronDown class="w-3 h-3 opacity-60" />
          </button>
          <div
            v-if="openDropdown === 'location'"
            class="absolute left-0 top-full mt-1.5 z-20 w-64 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1"
            @click.stop
          >
            <button
              type="button"
              class="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 flex items-center justify-between"
              :class="currentLocation === null ? 'text-primary-700 font-medium' : 'text-gray-700'"
              @click="handleLocationSelect(null, undefined)"
            >
              Tất cả địa điểm
              <Check v-if="currentLocation === null" class="w-3.5 h-3.5 text-primary-600" />
            </button>
            <div class="h-px bg-gray-100 my-1" />
            <div v-if="locations.loading.value && locations.items.value.length === 0" class="px-3 py-2 text-xs text-gray-500 inline-flex items-center gap-1.5">
              <Loader2 class="w-3 h-3 animate-spin" /> Đang tải...
            </div>
            <button
              v-for="loc in locations.items.value"
              :key="loc.code"
              type="button"
              class="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 flex items-center justify-between"
              :class="filterLocationCity === loc.shortName ? 'text-primary-700 font-medium' : 'text-gray-700'"
              @click="handleLocationSelect(loc.shortName, loc.name)"
            >
              {{ loc.name }}
              <Check v-if="filterLocationCity === loc.shortName" class="w-3.5 h-3.5 text-primary-600" />
            </button>
            <p
              v-if="locations.items.value.length === 0 && !locations.loading.value"
              class="px-3 py-2 text-xs text-gray-400"
            >
              Không có dữ liệu.
            </p>
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

      <!-- ============ Active filter chips + "Xoá tất cả" ============ -->
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

      <!-- ============ Error banner ============ -->
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

      <!-- ============ Empty (chưa có job nào) ============ -->
      <div
        v-else-if="items.length === 0 && total === 0 && !hasActiveFilter"
        class="bg-white rounded-lg border border-gray-200"
      >
        <div class="flex flex-col items-center justify-center py-14 text-center px-6">
          <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            <Briefcase class="w-5 h-5 text-gray-500" />
          </div>
          <h3 class="text-sm font-semibold text-gray-900">Chưa có job nào được đăng</h3>
          <p class="text-xs text-gray-500 mt-1">
            Hãy quay lại sau hoặc thử điều chỉnh bộ lọc.
          </p>
        </div>
      </div>

      <!-- ============ Empty (filter trả 0) ============ -->
      <div
        v-else-if="items.length === 0 && hasActiveFilter"
        class="bg-white rounded-lg border border-gray-200"
      >
        <div class="flex flex-col items-center justify-center py-10 text-center px-6">
          <Search class="w-6 h-6 text-gray-300 mb-2" />
          <p class="text-xs text-gray-500 mb-3">
            Không tìm thấy job nào khớp với bộ lọc / từ khoá hiện tại.
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

      <!-- ============ "Có thể bạn sẽ cần" — gợi ý khi filter trả 0 ============ -->
      <section v-if="showSuggestions" class="mt-6">
        <header class="mb-3 flex items-center gap-2">
          <Sparkles class="w-4 h-4 text-primary-600" />
          <h2 class="text-sm font-semibold text-gray-900">Có thể bạn sẽ cần</h2>
          <span class="text-xs text-gray-500">— các job mới nhất</span>
        </header>

        <div v-if="suggestedLoading" class="bg-white rounded-lg border border-gray-200 flex items-center justify-center py-10">
          <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
        </div>

        <template v-else>
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <JobCard
              v-for="job in visibleSuggested"
              :key="job.id"
              :job="job"
              :saved="savedIds.has(job.id)"
              :pending="pendingIds.has(job.id)"
              @save="handleToggleSave"
            />
          </div>

          <div v-if="canShowMore" class="mt-4 flex justify-center">
            <button
              type="button"
              class="px-4 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition inline-flex items-center gap-1.5"
              @click="showMoreSuggested"
            >
              <ChevronDown class="w-3.5 h-3.5" /> Xem thêm
            </button>
          </div>
        </template>
      </section>

      <!-- ============ Grid jobs ============ -->
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <JobCard
          v-for="job in items"
          :key="job.id"
          :job="job"
          :saved="savedIds.has(job.id)"
          :pending="pendingIds.has(job.id)"
          @save="handleToggleSave"
        />
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

      <p v-if="items.length > 0" class="mt-4 text-[11px] text-gray-400 inline-flex items-center gap-1">
        <Building2 class="w-3 h-3" />
        Dữ liệu được cập nhật liên tục từ nhà tuyển dụng đã xác minh.
      </p>
    </div>
  </div>
</template>
