<script setup lang="ts">
/**
 * CvPreview — unified component cho 2 use case:
 *   1. Inline render: pure CV render với loading/error slots, emit ready/error.
 *      Dùng cho thumbnail card, embedded view ở các flow khác.
 *   2. Modal render: full preview modal (Teleport + Transition + header + body
 *      + footer). Dùng cho flow user mở preview CV từ list.
 *
 * Mode detection:
 *   - Nếu `open` được truyền (true hoặc false) → MODAL mode. Dùng `cv` prop
 *     cho content, `settingPrimary` cho button loading, emit `close` /
 *     `set-primary`.
 *   - Nếu `open` KHÔNG được truyền → INLINE mode. Dùng `data` / `templateId`
 *     / `cvId` props, emit `ready` / `error`.
 *
 * Tại sao 1 file:
 *   - Cùng concern "render CV". Modal chỉ thêm chrome (Teleport, header,
 *     transitions) — không phải logic khác.
 *   - Chia file → 2 file phải đồng bộ shape CvRenderData, buildRenderData,
 *     template mapping. 1 file dễ maintain.
 *   - API "smart" (open prop → modal) là Vue idiomatic — caller không cần
 *     quyết định component nào, chỉ cần truyền prop phù hợp.
 *
 * Props:
 *   Inline mode:
 *     - `data?: CvRenderData`        — caller có data sẵn (Mode 1)
 *     - `templateId?: number`        — bắt buộc kèm `data` (Mode 1)
 *     - `cvId?: string`              — tự fetch qua Bearer auth (Mode 2)
 *   Modal mode:
 *     - `open?: boolean`             — show/hide modal (presence = modal mode)
 *     - `cv?: Cv | null`             — CV đang xem
 *     - `settingPrimary?: boolean`   — loading state cho button "Đặt làm CV chính"
 *
 * Emits:
 *   Inline mode:
 *     - `ready`              — emit sau khi CVTemplateRenderer đã mount + 2 RAF
 *     - `error` [message]    — emit khi fetch fail
 *   Modal mode:
 *     - `close`                       — backdrop click hoặc close button
 *     - `set-primary` [cvId]          — user bấm "Đặt làm CV chính"
 *
 * Tại sao KHÔNG có prop `token`:
 *   - Component CHỈ dùng cho user-facing UI, có Bearer auth từ localStorage.
 *   - Flow Playwright/HMAC đã được tách sang file riêng
 *     [CvPrintView.vue](../views/print/CvPrintView.vue) — file đó tự dùng
 *     `useCvRenderData` composable với HMAC token, không qua component này.
 *
 * Lưu ý khi scale thumbnail:
 *   - Inline mode KHÔNG constrain size. Để thumbnail nhỏ, wrap trong container có
 *     `transform: scale(0.155) origin-top-left`. Đã dùng ở MyResumesView.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { Download, FileText, Loader2, Star, X, ExternalLink } from 'lucide-vue-next';
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue';
import { useCvRenderData, buildRenderData } from '@/composables/cvRenderData';
import { useCvDownload } from '@/composables/useCvDownload';
import type { Cv, CvRenderData } from '@/types/cv';

const props = defineProps<{
  /** Inline Mode 1: truyền data sẵn (vd từ list query đã có full row). */
  data?: CvRenderData;
  /** Inline Mode 1: bắt buộc khi `data` được truyền. */
  templateId?: number;
  /** Inline Mode 2: fetch qua BE (Bearer auth từ http interceptor). */
  cvId?: string;
  /** Modal: presence (true/false) = modal mode. */
  open?: boolean;
  /** Modal: CV đang xem (title/source/isPrimary/fileUrl/fileType). */
  cv?: Cv | null;
  /** Modal: loading state cho button "Đặt làm CV chính". */
  settingPrimary?: boolean;
}>();

const emit = defineEmits<{
  ready: [];
  error: [message: string];
  close: [];
  'set-primary': [cvId: string];
}>();

/* ============================================================================
 * Mode detection — `open` được truyền (dù là true/false) = modal mode.
 *
 * `props.open !== undefined` thay vì `props.open === true` để còn xử lý
 * cả `open=false` (modal đang đóng nhưng vẫn mount) → vẫn là modal mode,
 * không fallback về inline.
 * ==========================================================================*/
const isModal = computed<boolean>(() => props.open !== undefined);

/* ============================================================================
 * Inline mode state — fetch qua composable + manual override.
 *
 * Khi modal mode → skip fetch (fetchCvId = null → composable bail early).
 * ==========================================================================*/
const hasManualData = computed(
  () => props.data !== undefined && props.templateId !== undefined,
);
const fetchCvId = computed<string | null>(() => {
  if (isModal.value) return null;
  return hasManualData.value ? null : (props.cvId ?? null);
});

const {
  data: fetchedData,
  templateId: fetchedTemplateId,
  loading,
  error: fetchError,
} = useCvRenderData(fetchCvId);

const effectiveData = computed<CvRenderData | null>(() => {
  if (hasManualData.value) return props.data ?? null;
  return fetchedData.value;
});
const effectiveTemplateId = computed<number | null>(() => {
  if (hasManualData.value) return props.templateId ?? null;
  return fetchedTemplateId.value;
});

/* ============================================================================
 * Modal mode state — derive từ `cv` prop.
 *
 * Tất cả defensive (null-safe) vì `cv` có thể null khi modal đang đóng hoặc
 * sau khi user bấm "Đóng" (parent reset cv = null trước khi animation kết thúc).
 * ==========================================================================*/
const modalRenderData = computed<CvRenderData | null>(() => {
  if (!props.cv) return null;
  return buildRenderData(props.cv);
});

const modalTemplateId = computed<number>(() => {
  const id = props.cv?.templateId;
  return id && id >= 1 && id <= 5 ? id : 1;
});

/** URL cho iframe preview. Image/PDF dùng trực tiếp; DOCX wrap qua Google Docs Viewer. */
const modalPdfUrl = computed<string | null>(() => {
  const d = props.cv;
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

const modalIsOffice = computed<boolean>(() => {
  const mime = (props.cv?.fileType || '').toLowerCase();
  return (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword'
  );
});

/* ============================================================================
 * Emit `ready` sau khi DOM settle (inline mode only).
 *
 * 2 RAF đảm bảo Vue đã commit DOM và Tailwind đã apply style xong.
 *
 * Chỉ emit khi `effectiveData` thực sự có data (không emit khi chỉ là null
 * ban đầu do đang loading).
 * ==========================================================================*/
const emitReady = async (): Promise<void> => {
  if (isModal.value) return;
  if (!effectiveData.value || !effectiveTemplateId.value) return;
  await nextTick();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  emit('ready');
};

watch(fetchError, (msg) => {
  if (!isModal.value && msg) emit('error', msg);
});

watch(
  [effectiveData, effectiveTemplateId],
  async ([d, t]) => {
    if (!isModal.value && d && t) await emitReady();
  },
  { immediate: true },
);

/* ============================================================================
 * Modal handlers
 * ==========================================================================*/
const onBackdropClick = (): void => emit('close');
const onSetPrimary = (): void => {
  if (props.cv) emit('set-primary', props.cv.id);
};
const onClose = (): void => emit('close');

/* ============================================================================
 * Download — 2 nút trong header modal. Logic ở [useCvDownload.ts] composable
 * (chia sẻ với card kebab menu ở MyResumesView — cùng handler, cùng toast).
 * ==========================================================================*/
const {
  downloading,
  canOpenOriginal,
  openOriginalTooltip,
  handleDownload,
  handleOpenOriginal,
} = useCvDownload();

/** Local wrapper gắn `cv` prop vào handler composable (handler không biết về props). */
const onDownload = (): void => {
  void handleDownload(props.cv);
};
const onOpenOriginal = (): void => {
  handleOpenOriginal(props.cv);
};
</script>

<template>
  <!-- ===================== MODAL MODE ===================== -->
  <Teleport v-if="isModal" to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
        @click.self="onBackdropClick"
      >
        <Transition
          appear
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 scale-95 translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
        >
          <div class="bg-white rounded-2xl shadow-2xl shadow-slate-900/20 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden ring-1 ring-slate-900/5">
            <!-- Header: title + source + actions -->
            <header class="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-slate-900 truncate">
                  {{ cv?.title || 'Xem CV' }}
                </h2>
                <p v-if="cv" class="text-xs text-slate-500 mt-0.5">
                  {{ cv.source === 'upload' ? 'CV Upload' : 'CV tạo trực tiếp' }}
                  <template v-if="cv.source === 'direct' && cv.templateId">
                    · Mẫu {{ cv.templateId }}
                  </template>
                </p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <!-- 2 nút download — đặt trước CTA chính "Đặt làm CV chính"
                     để action phụ (download) không chiếm spotlight. -->
                <button
                  v-if="cv"
                  type="button"
                  class="btn-secondary h-9 px-2.5 sm:px-3 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 shrink-0"
                  :disabled="downloading"
                  :title="cv.source === 'direct' ? 'Tải CV dạng PDF vector (Playwright render)' : 'Tải file CV gốc đã upload'"
                  @click="onDownload"
                >
                  <Loader2 v-if="downloading" class="w-4 h-4 animate-spin" />
                  <Download v-else class="w-4 h-4" />
                  <span class="hidden sm:inline">Tải PDF</span>
                  <span class="sm:hidden">Tải</span>
                </button>
                <button
                  v-if="cv"
                  type="button"
                  class="btn-secondary h-9 px-2.5 sm:px-3 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 shrink-0"
                  :disabled="!canOpenOriginal(cv)"
                  :title="openOriginalTooltip(cv)"
                  :aria-label="openOriginalTooltip(cv)"
                  @click="onOpenOriginal"
                >
                  <ExternalLink class="w-4 h-4" />
                  <span class="hidden md:inline">Mở file gốc</span>
                </button>
                <button
                  v-if="cv && !cv.isPrimary"
                  type="button"
                  class="btn-primary h-9 px-3 sm:px-3.5 text-sm font-semibold inline-flex items-center gap-1.5 sm:gap-2 shrink-0"
                  :disabled="settingPrimary"
                  @click="onSetPrimary"
                >
                  <Loader2 v-if="settingPrimary" class="w-4 h-4 animate-spin" />
                  <Star v-else class="w-4 h-4" />
                  <span class="hidden sm:inline">Đặt làm CV chính</span>
                  <span class="sm:hidden">Đặt chính</span>
                </button>
                <button
                  type="button"
                  class="w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors inline-flex items-center justify-center"
                  :aria-label="'Đóng'"
                  @click="onClose"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
            </header>

            <!-- Body -->
            <div class="preview-scroll flex-1 overflow-y-auto bg-slate-50/50">
              <div v-if="cv">
                <!-- Upload CV: render qua iframe (image/PDF trực tiếp, DOCX qua Google Docs Viewer) -->
                <template v-if="cv.source === 'upload' && cv.fileUrl">
                  <div class="bg-white">
                    <iframe
                      v-if="modalPdfUrl"
                      :src="modalPdfUrl"
                      class="w-full bg-white"
                      style="height: min(82vh, 760px)"
                      :title="'CV file'"
                    />
                  </div>
                  <p
                    v-if="modalIsOffice"
                    class="text-xs text-slate-500 text-center px-4 py-2 bg-slate-50 border-t border-slate-100"
                  >
                    File DOCX được render qua Google Docs Viewer. Nếu không hiển thị, bấm "Mở tab mới".
                  </p>
                </template>

                <!-- Direct CV: render qua CVTemplateRenderer -->
                <template v-else-if="modalRenderData">
                  <div
                    class="bg-white max-w-[820px] mx-auto my-6 shadow-lg rounded-lg overflow-hidden ring-1 ring-slate-900/5"
                  >
                    <CVTemplateRenderer
                      :data="modalRenderData"
                      :template-id="modalTemplateId"
                    />
                  </div>
                </template>

                <!-- Empty state -->
                <div v-else class="flex flex-col items-center justify-center py-20 text-center px-6">
                  <div class="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                    <FileText class="w-6 h-6 text-slate-400" />
                  </div>
                  <p class="text-sm text-slate-500">CV chưa có dữ liệu để hiển thị.</p>
                </div>

                <!-- Footer: file type label + "Mở tab mới" link (chỉ upload) -->
                <div class="bg-white border-t border-slate-200 px-5 py-3 flex items-center justify-between gap-3">
                  <p class="text-xs text-slate-500 truncate">
                    <template v-if="cv.source === 'upload'">
                      {{ cv.fileType || 'file' }}
                    </template>
                    <template v-else>
                      Mẫu {{ modalTemplateId }} · CV tạo trực tiếp
                    </template>
                  </p>
                  <div class="flex gap-4 shrink-0">
                    <a
                      v-if="cv.source === 'upload' && cv.fileUrl"
                      :href="cv.fileUrl"
                      target="_blank"
                      rel="noopener"
                      class="text-xs text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5 transition-colors"
                    >
                      <ExternalLink class="w-3.5 h-3.5" /> Mở tab mới
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>

  <!-- ===================== INLINE MODE ===================== -->
  <div v-else class="cv-view">
    <!-- Loading state — chỉ hiện khi fetch mode đang load. Manual mode
         (data prop) không qua đây vì data đã có sẵn từ frame đầu. -->
    <template v-if="!hasManualData && loading">
      <slot name="loading">
        <div
          class="cv-view__skeleton flex items-center justify-center p-12 bg-neutral-50 rounded-lg"
          role="status"
          aria-live="polite"
        >
          <div class="animate-pulse text-neutral-400">Đang tải CV…</div>
        </div>
      </slot>
    </template>

    <!-- Error state — default text đỏ, caller có thể override. -->
    <template v-else-if="!hasManualData && fetchError">
      <slot name="error" :message="fetchError">
        <div
          class="cv-view__error p-8 text-center text-red-600 font-medium"
          role="alert"
        >
          {{ fetchError }}
        </div>
      </slot>
    </template>

    <!-- Render CV — chỉ khi data + templateId đều có giá trị. -->
    <template v-else-if="effectiveData && effectiveTemplateId">
      <CVTemplateRenderer
        :template-id="effectiveTemplateId"
        :data="effectiveData"
      />
    </template>
  </div>
</template>

<style scoped>
/* Scrollbar mỏng — modal preview CV không nên chiếm chiều ngang.
 * Firefox dùng `scrollbar-width: thin`, Webkit/Chromium/Safari dùng ::-webkit-scrollbar.
 * Tone slate-300 với 70% opacity, hover slate-400 đậm hơn. */
.preview-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(203, 213, 225, 0.7) transparent;
}
.preview-scroll::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.preview-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.preview-scroll::-webkit-scrollbar-thumb {
  background-color: rgba(203, 213, 225, 0.7);
  border-radius: 9999px;
}
.preview-scroll::-webkit-scrollbar-thumb:hover {
  background-color: rgba(148, 163, 184, 0.9);
}
</style>