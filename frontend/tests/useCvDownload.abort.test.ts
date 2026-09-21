// @vitest-environment happy-dom
/**
 * Test Bug M1: AbortError từ timeout 30s không bị catch nhầm thành
 * "Tải CV thất bại. Vui lòng thử lại." — phải hiện warning riêng.
 *
 * Approach: dùng REAL Pinia toast store (setActivePinia + createPinia),
 * verify bằng cách đọc `store.toasts` sau khi gọi handleDownload.
 *
 *   - Mock `fetch` (composable dùng raw fetch cho upload CV để tránh CORS).
 *   - Mock `http.get` (composable dùng http cho direct CV — nhưng test này
 *     tập trung upload path vì chỉ path đó mới có AbortController timeout).
 *
 *   - Sau mỗi case, đọc `store.toasts` để xác nhận:
 *     • Có 1 toast đúng level (warning cho timeout, error cho network).
 *     • Message chứa đúng nội dung kỳ vọng.
 *
 * Verify regression:
 *   - 4 throttle test cũ vẫn pass (chạy riêng — file này không touch throttle).
 *   - Network error thật → toast.error (giữ nguyên behavior).
 *
 * Module-level `lastActionAt` (Bug 2 throttle): reset qua `vi.resetModules()` +
 * dynamic import trong beforeEach.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useToastStore } from '@stores/toast';
import type { Cv } from '@/types/cv';

const cvUpload: Cv = {
  id: 'cv-upload-1',
  candidateId: 'c1',
  title: 'Test Upload',
  fileUrl: 'http://example.com/large-file.pdf',
  fileType: 'application/pdf',
  isPrimary: false,
  status: 'ready',
  source: 'upload',
  templateId: null,
  parsedData: null,
  ai_analysis: null,
  failureReason: null,
  scoreUpdatedAt: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('Bug M1: AbortError (timeout 30s) không hiện "Tải thất bại"', () => {
  let useCvDownload: typeof import('@/composables/useCvDownload').useCvDownload;
  let toast: ReturnType<typeof useToastStore>;

  beforeEach(async () => {
    // Pinia: reset trước mỗi test → store.toasts = []
    setActivePinia(createPinia());
    toast = useToastStore();

    // Module reset để `lastActionAt` (Bug 2 throttle) về 0
    vi.resetModules();
    const mod = await import('@/composables/useCvDownload');
    useCvDownload = mod.useCvDownload;

    // Mock fetch + http — fresh per test
    vi.mocked(global.fetch).mockReset?.();
    vi.restoreAllMocks();
  });

  it('PASS case: fetch reject với AbortError → toast level=warning timeout (KHÔNG error)', async () => {
    // Mock fetch reject AbortError — simulate timeout đã fire
    global.fetch = vi.fn().mockImplementation(
      async (_url: string, _opts?: { signal?: AbortSignal }) => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
    );

    const { handleDownload } = useCvDownload();
    await handleDownload(cvUpload);

    // Verify store.toasts có 1 entry level='warning'
    expect(toast.toasts).toHaveLength(1);
    expect(toast.toasts[0]?.level).toBe('warning');
    expect(toast.toasts[0]?.message).toContain('Quá thời gian chờ tải CV');

    // Verify KHÔNG có toast level='error' (đây là bug trước fix)
    expect(toast.toasts.some((t) => t.level === 'error')).toBe(false);

    // Verify KHÔNG có toast level='success' (vì không tải thành công)
    expect(toast.toasts.some((t) => t.level === 'success')).toBe(false);
  });

  it('PASS case: fetch reject với network error → toast level=error "Tải thất bại"', async () => {
    // Mock fetch reject generic error (network down, DNS fail, etc.)
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    const { handleDownload } = useCvDownload();
    await handleDownload(cvUpload);

    // toast level='error' phải có, message đúng
    expect(toast.toasts).toHaveLength(1);
    expect(toast.toasts[0]?.level).toBe('error');
    expect(toast.toasts[0]?.message).toBe('Tải CV thất bại. Vui lòng thử lại.');

    // KHÔNG có toast warning
    expect(toast.toasts.some((t) => t.level === 'warning')).toBe(false);
  });

  it('PASS case: throttle blocked → toast level=warning throttle (KHÔNG AbortError)', async () => {
    // Lần 1: thành công (set lastActionAt)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake'])),
    });

    const A = useCvDownload();
    const B = useCvDownload();

    // A đi qua throttle, fetch OK
    await A.handleDownload(cvUpload);
    expect(toast.toasts).toHaveLength(1);
    expect(toast.toasts[0]?.level).toBe('success');
    expect(toast.toasts[0]?.message).toBe('Đã tải CV.');

    // B bị throttle (lastActionAt < 2s ago) → return ngay, KHÔNG call fetch
    await B.handleDownload(cvUpload);

    // Store giờ có 2 toasts: success (A) + warning throttle (B)
    expect(toast.toasts).toHaveLength(2);
    expect(toast.toasts[1]?.level).toBe('warning');
    expect(toast.toasts[1]?.message).toBe('Bạn vừa thao tác. Vui lòng đợi vài giây.');

    // QUAN TRỌNG: toast timeout (AbortError) KHÔNG có trong queue — verify
    // bug cũ + bug M1 không lẫn. Nếu có message chứa "Quá thời gian" → bug.
    expect(
      toast.toasts.some((t) => t.message.includes('Quá thời gian')),
    ).toBe(false);
  });

  it('PASS case: HTTP error response (500) → toast level=error, không AbortError', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { handleDownload } = useCvDownload();
    await handleDownload(cvUpload);

    expect(toast.toasts).toHaveLength(1);
    expect(toast.toasts[0]?.level).toBe('error');
    expect(toast.toasts[0]?.message).toBe('Tải CV thất bại. Vui lòng thử lại.');
    expect(toast.toasts.some((t) => t.message.includes('Quá thời gian'))).toBe(
      false,
    );
  });

  it('PASS case: fetch thành công → toast level=success (sanity check)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake'])),
    });

    const { handleDownload } = useCvDownload();
    await handleDownload(cvUpload);

    expect(toast.toasts).toHaveLength(1);
    expect(toast.toasts[0]?.level).toBe('success');
    expect(toast.toasts[0]?.message).toBe('Đã tải CV.');
  });
});
