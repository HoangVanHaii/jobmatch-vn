// @vitest-environment happy-dom
/**
 * Test Bug 2: throttle state MUST be shared between separate useCvDownload()
 * instances. Trước fix: mỗi composable instance tạo closure `lastActionAt` riêng
 * → user bypass throttle bằng cách đổi qua lại giữa modal và menu. Sau fix:
 * lastActionAt ở module-level → mọi instance share state.
 *
 * Lưu ý: `lastActionAt` là module-level, persist giữa các test. Mỗi test dùng
 * `vi.resetModules()` + dynamic import để reset về 0, đảm bảo test độc lập.
 *
 * Env: happy-dom vì `window.open()` được gọi trong handleOpenOriginal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cv } from '@/types/cv';

const { httpGetSpy, toastCalls } = vi.hoisted(() => ({
  httpGetSpy: vi.fn().mockRejectedValue(new Error('mocked network error')),
  toastCalls: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('vue', () => ({
  ref: <T,>(v: T) => ({ value: v }),
  computed: <T,>(fn: () => T) => ({ get value() { return fn(); } }),
}));

vi.mock('@/services/http', () => ({
  http: { get: httpGetSpy },
}));

vi.mock('@stores/toast', () => ({
  useToastStore: () => toastCalls,
}));

const cvDirect: Cv = {
  id: 'cv-test-1',
  candidateId: 'c1',
  title: 'Test CV',
  fileUrl: null,
  fileType: null,
  isPrimary: false,
  status: 'ready',
  source: 'direct',
  templateId: 1,
  parsedData: null,
  ai_analysis: null,
  failureReason: null,
  scoreUpdatedAt: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('Bug 2: throttle shared across useCvDownload instances', () => {
  // Dynamic import inside beforeEach để vi.resetModules() reset module-level
  // `lastActionAt` về 0 mỗi test.
  let useCvDownload: typeof import('@/composables/useCvDownload').useCvDownload;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/composables/useCvDownload');
    useCvDownload = mod.useCvDownload;
    toastCalls.warning.mockClear();
    toastCalls.success.mockClear();
    toastCalls.error.mockClear();
    httpGetSpy.mockClear();
  });

  it('PASS case: instance B is throttled when called within 2s of instance A', async () => {
    const A = useCvDownload();
    const B = useCvDownload();

    const promiseA = A.handleDownload(cvDirect);
    const promiseB = B.handleDownload(cvDirect);

    await Promise.all([promiseA, promiseB]);

    // B phải bị throttle (toast.warning), A đi qua throttle nhưng fail ở fetch (mock)
    expect(toastCalls.warning).toHaveBeenCalledTimes(1);
    expect(toastCalls.warning).toHaveBeenCalledWith(
      'Bạn vừa thao tác. Vui lòng đợi vài giây.',
    );
    // http.get chỉ được gọi 1 lần (cho A), B không tới được
    expect(httpGetSpy).toHaveBeenCalledTimes(1);
  });

  it('after 2.1s wait, instance B is allowed again', async () => {
    const A = useCvDownload();
    const B = useCvDownload();

    await A.handleDownload(cvDirect);
    expect(toastCalls.warning).not.toHaveBeenCalled();

    // Wait > MIN_DOWNLOAD_INTERVAL_MS (2s)
    await new Promise((r) => setTimeout(r, 2100));

    await B.handleDownload(cvDirect);
    expect(toastCalls.warning).not.toHaveBeenCalled();
    // http.get được gọi 2 lần (mỗi instance 1 lần)
    expect(httpGetSpy).toHaveBeenCalledTimes(2);
  });

  it('3 instances (modal + 2 menu items) all share throttle', async () => {
    const A = useCvDownload();
    const B = useCvDownload();
    const C = useCvDownload();

    const pA = A.handleDownload(cvDirect);
    const pB = B.handleDownload(cvDirect);
    const pC = C.handleDownload(cvDirect);

    await Promise.all([pA, pB, pC]);

    expect(toastCalls.warning).toHaveBeenCalledTimes(2); // B + C
    expect(httpGetSpy).toHaveBeenCalledTimes(1); // chỉ A
  });

  it('handleOpenOriginal also shares throttle with handleDownload', async () => {
    const A = useCvDownload();
    const B = useCvDownload();

    // A: mở file gốc (chỉ cần fileUrl, không cần fetch)
    A.handleOpenOriginal({
      ...cvDirect,
      source: 'upload',
      fileUrl: 'http://example.com/cv.pdf',
      fileType: 'application/pdf',
    });

    // B: ngay sau đó gọi handleDownload → phải throttle
    await B.handleDownload(cvDirect);

    expect(toastCalls.warning).toHaveBeenCalledTimes(1);
    expect(toastCalls.warning).toHaveBeenCalledWith(
      'Bạn vừa thao tác. Vui lòng đợi vài giây.',
    );
    expect(httpGetSpy).not.toHaveBeenCalled(); // B bị throttle
  });
});
