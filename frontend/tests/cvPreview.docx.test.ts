// @vitest-environment happy-dom
/**
 * Test Bug 1 + Bug 3 + tương tác giữa chúng cho useDocxRenderer composable.
 *
 * Import trực tiếp từ file composable thật (sau khi tách từ CvPreview.vue).
 * Trước fix refactor: file này replicate verbatim logic từ CvPreview.vue.
 * Sau fix: import thật → nếu CvPreview.vue thay đổi composable này, test
 * vẫn reflect đúng (vì test composable, không phải component).
 *
 * `useDocxRenderer` gọi `onUnmounted(dispose)` trong setup. Trong test không
 * có Vue instance context, nên warning "onUnmounted is called when there is
 * no active component instance" có thể xuất hiện → suppress trong beforeEach.
 *
 * Test gọi `dispose()` thủ công để simulate component unmount (thay vì
 * mount wrapper Vue component).
 *
 * Env: happy-dom vì cần `document.createElement('iframe')` cho contentDocument
 * và dynamic `import('docx-preview')` được vi.mock mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useDocxRenderer } from '@/composables/useDocxRenderer';

const { renderAsyncSpy, consoleErrorSpy, consoleWarnSpy } = vi.hoisted(() => ({
  renderAsyncSpy: vi.fn(),
  consoleErrorSpy: vi.spyOn(console, 'error').mockImplementation(() => {}),
  consoleWarnSpy: vi.spyOn(console, 'warn').mockImplementation(() => {}),
}));

vi.mock('@stores/toast', () => ({
  useToastStore: () => ({
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock dynamic import của docx-preview: renderAsyncSpy nằm ở hoisted scope.
vi.mock('docx-preview', () => ({
  renderAsync: renderAsyncSpy,
}));

beforeEach(() => {
  renderAsyncSpy.mockReset();
  consoleErrorSpy.mockClear();
  consoleWarnSpy.mockClear();
  // Default: renderAsync trả về ngay lập tức
  renderAsyncSpy.mockResolvedValue(undefined);
  // Default: fetch trả về blob ok
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['fake docx'])),
  });
});

// Helper: tạo iframe với contentDocument có thể truy cập (happy-dom hỗ trợ).
function createFakeIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  document.body.appendChild(iframe);
  return iframe;
}

describe('Bug 1: unmount guard prevents state update on unmounted component', () => {
  it('PASS case: unmount during renderAsync → no state update, no console.error', async () => {
    const fileUrl = ref<string | null>('http://example.com/test.docx');
    const renderer = useDocxRenderer({ fileUrl });

    // Mock renderAsync chậm 200ms để có thời gian unmount mid-render.
    let renderStarted = false;
    let renderCompleted = false;
    renderAsyncSpy.mockImplementation(async () => {
      renderStarted = true;
      await new Promise((r) => setTimeout(r, 200));
      renderCompleted = true;
    });

    renderer.docxIframeRef.value = createFakeIframe();

    const promise = renderer.loadDocx();

    // Wait cho renderAsync start
    await new Promise((r) => setTimeout(r, 50));
    expect(renderStarted).toBe(true);
    expect(renderer.docxState.value).toBe('loading');

    // Simulate component unmount TRƯỚC khi renderAsync hoàn thành
    renderer.dispose();

    // Đợi renderAsync "hoàn thành"
    await new Promise((r) => setTimeout(r, 250));
    expect(renderCompleted).toBe(true);

    await promise;

    // State KHÔNG được set thành 'success' (guard isComponentMounted=false)
    expect(renderer.docxState.value).toBe('loading');

    // Console.error KHÔNG được gọi (guard skip catch handler)
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('PASS case: dispose BEFORE loadDocx → no fetch, no state update', async () => {
    const fileUrl = ref<string | null>('http://example.com/test.docx');
    const renderer = useDocxRenderer({ fileUrl });

    renderer.dispose();

    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>;
    await renderer.loadDocx();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(renderer.docxState.value).toBe('idle');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('PASS case: dispose + second loadDocx → guard skips state mutation', async () => {
    const fileUrl = ref<string | null>('http://example.com/test.docx');
    const renderer = useDocxRenderer({ fileUrl });

    renderer.dispose();

    // loadDocx vẫn chạy (guard check trong function), nhưng early return.
    await renderer.loadDocx();

    expect(renderer.docxState.value).toBe('idle');
    expect(renderer.docxError.value).toBeNull();
  });
});

describe('Bug 3: abort signal stops stale render (CV đổi nhanh)', () => {
  it('PASS case: render A bị abort khi CV đổi sang B', async () => {
    const fileUrl = ref<string | null | undefined>('http://example.com/a.docx');
    const renderer = useDocxRenderer({ fileUrl });

    const renderOrder: string[] = [];
    let callIndex = 0;
    renderAsyncSpy.mockImplementation(async (_blob, container) => {
      const idx = callIndex++;
      const tag = idx === 0 ? 'A' : 'B';
      container.setAttribute('data-render', tag);
      await new Promise((r) => setTimeout(r, 100));
      renderOrder.push(tag);
    });

    renderer.docxIframeRef.value = createFakeIframe();

    // Load A
    const promiseA = renderer.loadDocx();
    await new Promise((r) => setTimeout(r, 50));

    // Đổi CV (watch sẽ gọi abortCurrent rồi loadDocx B — simulate bằng cách
    // set fileUrl ref mới + gọi abortCurrent thủ công như component watch làm)
    renderer.abortCurrent();
    fileUrl.value = 'http://example.com/b.docx';
    const promiseB = renderer.loadDocx();

    await Promise.all([promiseA, promiseB]);

    // Cả 2 renderAsync đều chạy (lib không cancel mid-await),
    // nhưng abort signal ở check SAU renderAsync → A không set success,
    // B hoàn thành bình thường.
    expect(renderOrder).toEqual(['A', 'B']);
    expect(renderer.docxState.value).toBe('success');

    // DOM cuối cùng là của B (doc.open()/write()/close() của B clear A,
    // setAttribute('data-render', 'B') ghi lên container mới).
    const finalIframe = renderer.docxIframeRef.value;
    expect(finalIframe?.contentDocument?.body.innerHTML).toContain('data-render="B"');
  });

  it('PASS case: fileUrl null → loadDocx no-op, no fetch, state giữ idle', async () => {
    const fileUrl = ref<string | null>(null);
    const renderer = useDocxRenderer({ fileUrl });

    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>;
    await renderer.loadDocx();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(renderer.docxState.value).toBe('idle');
  });
});

describe('Bug 1 + Bug 3 interaction: unmount NGAY SAU khi abort khác vừa chạy', () => {
  it('PASS case: đổi CV (abort) rồi unmount ngay → không có lỗi', async () => {
    const fileUrl = ref<string | null>('http://example.com/a.docx');
    const renderer = useDocxRenderer({ fileUrl });

    let renderStarted = false;
    renderAsyncSpy.mockImplementation(async () => {
      renderStarted = true;
      await new Promise((r) => setTimeout(r, 100));
    });

    renderer.docxIframeRef.value = createFakeIframe();

    // Load A → renderAsync bắt đầu
    const promiseA = renderer.loadDocx();
    await new Promise((r) => setTimeout(r, 30));
    expect(renderStarted).toBe(true);

    // Abort A (đổi CV — watch trong component sẽ làm việc này)
    renderer.abortCurrent();

    // Unmount ngay (đóng modal hoặc navigate away)
    renderer.dispose();

    // Đợi renderAsync A hoàn thành
    await new Promise((r) => setTimeout(r, 150));

    await promiseA;

    // abort() gọi 2 lần (1 từ abortCurrent, 1 từ dispose) là idempotent
    // trên AbortController — không throw.
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    // State vẫn 'loading' (A bị abort không set success, unmount block set error)
    expect(renderer.docxState.value).toBe('loading');
  });

  it('PASS case: gọi abort() nhiều lần trên cùng 1 controller — không throw', () => {
    // AbortController.abort() là idempotent — gọi nhiều lần OK, không throw.
    const ctrl = new AbortController();
    expect(() => {
      ctrl.abort();
      ctrl.abort();
      ctrl.abort();
    }).not.toThrow();

    expect(ctrl.signal.aborted).toBe(true);
  });

  it('PASS case: 2 lần dispose liên tiếp — không throw, không set state', async () => {
    const fileUrl = ref<string | null>('http://example.com/test.docx');
    const renderer = useDocxRenderer({ fileUrl });

    expect(() => {
      renderer.dispose();
      renderer.dispose(); // gọi lần 2 — idempotent
    }).not.toThrow();

    await renderer.loadDocx();

    expect(renderer.docxState.value).toBe('idle');
  });

  it('PASS case: reset() trong khi render đang chạy → state=idle, abort fetch', async () => {
    const fileUrl = ref<string | null>('http://example.com/test.docx');
    const renderer = useDocxRenderer({ fileUrl });

    let renderStarted = false;
    renderAsyncSpy.mockImplementation(async () => {
      renderStarted = true;
      await new Promise((r) => setTimeout(r, 200));
    });

    // Mock fetch: nếu abort → reject AbortError, nếu không thì resolve.
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, opts?: { signal?: AbortSignal }) => {
        return new Promise((resolve, reject) => {
          const signal = opts?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
          // Resolve ngay để loadDocx đi tiếp tới renderAsync
          resolve({
            ok: true,
            blob: () => Promise.resolve(new Blob(['fake'])),
          });
        });
      },
    );

    // QUAN TRỌNG: setup iframe ref trước — nếu thiếu, loadDocx throw
    // "Iframe chưa sẵn sàng" và state → 'error' thay vì 'loading'.
    renderer.docxIframeRef.value = createFakeIframe();

    const promise = renderer.loadDocx();
    await new Promise((r) => setTimeout(r, 50));
    // renderAsync đã start (fetch resolve, renderAsync bắt đầu)
    expect(renderStarted).toBe(true);
    expect(renderer.docxState.value).toBe('loading');

    // reset() → abort + state='idle'
    renderer.reset();

    expect(renderer.docxState.value).toBe('idle');
    expect(renderer.docxError.value).toBeNull();

    await promise;
    // Không có lỗi log
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
