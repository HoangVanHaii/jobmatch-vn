<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import {
  FileText,
  Plus,
  Upload,
  Eye,
  Star,
  Loader2,
  AlertCircle,
  Trash2,
  X,
  ExternalLink,
  Download,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Search,
} from 'lucide-vue-next';
import { useCvStore } from '@stores/cv';
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue';
import CVTemplateMockup from '@components/cv/CVTemplateMockup.vue';
import type { CvRenderData, CvSource, CvStatus, ListCv, CvDetail } from '@/types/cv';
import { useSocket } from '@composables/useSocket';

const router = useRouter();
const cvStore = useCvStore();
const { items, total, page, pageSize, totalPages, loading, error } = storeToRefs(cvStore);

/* ============================================================================
 * Filter theo source — server-side qua query string.
 * Đổi filter → reset về trang 1.
 * ==========================================================================*/
const sourceFilter = ref<'all' | CvSource>('all');
const searchQuery = ref('');

const sourceOptions: Array<{ value: 'all' | CvSource; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'upload', label: 'CV Upload' },
  { value: 'direct', label: 'CV tạo trực tiếp' },
];

const sourceToQuery = (s: 'all' | CvSource): CvSource | undefined =>
  s === 'all' ? undefined : s;

const loadList = async () => {
  await cvStore.fetchList(sourceToQuery(sourceFilter.value));
};

const handleSourceChange = async (s: 'all' | CvSource) => {
  sourceFilter.value = s;
  await cvStore.fetchList(sourceToQuery(s), 1);
};

const goToPage = async (p: number) => {
  const target = Math.min(Math.max(1, p), totalPages.value);
  if (target === page.value) return;
  await cvStore.fetchList(sourceToQuery(sourceFilter.value), target);
};

onMounted(loadList);
watch(() => router.currentRoute.value.fullPath, () => loadList());

/* ============================================================================
 * Socket: BE worker / PATCH sẽ emit `cv:status-changed` khi status CV đổi
 * (`pending → parsing → ready | failed`). Lắng nghe để cập nhật UI realtime,
 * tránh user phải F5 thủ công.
 *
 * Payload BE (xem cv.service.ts changeStatus / changeAnalysisAsReady):
 *   { cvId: string; status: CvStatus }
 *
 * - status='parsing' / 'failed' / ...  → patch ngay status trong list.
 * - status='ready'                     → patch + refresh detail để lấy
 *                                         aiAnalysisTotal mới (score vừa chấm).
 * ==========================================================================*/
useSocket('cv:status-changed', async (payload: { cvId: string; status: CvStatus }) => {
  const { cvId, status } = payload;
  if (!cvId || !status) return;

  // 1. Patch status ngay (UI phản hồi tức thì)
  cvStore.updateStatus(cvId, status);

  // 2. Khi ready → fetch lại detail để lấy aiAnalysisTotal
  if (status === 'ready') {
    await cvStore.refreshDetail(cvId);
  }
});

/* ============================================================================
 * Filter phía client theo search (lọc nhẹ trên list hiện tại)
 * ==========================================================================*/
const visibleItems = computed<ListCv[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter((cv) =>
    (cv.title || '').toLowerCase().includes(q),
  );
});

/* ============================================================================
 * Label theo status (chỉ text, dot màu theo status).
 * ==========================================================================*/
const statusLabel: Record<CvStatus, string> = {
  pending: 'Chờ xử lý',
  parsing: 'Đang phân tích',
  ready: 'Sẵn sàng',
  failed: 'Lỗi',
  deleted: 'Đã xoá',
};

const statusDotColor: Record<CvStatus, string> = {
  pending: 'bg-amber-500',
  parsing: 'bg-blue-500',
  ready: 'bg-green-500',
  failed: 'bg-red-500',
  deleted: 'bg-gray-400',
};

/** Nhãn hiển thị trong thumbnail. */
const sourceLabel: Record<CvSource, string> = {
  upload: 'CV Upload',
  direct: 'Tạo trực tiếp',
};

/** Lấy templateId cho direct CV (clamp về 1..5). */
const getTemplateId = (cv: ListCv): number | null => {
  if (cv.source !== 'direct') return null;
  const id = cv.templateId;
  return id !== null && id >= 1 && id <= 5 ? id : 1;
};

/** Nhãn ngắn gọn cho file type (PDF / DOCX / generic). */
const fileTypeLabel = (cv: ListCv): string => {
  const mime = (cv.fileType || '').toLowerCase();
  if (mime === 'application/pdf') return 'PDF';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword'
  ) return 'DOCX';
  if (mime.startsWith('image/')) return mime.replace('image/', '').toUpperCase();
  return 'FILE';
};

/** Title fallback khi ListCv.title null/empty. */
const getDisplayTitle = (cv: ListCv): string => {
  if (cv.title && cv.title.trim().length > 0) return cv.title;
  return 'CV chưa đặt tên';
};

/** Format ngày tạo CV (nếu có). */
const formatDate = (cv: ListCv): string => {
  const raw = (cv as unknown as { createdAt?: string; updatedAt?: string }).updatedAt
    || (cv as unknown as { createdAt?: string }).createdAt;
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
};

/* ============================================================================
 * Set primary
 * ==========================================================================*/
const settingPrimaryId = ref<string | null>(null);
const handleSetPrimary = async (cvId: string) => {
  settingPrimaryId.value = cvId;
  await cvStore.setPrimary(cvId);
  settingPrimaryId.value = null;
};

/* ============================================================================
 * Delete — soft-delete qua store.remove() + confirm modal trước.
 * ==========================================================================*/
const deletingId = ref<string | null>(null);
const confirmDeleteId = ref<string | null>(null);

const askDelete = (cvId: string): void => {
  confirmDeleteId.value = cvId;
};
const cancelDelete = (): void => {
  confirmDeleteId.value = null;
};
const confirmDeleteAction = async (): Promise<void> => {
  const id = confirmDeleteId.value;
  if (!id) return;
  confirmDeleteId.value = null;
  deletingId.value = id;
  try {
    await cvStore.remove(id);
    if (cvStore.items.length === 0 && cvStore.page > 1) {
      await cvStore.fetchList(undefined, 1);
    }
  } finally {
    deletingId.value = null;
  }
};

/* ============================================================================
 * Click-to-preview: click vào card → fetch detail → mở modal.
 * ==========================================================================*/
const previewOpen = ref(false);
const previewLoading = ref(false);
const previewData = ref<CvDetail | null>(null);

const openPreview = async (cv: ListCv) => {
  previewOpen.value = true;
  previewData.value = null;
  previewLoading.value = true;
  try {
    const detail = await cvStore.fetchDetail(cv.id);
    if (!detail) {
      previewOpen.value = false;
      return;
    }
    previewData.value = detail;
  } finally {
    previewLoading.value = false;
  }
};

const closePreview = (): void => {
  previewOpen.value = false;
  previewData.value = null;
};

const previewRenderData = computed<CvRenderData | null>(() => {
  const d = previewData.value;
  if (!d) return null;
  const p = (d.parsedData ?? {}) as Record<string, unknown>;
  return {
    title: d.title ?? '',
    personalInfo: {
      fullName: (p.name as string) ?? '',
      position: (p.position as string) ?? '',
      email: (p.email as string) ?? '',
      phone: (p.phone as string) ?? '',
      address: (p.address as string) ?? '',
      dob: (p.dob as string) ?? '',
      gender: (p.gender as string) ?? '',
      facebook: (p.facebook as string) ?? '',
      linkedin: (p.linkedin as string) ?? '',
      portfolio: (p.portfolio as string) ?? '',
      github: (p.github as string) ?? '',
      avatarUrl: (p.avatarUrl as string) ?? '',
    },
    summary: (p.summary as string) ?? '',
    educations: Array.isArray(p.education) ? (p.education as CvRenderData['educations']) : [],
    experiences: Array.isArray(p.experience) ? (p.experience as CvRenderData['experiences']) : [],
    skills: Array.isArray(p.skills)
      ? (p.skills as string[]).map((name) => ({ name }))
      : [],
    projects: Array.isArray(p.projects) ? (p.projects as CvRenderData['projects']) : [],
    certificates: Array.isArray(p.certifications) ? (p.certifications as CvRenderData['certificates']) : [],
    activities: Array.isArray(p.activities) ? (p.activities as CvRenderData['activities']) : [],
    interests: Array.isArray(p.interests) ? (p.interests as string[]) : [],
  };
});

const previewTemplateId = computed<number>(() => {
  const id = previewData.value?.templateId;
  return id && id >= 1 && id <= 5 ? id : 1;
});

const previewPdfUrl = computed<string | null>(() => {
  const d = previewData.value;
  if (!d?.fileUrl) return null;
  const mime = (d.fileType || '').toLowerCase();
  const url = d.fileUrl;
  if (mime.startsWith('image/') || mime === 'application/pdf') return url;
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword'
  ) {
    return `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
  }
  return url;
});

const previewIsOffice = computed<boolean>(() => {
  const mime = (previewData.value?.fileType || '').toLowerCase();
  return (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword'
  );
});

const handleCreate = (): void => {
  router.push('/candidate/resumes/new');
};
const handleUploadClick = (): void => {
  router.push('/candidate/resumes/new?mode=upload');
};
</script>

<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-7xl mx-auto">
      <!-- ============ Header (phẳng, tối giản) ============ -->
      <header class="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 class="text-xl font-semibold text-gray-900 tracking-tight">CV của tôi</h1>
          <p class="text-sm text-gray-500 mt-1">Quản lý các CV bạn đã tạo hoặc tải lên.</p>
        </div>
        <div class="flex gap-2 shrink-0">
          <button
            type="button"
            class="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition inline-flex items-center gap-1.5"
            @click="handleUploadClick"
          >
            <Upload class="w-4 h-4" /> Upload CV
          </button>
          <button
            type="button"
            class="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition inline-flex items-center gap-1.5"
            @click="handleCreate"
          >
            <Plus class="w-4 h-4" /> Tạo CV
          </button>
        </div>
      </header>

      <!-- ============ Filter bar ============ -->
      <div class="mb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div class="inline-flex bg-white rounded-lg border border-gray-200 p-0.5">
          <button
            v-for="opt in sourceOptions"
            :key="opt.value"
            type="button"
            @click="handleSourceChange(opt.value)"
            class="px-3 py-1.5 text-xs font-medium rounded-md transition"
            :class="sourceFilter === opt.value
              ? 'bg-gray-900 text-white'
              : 'text-gray-600 hover:text-gray-900'"
          >
            {{ opt.label }}
          </button>
        </div>

        <div class="flex items-center gap-2">
          <div class="relative">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Tìm theo tiêu đề..."
              class="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 w-56 transition"
            />
          </div>
          <span v-if="visibleItems.length > 0" class="text-xs text-gray-500 shrink-0">
            Hiển thị <strong class="text-gray-900">{{ visibleItems.length }}</strong> / {{ total }} CV
          </span>
        </div>
      </div>

      <!-- Error -->
      <div
        v-if="error"
        class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex items-center gap-2"
      >
        <AlertCircle class="w-3.5 h-3.5 text-red-500 shrink-0" />
        <p class="text-xs text-red-700">{{ error }}</p>
      </div>

      <!-- Loading -->
      <div
        v-if="loading && items.length === 0"
        class="bg-white rounded-lg border border-gray-200 flex items-center justify-center py-14"
      >
        <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
      </div>

      <!-- Empty (no CV at all) -->
      <div
        v-else-if="items.length === 0 && total === 0"
        class="bg-white rounded-lg border border-gray-200"
      >
        <div class="flex flex-col items-center justify-center py-14 text-center px-6">
          <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            <FileText class="w-5 h-5 text-gray-500" />
          </div>
          <h3 class="text-sm font-semibold text-gray-900">Bạn chưa có CV nào</h3>
          <p class="text-xs text-gray-500 mt-1">Tạo CV trực tiếp hoặc upload CV để bắt đầu.</p>
          <div class="mt-4 flex gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition inline-flex items-center gap-1.5"
              @click="handleUploadClick"
            >
              <Upload class="w-3.5 h-3.5" /> Upload CV
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-md bg-gray-900 text-white hover:bg-gray-800 transition inline-flex items-center gap-1.5"
              @click="handleCreate"
            >
              <Plus class="w-3.5 h-3.5" /> Tạo CV
            </button>
          </div>
        </div>
      </div>

      <!-- Empty (filter returns 0) -->
      <div
        v-else-if="visibleItems.length === 0"
        class="bg-white rounded-lg border border-gray-200"
      >
        <div class="flex flex-col items-center justify-center py-10 text-center">
          <FileText class="w-6 h-6 text-gray-300 mb-2" />
          <p class="text-xs text-gray-500">Không có CV nào khớp với bộ lọc / từ khoá hiện tại.</p>
        </div>
      </div>

      <!-- ============ Grid: 1 / 2 / 3 / 4 cols ============ -->
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
        <article
          v-for="cv in visibleItems"
          :key="cv.id"
          class="group relative w-full bg-white rounded-lg border transition cursor-pointer overflow-hidden flex flex-col hover:-translate-y-0.5 hover:shadow-sm"
          :class="cv.isPrimary
            ? 'border-gray-900'
            : 'border-gray-200 hover:border-gray-300'"
          @click="openPreview(cv)"
        >
          <!-- ============ Thumbnail ============ -->
          <div class="relative h-[170px] bg-gray-50 flex items-center justify-center overflow-hidden">
            <!-- "CV chính" badge -->
            <span
              v-if="cv.isPrimary"
              class="absolute top-2 left-2 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-900 text-white"
            >
              <Star class="w-2.5 h-2.5 fill-current" /> CV chính
            </span>

            <!-- Source pill -->
            <span
              class="absolute top-2 right-2 z-10 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/90 text-gray-600 border border-gray-200"
            >
              {{ sourceLabel[cv.source] }}
            </span>

            <!-- Delete icon (hiện khi hover) -->
            <button
              type="button"
              class="absolute bottom-2 right-2 z-20 w-7 h-7 rounded-md bg-white text-gray-400 hover:text-red-600 shadow-sm border border-gray-200 flex items-center justify-center transition opacity-0 group-hover:opacity-100"
              title="Xóa CV"
              @click.stop="askDelete(cv.id)"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>

            <!-- Direct CV: A4 paper wrap mockup -->
            <div
              v-if="cv.source === 'direct'"
              class="relative h-[150px] aspect-[1/1.414] bg-white rounded-sm border border-gray-200 shadow-sm overflow-hidden"
            >
              <CVTemplateMockup
                :template-id="getTemplateId(cv)"
                class="w-full h-full"
              />
            </div>

            <!-- Upload CV: A4 paper wrap file mockup -->
            <div
              v-else
              class="relative h-[150px] aspect-[1/1.414] bg-white rounded-sm border border-gray-200 shadow-sm overflow-hidden"
            >
              <!-- Folded corner -->
              <div
                class="absolute top-0 right-0 w-2 h-2 bg-gray-100 border-l border-b border-gray-200"
                style="clip-path: polygon(100% 0, 0 0, 100% 100%)"
              />
              <!-- Text lines -->
              <div class="w-full h-full p-1.5 flex flex-col gap-0.5">
                <div class="h-1 bg-gray-300 rounded w-3/4" />
                <div class="h-0.5 bg-gray-300 rounded w-1/2" />
                <div class="h-px bg-gray-200 w-full my-0.5" />
                <div class="h-0.5 bg-gray-300 rounded w-full" />
                <div class="h-0.5 bg-gray-300 rounded w-5/6" />
                <div class="h-0.5 bg-gray-300 rounded w-full" />
                <div class="h-0.5 bg-gray-300 rounded w-4/5" />
                <div class="h-px bg-gray-200 w-full my-0.5" />
                <div class="h-0.5 bg-gray-300 rounded w-full" />
                <div class="h-0.5 bg-gray-300 rounded w-3/4" />
                <div class="h-0.5 bg-gray-300 rounded w-full" />
                <div class="h-px bg-gray-200 w-full my-0.5" />
                <div class="h-0.5 bg-gray-300 rounded w-full" />
                <div class="h-0.5 bg-gray-300 rounded w-5/6" />
              </div>
              <!-- File type badge -->
              <span
                class="absolute bottom-1 right-1 inline-flex items-center px-1 py-px rounded text-[8px] font-bold tracking-wide bg-gray-100 text-gray-600"
              >
                {{ fileTypeLabel(cv) }}
              </span>
            </div>
          </div>

          <!-- ============ Body ============ -->
          <div class="p-3 flex flex-col gap-2 border-t border-gray-100">
            <p
              class="text-sm font-medium text-gray-900 leading-snug line-clamp-2 min-h-[2.5rem]"
              :title="getDisplayTitle(cv)"
            >
              {{ getDisplayTitle(cv) }}
            </p>

            <!-- Status + meta row -->
            <div class="flex items-center justify-between gap-1.5 text-xs">
              <div class="flex items-center gap-1.5 min-w-0">
                <span
                  class="w-1.5 h-1.5 rounded-full shrink-0"
                  :class="statusDotColor[cv.status]"
                ></span>
                <span class="text-gray-500 truncate">{{ statusLabel[cv.status] }}</span>
              </div>

              <div class="flex items-center gap-1 shrink-0">
                <span
                  v-if="cv.aiAnalysisTotal !== null"
                  class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700"
                  :title="`AI score: ${cv.aiAnalysisTotal}/100`"
                >
                  <Sparkles class="w-2.5 h-2.5" />
                  {{ cv.aiAnalysisTotal }}
                </span>
                <span
                  v-if="cv.source === 'direct' && getTemplateId(cv)"
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600"
                >
                  Mẫu {{ getTemplateId(cv) }}
                </span>
              </div>
            </div>

            <!-- Footer: date + hover preview hint -->
            <div class="flex items-center justify-between text-[11px] text-gray-400 pt-1.5 border-t border-gray-100">
              <span v-if="formatDate(cv)">{{ formatDate(cv) }}</span>
              <span v-else>—</span>
              <span class="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition text-gray-700">
                <Eye class="w-3 h-3" /> Xem
              </span>
            </div>
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
          Tổng <strong class="text-gray-900">{{ total }}</strong> CV
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

    <!-- ============ Preview modal ============ -->
    <Teleport to="body">
      <div
        v-if="previewOpen"
        class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        @click.self="closePreview"
      >
        <div class="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
          <header class="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-4">
            <h2 class="text-sm font-semibold text-gray-900 truncate">
              Xem CV — {{ previewData?.source === 'upload' ? 'CV Upload' : 'CV tạo trực tiếp' }}
            </h2>
            <div class="flex items-center gap-2">
              <button
                v-if="previewData && !previewData.isPrimary"
                type="button"
                class="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800 inline-flex items-center gap-1.5 transition disabled:opacity-50"
                :disabled="settingPrimaryId === previewData.id"
                @click="handleSetPrimary(previewData.id)"
              >
                <Loader2 v-if="settingPrimaryId === previewData.id" class="w-3.5 h-3.5 animate-spin" />
                <Star v-else class="w-3.5 h-3.5" />
                Đặt làm CV chính
              </button>
              <button
                type="button"
                class="text-gray-400 hover:text-gray-600 p-1.5 rounded-md hover:bg-gray-100 transition"
                @click="closePreview"
                aria-label="Đóng"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
          </header>
          <div class="flex-1 overflow-y-auto bg-gray-50">
            <div v-if="previewLoading" class="flex items-center justify-center py-16">
              <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
            </div>
            <div v-else-if="previewData">
              <template v-if="previewData.source === 'upload' && previewData.fileUrl">
                <div class="bg-white">
                  <iframe
                    v-if="previewPdfUrl"
                    :src="previewPdfUrl"
                    class="w-full bg-white"
                    style="height: 82vh"
                    title="CV file"
                  />
                </div>
                <div class="bg-white border-t border-gray-200 px-4 py-2.5 flex items-center justify-between gap-3">
                  <p class="text-xs text-gray-500 truncate">
                    {{ previewData.fileType || 'file' }}
                  </p>
                  <div class="flex gap-3 shrink-0">
                    <a
                      :href="previewData.fileUrl"
                      target="_blank"
                      rel="noopener"
                      class="text-xs text-gray-700 hover:text-gray-900 inline-flex items-center gap-1 transition"
                    >
                      <ExternalLink class="w-3 h-3" /> Mở tab mới
                    </a>
                    <a
                      :href="previewData.fileUrl"
                      :download="previewData.fileUrl.split('/').pop()"
                      class="text-xs text-gray-700 hover:text-gray-900 inline-flex items-center gap-1 transition"
                    >
                      <Download class="w-3 h-3" /> Tải xuống
                    </a>
                  </div>
                </div>
                <p
                  v-if="previewIsOffice"
                  class="text-xs text-gray-500 text-center px-4 py-2 bg-gray-50"
                >
                  File DOCX được render qua Google Docs Viewer. Nếu không hiển thị, bấm "Mở tab mới".
                </p>
              </template>

              <template v-else-if="previewRenderData">
                <div class="bg-white max-w-[820px] mx-auto my-4 shadow-sm rounded overflow-hidden">
                  <CVTemplateRenderer
                    :template-id="previewTemplateId"
                    :data="previewRenderData"
                  />
                </div>
              </template>

              <div v-else class="flex flex-col items-center justify-center py-16 text-center">
                <FileText class="w-8 h-8 text-gray-300 mb-2" />
                <p class="text-xs text-gray-500">CV chưa có dữ liệu để hiển thị.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ============ Delete confirm modal ============ -->
    <Teleport to="body">
      <div
        v-if="confirmDeleteId !== null"
        class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        @click.self="cancelDelete"
      >
        <div class="bg-white rounded-lg shadow-xl max-w-sm w-full p-4">
          <div class="flex items-start gap-2.5">
            <div class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              <Trash2 class="w-4 h-4 text-gray-700" />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-semibold text-gray-900">Xóa CV</h3>
              <p class="text-xs text-gray-500 mt-1">
                Bạn có chắc muốn xóa CV này? Hành động này không thể hoàn tác.
              </p>
            </div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-md text-gray-700 hover:bg-gray-100 transition"
              @click="cancelDelete"
            >
              Hủy
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-md bg-gray-900 text-white hover:bg-gray-800 transition"
              @click="confirmDeleteAction"
            >
              Xóa
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>