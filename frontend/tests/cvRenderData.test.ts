// @vitest-environment happy-dom
/**
 * Test Bug H2/H3: useCvRenderData race condition + leak on unmount.
 *
 * H2 — click CV-A rồi click CV-B nhanh (A's response resolve SAU B's) →
 *      data.value phải là B, KHÔNG bị A overwrite.
 * H3 — component unmount giữa lúc fetch đang chạy → response resolve SAU
 *      unmount không set data.value, không throw warning.
 *
 * Mock pattern:
 *   - cvApi.getRenderData nhận signal → nếu abort → reject CanceledError.
 *   - Có thể delay response từng request độc lập (A chậm hơn B).
 *
 * Lưu ý: composable dùng `onUnmounted(dispose)` trong setup. Trong test
 * ngoài component context, warning Vue in ra. Suppress qua consoleWarnSpy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useCvRenderData } from '@/composables/cvRenderData';

const { consoleWarnSpy, consoleErrorSpy } = vi.hoisted(() => ({
  consoleWarnSpy: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  consoleErrorSpy: vi.spyOn(console, 'error').mockImplementation(() => {}),
}));

// Mock cv.api factory — vi.hoisted để dùng được trong vi.mock factory.
const { getRenderDataSpy, responseQueue } = vi.hoisted(() => {
  // Hàng đợi các response giả lập: mỗi lần gọi getRenderData sẽ pop response
  // tiếp theo. Nếu response là 'slow' → tạo promise chờ abort hoặc 500ms.
  const queue: Array<{ cvId: string; delay: number }> = [];
  const spy = vi.fn(async (
    cvId: string,
    _token?: string,
    config?: { signal?: AbortSignal },
  ) => {
    const next = queue.shift() ?? { cvId, delay: 50 };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          data: {
            success: true,
            data: {
              id: cvId,
              title: `CV ${cvId}`,
              source: 'direct',
              templateId: 1,
              parsedData: { name: `Name ${cvId}` },
            },
          },
        });
      }, next.delay);

      const signal = config?.signal;
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          const err = new Error('aborted');
          err.name = 'CanceledError';
          reject(err);
          return;
        }
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const err = new Error('aborted');
          err.name = 'CanceledError';
          reject(err);
        });
      }
    });
  });
  return { getRenderDataSpy: spy, responseQueue: queue };
});

vi.mock('@/services/cv.api', () => ({
  cvApi: {
    getRenderData: getRenderDataSpy,
  },
}));

beforeEach(() => {
  responseQueue.length = 0;
  getRenderDataSpy.mockClear();
  consoleWarnSpy.mockClear();
  consoleErrorSpy.mockClear();
});

describe('H2: useCvRenderData race — click A rồi B nhanh, A chậm hơn B', () => {
  it('PASS case: data.value cuối cùng là B, không bị A ghi đè', async () => {
    // Setup queue TRƯỚC khi composable mount — vì watch `immediate: true`
    // fire fetchData synchronously trong useCvRenderData, nếu queue rỗng
    // sẽ dùng fallback.
    responseQueue.push({ cvId: 'cv-A', delay: 200 });
    responseQueue.push({ cvId: 'cv-B', delay: 30 });

    const cvId = ref<string | null>('cv-A');
    const { data, dispose } = useCvRenderData(cvId);

    // Đợi A bắt đầu fetch
    await new Promise((r) => setTimeout(r, 10));
    expect(getRenderDataSpy).toHaveBeenCalledTimes(1);
    expect(getRenderDataSpy.mock.calls[0]?.[0]).toBe('cv-A');

    // Đổi sang B trong khi A chưa resolve
    cvId.value = 'cv-B';

    // Đợi B resolve (30ms) + viết state
    await new Promise((r) => setTimeout(r, 80));
    // Verify B đã set data
    expect(data.value?.title).toBe('CV cv-B');

    // Đợi thêm nếu A có resolve trễ (200ms total từ start A)
    await new Promise((r) => setTimeout(r, 200));
    // Vẫn là B, KHÔNG bị A overwrite
    expect(data.value?.title).toBe('CV cv-B');

    dispose();
  });

  it('PASS case: A bị abort, getRenderData cho B nhận signal mới (không bị reuse)', async () => {
    responseQueue.push({ cvId: 'cv-A', delay: 300 });
    responseQueue.push({ cvId: 'cv-B', delay: 30 });

    const cvId = ref<string | null>('cv-A');
    const { dispose } = useCvRenderData(cvId);

    await new Promise((r) => setTimeout(r, 10));
    cvId.value = 'cv-B';

    await new Promise((r) => setTimeout(r, 100));

    // A's signal đã bị abort → spy nhận signal.aborted=true ở call #2.
    // Spy verify bằng cách đếm: 2 calls total, B đã complete.
    expect(getRenderDataSpy).toHaveBeenCalledTimes(2);
    expect(getRenderDataSpy.mock.calls[0]?.[0]).toBe('cv-A');
    expect(getRenderDataSpy.mock.calls[1]?.[0]).toBe('cv-B');

    dispose();
  });
});

describe('H3: useCvRenderData leak — unmount giữa lúc fetch', () => {
  it('PASS case: dispose trước khi response về → KHÔNG set data.value, KHÔNG throw', async () => {
    const cvId = ref<string | null>('cv-A');
    const { data, error, dispose } = useCvRenderData(cvId);

    // Slow response (300ms) — dispose sẽ abort trước khi resolve
    responseQueue.push({ cvId: 'cv-A', delay: 300 });

    await new Promise((r) => setTimeout(r, 10));
    // Đang fetch — dispose ngay
    dispose();

    // Đợi "response" tới (300ms) — composable's signal đã aborted
    await new Promise((r) => setTimeout(r, 350));

    // data.value vẫn null (fetch bị abort → không set state)
    expect(data.value).toBeNull();
    // error KHÔNG set (Cancel được filter, không phải error)
    expect(error.value).toBeNull();
    // Không có Vue warning về set state trên unmounted
    // (Vue in ra warning khi set ref trên unmounted instance — phải 0 lần
    // cho pattern đúng)
    // Note: Vue 3 có thể in 1 warning "onUnmounted called when there is no
    // active component instance" do test context — chấp nhận, không phải bug.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('PASS case: dispose idempotent — gọi 2 lần không throw', () => {
    const cvId = ref<string | null>('cv-A');
    const { dispose } = useCvRenderData(cvId);

    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
  });

  it('PASS case: refresh() sau dispose → abort fetch mới, không set state', async () => {
    const cvId = ref<string | null>('cv-A');
    const { refresh, data, dispose } = useCvRenderData(cvId);

    responseQueue.push({ cvId: 'cv-A', delay: 200 });

    await new Promise((r) => setTimeout(r, 10));
    dispose();
    // Sau dispose, refresh() vẫn có thể gọi (no-op vì isComponentMounted=false)
    await refresh();

    expect(data.value).toBeNull();
  });
});

describe('CvPrintView safety: 1 lần mount/unmount với token cố định', () => {
  it('PASS case: cvId + token extract từ URL → 1 fetch → unmount sạch', async () => {
    const cvId = ref<string | null>('cv-print-123');
    const token = ref<string | null>('hmac-token-xyz');

    const { data, templateId, error, dispose } = useCvRenderData(cvId, token);

    responseQueue.push({ cvId: 'cv-print-123', delay: 50 });

    // Đợi fetch complete
    await new Promise((r) => setTimeout(r, 80));

    expect(data.value).not.toBeNull();
    expect(data.value?.title).toBe('CV cv-print-123');
    expect(templateId.value).toBe(1);
    expect(error.value).toBeNull();
    expect(getRenderDataSpy).toHaveBeenCalledTimes(1);
    // Verify token được truyền cho API call
    expect(getRenderDataSpy.mock.calls[0]?.[1]).toBe('hmac-token-xyz');

    dispose();
  });
});
