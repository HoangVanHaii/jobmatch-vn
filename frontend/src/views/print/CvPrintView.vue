<script setup lang="ts">
/**
 * CvPrintView — page render-only CV cho Playwright capture PDF.
 *
 * Luồng:
 *   1. Playwright (chạy server-side trên BE) navigate tới
 *      `${FRONTEND_URL}/print/cv/:cvId?token=...` (BE đã cấp short-lived HMAC
 *      token khi user bấm Tải xuống trên CV direct).
 *   2. View này đọc `cvId` + `token` từ query, dùng `useCvRenderData`
 *      composable (mode HMAC) để fetch qua public endpoint
 *      `/cvs/:cvId/render-data`, BE verify token + trả slim row.
 *   3. Khi `data` + `templateId` sẵn sàng → render trực tiếp `<CVTemplateRenderer>`
 *      (KHÔNG qua `<CvPreview>` — file xem CV cho user).
 *   4. Sau khi DOM patch xong (flush: 'post') → chờ images + fonts + 1 RAF
 *      → set `data-ready="true"` trên <body> để Playwright biết chính xác khi
 *      nào chụp PDF.
 *
 * Tại sao KHÔNG có layout/auth guard:
 *   - Page này CHỈ dành cho Playwright access — không có UI cho user.
 *   - Auth đã verify qua HMAC signed token (TTL 120s, scope 1 cvId).
 *   - KHÔNG expose route này ra UI hay cho phép navigate thủ công.
 *
 * Tại sao KHÔNG có layout wrapper:
 *   - Cần page KHÔNG có header/nav/sidebar — chỉ render đúng CV content để
 *     PDF capture không lẫn UI của app.
 *
 * Tại sao KHÔNG dùng `<CvPreview>` (file xem CV cho user):
 *   - CvPrintView phục vụ mục đích DUY NHẤT là Playwright PDF capture.
 *   - Tách bạch với file xem CV: không phụ thuộc component UI cho user.
 *   - Khi thay đổi UX của CvPreview (loading skeleton, error slot UI, animation,
 *     responsive thumbnail scale) KHÔNG ảnh hưởng tới chất lượng PDF capture.
 *   - Khi tối ưu Playwright (data-ready signal, image observer, fonts wait)
 *     KHÔNG ảnh hưởng tới trải nghiệm user của CvPreview.
 *   - Hai file độc lập → scale/maintain riêng.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useCvRenderData } from '@composables/cvRenderData';
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue';

/* ============================================================================
 * Route params — extract cvId & HMAC token từ URL.
 *
 * Trả `null` khi missing để composable bail early (đỡ request rỗng).
 * ==========================================================================*/
const route = useRoute();
const cvId = computed<string | null>(() => {
  const id = route.params.cvId;
  return typeof id === 'string' && id.length > 0 ? id : null;
});
const token = computed<string | null>(() => {
  const t = route.query.token;
  return typeof t === 'string' && t.length > 0 ? t : null;
});

const { data, templateId, error } = useCvRenderData(cvId, token);

/* ============================================================================
 * Playwright `data-ready` signal coordination.
 *
 * Flow:
 *   - composable fetch xong → `data.value` thay đổi (null → CvRenderData)
 *   - watch với `flush: 'post'` → chạy SAU khi Vue patch DOM
 *     (đảm bảo <CVTemplateRenderer> đã mount vào DOM trước khi query <img>)
 *   - waitForImages() — đợi tất cả <img> load xong (resolve cả khi lỗi để
 *     không block capture vĩnh viễn, có timeout 5s/img)
 *   - setupImageObserver() — nếu ảnh render lazily (lazy loading) sau khi
 *     DOM mount, MutationObserver phát hiện <img> mới → mark ready lại
 *     (Playwright chỉ cần attribute tồn tại trước page.pdf(), set nhiều lần OK)
 *   - document.fonts.ready — Google Fonts + system fonts
 *   - 1 RAF — CSS transitions/animations settle
 *   - markReady() — set `data-ready="true"` trên <body>
 *
 * Tại sao KHÔNG dùng class: Tailwind purge có thể làm mất class production.
 * ==========================================================================*/

/** Chờ tất cả <img> load xong (resolve cả khi lỗi để không block capture). */
const waitForImages = (root: HTMLElement): Promise<void> => {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (!imgs.length) return Promise.resolve();
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
            setTimeout(resolve, 5_000);
          }),
    ),
  ).then(() => undefined);
};

let observer: MutationObserver | null = null;

const markReady = (): void => {
  document.body.setAttribute('data-ready', 'true');
};

const setupImageObserver = (): void => {
  observer = new MutationObserver(() => {
    markReady();
  });
  observer.observe(document.body, { childList: true, subtree: true });
};

const handleDataReady = async (): Promise<void> => {
  const root = document.getElementById('cv-print-root');
  if (root) {
    await waitForImages(root);
    setupImageObserver();
  }
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  markReady();
};

/* ============================================================================
 * Watch `data` → đợi DOM patch (flush: 'post') → handleDataReady.
 *
 * Lỗi: vẫn set data-ready để Playwright không timeout — error UI sẽ hiện
 * trong PDF (text đỏ).
 * ==========================================================================*/
watch(
  data,
  () => {
    if (data.value && templateId.value) {
      void handleDataReady();
    } else if (error.value) {
      markReady();
    }
  },
  { flush: 'post' },
);

/* Track có lỗi để render error UI trong template (reactive). */
const hasError = ref<string | null>(null);
watch(error, (msg) => {
  hasError.value = msg;
  if (msg) markReady();
}, { immediate: true });

onBeforeUnmount(() => {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
});
</script>

<template>
  <div id="cv-print-root" class="bg-white text-neutral-800">
    <CVTemplateRenderer
      v-if="data && templateId"
      :data="data"
      :template-id="templateId"
    />
    <div
      v-else-if="hasError"
      class="p-8 text-center text-red-600 font-medium"
      role="alert"
    >
      {{ hasError }}
    </div>
    <!-- Loading: render nothing — watch handleDataReady/markReady sẽ trigger
         khi composable resolve. Để DOM trống tránh Playwright capture nhầm
         skeleton vào PDF. -->
  </div>
</template>

<style>
/* Reset Tailwind preflight conflict — print page không có layout wrapper. */
html,
body {
  margin: 0;
  padding: 0;
  background: #ffffff;
}
</style>