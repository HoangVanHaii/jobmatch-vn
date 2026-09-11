// @vitest-environment happy-dom
/**
 * Integration test: mount CvPreview.vue thật + mock docx-preview + mock services.
 *
 * Mục tiêu:
 *   - Component mount không throw (template + composables chain OK).
 *   - Đổi prop `open: false → true` với cv là DOCX → composable's loadDocx
 *     chạy tới renderAsync đúng 1 lần (dùng renderAsyncSpy làm proxy).
 *   - Đổi CV trong khi modal đang mở (DOCX → DOCX khác) → renderAsync được
 *     gọi 2 lần (lần 1 bị abort ở check signal, lần 2 hoàn thành).
 *
 * Tại sao cần test này:
 *   - Composables unit test (cvPreview.docx.test.ts) chỉ verify useDocxRenderer
 *     cô lập. Component test verify:
 *       - Template ref="docxIframeRef" bind đúng ref từ composable.
 *       - Watch trigger đúng khi prop open đổi.
 *       - Toàn bộ chain component → composable → dynamic import → iframe.
 *
 * Mock strategy:
 *   - `docx-preview`     → renderAsync spy (proxy cho "loadDocx đã chạy tới render").
 *   - `@stores/toast`    → Pinia store stub (tránh setup Pinia instance).
 *   - `@/services/cv.api` → stub getRenderData (useCvRenderData dùng; modal mode
 *                           thực tế không call, nhưng watch vẫn trigger 1 lần
 *                           với cvId=null → set error 'Thiếu cvId' — không ảnh
 *                           hưởng vì `!isModal` guard ở component watch).
 *   - `@/services/http`  → stub get (useCvDownload dùng; modal này không bấm
 *                           download nên không call).
 *   - `global.fetch`     → mock thẳng (useDocxRenderer dùng fetch trực tiếp).
 */
import { mount, flushPromises } from '@vue/test-utils';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CvPreview from '@/components/cv/CvPreview.vue';
import type { Cv } from '@/types/cv';

const { renderAsyncSpy, consoleErrorSpy } = vi.hoisted(() => ({
  renderAsyncSpy: vi.fn(),
  consoleErrorSpy: vi.spyOn(console, 'error').mockImplementation(() => {}),
}));

vi.mock('@stores/toast', () => ({
  useToastStore: () => ({
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/services/cv.api', () => ({
  cvApi: {
    getRenderData: vi.fn().mockResolvedValue({
      data: { source: 'direct', templateId: 1, parsedData: {}, title: 'stub' },
    }),
  },
}));

vi.mock('@/services/http', () => ({
  http: { get: vi.fn().mockRejectedValue(new Error('mocked network')) },
}));

vi.mock('docx-preview', () => ({
  renderAsync: renderAsyncSpy,
}));

const docxCv: Cv = {
  id: 'cv-docx-1',
  candidateId: 'c1',
  title: 'Test DOCX',
  fileUrl: 'http://example.com/test.docx',
  fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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

beforeEach(() => {
  renderAsyncSpy.mockReset();
  renderAsyncSpy.mockResolvedValue(undefined);
  consoleErrorSpy.mockClear();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['fake docx content'])),
  });
});

describe('Integration: CvPreview.vue + useDocxRenderer', () => {
  it('PASS: Component mount không throw với prop open=false', async () => {
    const wrapper = mount(CvPreview, {
      props: { open: false, cv: docxCv },
    });

    await flushPromises();
    // Không có console.error nào
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('PASS: open false → true với DOCX → renderAsync được gọi đúng 1 lần', async () => {
    renderAsyncSpy.mockImplementation(async (_blob, container) => {
      container.setAttribute('data-render', 'docx-content');
    });

    const wrapper = mount(CvPreview, {
      props: { open: false, cv: docxCv },
    });
    await flushPromises();

    // open=false → watch không trigger loadDocx
    expect(renderAsyncSpy).not.toHaveBeenCalled();

    // Mở modal
    await wrapper.setProps({ open: true });
    await flushPromises();
    // Đợi dynamic import + renderAsync resolve
    await new Promise((r) => setTimeout(r, 100));

    // loadDocx đã chạy tới renderAsync (proxy: spy được gọi)
    expect(renderAsyncSpy).toHaveBeenCalledTimes(1);

    // Component không có lỗi runtime
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('PASS: docxIframeRef từ composable bind đúng vào <iframe ref="docxIframeRef">', async () => {
    renderAsyncSpy.mockImplementation(async (_blob, container) => {
      container.setAttribute('data-render', 'docx-content');
    });

    const wrapper = mount(CvPreview, {
      props: { open: false, cv: docxCv },
      attachTo: document.body, // cần attach để teleport + ref binding hoạt động
    });
    await wrapper.setProps({ open: true });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 100));

    // Tìm iframe DOCX trong DOM (sandbox + ref binding)
    const iframe = document.querySelector(
      'iframe[title="DOCX preview"]',
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-same-origin');

    // Iframe phải có contentDocument (sandbox allow-same-origin) → renderAsync
    // đã viết nội dung vào document.
    const body = iframe?.contentDocument?.body;
    expect(body?.innerHTML).toContain('data-render="docx-content"');

    wrapper.unmount();
  });

  it('PASS: đổi CV DOCX trong khi modal mở → renderAsync được gọi 2 lần (abort + render mới)', async () => {
    const renderOrder: string[] = [];
    let callIndex = 0;
    renderAsyncSpy.mockImplementation(async (_blob, container) => {
      const idx = callIndex++;
      const tag = idx === 0 ? 'A' : 'B';
      container.setAttribute('data-render', tag);
      await new Promise((r) => setTimeout(r, 80));
      renderOrder.push(tag);
    });

    const docxCvB: Cv = {
      ...docxCv,
      id: 'cv-docx-2',
      title: 'Test DOCX B',
      fileUrl: 'http://example.com/test-b.docx',
    };

    const wrapper = mount(CvPreview, {
      props: { open: true, cv: docxCv },
      attachTo: document.body,
    });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 30)); // renderAsync A bắt đầu

    // Đổi sang CV B trong khi A đang render
    await wrapper.setProps({ cv: docxCvB });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 200));

    // renderAsync A + B đều chạy (lib không cancel mid-await), abort signal
    // ở check sau renderAsync → A không set success, B mới set success.
    expect(renderOrder).toEqual(['A', 'B']);
    expect(renderAsyncSpy).toHaveBeenCalledTimes(2);

    // DOM cuối cùng phải là của B
    const iframe = document.querySelector(
      'iframe[title="DOCX preview"]',
    ) as HTMLIFrameElement | null;
    expect(iframe?.contentDocument?.body.innerHTML).toContain('data-render="B"');

    wrapper.unmount();
  });

  it('PASS: đóng modal (open=true → false) → component unmount sạch, không lỗi', async () => {
    renderAsyncSpy.mockImplementation(async () => {
      // Slow render — đóng modal giữa lúc đang render
      await new Promise((r) => setTimeout(r, 300));
    });

    const wrapper = mount(CvPreview, {
      props: { open: true, cv: docxCv },
      attachTo: document.body,
    });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50));

    // Đóng modal giữa lúc renderAsync đang chạy
    await wrapper.setProps({ open: false });
    await flushPromises();

    // Đợi renderAsync "hoàn thành" (300ms)
    await new Promise((r) => setTimeout(r, 400));

    // Component không throw lỗi runtime
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});
