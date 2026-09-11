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
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue';
import { Download, FileText, Loader2, MoreVertical, Pencil, Star, X, ExternalLink } from 'lucide-vue-next';
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue';
import { useCvRenderData, buildRenderData } from '@/composables/cvRenderData';
import { useCvDownload } from '@/composables/useCvDownload';
import { useDocxRenderer } from '@/composables/useDocxRenderer';
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
  /** User bấm "Sửa CV" — parent tự quyết định route (vd: router.push tới
   *  /resumes/:cvId/edit). Component KHÔNG gọi router trực tiếp để giữ
   *  CvPreview pure (testable, không phụ thuộc routing). */
  edit: [cvId: string];
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

/**
 * Phân loại MIME cho upload CV:
 *   - Image/PDF    → iframe trực tiếp với `modalPdfUrl`
 *   - DOCX (.docx) → render trong sandbox iframe qua docx-preview (xem `loadDocx`)
 *   - DOC (.doc)   → fallback "Tải về máy để xem" (định dạng binary cũ,
 *                    docx-preview không support)
 *
 * Phải tách DOCX và DOC thành 2 computeds riêng vì:
 *   - DOCX: có hướng render (docx-preview)
 *   - DOC: chỉ có fallback download
 *   - Trộn 2 loại vào 1 nhánh dễ kéo theo bug (DOCX render OK nhưng DOC
 *     âm thầm fail trong docx-preview vì không parse được binary).
 */
const modalIsDocx = computed<boolean>(() => {
  const mime = (props.cv?.fileType || '').toLowerCase();
  return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
});

const modalIsLegacyDoc = computed<boolean>(() => {
  const mime = (props.cv?.fileType || '').toLowerCase();
  return mime === 'application/msword';
});

/** URL cho iframe preview. Chỉ set cho image/PDF — DOCX/DOC có nhánh riêng. */
const modalPdfUrl = computed<string | null>(() => {
  const d = props.cv;
  if (!d?.fileUrl) return null;
  const mime = (d.fileType || '').toLowerCase();
  const url = d.fileUrl;
  if (mime.startsWith('image/') || mime === 'application/pdf') return url;
  // DOCX/DOC: template branch riêng (DOCX render, DOC download fallback).
  return null;
});

/* ============================================================================
 * DOCX rendering — dynamic import + sandboxed iframe + 3 state UI.
 *
 * Toàn bộ logic (state machine, abort, mount tracker) đã tách sang
 * [useDocxRenderer.ts](../../composables/useDocxRenderer.ts). Component này
 * chỉ:
 *   - Build reactive `docxFileUrl` ref cho composable.
 *   - Wire watch trigger: mở modal → loadDocx, đóng modal → reset/abort.
 *
 * 3 state UI:
 *   - 'idle'      : modal chưa mở hoặc đã đóng — không render gì
 *   - 'loading'   : fetch + parse đang chạy — skeleton
 *   - 'success'   : đã render xong — hiện iframe
 *   - 'error'     : fetch fail / parse fail / file hỏng — fallback download
 * ==========================================================================*/

/** URL DOCX cho composable. Null khi không phải MIME DOCX → composable no-op. */
const docxFileUrl = computed<string | null>(() => {
  if (!modalIsDocx.value) return null;
  return props.cv?.fileUrl ?? null;
});

const {
  docxState,
  docxError,
  docxIframeRef,
  loadDocx,
  reset: resetDocx,
  abortCurrent: abortDocx,
} = useDocxRenderer({ fileUrl: docxFileUrl });

/**
 * Watch: trigger `loadDocx` khi modal mở với CV .docx; reset state khi đóng.
 *
 * Depend 4 giá trị:
 *   - `props.open`         : modal toggle
 *   - `props.cv?.id`       : đổi CV khác → reload
 *   - `props.cv?.fileUrl`  : đổi file (vd sau khi re-upload) → reload
 *   - `modalIsDocx.value`  : MIME re-classify → load hoặc skip
 *
 * `immediate: true` để lần render đầu (nếu modal mount với open=true sẵn)
 * vẫn trigger load — quan trọng cho edge case parent set open=true đồng
 * thời với prop assignment.
 *
 * Đổi CV trong khi modal đang mở → gọi `abortDocx()` rồi `loadDocx()` ngay
 * (không reset state vì loadDocx sẽ set 'loading'). Đóng modal → `resetDocx()`.
 */
watch(
  () =>
    [
      props.open,
      props.cv?.id,
      props.cv?.fileUrl,
      modalIsDocx.value,
    ] as const,
  ([isOpen]) => {
    if (isOpen && props.cv && modalIsDocx.value) {
      void loadDocx();
    } else if (!isOpen) {
      resetDocx();
    } else {
      // open=true nhưng CV không phải DOCX (mime đổi): abort pending, không reset
      // state vì component có thể switch lại MIME ngay.
      abortDocx();
    }
  },
  { immediate: true },
);

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
 * Edit CV — disable nút khi CV đang trong quá trình xử lý (pending/parsing/
 * analyzing) vì có thể conflict với deepMerge của PATCH. Mirror logic ở
 * MyResumesView [menuCanEdit] để UX nhất quán giữa 2 entry point.
 *
 * Status 'failed' → cho phép (BE update() chấp nhận). Status 'deleted' →
 * chặn (BE softDelete đã filter row khỏi list nhưng defensive check vẫn có).
 * ==========================================================================*/
const canEditCv = (cv: Cv | null | undefined): boolean =>
  !!cv &&
  cv.status !== 'pending' &&
  cv.status !== 'parsing' &&
  cv.status !== 'analyzing' &&
  cv.status !== 'deleted';

const editTooltip = (cv: Cv | null | undefined): string => {
  if (!cv) return '';
  if (cv.status === 'pending') return 'CV đang chờ xử lý, chưa thể sửa';
  if (cv.status === 'parsing') return 'CV đang được parse, chưa thể sửa';
  if (cv.status === 'analyzing') return 'CV đang được AI phân tích, chưa thể sửa';
  if (cv.status === 'deleted') return 'CV đã bị xoá';
  return 'Chỉnh sửa nội dung CV';
};

const onEdit = (): void => {
  if (props.cv && canEditCv(props.cv)) emit('edit', props.cv.id);
};

/* ============================================================================
 * Kebab menu — gom 3 secondary actions (Tải PDF, Sửa CV, Mở file gốc) vào
 * dropdown để header modal gọn, không overflow trên mobile.
 *
 * UX: dropdown xuất hiện bên dưới trigger `⋮`. Click outside hoặc ESC đóng.
 * Click vào item → thực thi action + tự đóng menu.
 *
 * Position: absolute bên trong header (modal đã có z-50, không cần teleport
 * sang body). Click-outside dùng class root `.cv-preview-kebab` để filter.
 * ==========================================================================*/
const kebabOpen = ref(false);
const closeKebab = (): void => {
  kebabOpen.value = false;
};
const onKebabClickOutside = (e: MouseEvent): void => {
  const target = e.target as HTMLElement | null;
  if (!target || !target.closest('.cv-preview-kebab')) kebabOpen.value = false;
};
const onKebabKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') kebabOpen.value = false;
};

onMounted(() => {
  document.addEventListener('click', onKebabClickOutside);
  document.addEventListener('keydown', onKebabKeydown);
});
onUnmounted(() => {
  document.removeEventListener('click', onKebabClickOutside);
  document.removeEventListener('keydown', onKebabKeydown);
});

/** Wrapper chạy action và đóng menu (dùng cho mọi item trong dropdown). */
const runKebabAction = (action: () => void): void => {
  action();
  kebabOpen.value = false;
};

/* ============================================================================
 * Body scroll lock khi modal mở.
 *
 * Mục đích: chặn user scroll page bên dưới modal + ẩn scrollbar để không lộ
 * dải sáng ở mép phải viewport.
 *
 * Cách fix (sau khi loại bỏ `scrollbar-gutter: stable` ở style.css):
 *   - Set `overflow: hidden` trên cả <html> và <body>. <html> mới là element
 *     thực sự scroll ở Chrome/Firefox/Safari hiện đại; chỉ set trên <body>
 *     KHÔNG đủ — browser bỏ qua.
 *   - KHÔNG cần compensate scrollbar bằng padding-right nữa (vì gutter đã
 *     được remove), không cần thêm class ẩn scrollbar visually (overflow:hidden
 *     đã làm scrollbar biến mất hoàn toàn trên mọi browser).
 *   - Lưu inline overflow cũ để restore đúng giá trị (nếu app đã set inline).
 *   - `onBeforeUnmount` safety: nếu component unmount khi modal đang mở (vd
 *     navigate trang mà chưa đóng modal) → trả lại scroll cho body, tránh
 *     trang kế bị "đóng băng".
 *
 * Phạm vi: chỉ modal mode (`isModal=true`). Inline mode không có backdrop che
 * nên không cần lock.
 * ==========================================================================*/
let savedHtmlOverflow = '';
let savedBodyOverflow = '';

const lockBodyScroll = (): void => {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const body = document.body;
  savedHtmlOverflow = html.style.overflow;
  savedBodyOverflow = body.style.overflow;
  html.style.overflow = 'hidden';
  body.style.overflow = 'hidden';
};

const unlockBodyScroll = (): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.style.overflow = savedHtmlOverflow;
  document.body.style.overflow = savedBodyOverflow;
  savedHtmlOverflow = '';
  savedBodyOverflow = '';
};

watch(
  () => props.open,
  (open) => {
    if (!isModal.value) return;
    if (open) lockBodyScroll();
    else unlockBodyScroll();
  },
);

onBeforeUnmount(() => {
  if (isModal.value && props.open) unlockBodyScroll();
});

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
                <!-- CTA chính "Đặt làm CV chính" — giữ riêng (visible, không
                     gom vào menu) để user dễ thấy nhất. Secondary actions
                     (Tải PDF, Sửa CV, Mở file gốc) gom trong kebab `⋮`.

                     Style: primary-blue gradient (đồng bộ với design system
                     ở style.css — primary-500/600/700 là tone xanh dương
                     dùng cho btn-primary, focus ring, link). Star fill
                     để icon nổi bật. Hover: shadow tone primary + gradient
                     đậm hơn 1 tone → feedback rõ. -->
                <button
                  v-if="cv && !cv.isPrimary"
                  type="button"
                  class="h-9 px-3 sm:px-3.5 text-sm font-semibold inline-flex items-center gap-1.5 sm:gap-2 shrink-0 rounded-lg
                         bg-gradient-to-b from-primary-500 to-primary-600 text-white
                         shadow-sm shadow-primary-600/25
                         hover:shadow-md hover:shadow-primary-600/35
                         hover:from-primary-600 hover:to-primary-700
                         disabled:opacity-50 disabled:cursor-not-allowed
                         disabled:hover:shadow-sm disabled:hover:from-primary-500 disabled:hover:to-primary-600
                         transition-all duration-150"
                  :disabled="settingPrimary"
                  @click="onSetPrimary"
                >
                  <Loader2 v-if="settingPrimary" class="w-4 h-4 animate-spin" />
                  <Star v-else class="w-4 h-4 fill-current" />
                  <span class="hidden sm:inline">Đặt làm CV chính</span>
                  <span class="sm:hidden">Đặt chính</span>
                </button>

                <!-- Kebab menu `⋮` — gom Tải PDF / Sửa CV / Mở file gốc.
                     Click outside hoặc ESC đóng (handler global ở script). -->
                <div v-if="cv" class="cv-preview-kebab relative">
                  <button
                    type="button"
                    class="w-9 h-9 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors inline-flex items-center justify-center"
                    :aria-label="'Mở menu thao tác'"
                    :aria-haspopup="true"
                    :aria-expanded="kebabOpen"
                    @click="kebabOpen = !kebabOpen"
                  >
                    <MoreVertical class="w-4 h-4" />
                  </button>
                  <Transition
                    enter-active-class="transition duration-100 ease-out"
                    enter-from-class="opacity-0 -translate-y-1"
                    enter-to-class="opacity-100 translate-y-0"
                    leave-active-class="transition duration-75 ease-in"
                    leave-from-class="opacity-100"
                    leave-to-class="opacity-0"
                  >
                    <div
                      v-if="kebabOpen"
                      class="absolute right-0 top-full mt-1.5 w-56 bg-white rounded-lg shadow-lg ring-1 ring-slate-900/5 py-1 z-10 origin-top-right"
                      role="menu"
                    >
                      <!-- Tải PDF — secondary cho cả direct + upload -->
                      <button
                        type="button"
                        role="menuitem"
                        class="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2.5 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                        :disabled="downloading"
                        @click="runKebabAction(onDownload)"
                      >
                        <Loader2 v-if="downloading" class="w-4 h-4 animate-spin text-slate-400" />
                        <Download v-else class="w-4 h-4 text-slate-400" />
                        <span class="flex-1">
                          {{ cv.source === 'direct' ? 'Tải PDF' : 'Tải file gốc' }}
                        </span>
                      </button>
                      <!-- Sửa CV — chỉ cho direct CV. Upload CV là file PDF/DOCX/DOC
                           đã upload lên, không có form data để sửa (CreateResumeView
                           là wizard form cho direct). Nếu user click sửa upload CV sẽ
                           navigate tới edit form trống → bug UX. -->
                      <button
                        v-if="cv.source === 'direct'"
                        type="button"
                        role="menuitem"
                        class="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2.5 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                        :disabled="!canEditCv(cv)"
                        :title="editTooltip(cv)"
                        @click="runKebabAction(onEdit)"
                      >
                        <Pencil class="w-4 h-4 text-slate-400" />
                        <span class="flex-1">Sửa CV</span>
                      </button>
                      <!-- Mở file gốc — chỉ upload CV (direct không có file gốc) -->
                      <button
                        v-if="cv.source === 'upload'"
                        type="button"
                        role="menuitem"
                        class="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2.5 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                        :disabled="!canOpenOriginal(cv)"
                        :title="openOriginalTooltip(cv)"
                        @click="runKebabAction(onOpenOriginal)"
                      >
                        <ExternalLink class="w-4 h-4 text-slate-400" />
                        <span class="flex-1">Mở file gốc</span>
                      </button>
                    </div>
                  </Transition>
                </div>

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
                <!-- Upload CV: 3 nhánh theo MIME -->
                <template v-if="cv.source === 'upload' && cv.fileUrl">
                  <!-- Image/PDF: iframe trực tiếp (giữ nguyên như cũ) -->
                  <div v-if="modalPdfUrl" class="bg-white">
                    <iframe
                      :src="modalPdfUrl"
                      class="w-full bg-white"
                      style="height: min(82vh, 760px)"
                      :title="'CV file'"
                    />
                  </div>

                  <!-- DOCX (.docx): render trong sandboxed iframe qua docx-preview.
                       Loading: skeleton + spinner.
                       Success: sandboxed iframe (script execution bị chặn).
                       Error: fallback "Tải về máy để xem" — không để trắng màn hình. -->
                  <div v-else-if="modalIsDocx" class="bg-slate-50">
                    <!-- Loading state -->
                    <div
                      v-if="docxState === 'loading' || docxState === 'idle'"
                      class="flex flex-col items-center justify-center text-slate-400"
                      style="height: min(82vh, 760px)"
                    >
                      <Loader2 class="w-8 h-8 animate-spin mb-3" />
                      <p class="text-sm">Đang tải nội dung…</p>
                    </div>

                    <!-- Error state — fallback download, không crash modal -->
                    <div
                      v-else-if="docxState === 'error'"
                      class="flex flex-col items-center justify-center text-center px-6 py-12"
                      style="height: min(82vh, 760px)"
                    >
                      <div class="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                        <FileText class="w-6 h-6 text-slate-400" />
                      </div>
                      <p class="text-sm font-medium text-slate-700 mb-1">
                        Không thể hiển thị bản xem trước
                      </p>
                      <p class="text-xs text-slate-500 mb-4 max-w-sm">
                        {{ docxError || 'File DOCX có thể bị lỗi hoặc không đúng định dạng.' }}
                      </p>
                      <button
                        type="button"
                        class="btn-secondary h-9 px-3 text-sm font-semibold inline-flex items-center gap-1.5"
                        :disabled="downloading"
                        @click="onDownload"
                      >
                        <Loader2 v-if="downloading" class="w-4 h-4 animate-spin" />
                        <Download v-else class="w-4 h-4" />
                        Tải về máy để xem
                      </button>
                    </div>

                    <!-- Sandbox iframe: luôn mount để ref ổn định, ẩn cho tới khi success.
                         `sandbox="allow-same-origin"` cho phép parent đọc contentDocument
                         để gọi renderAsync, nhưng CHẶN mọi script trong file DOCX. -->
                    <iframe
                      v-show="docxState === 'success'"
                      ref="docxIframeRef"
                      sandbox="allow-same-origin"
                      class="w-full bg-white border-0 block"
                      style="height: min(82vh, 760px)"
                      title="DOCX preview"
                    />
                  </div>

                  <!-- DOC (.doc) — định dạng binary cũ, docx-preview không support.
                       Chỉ cho download, không thử render. -->
                  <div
                    v-else-if="modalIsLegacyDoc"
                    class="flex flex-col items-center justify-center text-center px-6 py-16"
                    style="height: min(82vh, 760px)"
                  >
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                      <FileText class="w-6 h-6 text-slate-400" />
                    </div>
                    <p class="text-sm font-medium text-slate-700 mb-1">
                      File .doc (định dạng cũ)
                    </p>
                    <p class="text-xs text-slate-500 mb-4 max-w-sm">
                      Trình duyệt không hỗ trợ hiển thị file Word định dạng cũ.
                      Vui lòng tải về để xem.
                    </p>
                    <button
                      type="button"
                      class="btn-secondary h-9 px-3 text-sm font-semibold inline-flex items-center gap-1.5"
                      :disabled="downloading"
                      @click="onDownload"
                    >
                      <Loader2 v-if="downloading" class="w-4 h-4 animate-spin" />
                      <Download v-else class="w-4 h-4" />
                      Tải về máy để xem
                    </button>
                  </div>
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