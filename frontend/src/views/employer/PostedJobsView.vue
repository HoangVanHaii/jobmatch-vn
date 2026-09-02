<script setup lang="ts">
/**
 * PostedJobsView — trang "Job đã đăng" cho employer tại `/employer/jobs`.
 *
 * Pattern filter y hệt JobsView (candidate) nhưng với các khác biệt:
 *  - Filter status (live/draft/ai_scanning/ai_flagged/expired/closed) — vì
 *    employer cần quản lý job ở mọi trạng thái moderation pipeline.
 *  - Filter location/industry/jobType/jobLevel/remote giống candidate.
 *    Thứ tự filter row: Status → Địa điểm → Ngành nghề → Loại hình → Cấp bậc → Hình thức.
 *  - KHÔNG có "Có thể bạn sẽ cần" (gợi ý) — employer không cần.
 *  - Card dùng EmployerJobCard — có status badge + actions "Ứng viên / Sửa".
 *
 * Backend:
 *  - GET /api/v1/jobs/company — auth + employerOnly. Controller tự resolve
 *    companyId từ session user (qua companyMemberService.findMembershipByUserId).
 *  - Nếu employer chưa thuộc company nào → trả list rỗng → hiển thị CTA
 *    "Tạo công ty / Đăng job đầu tiên".
 *
 * Search/filter đều debounce 400ms + reset về page 1.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import {
  Search,
  X,
  Briefcase,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Building2,
  Plus,
  MapPin,
} from 'lucide-vue-next';
import { useEmployerJobStore } from '@stores/employerJob';
import { useDebounce } from '@composables/useDebounce';
import { useLocations } from '@composables/useLocations';
import { jobApi } from '@services/job.api';
import EmployerJobCard from '@components/job/EmployerJobCard.vue';
import ConfirmModal from '@components/common/ConfirmModal.vue';
import EditJobModal from '@components/employer/EditJobModal.vue';
import CreateJobModal from '@components/employer/CreateJobModal.vue';
import { useToastStore } from '@stores/toast';
import type { JobLevel, JobStatus, JobType } from '@/types/job';

const store = useEmployerJobStore();
const { items, total, page, pageSize, totalPages, loading, error } = storeToRefs(store);
const toast = useToastStore();
const router = useRouter();
const route = useRoute();

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
 * Filter dropdowns
 * ==========================================================================*/
type DropdownKey = 'status' | 'location' | 'jobType' | 'jobLevel' | 'remote' | 'industry';
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

/* Status */
const statusOptions: Array<{ value: JobStatus | null; label: string }> = [
  { value: null, label: 'Tất cả trạng thái' },
  { value: 'live', label: 'Đang hiển thị' },
  { value: 'draft', label: 'Bản nháp' },
  { value: 'ai_scanning', label: 'AI đang quét' },
  { value: 'ai_flagged', label: 'Bị gắn cờ' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'closed', label: 'Đã đóng' },
];
const currentStatus = ref<JobStatus | null>(null);
const handleStatusSelect = (v: JobStatus | null): void => {
  currentStatus.value = v;
  openDropdown.value = null;
  void store.fetchList({ status: v ?? undefined }, 1);
};

/* Location — dùng composable useLocations (provinces.open-api.vn, fallback HN/HCM/ĐN).
 * Gửi `shortName` (đã strip "Thành phố "/"Tỉnh ") lên BE để match data job
 * mà employer nhập tay. Backend `jobService.list` đã match cả 2 dạng nên OK
 * cả data cũ lẫn mới. */
const locations = useLocations();
const currentLocationCity = ref<string | null>(null);
/** Tên đầy đủ có tiền tố (vd "Thành phố Hà Nội") — dùng cho chip label. */
const currentLocationDisplay = ref<string | null>(null);
const handleLocationSelect = (shortName: string | null, displayName?: string): void => {
  currentLocationCity.value = shortName;
  currentLocationDisplay.value = shortName ? (displayName ?? shortName) : null;
  openDropdown.value = null;
  void store.fetchList({ locationCity: shortName ?? undefined }, 1);
};

/* jobType */
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

/* jobLevel */
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

/* remote */
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

/* Industry — fetch distinct từ API (giống JobsView). */
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
const currentIndustry = ref<string | null>(null);
const handleIndustrySelect = (v: string | null): void => {
  currentIndustry.value = v;
  openDropdown.value = null;
  void store.fetchList({ industry: v ?? undefined }, 1);
};

/* ============================================================================
 * Active chips + reset
 * ==========================================================================*/
interface ActiveChip {
  key: DropdownKey;
  label: string;
  onRemove: () => void;
}
const activeChips = computed<ActiveChip[]>(() => {
  const chips: ActiveChip[] = [];
  if (currentStatus.value) {
    const opt = statusOptions.find((o) => o.value === currentStatus.value);
    chips.push({ key: 'status', label: opt?.label ?? currentStatus.value, onRemove: () => handleStatusSelect(null) });
  }
  if (currentLocationCity.value) {
    chips.push({
      key: 'location',
      label: currentLocationDisplay.value ?? currentLocationCity.value,
      onRemove: () => handleLocationSelect(null, undefined),
    });
  }
  if (currentJobType.value) {
    const opt = jobTypeOptions.find((o) => o.value === currentJobType.value);
    chips.push({ key: 'jobType', label: opt?.label ?? currentJobType.value, onRemove: () => handleJobTypeSelect(null) });
  }
  if (currentJobLevel.value) {
    const opt = jobLevelOptions.find((o) => o.value === currentJobLevel.value);
    chips.push({ key: 'jobLevel', label: opt?.label ?? currentJobLevel.value, onRemove: () => handleJobLevelSelect(null) });
  }
  if (currentRemote.value !== null) {
    const opt = remoteOptions.find((o) => o.value === currentRemote.value);
    chips.push({ key: 'remote', label: opt?.label ?? '', onRemove: () => handleRemoteSelect(null) });
  }
  if (currentIndustry.value) {
    chips.push({ key: 'industry', label: currentIndustry.value, onRemove: () => handleIndustrySelect(null) });
  }
  return chips;
});

const hasActiveFilter = computed(
  () => searchInput.value.trim() !== '' || activeChips.value.length > 0,
);

const resetAllFilters = async (): Promise<void> => {
  searchInput.value = '';
  currentStatus.value = null;
  currentLocationCity.value = null;
  currentLocationDisplay.value = null;
  currentJobType.value = null;
  currentJobLevel.value = null;
  currentRemote.value = null;
  currentIndustry.value = null;
  store.resetFilters();
  await store.fetchList({}, 1);
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
 * Delete job — confirm modal + API
 * ==========================================================================*/
const deleteConfirmId = ref<string | null>(null);
const deleteConfirmTitle = ref<string>('');
const askDelete = (jobId: string): void => {
  deleteConfirmId.value = jobId;
  deleteConfirmTitle.value = items.value.find((j) => j.id === jobId)?.title ?? '';
};
const cancelDelete = (): void => {
  deleteConfirmId.value = null;
};
const confirmDeleteAction = async (): Promise<void> => {
  const id = deleteConfirmId.value;
  if (!id) return;
  deleteConfirmId.value = null;
  try {
    await jobApi.delete(id);
    toast.push({ variant: 'success', title: 'Đã xoá job', body: deleteConfirmTitle.value });
    await store.fetchList(undefined, page.value);
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Xoá thất bại',
      body: e instanceof Error ? e.message : 'Vui lòng thử lại',
    });
  }
};
const confirmMessage = computed(
  () => `Bạn có chắc muốn xoá "${deleteConfirmTitle.value}"? Job sẽ chuyển sang trạng thái đã đóng và không còn hiển thị với ứng viên.`,
);

/* ============================================================================
 * Edit modal — mở khi card emit 'edit'. Host ở page-level để khi đóng/mở lại
 * không remount component (chỉ reset state nội bộ của modal qua watch jobId).
 * ==========================================================================*/
const editModalJobId = ref<string | null>(null);
const editModalOpen = ref(false);
const openEditModal = (jobId: string): void => {
  editModalJobId.value = jobId;
  editModalOpen.value = true;
};
const onEditSaved = async (): Promise<void> => {
  // Modal đã tự đóng + toast success. Refetch list để card refresh data.
  await store.fetchList(undefined, page.value);
};

/* ============================================================================
 * Create modal — mở khi click "Đăng job mới". Không cần jobId.
 * ==========================================================================*/
const createModalOpen = ref(false);
const openCreateModal = (): void => {
  createModalOpen.value = true;
};
const onJobCreated = async (newJobId: string): Promise<void> => {
  // Modal đã tự đóng. Navigate tới trang detail để user thấy job vừa tạo +
  // có thể gửi kiểm duyệt AI / sửa tiếp.
  await router.push(`/employer/jobs/${newJobId}`);
};

/* ============================================================================
 * Mount / navigation — reset mỗi lần vào trang (giống JobsView).
 * ==========================================================================*/
const initFresh = async (): Promise<void> => {
  searchInput.value = '';
  currentStatus.value = null;
  currentLocationCity.value = null;
  currentLocationDisplay.value = null;
  currentJobType.value = null;
  currentJobLevel.value = null;
  currentRemote.value = null;
  currentIndustry.value = null;
  store.resetFilters();
  await store.fetchList();
};

onMounted(() => {
  void initFresh();
  void fetchIndustries();
  void locations.fetch();
});

watch(
  () => route.path,
  (newPath, oldPath) => {
    if (newPath === '/employer/jobs' && oldPath !== newPath) {
      void initFresh();
    }
  },
);

/* ============================================================================
 * Helpers cho template
 * ==========================================================================*/
const triggerLabel = (key: DropdownKey, currentLabel: string | null): string => {
  if (currentLabel) return currentLabel;
  const defaults: Record<DropdownKey, string> = {
    status: 'Trạng thái',
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
    case 'status':
      if (currentStatus.value === null) return null;
      return statusOptions.find((o) => o.value === currentStatus.value)?.label ?? null;
    case 'location':
      return currentLocationDisplay.value;
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
</script>

<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-7xl mx-auto">
      <!-- ============ Header ============ -->
      <header class="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Job đã đăng</h1>
          <p class="text-sm text-gray-500 mt-1">
            Quản lý các tin tuyển dụng của công ty bạn.
          </p>
        </div>
        <button
          type="button"
          class="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition inline-flex items-center gap-1.5"
          @click="openCreateModal"
        >
          <Plus class="w-4 h-4" /> Đăng job mới
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
            placeholder="Tìm theo tiêu đề job..."
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

      <!-- ============ Filter row ============ -->
      <div data-dropdown class="mb-2 flex items-center gap-2 flex-wrap">
        <!-- Trạng thái (vị trí đầu — quan trọng nhất với employer) -->
        <div data-dropdown class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white transition"
            :class="currentStatus
              ? 'border-primary-200 bg-primary-50 text-primary-700'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50'"
            @click="toggleDropdown('status')"
          >
            <Briefcase class="w-3.5 h-3.5" />
            {{ triggerLabel('status', currentTriggerLabel('status')) }}
            <ChevronDown class="w-3 h-3 opacity-60" />
          </button>
          <div
            v-if="openDropdown === 'status'"
            class="absolute left-0 top-full mt-1.5 z-20 w-48 rounded-lg border border-gray-200 bg-white shadow-lg py-1"
            @click.stop
          >
            <template v-for="(opt, idx) in statusOptions" :key="opt.label">
              <button
                type="button"
                class="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 flex items-center justify-between"
                :class="currentStatus === opt.value ? 'text-primary-700 font-medium' : 'text-gray-700'"
                @click="handleStatusSelect(opt.value)"
              >
                {{ opt.label }}
                <Check v-if="currentStatus === opt.value" class="w-3.5 h-3.5 text-primary-600" />
              </button>
              <div v-if="idx === 0 && statusOptions.length > 1" class="h-px bg-gray-100 my-1" />
            </template>
          </div>
        </div>

        <!-- Địa điểm (vị trí thứ 2) -->
        <div data-dropdown class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white transition"
            :class="currentLocationCity
              ? 'border-primary-200 bg-primary-50 text-primary-700'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50'"
            @click="toggleDropdown('location')"
          >
            <MapPin class="w-3.5 h-3.5" />
            {{ triggerLabel('location', currentTriggerLabel('location')) }}
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
              :class="currentLocationCity === null ? 'text-primary-700 font-medium' : 'text-gray-700'"
              @click="handleLocationSelect(null, undefined)"
            >
              Tất cả địa điểm
              <Check v-if="currentLocationCity === null" class="w-3.5 h-3.5 text-primary-600" />
            </button>
            <div class="h-px bg-gray-100 my-1" />
            <div
              v-if="locations.loading.value && locations.items.value.length === 0"
              class="px-3 py-2 text-xs text-gray-500 inline-flex items-center gap-1.5"
            >
              <Loader2 class="w-3 h-3 animate-spin" /> Đang tải...
            </div>
            <button
              v-for="loc in locations.items.value"
              :key="loc.code"
              type="button"
              class="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 flex items-center justify-between"
              :class="currentLocationCity === loc.shortName ? 'text-primary-700 font-medium' : 'text-gray-700'"
              @click="handleLocationSelect(loc.shortName, loc.name)"
            >
              {{ loc.name }}
              <Check v-if="currentLocationCity === loc.shortName" class="w-3.5 h-3.5 text-primary-600" />
            </button>
            <p
              v-if="locations.items.value.length === 0 && !locations.loading.value"
              class="px-3 py-2 text-xs text-gray-400"
            >
              Không có dữ liệu.
            </p>
          </div>
        </div>

        <!-- Ngành nghề (vị trí thứ 3) -->
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
            <Building2 class="w-3.5 h-3.5" />
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
            <Briefcase class="w-3.5 h-3.5" />
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
          <Loader2 v-if="chip.key === 'status' && currentStatus === 'ai_scanning'" class="w-3 h-3 animate-spin" />
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

      <!-- ============ Loading ============ -->
      <div
        v-if="loading && items.length === 0"
        class="bg-white rounded-lg border border-gray-200 flex items-center justify-center py-14"
      >
        <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
      </div>

      <!-- ============ Empty (chưa có job) ============ -->
      <div
        v-else-if="items.length === 0 && total === 0 && !hasActiveFilter"
        class="bg-white rounded-lg border border-gray-200"
      >
        <div class="flex flex-col items-center justify-center py-14 text-center px-6">
          <div class="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center mb-3">
            <Briefcase class="w-5 h-5 text-primary-600" />
          </div>
          <h3 class="text-sm font-semibold text-gray-900">Bạn chưa đăng job nào</h3>
          <p class="text-xs text-gray-500 mt-1 max-w-sm">
            Tạo công ty trước (nếu chưa có), sau đó đăng tin tuyển dụng đầu tiên để bắt đầu nhận ứng viên.
          </p>
          <div class="mt-4 flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition"
              @click="router.push('/employer/company')"
            >
              Hồ sơ công ty
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-md bg-gray-900 text-white hover:bg-gray-800 transition inline-flex items-center gap-1.5"
              @click="openCreateModal"
            >
              <Plus class="w-3.5 h-3.5" /> Đăng job mới
            </button>
          </div>
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
            Không có job nào khớp với bộ lọc / từ khoá hiện tại.
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
        <EmployerJobCard
          v-for="job in items"
          :key="job.id"
          :job="job"
          @delete="askDelete"
          @edit="openEditModal"
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
    </div>

    <!-- ============ Confirm delete modal ============ -->
    <ConfirmModal
      :open="deleteConfirmId !== null"
      title="Xoá job?"
      :message="confirmMessage"
      confirm-text="Xoá"
      variant="danger"
      @cancel="cancelDelete"
      @confirm="confirmDeleteAction"
    />

    <!-- ============ Edit modal ============ -->
    <EditJobModal
      v-if="editModalJobId"
      v-model:open="editModalOpen"
      :job-id="editModalJobId"
      @saved="onEditSaved"
    />

    <!-- ============ Create modal ============ -->
    <CreateJobModal
      v-model:open="createModalOpen"
      @created="onJobCreated"
    />
  </div>
</template>