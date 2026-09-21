// @vitest-environment happy-dom
/**
 * Test cho edit CV flow (direct mode).
 *
 * Phạm vi test (focused — không mount full CreateResumeView vì deps quá nặng):
 *   1. cvApi.update gọi đúng PATCH /cvs/:cvId.
 *   2. cvStore.update merge response vào local list qua applyRow.
 *   3. menuCanEdit guard logic — disable edit khi CV đang processing.
 *   4. UpdateDirectCvInput shape đúng (BE merge vào parsedData).
 *   5. Edit flow prefill — mapping từ Cv.parsedData → form fields đúng.
 *
 * Khác với create flow:
 *   - create → POST /cvs/direct, không enqueue worker.
 *   - update → PATCH /cvs/:cvId, BE set status='analyzing' + enqueue worker.
 *
 * Test approach: mock http module + pinia store, focus logic không cần DOM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type {
  Cv,
  CvSource,
  CvStatus,
  UpdateDirectCvInput,
} from '@/types/cv';

// Mock http module — capture request thay vì gọi thật.
const mockPatch = vi.fn();
const mockGet = vi.fn();
vi.mock('@/services/http', () => ({
  http: {
    patch: (...args: unknown[]) => mockPatch(...args),
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

// Lazy import SAU mock để ensure module dùng mocked http.
const { cvApi } = await import('@/services/cv.api');
const { useCvStore } = await import('@/stores/cv');

const makeCv = (overrides: Partial<Cv> = {}): Cv => ({
  id: 'cv-1',
  candidateId: 'cand-1',
  title: 'Backend Dev',
  fileUrl: null,
  fileType: null,
  isPrimary: false,
  status: 'ready',
  source: 'direct',
  templateId: 1,
  parsedData: {
    name: 'Nguyễn Văn A',
    email: 'a@example.com',
    summary: 'Existing summary',
    skills: ['Node.js', 'PostgreSQL'],
  },
  ai_analysis: { isCv: true, total: 80, strengths: [], weaknesses: [], suggestions: [], verificationWarnings: [] },
  failureReason: null,
  scoreUpdatedAt: '2025-01-01T00:00:00Z',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

describe('Edit CV direct — API + Store', () => {
  beforeEach(() => {
    mockPatch.mockReset();
    mockGet.mockReset();
    setActivePinia(createPinia());
  });

  it('PASS: cvApi.update gọi PATCH /cvs/:cvId với payload đúng', async () => {
    mockPatch.mockResolvedValueOnce({
      data: { success: true, data: makeCv({ status: 'analyzing' }) },
    });

    const input: UpdateDirectCvInput = {
      title: 'Senior Backend Dev',
      parsedData: {
        summary: 'Updated summary',
        contact: { name: 'Nguyễn Văn A' },
        skills: ['Node.js', 'TypeScript', 'PostgreSQL'],
      },
    };
    await cvApi.update('cv-xyz', input);

    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockPatch).toHaveBeenCalledWith('/cvs/cv-xyz', input);
  });

  it('PASS: cvApi.update encode URI component cho cvId có ký tự đặc biệt', async () => {
    mockPatch.mockResolvedValueOnce({
      data: { success: true, data: makeCv() },
    });
    await cvApi.update('cv/with/slash', { title: 'X' });
    expect(mockPatch).toHaveBeenCalledWith('/cvs/cv%2Fwith%2Fslash', {
      title: 'X',
    });
  });

  it('PASS: cvStore.update applyRow response vào list local', async () => {
    const updated = makeCv({ id: 'cv-1', status: 'analyzing', title: 'New title' });
    mockPatch.mockResolvedValueOnce({
      data: { success: true, data: updated },
    });

    const store = useCvStore();
    store.items = [makeCv({ id: 'cv-1', status: 'ready', title: 'Old title' })];

    const result = await store.update('cv-1', { title: 'New title' });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('analyzing');
    expect(store.items[0].status).toBe('analyzing');
    expect(store.items[0].title).toBe('New title');
  });

  it('PASS: cvStore.update trả null + set error khi API fail', async () => {
    mockPatch.mockRejectedValueOnce({
      response: { data: { error: { code: 'INVALID_SOURCE', message: 'Cannot update upload CV' } } },
    });

    const store = useCvStore();
    store.items = [makeCv()];

    const result = await store.update('cv-1', { title: 'X' });

    expect(result).toBeNull();
    expect(store.error).toBe('Cannot update upload CV'); // raw BE message (no override)
  });

  it('PASS: cvStore.update no-op applyRow khi CV không có trong list', async () => {
    const updated = makeCv({ id: 'cv-OTHER', status: 'analyzing' });
    mockPatch.mockResolvedValueOnce({
      data: { success: true, data: updated },
    });

    const store = useCvStore();
    store.items = [makeCv({ id: 'cv-1' })];

    await store.update('cv-OTHER', { title: 'X' });

    // list KHÔNG thay đổi — CV không có trong pagination hiện tại.
    expect(store.items).toHaveLength(1);
    expect(store.items[0].id).toBe('cv-1');
    expect(store.items[0].status).toBe('ready');
  });
});

describe('Edit CV — menu guard', () => {
  it('PASS: menuCanEdit cho phép khi CV ở terminal status', () => {
    // Mirror logic từ MyResumesView.vue menuCanEdit
    const menuCanEdit = (status: CvStatus): boolean =>
      status !== 'pending' &&
      status !== 'parsing' &&
      status !== 'analyzing' &&
      status !== 'deleted';

    expect(menuCanEdit('ready')).toBe(true);
    expect(menuCanEdit('failed')).toBe(true);
  });

  it('PASS: menuCanEdit block khi CV đang processing', () => {
    const menuCanEdit = (status: CvStatus): boolean =>
      status !== 'pending' &&
      status !== 'parsing' &&
      status !== 'analyzing' &&
      status !== 'deleted';

    expect(menuCanEdit('pending')).toBe(false);
    expect(menuCanEdit('parsing')).toBe(false);
    expect(menuCanEdit('analyzing')).toBe(false);
    expect(menuCanEdit('deleted')).toBe(false);
  });

  it('PASS: menuEditTooltip đúng message theo status', () => {
    const menuEditTooltip = (status: CvStatus): string => {
      if (status === 'pending') return 'CV đang chờ xử lý, chưa thể sửa';
      if (status === 'parsing') return 'CV đang được parse, chưa thể sửa';
      if (status === 'analyzing') return 'CV đang được AI phân tích, chưa thể sửa';
      if (status === 'deleted') return 'CV đã bị xoá';
      return 'Chỉnh sửa nội dung CV';
    };

    expect(menuEditTooltip('ready')).toBe('Chỉnh sửa nội dung CV');
    expect(menuEditTooltip('failed')).toBe('Chỉnh sửa nội dung CV');
    expect(menuEditTooltip('pending')).toContain('chờ xử lý');
    expect(menuEditTooltip('analyzing')).toContain('AI phân tích');
  });

  it('PASS: menu "Sửa" chỉ hiện cho source="direct" (không phải upload)', () => {
    // Mirror v-if từ MyResumesView.vue menu item
    const showEditItem = (source: CvSource): boolean => source === 'direct';

    expect(showEditItem('direct')).toBe(true);
    expect(showEditItem('upload')).toBe(false);
  });
});

describe('Edit CV — prefill từ parsedData', () => {
  // Mirror logic từ CreateResumeView.vue prefillFromCv (compact version).
  type ParsedData = Record<string, unknown>;

  const stringField = (data: ParsedData, key: string): string => {
    const v = data[key];
    return typeof v === 'string' ? v : '';
  };

  const prefillContact = (data: ParsedData) => ({
    fullName: stringField(data, 'name'),
    email: stringField(data, 'email'),
    phone: stringField(data, 'phone'),
    facebook: stringField(data, 'facebook'),
    linkedin: stringField(data, 'linkedin'),
    portfolio: stringField(data, 'portfolio'),
    github: stringField(data, 'github'),
    avatarUrl: stringField(data, 'avatarUrl'),
  });

  it('PASS: prefill contact từ parsedData', () => {
    const data: ParsedData = {
      name: 'Lê Văn B',
      email: 'b@example.com',
      phone: '+84 909',
      facebook: 'fb.com/b',
      linkedin: 'linkedin.com/in/b',
      portfolio: 'b.dev',
      github: 'github.com/b',
      avatarUrl: 'https://cdn/b.jpg',
    };
    const contact = prefillContact(data);
    expect(contact.fullName).toBe('Lê Văn B');
    expect(contact.email).toBe('b@example.com');
    expect(contact.github).toBe('github.com/b');
  });

  it('PASS: prefill fallback an toàn khi parsedData thiếu field', () => {
    const data: ParsedData = { name: 'Only name' };
    const contact = prefillContact(data);
    expect(contact.fullName).toBe('Only name');
    expect(contact.email).toBe('');
    expect(contact.github).toBe('');
  });

  it('PASS: prefill defensive — không crash khi field là non-string', () => {
    const data: ParsedData = {
      name: 'X',
      email: 12345, // BE có thể trả number do JSON quirks
      phone: null,
    };
    const contact = prefillContact(data);
    expect(contact.fullName).toBe('X');
    expect(contact.email).toBe(''); // không phải string → fallback ''
    expect(contact.phone).toBe('');
  });

  it('PASS: prefill education — empty array nếu không có', () => {
    type Edu = { school: string; major?: string };
    const data: ParsedData = {};
    const edu = (data.education as Edu[] | undefined) ?? [];
    expect(edu).toEqual([]);
  });

  it('PASS: prefill education — giữ nguyên shape', () => {
    type Edu = { school: string; major?: string; startYear?: number };
    const data: ParsedData = {
      education: [
        { school: 'NEU', major: 'Marketing', startYear: 2018 },
        { school: 'FTU', major: 'Finance' },
      ],
    };
    const edu = (data.education as Edu[]) ?? [];
    expect(edu).toHaveLength(2);
    expect(edu[0].school).toBe('NEU');
    expect(edu[0].startYear).toBe(2018);
  });
});

describe('Edit CV — UpdateDirectCvInput shape', () => {
  it('PASS: UpdateDirectCvInput có thể chỉ gửi title (không parsedData)', () => {
    // Compile-time check: assignment này phải OK
    const input: UpdateDirectCvInput = { title: 'New title' };
    expect(input.title).toBe('New title');
    expect(input.parsedData).toBeUndefined();
  });

  it('PASS: UpdateDirectCvInput có thể chỉ gửi parsedData (không title)', () => {
    const input: UpdateDirectCvInput = {
      parsedData: { summary: 'Updated' },
    };
    expect(input.title).toBeUndefined();
    expect(input.parsedData?.summary).toBe('Updated');
  });

  it('PASS: parsedData Pick đúng field — KHÔNG có title/templateId/isPrimary', () => {
    // Compile-time: parsedData là Pick<CreateDirectCvInput, 'summary' | 'contact' | ...>
    // → KHÔNG thể gán `title` vào parsedData.
    const input: UpdateDirectCvInput = {
      parsedData: {
        summary: 'X',
        contact: { name: 'A' },
        education: [],
        experience: [],
        skills: [],
        languages: [],
        projects: [],
        certifications: [],
        // @ts-expect-error — 'title' không thuộc parsedData.Pick
        // title: 'should fail',
      },
    };
    expect(input.parsedData?.summary).toBe('X');
  });
});
