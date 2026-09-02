<script setup lang="ts">
/**
 * CvThumbnail — wrapper chọn thumbnail mini theo `cv.source` + `templateId`.
 *
 * Folder structure (parallel với `templates/`):
 *   src/components/cv/templates/CVTemplate{1-5}.vue          — A4 full render (modal preview)
 *   src/components/cv/thumbnails/CvThumbnailTemplate{1-5}.vue — mini render (~132×170, cho card)
 *
 * Mỗi CvThumbnailTemplate{N}.vue là bản thu nhỏ của CVTemplate{N}.vue tương ứng,
 * giữ nguyên layout + format + content. User mở modal preview (CvPreview) sẽ thấy
 * full A4; card list chỉ là bản thu nhỏ nhìn cho biết CV trông như thế nào.
 *
 * 4 loại CV component này handle:
 *   1. direct + templateId=1..5 → CvThumbnailTemplate{1-5} tương ứng.
 *   2. upload + PDF + có fileUrl → native PDF embed (Chrome/Firefox) với
 *      event-driven skeleton overlay để tránh "flash đen" khi PDF viewer
 *      đang khởi tạo (~1-2s đầu) — xem chi tiết bên dưới.
 *   3. upload + image → `<img>` cover-fit.
 *   4. upload + other (DOCX, ...) → fallback mockup gạch xám.
 *
 * Tại sao có skeleton overlay cho PDF:
 *   - `<object type="application/pdf">` tạo 1 native PDF viewer (Chrome PDF
 *     plugin / Firefox pdf.js viewer) ngay khi DOM mount. Viewer render
 *     backdrop ĐEN trong khi fetch PDF binary + initialize engine (1-2s).
 *   - Backdrop đen hiện TRƯỚC khi PDF content vẽ — user nhìn thấy "khối đen".
 *   - Fix: object `visibility: hidden` cho tới khi `load` event fire (= PDF
 *     viewer đã vẽ xong page đầu). Skeleton (shimmer + gray bars) hiện trên
 *     cùng lúc thay thế — không có timer/setTimeout, không static white
 *     cover, layout không nhảy.
 *
 * Props:
 *   - `cv: Cv` — bất kỳ loại CV. Component tự route.
 *
 * Sizing:
 *   - Outer container: fill 100% width/height của parent. Parent phải có
 *     aspectRatio 850/1100 (set ở MyResumesView hiện tại).
 *   - Có thể dùng nơi khác (dashboard widget, picker) với wrapper sized khác.
 */
import { computed, ref, watch } from 'vue';
import CvThumbnailTemplate1 from './CvThumbnailTemplate1.vue';
import CvThumbnailTemplate2 from './CvThumbnailTemplate2.vue';
import CvThumbnailTemplate3 from './CvThumbnailTemplate3.vue';
import CvThumbnailTemplate4 from './CvThumbnailTemplate4.vue';
import CvThumbnailTemplate5 from './CvThumbnailTemplate5.vue';
import { buildRenderData } from '@/composables/cvRenderData';
import type { Cv } from '@/types/cv';

const props = defineProps<{
  cv: Cv;
}>();

/* ============================================================================
 * Branch detection
 * ==========================================================================*/
const isUpload = computed<boolean>(() => props.cv.source === 'upload');
const isDirect = computed<boolean>(() => props.cv.source === 'direct');

/** Resolve templateId cho direct CV — fallback về 1 nếu null/out-of-range. */
const directTemplateId = computed<number | null>(() => {
  if (!isDirect.value) return null;
  const id = props.cv.templateId;
  return id !== null && id >= 1 && id <= 5 ? id : 1;
});

/** Mime type lowercase, dùng cho branch upload. */
const mime = computed<string>(() => (props.cv.fileType ?? '').toLowerCase());
const isPdf = computed<boolean>(() => mime.value === 'application/pdf');
const isImage = computed<boolean>(() => mime.value.startsWith('image/'));
const hasFile = computed<boolean>(() => Boolean(props.cv.fileUrl));

/** Build CvRenderData từ Cv row — share với modal preview + Playwright print. */
const renderData = computed(() => buildRenderData(props.cv));

/* ============================================================================
 * Thumbnail template map — 1:1 với templates/CVTemplate{1-5}.vue.
 *
 * Cú pháp `as const` để key lookup được TS-narrow về 1|2|3|4|5.
 * ==========================================================================*/
const templateMap = {
  1: CvThumbnailTemplate1,
  2: CvThumbnailTemplate2,
  3: CvThumbnailTemplate3,
  4: CvThumbnailTemplate4,
  5: CvThumbnailTemplate5,
} as const;

const ResolvedThumbnail = computed(() => {
  const t = directTemplateId.value as 1 | 2 | 3 | 4 | 5 | null;
  return t ? templateMap[t] ?? CvThumbnailTemplate1 : null;
});

/* ============================================================================
 * Upload PDF: lifecycle state — track khi nào native PDF viewer đã vẽ xong.
 *
 * Vì sao cần state này:
 *   - Native PDF viewer (Chrome PDFium / Firefox pdf.js) tạo backdrop đen
 *     ngay khi `<object>` mount, TRƯỚC khi PDF content vẽ. User thấy "đen"
 *     trong 1-2s đầu dù PDF đang load bình thường.
 *   - `<object>` fire `load` event khi PDF viewer đã load xong resource +
 *     render page đầu — đây là "actual render success event".
 *   - Dùng `visibility: hidden` cho object + show skeleton cho tới khi `load`
 *     fire. User không thấy đen, chỉ thấy skeleton có shimmer.
 *   - `error` event cover case CORS fail / 404 / MIME type mismatch → show
 *     placeholder "Không thể xem trước CV" thay vì đen vĩnh viễn.
 *   - Watch `cv.id` reset state khi user chuyển tab / đổi filter — không để
 *     state cũ của CV trước "lưu lại" skeleton khi CV mới đã render xong.
 *
 * KHÔNG dùng setTimeout / opacity fade cố định / hide card — đều che lỗi
 * bằng timer, không phải event-driven như spec yêu cầu.
 * ==========================================================================*/
const isPdfLoaded = ref<boolean>(false);
const isPdfError = ref<boolean>(false);

const onPdfLoaded = (): void => {
  isPdfLoaded.value = true;
  isPdfError.value = false;
};
const onPdfError = (): void => {
  isPdfLoaded.value = false;
  isPdfError.value = true;
};

// Reset khi cv đổi (filter / pagination / F5 reload list) — state cũ không
// "ám" sang CV mới. Nếu giữ isPdfLoaded=true từ CV cũ, CV mới sẽ hiện ngay
// mà không có skeleton dù object chưa kịp load.
watch(
  () => props.cv.id,
  () => {
    isPdfLoaded.value = false;
    isPdfError.value = false;
  },
);

/** Đang hiện PDF branch? Dùng để v-if các layer skeleton / error. */
const showPdfBranch = computed<boolean>(
  () => isUpload.value && isPdf.value && hasFile.value,
);
</script>

<template>
  <!--
    Outer container — full 100% width/height của parent. Parent (MyResumesView
    hoặc nơi gọi khác) phải có aspectRatio 850/1100 để giữ tỉ lệ A4.
    bg-white + ring + rounded-[3px] + overflow-hidden cho giống "khung tranh"
    paper-stack effect.
  -->
  <div
    class="relative w-full h-full bg-white rounded-[3px] ring-1 ring-slate-900/[0.06] overflow-hidden"
  >
    <!-- ==================== Direct CV: switch theo templateId ==================== -->
    <component
      v-if="ResolvedThumbnail"
      :is="ResolvedThumbnail"
      :data="renderData"
      class="absolute inset-0"
    />

    <!-- ==================== Upload + PDF: native browser viewer + skeleton overlay ====================
         3 layer xếp chồng (z-order từ dưới lên):
           1. <object> native PDF viewer — visibility:hidden cho tới khi `load`
              event fire. Element vẫn ở DOM nên load event có thể fire, nhưng
              user không thấy backdrop đen của viewer khi viewer đang init.
           2. Skeleton (shimmer + gray bars) — chỉ hiện khi `!isPdfLoaded &&
              !isPdfError`. Mô phỏng layout trang CV để user hiểu "đang load",
              có animate-pulse để có life signal thay vì block trắng tĩnh.
           3. Error placeholder — chỉ hiện khi `isPdfError` (CORS fail / 404
              / MIME mismatch). Text ngắn "Không thể xem trước CV" + icon nhỏ.

         Lý do dùng overlay thay vì mount/unmount object:
           - Unmount + remount sẽ trigger load sequence MỚI → flash đen lặp
             lại khi user chuyển tab filter.
           - visibility:hidden giữ element ở DOM, load event vẫn fire 1 lần.
           - Chỉ swap visibility khi load event thực sự fire (event-driven).
    -->
    <template v-if="showPdfBranch">
      <object
        :data="cv.fileUrl ?? ''"
        type="application/pdf"
        :aria-label="`PDF thumbnail: ${cv.title || 'CV'}`"
        class="absolute inset-0 w-full h-full pointer-events-none"
        :style="{ visibility: isPdfLoaded ? 'visible' : 'hidden' }"
        @load="onPdfLoaded"
        @error="onPdfError"
      >
        <!-- Fallback content cho browser không hỗ trợ PDF embed. visibility
             của parent vẫn phụ thuộc isPdfLoaded — fallback này chỉ hiện
             khi load thành công (visibility: visible). -->
        <div class="w-full h-full flex flex-col p-2.5 gap-1 bg-white">
          <div class="h-1.5 bg-slate-300 rounded w-3/4" />
          <div class="h-1 bg-slate-200 rounded w-1/2 mt-1" />
          <div class="h-px bg-slate-100 w-full my-1.5" />
          <div class="h-1 bg-slate-200 rounded w-full" />
          <div class="h-1 bg-slate-200 rounded w-5/6" />
          <div class="h-1 bg-slate-200 rounded w-full" />
        </div>
      </object>

      <!-- Skeleton: chỉ render khi chưa load xong VÀ chưa lỗi. v-if (không
           v-show) để DOM được dọn khi load xong → không có z-index conflict. -->
      <div
        v-if="!isPdfLoaded && !isPdfError"
        class="absolute inset-0 w-full h-full bg-white flex flex-col p-2.5 gap-1"
        role="status"
        aria-live="polite"
        :aria-label="'Đang tải CV PDF'"
      >
        <div class="h-1.5 bg-slate-200 rounded w-3/4 animate-pulse" />
        <div class="h-1 bg-slate-200 rounded w-1/2 mt-1 animate-pulse" />
        <div class="h-px bg-slate-100 w-full my-1.5" />
        <div class="h-1 bg-slate-200 rounded w-full animate-pulse" />
        <div class="h-1 bg-slate-200 rounded w-5/6 animate-pulse" />
        <div class="h-1 bg-slate-200 rounded w-full animate-pulse" />
      </div>

      <!-- Error placeholder: thân thiện hơn đen vĩnh viễn. -->
      <div
        v-if="isPdfError"
        class="absolute inset-0 w-full h-full bg-white flex flex-col items-center justify-center gap-1.5 px-2 text-center"
        role="alert"
      >
        <!-- Icon file lỗi — dùng inline svg để không kéo thêm lucide cho case
             hiếm gặp này (lỗi PDF là edge case, không phải happy path). -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          class="w-5 h-5 text-slate-300"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
          />
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 13.5h6M9 16.5h4.5" />
        </svg>
        <span class="text-[9px] font-medium text-slate-400 leading-tight">
          Không thể xem trước CV
        </span>
      </div>
    </template>

    <!-- ==================== Upload + Image: <img> cover-fit ==================== -->
    <img
      v-else-if="isUpload && isImage && hasFile"
      :src="cv.fileUrl ?? ''"
      :alt="cv.title || 'CV image'"
      class="absolute inset-0 w-full h-full object-cover pointer-events-none"
    />

    <!-- ==================== Upload + Other (DOCX, unknown) ====================
         Fallback mockup gạch xám — visual hint "có CV nhưng không preview được".
         User bấm "Xem chi tiết" → modal với Google Docs Viewer cho DOCX. -->
    <div
      v-else-if="isUpload"
      class="absolute inset-0 w-full h-full flex flex-col p-2.5 gap-1 bg-white"
    >
      <div class="h-1.5 bg-slate-300 rounded w-3/4" />
      <div class="h-1 bg-slate-200 rounded w-1/2 mt-1" />
      <div class="h-px bg-slate-100 w-full my-1.5" />
      <div class="h-1 bg-slate-200 rounded w-full" />
      <div class="h-1 bg-slate-200 rounded w-5/6" />
      <div class="h-1 bg-slate-200 rounded w-full" />
      <div class="h-1 bg-slate-200 rounded w-4/5" />
      <div class="h-px bg-slate-100 w-full my-1.5" />
      <div class="h-1 bg-slate-200 rounded w-full" />
      <div class="h-1 bg-slate-200 rounded w-3/4" />
      <div class="h-1 bg-slate-200 rounded w-full" />
    </div>

    <!-- ==================== Unknown (defensive) ==================== -->
    <div
      v-else
      class="absolute inset-0 w-full h-full flex items-center justify-center text-slate-300 text-[10px]"
    >
      <span>—</span>
    </div>
  </div>
</template>