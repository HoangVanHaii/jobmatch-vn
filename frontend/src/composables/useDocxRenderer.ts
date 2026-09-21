/**
 * useDocxRenderer — composable tách riêng toàn bộ logic render DOCX từ CvPreview.vue.
 *
 * Tại sao tách composable:
 *   - CvPreview.vue chứa 2 use case (modal + inline) + template lớn. Phần DOCX
 *     logic (~180 dòng) không liên quan đến modal chrome hay CVTemplateRenderer.
 *     Giữ chung → component khó đọc, khó test độc lập.
 *   - DOCX render có state machine riêng (idle/loading/success/error), abort
 *     logic riêng, mount tracker riêng → đủ complexity để tách.
 *   - Pattern này đã có ở [useCvDownload.ts](./useCvDownload.ts): composable
 *     nhận reactive deps (cv, fileUrl, ...) trả về { state, action }, component
 *     chỉ wire-up watch + template.
 *
 * Tại sao KHÔNG dynamic import composable:
 *   - Composable code ~150 dòng → không đáng tách chunk riêng.
 *   - Dynamic import ở đây vẫn giữ cho `docx-preview` lib (280KB), trong
 *     `renderDocxIntoIframe` (xem bên dưới).
 *
 * API:
 *   Input:
 *     - `fileUrl: Ref<string | null | undefined>` — URL DOCX cần render. Khi null
 *       → composable không làm gì (state vẫn idle). Component caller quyết
 *       định khi nào `loadDocx()` chạy (xem watch ở CvPreview.vue).
 *   Output:
 *     - `docxState: Ref<DocxState>`     — 'idle' | 'loading' | 'success' | 'error'
 *     - `docxError: Ref<string | null>` — message cho error UI (fallback text)
 *     - `docxIframeRef: Ref<HTMLIFrameElement | null>` — gắn vào `<iframe ref>`
 *     - `loadDocx()`                    — trigger fetch + render
 *     - `reset()`                       — abort + set state='idle'
 *     - `abortCurrent()`                — abort request hiện tại, KHÔNG reset state
 *     - `dispose()`                     — manual cleanup (cho test không có
 *                                          component context). Component thật
 *                                          dùng `onUnmounted` tự động.
 *
 * Auto-cleanup khi component dùng composable unmount:
 *   - `onUnmounted` được gọi trong setup() của component → Vue tự invoke khi
 *     component destroy → set `isComponentMounted=false` + abort pending fetch.
 *   - Trong test ngoài component context, gọi `dispose()` thủ công.
 *
 * 3 bug fix đã giữ từ phiên trước:
 *   - Bug 1 (mount tracker): `isComponentMounted` flag + check trước mọi
 *     ref assignment → không set state trên component đã unmount.
 *   - Bug 3 (abort race): 5 điểm check `ctrl.signal.aborted` trong
 *     `renderDocxIntoIframe` + 2 điểm trong `loadDocx` → render stale bail
 *     out khi CV đổi nhanh hoặc component unmount giữa renderAsync.
 *   - Bug 2 (throttle): KHÔNG liên quan composable này, vẫn ở useCvDownload.
 */
import { nextTick, onUnmounted, ref, type Ref } from 'vue';

export type DocxState = 'idle' | 'loading' | 'success' | 'error';

export interface UseDocxRendererOptions {
  /** URL DOCX. Null/undefined → composable no-op, state giữ 'idle'. */
  fileUrl: Ref<string | null | undefined>;
}

export interface UseDocxRendererReturn {
  docxState: Ref<DocxState>;
  docxError: Ref<string | null>;
  /** Gắn vào `<iframe ref="docxIframeRef">` trong template. */
  docxIframeRef: Ref<HTMLIFrameElement | null>;
  /** Trigger fetch + render. Idempotent: gọi concurrent chỉ render mới nhất. */
  loadDocx: () => Promise<void>;
  /** Abort + reset về 'idle'. Gọi khi đóng modal. */
  reset: () => void;
  /** Abort request hiện tại (nếu có), giữ state. Gọi khi watch phát hiện đổi CV. */
  abortCurrent: () => void;
  /**
   * Manual cleanup — set mount tracker = false + abort. Component thật dùng
   * `onUnmounted` tự động; test gọi trực tiếp để simulate unmount.
   */
  dispose: () => void;
}

/**
 * CSS override inject vào iframe document để match style A4 như modal PDF.
 *
 * Tại sao cần:
 *   - Tailwind class từ parent KHÔNG cross-document, không áp dụng vào iframe.
 *   - DOCX preview mặc định không có padding/background → trông "trống".
 *
 * Tại sao KHÔNG dùng `<style scoped>`:
 *   - Scoped style chỉ apply cho DOM trong component, không cross vào iframe.
 *   - Inline `<style>` trong iframe doc là cách duy nhất.
 */
const DOCX_IFRAME_STYLE = `
  html, body {
    margin: 0;
    padding: 0;
    background: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-sizing: border-box;
  }
  body { overflow-y: auto; min-height: 100%; }
  .docx-wrapper {
    padding: 16px 0 24px;
    background: #f8fafc;
    min-height: 100%;
  }
  .docx-wrapper > section.docx {
    max-width: 820px;
    width: calc(100% - 32px);
    margin: 0 auto 16px;
    padding: 24px 32px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
    background: white;
    box-sizing: border-box;
  }
  @media print {
    .docx-wrapper { background: white; padding: 0; }
    .docx-wrapper > section.docx { box-shadow: none; max-width: 100%; margin: 0; }
  }
`;

export function useDocxRenderer(
  opts: UseDocxRendererOptions,
): UseDocxRendererReturn {
  const docxState = ref<DocxState>('idle');
  const docxError = ref<string | null>(null);
  const docxIframeRef = ref<HTMLIFrameElement | null>(null);

  let docxAbortController: AbortController | null = null;
  /**
   * Bug 1 fix: track mount state để tránh set ref state trên component đã
   * unmount. Vue 3 có thể silent fail hoặc warn "Set operation on key X
   * failed" khi set state trên unmounted component.
   */
  let isComponentMounted = true;
  let isDisposed = false;

  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    isComponentMounted = false;
    docxAbortController?.abort();
  };

  /**
   * Auto-register cleanup khi composable được gọi trong setup(). Vue throw
   * warning (không throw error) nếu gọi ngoài component context — trong test
   * ta suppress warning + dùng `dispose()` thủ công.
   */
  onUnmounted(dispose);

  /**
   * Render blob DOCX vào iframe đã mount. Tách thành function riêng để test
   * abort logic riêng nếu cần.
   *
   * 5 điểm check `ctrl.signal.aborted` (Bug 3 fix):
   *   1. Đầu function — skip nếu signal đã abort (CV đã đổi trước khi gọi).
   *   2. Sau dynamic import — import có thể mất ~50ms với cold cache.
   *   3. Sau lấy contentDocument — iframe có thể đã detach.
   *   4. (Optional) Sau inject CSS — DOM mutation nhỏ.
   *   5. Trước await renderAsync — renderAsync không support AbortSignal, nhưng
   *      nếu abort trước khi renderAsync chạy → bail out, tránh waste CPU.
   *
   * Sau renderAsync, caller (`loadDocx`) check signal ở 2 nơi (sau await
   * renderDocxIntoIframe + sau catch) → đảm bảo state chỉ set khi đây là
   * render "hiện tại".
   */
  const renderDocxIntoIframe = async (
    iframe: HTMLIFrameElement,
    blob: Blob,
    ctrl: AbortController,
  ): Promise<void> => {
    if (ctrl.signal.aborted) return;

    const { renderAsync } = await import('docx-preview');
    if (ctrl.signal.aborted) return;

    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Không truy cập được nội dung iframe');
    if (ctrl.signal.aborted) return;

    // Reset iframe document về trạng thái sạch.
    doc.open();
    doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
    doc.close();

    // Inject CSS override — cross-document, không dùng Tailwind class ở đây.
    const styleEl = doc.createElement('style');
    styleEl.textContent = DOCX_IFRAME_STYLE;
    doc.head.appendChild(styleEl);

    // Container mà docx-preview sẽ appendChildren vào.
    const container = doc.createElement('div');
    doc.body.appendChild(container);

    if (ctrl.signal.aborted) return;

    await renderAsync(blob, container, container, {
      className: 'docx',
      inWrapper: true,
      ignoreHeight: true,
      useBase64URL: true,
      trimXmlDeclaration: true,
    });
  };

  /**
   * Load + render DOCX. Được trigger từ watch ở component caller khi modal
   * mở với CV .docx.
   *
   * Flow:
   *   1. Abort request cũ (nếu user đóng/mở lại modal nhanh hoặc đổi CV).
   *   2. Set state='loading', clear error.
   *   3. fetch(fileUrl) — simple GET, không custom header → không preflight,
   *      an toàn với bucket MinIO không có CORS rule (giống useCvDownload).
   *   4. Sau khi có blob, đợi nextTick để chắc iframe ref available
   *      (modal v-if="open" vừa flip true → Vue mount DOM).
   *   5. Gọi renderDocxIntoIframe → state='success' nếu pass.
   *   6. Bất kỳ throw nào (fetch fail, parse fail, file .doc disguised as
   *      .docx, v.v.) → state='error' với message gốc.
   */
  const loadDocx = async (): Promise<void> => {
    const url = opts.fileUrl.value;
    if (!url) return;

    docxAbortController?.abort();
    const ctrl = new AbortController();
    docxAbortController = ctrl;

    if (!isComponentMounted) return;
    docxState.value = 'loading';
    docxError.value = null;

    try {
      const response = await fetch(url, { signal: ctrl.signal });
      if (!response.ok) {
        throw new Error(`Tải file thất bại (HTTP ${response.status})`);
      }
      const blob = await response.blob();

      // Safety: đợi Vue flush DOM xong để chắc iframe ref available.
      await nextTick();
      if (ctrl.signal.aborted) return;

      const iframe = docxIframeRef.value;
      if (!iframe) throw new Error('Iframe chưa sẵn sàng');

      await renderDocxIntoIframe(iframe, blob, ctrl);
      if (ctrl.signal.aborted) return;
      // Guard: component có thể đã unmount trong khi renderDocxIntoIframe chạy.
      if (!isComponentMounted) return;

      docxState.value = 'success';
    } catch (err) {
      // AbortError từ AbortController.abort() → im lặng, không báo error.
      if ((err as Error).name === 'AbortError') return;
      if (!isComponentMounted) return;
      console.error('useDocxRenderer: render failed', err);
      docxError.value =
        (err as Error).message ??
        'File DOCX có thể bị lỗi hoặc không đúng định dạng.';
      docxState.value = 'error';
    }
  };

  /** Abort + reset state. Component gọi khi đóng modal. */
  const reset = (): void => {
    docxAbortController?.abort();
    docxAbortController = null;
    docxState.value = 'idle';
    docxError.value = null;
  };

  /** Abort mà không reset state. Component gọi khi watch phát hiện đổi CV
   *  (sẽ trigger loadDocx mới ngay sau). */
  const abortCurrent = (): void => {
    docxAbortController?.abort();
  };

  return {
    docxState,
    docxError,
    docxIframeRef,
    loadDocx,
    reset,
    abortCurrent,
    dispose,
  };
}
