<script setup lang="ts">
/**
 * JobDetailView — trang chi tiết job tại `/candidate/viec-lam/:id`.
 *
 * Sections:
 *   1. Header card (full-width) — title + featured + company · location + tags + meta
 *   2. Main 2-col (8/4 trên lg+):
 *      - Left (col-span-8): Mô tả / Yêu cầu / Quyền lợi / Kỹ năng
 *      - Right (col-span-4): Thông tin công ty + Apply card (sticky top-4)
 *   3. Loading state + error banner + not-found empty
 *
 * Lưu ý:
 *   - API `GET /jobs/:id` side-effect tăng viewsCount +1 (xem backend
 *     job.service.ts:getById). Không tăng thêm ở FE.
 *   - Apply button = placeholder (chưa gắn action, hiện toast).
 *   - Save button (bookmark) = placeholder local state, chưa gọi API.
 *   - Company info: backend JobListItem/JobDetail CHƯA trả full company record
 *     (chỉ name + logoUrl). Hiển thị phần có sẵn, không fake dữ liệu.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  Clock,
  Eye,
  FileText,
  Globe2,
  Loader2,
  MapPin,
  Send,
  Star,
  Wallet,
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  Share2,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import { storeToRefs } from 'pinia';
import { jobApi } from '@services/job.api';
import { useToastStore } from '@stores/toast';
import { useSavedJobStore } from '@stores/savedJob';
import type { JobDetail } from '@/types/job';

const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const savedJobStore = useSavedJobStore();
const { savedIds, pendingIds } = storeToRefs(savedJobStore);

const job = ref<JobDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const jobId = computed<string>(() => String(route.params.id ?? ''));
const saved = computed(() => (job.value ? savedIds.value.has(job.value.id) : false));
const saving = computed(() => (job.value ? pendingIds.value.has(job.value.id) : false));

/* ============================================================================
 * Fetch detail
 * ==========================================================================*/

const fetchDetail = async () => {
  if (!jobId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const { data } = await jobApi.detail(jobId.value);
    job.value = data.data;
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
});
// Re-fetch khi navigate giữa 2 detail (route param đổi).
watch(jobId, fetchDetail);

/* ============================================================================
 * Formatters (giữ chung với JobCard)
 * ==========================================================================*/

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
  return job.value?.jobLevel ? m[job.value.jobLevel] ?? job.value.jobLevel : '';
});

const jobTypeLabel = computed((): string => {
  const m: Record<string, string> = {
    'full-time': 'Toàn thời gian',
    'part-time': 'Bán thời gian',
    contract: 'Hợp đồng',
    internship: 'Thực tập',
    freelance: 'Freelance',
  };
  return job.value?.jobType ? m[job.value.jobType] ?? job.value.jobType : '';
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

const companyInitial = computed((): string => {
  const name = job.value?.companyName;
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
});

const locationLine = computed((): string => {
  const loc = job.value?.location;
  if (!loc) return '';
  const parts = [loc.district, loc.city].filter(Boolean);
  return parts.join(', ');
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

const publishedLabel = computed((): string => {
  if (!job.value?.publishedAt) return '';
  return dayjs(job.value.publishedAt).format('DD/MM/YYYY');
});

const deadlineLabel = computed((): string => {
  if (!job.value?.deadline) return '';
  return dayjs(job.value.deadline).format('DD/MM/YYYY');
});

const compactNumber = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
};

/* ============================================================================
 * Handlers
 * ==========================================================================*/

const goBack = (): void => {
  // Quay lại trang list job trong candidate layout.
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push('/candidate/viec-lam');
  }
};

const onApply = (): void => {
  toast.push({
    variant: 'info',
    title: 'Tính năng đang phát triển',
    body: 'Ứng tuyển job sẽ sớm được mở. Vui lòng quay lại sau!',
  });
};

const onSave = async (): Promise<void> => {
  if (!job.value) return;
  const wasSaved = saved.value;
  const ok = await savedJobStore.toggle(job.value.id);
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
</script>

<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-6xl mx-auto">
      <!-- ============ Back button ============ -->
      <button
        type="button"
        class="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition"
        @click="goBack"
      >
        <ArrowLeft class="w-4 h-4" /> Quay lại danh sách
      </button>

      <!-- ============ Loading ============ -->
      <div
        v-if="loading && !job"
        class="bg-white rounded-xl border border-gray-200 flex items-center justify-center py-20"
      >
        <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
      </div>

      <!-- ============ Error / Not found ============ -->
      <div
        v-else-if="error || !job"
        class="bg-white rounded-xl border border-gray-200 px-6 py-16 text-center"
      >
        <div class="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
          <AlertCircle class="w-6 h-6 text-red-500" />
        </div>
        <h3 class="text-sm font-semibold text-gray-900">Không tải được chi tiết job</h3>
        <p class="text-xs text-gray-500 mt-1">{{ error ?? 'Job không tồn tại hoặc đã bị đóng.' }}</p>
        <button
          type="button"
          class="mt-4 px-3 py-1.5 text-xs rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition"
          @click="goBack"
        >
          Quay lại
        </button>
      </div>

      <!-- ============ Main content ============ -->
      <template v-else>
        <!-- Header card -->
        <header class="bg-white rounded-xl border border-gray-200 p-6 mb-4">
          <div class="flex items-start gap-4">
            <div
              class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary-50 to-primary-100 text-xl font-semibold text-primary-700"
            >
              <img
                v-if="job.companyLogoUrl"
                :src="job.companyLogoUrl"
                :alt="job.companyName ?? ''"
                class="h-full w-full object-cover"
              />
              <span v-else>{{ companyInitial }}</span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-start gap-2 flex-wrap">
                <h1 class="text-xl md:text-2xl font-semibold text-gray-900 leading-snug">
                  {{ job.title }}
                </h1>
                <Star
                  v-if="job.featured"
                  class="w-5 h-5 shrink-0 mt-1 fill-yellow-400 text-yellow-400"
                  aria-label="Job nổi bật"
                />
              </div>

              <div class="mt-1.5 flex items-center gap-x-4 gap-y-1 flex-wrap text-sm text-gray-600">
                <span v-if="job.companyName" class="inline-flex items-center gap-1">
                  <Building2 class="w-3.5 h-3.5 text-gray-400" />
                  {{ job.companyName }}
                </span>
                <span v-if="locationLine" class="inline-flex items-center gap-1">
                  <MapPin class="w-3.5 h-3.5 text-gray-400" />
                  {{ locationLine }}
                </span>
                <span v-if="job.industry" class="inline-flex items-center gap-1">
                  <Globe2 class="w-3.5 h-3.5 text-gray-400" />
                  {{ job.industry }}
                </span>
              </div>

              <!-- Tag row -->
              <div class="mt-3 flex flex-wrap gap-1.5">
                <span
                  v-if="job.jobLevel"
                  class="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700"
                >
                  <Briefcase class="h-3 w-3" />
                  {{ jobLevelLabel }}
                </span>
                <span
                  v-if="job.jobType"
                  class="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700"
                >
                  {{ jobTypeLabel }}
                </span>
                <span
                  class="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
                >
                  <Wallet class="h-3 w-3" />
                  {{ salaryLabel }}
                </span>
                <span
                  v-if="job.remoteOk"
                  class="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700"
                >
                  Remote OK
                </span>
              </div>

              <!-- Meta row -->
              <div class="mt-4 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-gray-500">
                <span v-if="publishedLabel" class="inline-flex items-center gap-1">
                  <Calendar class="w-3 h-3" />
                  Đăng {{ publishedLabel }}
                </span>
                <span v-if="deadlineLabel" class="inline-flex items-center gap-1">
                  <Clock class="w-3 h-3" />
                  Hạn nộp {{ deadlineLabel }}
                </span>
                <span v-if="experienceLabel" class="inline-flex items-center gap-1">
                  <Briefcase class="w-3 h-3" />
                  Kinh nghiệm: {{ experienceLabel }}
                </span>
                <span class="inline-flex items-center gap-1">
                  <Eye class="w-3 h-3" />
                  {{ compactNumber(job.viewsCount) }} lượt xem
                </span>
                <span class="inline-flex items-center gap-1">
                  <FileText class="w-3 h-3" />
                  {{ compactNumber(job.appliesCount) }} ứng viên
                </span>
              </div>
            </div>
          </div>
        </header>

        <!-- 2-col main -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <!-- ============ Left col ============ -->
          <div class="lg:col-span-8 space-y-4">
            <!-- Mô tả -->
            <section class="bg-white rounded-xl border border-gray-200 p-6">
              <h2 class="text-sm font-semibold text-gray-900 mb-3">Mô tả công việc</h2>
              <p class="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {{ job.description }}
              </p>
            </section>

            <!-- Yêu cầu -->
            <section
              v-if="job.requirements"
              class="bg-white rounded-xl border border-gray-200 p-6"
            >
              <h2 class="text-sm font-semibold text-gray-900 mb-3">Yêu cầu ứng viên</h2>
              <p class="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {{ job.requirements }}
              </p>
            </section>

            <!-- Quyền lợi -->
            <section
              v-if="job.benefits"
              class="bg-white rounded-xl border border-gray-200 p-6"
            >
              <h2 class="text-sm font-semibold text-gray-900 mb-3">Quyền lợi</h2>
              <p class="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {{ job.benefits }}
              </p>
            </section>

            <!-- Skills -->
            <section
              v-if="job.requiredSkills?.length || job.niceToHaveSkills?.length"
              class="bg-white rounded-xl border border-gray-200 p-6"
            >
              <h2 class="text-sm font-semibold text-gray-900 mb-3">Kỹ năng</h2>

              <div v-if="job.requiredSkills?.length" class="mb-3">
                <p class="text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-1.5">
                  Yêu cầu
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="skill in job.requiredSkills"
                    :key="skill"
                    class="inline-flex items-center rounded-md bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
                  >
                    {{ skill }}
                  </span>
                </div>
              </div>

              <div v-if="job.niceToHaveSkills?.length">
                <p class="text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-1.5">
                  Ưu tiên
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="skill in job.niceToHaveSkills"
                    :key="skill"
                    class="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                  >
                    {{ skill }}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <!-- ============ Right col (sticky) ============ -->
          <aside class="lg:col-span-4 space-y-4">
            <div class="lg:sticky lg:top-4 space-y-4">
              <!-- Apply card -->
              <div class="bg-white rounded-xl border border-gray-200 p-5">
                <button
                  type="button"
                  class="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition inline-flex items-center justify-center gap-2"
                  @click="onApply"
                >
                  <Send class="w-4 h-4" /> Ứng tuyển ngay
                </button>
                <button
                  type="button"
                  class="mt-2 w-full px-4 py-2 text-sm font-medium rounded-lg border transition inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  :class="saved
                    ? 'border-primary-200 bg-primary-50 text-primary-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'"
                  :disabled="saving"
                  @click="onSave"
                >
                  <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                  <BookmarkCheck v-else-if="saved" class="w-4 h-4" />
                  <Bookmark v-else class="w-4 h-4" />
                  {{ saved ? 'Đã lưu job' : 'Lưu job' }}
                </button>
                <button
                  type="button"
                  class="mt-2 w-full px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition inline-flex items-center justify-center gap-2"
                  @click="onShare"
                >
                  <Share2 class="w-4 h-4" /> Chia sẻ
                </button>
              </div>

              <!-- Company card -->
              <div class="bg-white rounded-xl border border-gray-200 p-5">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                  Thông tin công ty
                </h3>
                <div class="flex items-center gap-3">
                  <div
                    class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-primary-50 to-primary-100 text-sm font-semibold text-primary-700"
                  >
                    <img
                      v-if="job.companyLogoUrl"
                      :src="job.companyLogoUrl"
                      :alt="job.companyName ?? ''"
                      class="h-full w-full object-cover"
                    />
                    <span v-else>{{ companyInitial }}</span>
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-gray-900 truncate">
                      {{ job.companyName ?? 'Công ty ẩn danh' }}
                    </p>
                    <p v-if="job.industry" class="text-xs text-gray-500 truncate">
                      {{ job.industry }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Job overview stats -->
              <div class="bg-white rounded-xl border border-gray-200 p-5 space-y-2.5">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Tổng quan
                </h3>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <Eye class="w-3.5 h-3.5" /> Lượt xem
                  </span>
                  <span class="font-medium text-gray-900">{{ compactNumber(job.viewsCount) }}</span>
                </div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <FileText class="w-3.5 h-3.5" /> Ứng viên
                  </span>
                  <span class="font-medium text-gray-900">{{ compactNumber(job.appliesCount) }}</span>
                </div>
                <div v-if="publishedLabel" class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <Calendar class="w-3.5 h-3.5" /> Ngày đăng
                  </span>
                  <span class="font-medium text-gray-900">{{ publishedLabel }}</span>
                </div>
                <div v-if="deadlineLabel" class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <Clock class="w-3.5 h-3.5" /> Hạn nộp
                  </span>
                  <span class="font-medium text-gray-900">{{ deadlineLabel }}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </template>
    </div>
  </div>
</template>