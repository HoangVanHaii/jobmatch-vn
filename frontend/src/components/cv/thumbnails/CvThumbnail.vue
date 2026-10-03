<script lang="ts">
/* ============================================================================
 * Module scope — chạy 1 lần khi module load (KHÔNG phải per-instance như
 * <script setup>). Dùng cho bitmap cache chia sẻ mọi instance CvThumbnail:
 * card remount (đổi filter / pagination / quay lại trang) vẽ lại từ cache
 * thay vì fetch + parse + render pdf.js lần nữa.
 * ==========================================================================*/

/** Bitmap đã render của trang 1 — PNG blob URL (lossless) + dims bitmap. */
type PdfThumbBitmap = { blobUrl: string; width: number; height: number };

/** Key = `${fileUrl}|${displayWidth}|${dpr}` — displayWidth biết ngay từ DOM. */
const pdfThumbCache = new Map<string, PdfThumbBitmap>();

/** Số entry tối đa — evict cũ nhất (Map giữ insertion order) + revoke blob. */
const PDF_THUMB_CACHE_MAX = 16;

/** Ngưỡng lệch chiều rộng hiển thị (px) để re-render khi container resize. */
const PDF_RERENDER_DELTA_PX = 32;

/** Debounce re-render khi resize (ms) — tránh render liên tục khi drag window. */
const PDF_RERENDER_DEBOUNCE_MS = 200;
</script>

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
 *   2. upload + PDF + có fileUrl → render page 1 bằng pdfjs-dist vào <canvas>.
 *      Không dùng <object> / <embed> / <iframe> / native browser PDF viewer vì
 *      Chrome PDFium tạo compositor layer riêng với backdrop đen (~1-2s) khi
 *      mount, dù CSS visibility/opacity có apply đúng. pdfjs-dist render thẳng
 *      vào canvas do app quản lý → không có native viewer, không có flash đen.
 *      Xem chi tiết ở phần "Upload PDF" bên dưới.
 *   3. upload + image → `<img>` cover-fit.
 *   4. upload + other (DOCX, ...) → fallback mockup gạch xám.
 *
 * Props:
 *   - `cv: Cv` — bất kỳ loại CV. Component tự route.
 *
 * Sizing:
 *   - Outer container: fill 100% width/height của parent. Parent phải có
 *     aspectRatio 850/1100 (set ở MyResumesView hiện tại).
 *   - Có thể dùng nơi khác (dashboard widget, picker) với wrapper sized khác.
 *   - Branch PDF: canvas bitmap render đúng mật độ pixel hiển thị
 *     (container width × max(devicePixelRatio, 2)), canvas.style w-full
 *     h-full giữ kích thước hiển thị → nét 1:1 physical pixel (xem
 *     "Sizing — render đúng mật độ pixel" ở script).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CvThumbnailTemplate1 from './CvThumbnailTemplate1.vue';
import CvThumbnailTemplate2 from './CvThumbnailTemplate2.vue';
import CvThumbnailTemplate3 from './CvThumbnailTemplate3.vue';
import CvThumbnailTemplate4 from './CvThumbnailTemplate4.vue';
import CvThumbnailTemplate5 from './CvThumbnailTemplate5.vue';
import CvThumbnailTemplate6 from './CvThumbnailTemplate6.vue';
import CvThumbnailTemplate7 from './CvThumbnailTemplate7.vue';
import { buildRenderData } from '@/composables/cvRenderData';
import type { Cv } from '@/types/cv';

/* ============================================================================
 * PDF.js — worker setup (Vite)
 *
 * Vite xử lý `?url` suffix: copy file pdf.worker.mjs vào bundle và trả về
 * URL tĩnh. Worker PDF.js là bắt buộc để parse PDF không block main thread
 * (CV PDF có thể lớn vài MB → parse ở main thread sẽ jank UI list).
 *
 * Module này được import 1 lần ở top-level → GlobalWorkerOptions.workerSrc
 * được set 1 lần → mọi getDocument() sau dùng chung worker. KHÔNG cần set
 * lại mỗi instance.
 * ==========================================================================*/
import * as pdfjsLib from 'pdfjs-dist';
// Vite-specific URL import — worker file được bundle riêng, served như asset.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — pdfjs-dist không có types cho subpath worker import
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const props = withDefaults(
  defineProps<{
    cv: Cv;
    fit?: 'contain' | 'cover';
  }>(),
  {
    fit: 'contain',
  },
);

/* ============================================================================
 * Branch detection
 * ==========================================================================*/
const isUpload = computed<boolean>(() => props.cv.source === 'upload');
const isDirect = computed<boolean>(() => props.cv.source === 'direct');

/** Resolve templateId cho direct CV — fallback về 1 nếu null/out-of-range. */
const directTemplateId = computed<number | null>(() => {
  if (!isDirect.value) return null;
  const id = props.cv.templateId;
  return id !== null && id >= 1 && id <= 7 ? id : 1;
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
  6: CvThumbnailTemplate6,
  7: CvThumbnailTemplate7,
} as const;

const ResolvedThumbnail = computed(() => {
  const t = directTemplateId.value as 1 | 2 | 3 | 4 | 5 | 6 | 7 | null;
  return t ? templateMap[t] ?? CvThumbnailTemplate1 : null;
});

/** Đang hiện PDF branch? Dùng để v-if canvas wrapper. */
const showPdfBranch = computed<boolean>(
  () => isUpload.value && isPdf.value && hasFile.value,
);

/* ============================================================================
 * Upload PDF: render bằng pdfjs-dist vào <canvas>.
 *
 * Tại sao KHÔNG dùng <object> / <embed> / <iframe> / native PDF viewer:
 *   - Chrome PDFium viewer embed qua <object type="application/pdf"> tạo
 *     compositor layer riêng với backdrop đen (~1-2s) khi khởi tạo. CSS
 *     visibility / opacity / z-index trên host element không reliably ẩn
 *     backdrop đó (đã test thực tế trên Chrome 151 với F5: vẫn thấy đen
 *     ~1-2s dù wrapper đã visibility:hidden).
 *   - pdfjs-dist render thẳng PDF page vào <canvas> do app sở hữu hoàn toàn.
 *     Không có native viewer → không có compositor layer riêng → không có
 *     backdrop đen.
 *
 * Lifecycle:
 *   1. Mount / cv.id / cv.fileUrl đổi → reset state (loading=true, loaded=false,
 *      error=false), clear canvas, increment generation (cancel in-flight render).
 *   2. Check bitmap cache (key từ fileUrl + displayWidth + dpr) → hit thì vẽ
 *      lại bằng drawImage, KHÔNG fetch/parse PDF lần nữa.
 *   3. Miss → getDocument(url) → getPage(1) → render đúng mật độ hiển thị.
 *   4. Tính scale = (containerWidth / pageNaturalWidth) × max(DPR, 2) →
 *      canvas.width/height = bitmap khớp physical pixel vùng hiển thị.
 *   5. Nếu generation thay đổi sau bất kỳ await → drop kết quả (CV đã đổi),
 *      vẫn cleanup + destroy pdf để không leak.
 *   6. Success: isPdfLoaded=true, cache PNG lossless, page.cleanup() +
 *      pdf.destroy(). Error: isPdfError=true.
 *
 * Race condition:
 *   - generation counter tăng mỗi lần trigger render mới (cv change, mount,
 *     unmount). Mỗi lần resume sau await, check `gen === generation.current`:
 *     nếu sai → drop kết quả (user đã chuyển sang CV khác / component đã unmount).
 *   - pdfjs render task không có API cancel trực tiếp, nhưng check generation
 *     đủ để đảm bảo kết quả cũ không ghi đè canvas của CV mới.
 *   - Khi unmount: increment generation → mọi pending render tự drop khi resolve.
 *
 * Canvas background:
 *   - Fill white trước khi render (defense: nếu PDF page có vùng trong suốt,
 *     canvas sẽ hiện trắng thay vì màu nền mặc định của browser = đen).
 *   - Clear canvas khi CV đổi để không "lưu lại" page cũ trong khi page mới
 *     đang load.
 *
 * Sizing — render đúng mật độ pixel hiển thị (fix thumbnail mờ):
 *   - Trước đây: bitmap cố định = PDF natural × 2 (A4 → ~1190×1684) rồi CSS
 *     thu xuống card (~132-320px) → downscale 3.5-8× bằng 1-pass bilinear
 *     của browser → chữ nhòe.
 *   - Giờ: scale = (containerWidth / pageNaturalWidth) × max(devicePixelRatio, 2)
 *     → canvas.width/height (bitmap) khớp đúng số physical pixel của vùng
 *     hiển thị; canvas.style (w-full h-full) giữ kích thước hiển thị → nét
 *     1:1, RAM giảm ~10× so với bitmap cố định cũ.
 *   - Bitmap aspect luôn = PDF page aspect (viewport.scale uniform) → CSS
 *     `object-contain` (fit='contain') letterbox trắng khi container aspect
 *     ≠ PDF aspect; `object-cover object-top` (fit='cover') hiện phần đầu
 *     trang, crop phần dưới tràn.
 *   - ResizeObserver theo dõi container width; đổi ≥ PDF_RERENDER_DELTA_PX
 *     → re-render với scale mới (debounce PDF_RERENDER_DEBOUNCE_MS).
 * ==========================================================================*/

const canvasRef = ref<HTMLCanvasElement | null>(null);
/** Container ngoài — đo display width (CSS px) để tính render scale. */
const containerRef = ref<HTMLDivElement | null>(null);
const isPdfLoading = ref<boolean>(true);
const isPdfLoaded = ref<boolean>(false);
const isPdfError = ref<boolean>(false);

/** Display width (CSS px) của khung thumbnail — 0 nếu chưa đo được layout. */
const containerDisplayWidth = (): number => containerRef.value?.clientWidth ?? 0;

/** DPR render — min 2 để giữ nét trên màn thường + khi user zoom browser. */
const renderDpr = (): number =>
  typeof window !== 'undefined' ? Math.max(window.devicePixelRatio || 1, 2) : 2;

/** Vẽ bitmap cache (PNG blob) vào canvas — thay cho fetch + parse + render. */
const drawCachedToCanvas = (
  canvas: HTMLCanvasElement,
  entry: PdfThumbBitmap,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth || entry.width;
      canvas.height = img.naturalHeight || entry.height;
      fillCanvasWhite(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve();
    };
    img.onerror = () => reject(new Error('Cached thumbnail decode failed'));
    img.src = entry.blobUrl;
  });

/** Lưu bitmap vừa render vào cache — PNG lossless, async (không block UI). */
const cacheRenderedBitmap = (cacheKey: string, canvas: HTMLCanvasElement): void => {
  canvas.toBlob((blob) => {
    if (!blob) return; // best-effort — miss cache không ảnh hưởng hiển thị
    while (pdfThumbCache.size >= PDF_THUMB_CACHE_MAX) {
      const oldestKey = pdfThumbCache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = pdfThumbCache.get(oldestKey);
      pdfThumbCache.delete(oldestKey);
      if (oldest) URL.revokeObjectURL(oldest.blobUrl);
    }
    pdfThumbCache.set(cacheKey, {
      blobUrl: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
    });
  }, 'image/png');
};

/**
 * Generation counter — chống race condition khi user đổi CV giữa lúc render.
 * Tăng mỗi lần trigger render mới; mỗi lần resume sau await, check
 * `myGen === renderGeneration`. Nếu khác → drop kết quả (CV đã đổi).
 */
let renderGeneration = 0;

/** Display width của lần render thành công gần nhất — dùng cho resize check. */
let lastRenderedDisplayWidth = 0;

const fillCanvasWhite = (canvas: HTMLCanvasElement | null): void => {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
};

const renderPdfToCanvas = async (gen: number): Promise<void> => {
  const url = props.cv.fileUrl;
  const canvas = canvasRef.value;
  const displayWidth = containerDisplayWidth();

  if (!url || !canvas || displayWidth <= 0) {
    isPdfError.value = true;
    isPdfLoading.value = false;
    return;
  }

  const dpr = renderDpr();
  const cacheKey = `${url}|${Math.round(displayWidth)}|${dpr}`;

  try {
    // 1) Cache hit → vẽ lại bitmap đã render, bỏ qua fetch + parse + render.
    const cached = pdfThumbCache.get(cacheKey);
    if (cached) {
      await drawCachedToCanvas(canvas, cached);
      if (gen !== renderGeneration) return;
      lastRenderedDisplayWidth = displayWidth;
      isPdfLoaded.value = true;
      isPdfLoading.value = false;
      return;
    }

    // 2) Cache miss → fetch + parse + render trang 1 (chỉ trang 1 — thumbnail).
    const pdf = await pdfjsLib.getDocument({
      url,
      // Auth header nếu BE yêu cầu — match với axios interceptor.
      // KHÔNG cần truyền tường minh: pdfjs-dist sẽ dùng credentials mặc định
      // (cookie-based) cho same-origin, và bearer header sẽ được attach nếu
      // cần qua cách khác. Hiện tại URL là absolute từ backend, browser sẽ
      // gửi cookie nếu same-origin.
    }).promise;
    if (gen !== renderGeneration) {
      pdf.destroy().catch(() => {});
      return; // CV đã đổi / unmounted — drop
    }

    const page = await pdf.getPage(1);
    if (gen !== renderGeneration) {
      pdf.destroy().catch(() => {});
      return;
    }

    // Scale = (chiều rộng hiển thị / chiều rộng trang gốc) × DPR → bitmap
    // khớp đúng physical pixel của card (xem "Sizing" comment đầu section).
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: (displayWidth / base.width) * dpr,
    });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    // Fill white TRƯỚC khi render — defense cho PDF page có vùng trong suốt.
    fillCanvasWhite(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    await page.render({ canvasContext: ctx, viewport }).promise;
    if (gen !== renderGeneration) {
      page.cleanup();
      pdf.destroy().catch(() => {});
      return;
    }

    lastRenderedDisplayWidth = displayWidth;
    isPdfLoaded.value = true;
    isPdfLoading.value = false;

    // Cache PNG lossless cho lần remount kế tiếp (async, best-effort).
    cacheRenderedBitmap(cacheKey, canvas);

    // Dọn dẹp pdf.js ngay sau khi đã có bitmap: page.cleanup() giải phóng
    // intermediate render surfaces, pdf.destroy() giải phóng document data
    // trong worker → không giữ RAM của PDF đã render xong.
    page.cleanup();
    pdf.destroy().catch(() => {
      // best-effort — không ảnh hưởng UX
    });
  } catch (err) {
    if (gen !== renderGeneration) return;
    console.warn('[CvThumbnail] PDF.js render failed:', err);
    isPdfError.value = true;
    isPdfLoading.value = false;
  }
};

const triggerRender = (): void => {
  const myGen = ++renderGeneration;
  // Reset state NGAY để UI flash về loading.
  isPdfLoading.value = true;
  isPdfLoaded.value = false;
  isPdfError.value = false;
  // Clear canvas để không "lưu lại" PDF cũ trong khi PDF mới đang load.
  fillCanvasWhite(canvasRef.value);
  void renderPdfToCanvas(myGen);
};

// Lazy render — chỉ fetch PDF khi card scroll vào viewport.
//
// Lý do: list MyResumes có thể render N cards upload CV cùng lúc. Mỗi card
// mount đều fire 1 GET fileUrl (MinIO) + parse PDF → bandwidth waste + lag
// khi list lớn. IntersectionObserver đảm bảo chỉ cards trong viewport (+
// margin) mới trigger render. Cards còn lại đợi user scroll tới mới load.
// (containerRef đã khai báo ở section PDF state phía trên.)
const isIntersecting = ref<boolean>(false);
let intersectionObserver: IntersectionObserver | null = null;

/* ============================================================================
 * Resize — container đổi width (responsive / zoom browser) → re-render với
 * scale mới để bitmap luôn khớp mật độ hiển thị.
 *
 * Guard: chỉ re-render khi đã lazy-render lần đầu (isIntersecting), không
 * đang loading, và width lệch ≥ PDF_RERENDER_DELTA_PX so với lần render cuối
 * (tránh RO initial-fire và rung layout gây render thừa). Debounce để không
 * render liên tục khi user drag-resize window.
 * ==========================================================================*/
let pdfResizeObserver: ResizeObserver | null = null;
let pdfResizeTimer: ReturnType<typeof setTimeout> | null = null;

const onContainerResize = (): void => {
  if (!isIntersecting.value || isPdfLoading.value) return;
  const width = containerDisplayWidth();
  if (Math.abs(width - lastRenderedDisplayWidth) < PDF_RERENDER_DELTA_PX) return;
  if (pdfResizeTimer) clearTimeout(pdfResizeTimer);
  pdfResizeTimer = setTimeout(() => {
    pdfResizeTimer = null;
    if (showPdfBranch.value) triggerRender();
  }, PDF_RERENDER_DEBOUNCE_MS);
};

onMounted(() => {
  // Theo dõi resize luôn (không guard showPdfBranch — callback tự skip).
  if (typeof ResizeObserver !== 'undefined') {
    pdfResizeObserver = new ResizeObserver(onContainerResize);
    if (containerRef.value) pdfResizeObserver.observe(containerRef.value);
  }

  if (!showPdfBranch.value) return;
  // SSR / test environment không có IntersectionObserver → render ngay.
  if (typeof IntersectionObserver === 'undefined') {
    isIntersecting.value = true;
    triggerRender();
    return;
  }
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nowIntersecting = entry.isIntersecting;
      // Lần đầu vào viewport → trigger render (one-shot).
      if (nowIntersecting && !isIntersecting.value) {
        isIntersecting.value = true;
        triggerRender();
        // Sau khi trigger, không cần observe nữa (PDF render độc lập).
        intersectionObserver?.disconnect();
      }
    },
    {
      // Load trước khi user scroll tới 1 row (~250px).
      rootMargin: '250px 0px',
      threshold: 0.01,
    },
  );
  if (containerRef.value) {
    intersectionObserver.observe(containerRef.value);
  }
});

// Watch showPdfBranch để set containerRef đúng root khi branch bật.
watch(showPdfBranch, (show) => {
  if (show && containerRef.value && intersectionObserver) {
    intersectionObserver.observe(containerRef.value);
  }
});

// Đổi CV (filter / pagination / F5 reload list) → cancel render cũ + render mới.
// Watch cả id VÀ fileUrl vì fileUrl có thể đổi (vd re-upload) mà id giữ nguyên.
watch(
  () => [props.cv.id, props.cv.fileUrl] as const,
  () => {
    if (!showPdfBranch.value) return;
    triggerRender();
  },
);

// Branch toggle (user chuyển giữa upload-PDF / direct / image / other) → trigger.
watch(showPdfBranch, (show) => {
  if (show) triggerRender();
  else {
    // Rời PDF branch: cancel mọi render đang chạy + reset state.
    renderGeneration++;
    isPdfLoading.value = false;
    isPdfLoaded.value = false;
    isPdfError.value = false;
    fillCanvasWhite(canvasRef.value);
  }
});

// Unmount → cancel mọi render đang chạy (check generation ở resume).
onBeforeUnmount(() => {
  renderGeneration++;
  intersectionObserver?.disconnect();
  intersectionObserver = null;
  pdfResizeObserver?.disconnect();
  pdfResizeObserver = null;
  if (pdfResizeTimer) {
    clearTimeout(pdfResizeTimer);
    pdfResizeTimer = null;
  }
});
</script>

<template>
  <!--
    Outer container — full 100% width/height của parent. Parent (MyResumesView
    hoặc nơi gọi khác) phải có aspectRatio 850/1100 để giữ tỉ lệ A4.
    bg-white + ring + rounded-[3px] + overflow-hidden cho giống "khung tranh"
    paper-stack effect.
  -->
  <div
    ref="containerRef"
    class="relative w-full h-full bg-white rounded-[3px] overflow-hidden"
    :class="fit === 'cover' ? '' : 'ring-1 ring-slate-900/[0.06]'"
  >
    <!-- ==================== Direct CV: switch theo templateId ==================== -->
    <component
      v-if="ResolvedThumbnail"
      :is="ResolvedThumbnail"
      :data="renderData"
      class="absolute"
      :class="fit === 'cover' ? 'top-0 left-0 right-0 w-full' : 'inset-0'"
      :style="fit === 'cover' ? { height: 'auto', aspectRatio: '850 / 1100' } : undefined"
    />

    <!-- ==================== Upload + PDF: pdfjs-dist render vào <canvas> ====================
         KHÔNG dùng <object> / <embed> / <iframe> / native PDF viewer — đã bị
         loại bỏ hoàn toàn vì Chrome PDFium tạo backdrop đen ~1-2s khi mount
         (xem comment đầu file). PDF.js render thẳng vào <canvas> do app quản
         lý → không có compositor layer riêng → không có flash đen.

         3 layer xếp chồng:
           0. <canvas> — bitmap render đúng mật độ pixel hiển thị (container
              width × max(DPR, 2)); canvas.style w-full h-full giữ kích thước
              hiển thị. CSS `object-contain` (hoặc `object-cover object-top`
              khi fit='cover') để fit hoặc preview phần đầu trang CV.
           1. Skeleton (animate-pulse bars) — load thay thế canvas khi đang
              fetch PDF binary + parse + render.
           2. Error placeholder — khi PDF.js fail (404, CORS, invalid PDF).
    -->
    <template v-if="showPdfBranch">
      <!-- Canvas container — fill khung, bg-white để nếu PDF page có vùng trong
           suốt (transparency) thì hiện trắng thay vì đen. -->
      <div class="absolute inset-0 bg-white">
        <canvas
          ref="canvasRef"
          v-show="isPdfLoaded"
          class="absolute inset-0 w-full h-full pointer-events-none"
          :class="fit === 'cover' ? 'object-cover object-top' : 'object-contain'"
          aria-hidden="true"
        />

        <!-- Skeleton: chỉ render khi đang load VÀ chưa lỗi. -->
        <div
          v-if="isPdfLoading && !isPdfError"
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
      </div>
    </template>

    <!-- ==================== Upload + Image: <img> cover-fit ==================== -->
    <img
      v-else-if="isUpload && isImage && hasFile"
      :src="cv.fileUrl ?? ''"
      :alt="cv.title || 'CV image'"
      class="absolute inset-0 w-full h-full object-cover pointer-events-none"
      :class="fit === 'cover' ? 'object-top' : ''"
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
