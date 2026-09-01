<script setup lang="ts">
/**
 * MyResumesView — trang quản lý CV của candidate.
 *
 * BEHAVIOR (KHÔNG ĐỔI, chỉ đổi UI):
 *  - Filter theo source (server-side, query string): all | upload | direct
 *  - Pagination (server-side): ?limit, ?offset
 *  - Search client-side theo title
 *  - Open preview (click card hoặc menu "Xem chi tiết")
 *  - Set primary (in preview modal + quick-action trên card)
 *  - Re-analyze bằng AI (quick-action trên card, chỉ khi ready/failed)
 *  - Soft delete + confirm
 *  - Socket cv:status-changed → patch list + refresh detail khi ready
 *
 * UI/UX redesign v3 — "document workspace" polish pass:
 *  - Toolbar/filter làm lại: tab có icon riêng cho từng loại nguồn,
 *    chip "Xoá lọc" hiện khi có filter/search đang active
 *  - Thumbnail CV thật vẫn là trung tâm, hiệu ứng "xếp chồng giấy" bằng box-shadow
 *  - Dải màu trạng thái mảnh ở mép trên card
 *  - Quick-actions (Đặt chính / Phân tích lại) nổi trên thumbnail, gọn trong dropdown ⋮ còn Xem/Xóa
 *  - Skeleton loading, transition mượt cho modal
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import {
  FileText,
  Plus,
  Upload,
  Eye,
  Star,
  Loader2,
  AlertCircle,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Search,
  MoreVertical,
  Brain,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Download,
  ExternalLink,
} from 'lucide-vue-next';
import { useCvStore } from '@stores/cv';
import { usePlanStore } from '@stores/plan';
import { useCvDownload } from '@/composables/useCvDownload';
import CvPreview from '@components/cv/CvPreview.vue';
import CvThumbnail from '@components/cv/thumbnails/CvThumbnail.vue';
import CvAiAnalysisView from '@components/cv/CvAiAnalysisView.vue';
import type { CvSource, CvStatus, Cv, CvFailureReason } from '@/types/cv';
import { getAiScore } from '@/types/cv';
import { scoreLabel } from '@/utils/aiScore';
import { useSocket } from '@composables/useSocket';

const router = useRouter();
const cvStore = useCvStore();
const planStore = usePlanStore();
const { items, total, page, pageSize, totalPages, loading, error } = storeToRefs(cvStore);

// Set loading=true NGAY TRONG setup() — trước frame render đầu tiên —
// để spinner loading hiện ra thay vì empty state "Bạn chưa có CV nào" flash
// trong tích tắc (khi `loading=false` initial → render empty → onMounted
// fire → loading=true → re-render spinner). Set ở đây đảm bảo frame đầu
// đã là spinner.
cvStore.loading = true;

/* ============================================================================
 * Filter theo source — server-side qua query string.
 * Search theo title — server-side (?q=), FE debounce 400ms trước khi gọi
 * → mỗi lần user gõ là 1 round-trip DB, không phải filter 1000+ row ở client.
 * ==========================================================================*/
const sourceFilter = ref<'all' | CvSource>('all');
const searchQuery = ref('');

const sourceOptions: Array<{ value: 'all' | CvSource; label: string; shortLabel: string }> = [
  { value: 'all', label: 'Tất cả', shortLabel: 'Tất cả' },
  { value: 'upload', label: 'CV Upload', shortLabel: 'Upload' },
  { value: 'direct', label: 'CV tạo trực tiếp', shortLabel: 'Trực tiếp' },
];

const sourceToQuery = (s: 'all' | CvSource): CvSource | undefined =>
  s === 'all' ? undefined : s;

const loadList = async () => {
  // Preserve current search across re-mount / route return.
  await cvStore.fetchList(sourceToQuery(sourceFilter.value), undefined, undefined);
};

const handleSourceChange = async (s: 'all' | CvSource) => {
  sourceFilter.value = s;
  // Khi chuyển sang tab 'all' (source=undefined), phải truyền resetFilters=true
  // để store clear query.source — vì mặc định fetchList coi undefined =
  // "giữ nguyên source hiện tại" (cơ chế dùng cho watch(searchQuery) để search
  // không reset tab). Nếu không có flag này, click 'Tất cả' từ tab Upload/Direct
  // sẽ bị stuck filter theo tab cũ.
  await cvStore.fetchList(sourceToQuery(s), 1, undefined, s === 'all');
};

const goToPage = async (p: number) => {
  const target = Math.min(Math.max(1, p), totalPages.value);
  if (target === page.value) return;
  await cvStore.fetchList(sourceToQuery(sourceFilter.value), target, undefined);
};

onMounted(loadList);
onMounted(() => {
  // Fetch quota usage song song — populate planStore.usage để hasQuota() đúng.
  // Không await: nếu chậm, list CV vẫn hiện; quota check kích hoạt sau khi data về.
  void planStore.fetchMyUsage();
});
watch(() => router.currentRoute.value.fullPath, () => loadList());

/* ============================================================================
 * Search debounce 400ms — gọi BE ?q= thay vì filter client.
 *
 * Lý do:
 *   - 100+ CV thì filter client OK; nếu user có 5000 CV thì download cả trang
 *     về rồi filter .includes() → lag. Đẩy xuống DB (ILIKE %q%) tận dụng index.
 *   - Mỗi keystroke không nên spam 1 request. 400ms = đủ người dùng dừng tay,
 *     đủ ngắn để không cảm thấy chậm.
 *
 * Trim trước khi gửi để ' ' (space-only) được BE coi là no-search (validator
 * đã reject nhưng vẫn trim để phòng).
 * ==========================================================================*/
let searchTimer: ReturnType<typeof setTimeout> | null = null;
const SEARCH_DEBOUNCE_MS = 400;
watch(searchQuery, (val) => {
  if (searchTimer) clearTimeout(searchTimer);
  const trimmed = val.trim();
  // Empty sau trim → undefined (không gửi param `q`), vì BE validator
  // reject empty string là "Invalid input". undefined = no-search.
  const q = trimmed.length > 0 ? trimmed : undefined;
  searchTimer = setTimeout(() => {
    void cvStore.fetchList(undefined, undefined, q);
  }, SEARCH_DEBOUNCE_MS);
});
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

/* ============================================================================
 * Socket: BE worker / PATCH emit `cv:status-changed` khi status CV đổi.
 *
 * Payload gồm: cvId, status, failureReason (BE changeStatus gửi kèm — xem
 * cv.service.ts). QUAN TRỌNG: phải forward `failureReason` xuống store
 * updateStatus, không thì CV fail do quota sẽ mất reason ở local → strip
 * "Hết lượt" không hiện cho tới khi user F5 (lúc đó fetchList mới load
 * lại từ DB có reason). Bug này xảy ra vì listener cũ chỉ destructure
 * { cvId, status } rồi bỏ qua failureReason.
 *
 * Lưu ý: cv:quota-warning đăng ký ở App.vue (global) để SURVIVE navigation —
 * xem comment trong App.vue. Banner ở view này đọc từ store.
 * ==========================================================================*/
useSocket(
  'cv:status-changed',
  async (payload: { cvId: string; status: CvStatus; failureReason?: CvFailureReason | null }) => {
    const { cvId, status, failureReason } = payload;
    if (!cvId || !status) return;
    cvStore.updateStatus(cvId, status, failureReason ?? null);
    if (status === 'ready') {
      await cvStore.refreshDetail(cvId);
    }
  },
);

/* ============================================================================
 * Display helpers — tiny Tailwind classes cho status dot strip trên card.
 * ==========================================================================*/
const statusDotClass: Record<CvStatus, string> = {
  pending: 'bg-amber-500',
  parsing: 'bg-blue-500',
  ready: 'bg-emerald-500',
  failed: 'bg-red-500',
  deleted: 'bg-slate-300',
};

const getTemplateId = (cv: Cv): number | null => {
  if (cv.source !== 'direct') return null;
  const id = cv.templateId;
  return id !== null && id >= 1 && id <= 5 ? id : 1;
};

const fileTypeLabel = (cv: Cv): string => {
  const mime = (cv.fileType || '').toLowerCase();
  if (mime === 'application/pdf') return 'PDF';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword'
  ) return 'DOCX';
  if (mime.startsWith('image/')) return mime.replace('image/', '').toUpperCase();
  return 'FILE';
};

const getDisplayTitle = (cv: Cv): string => {
  if (cv.title && cv.title.trim().length > 0) return cv.title;
  return 'CV chưa đặt tên';
};

/** Subtitle ưu tiên:
 *  - direct: vị trí ứng tuyển từ parsedData (nếu có), fallback "CV tạo trực tiếp"
 *  - upload: "Tải lên — {mimetype}"
 */
const getSubtitle = (cv: Cv): string => {
  if (cv.source === 'direct') {
    const pos = ((cv.parsedData as Record<string, unknown> | null)?.position as string | undefined) ?? '';
    if (pos.trim()) return pos.trim();
    return 'CV tạo trực tiếp';
  }
  return `Tải lên — ${fileTypeLabel(cv)}`;
};

const formatDate = (cv: Cv): string => {
  const raw = cv.updatedAt || cv.createdAt;
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
};

/* ============================================================================
 * Card reason box — hiển thị LÝ DO inline ngay trên card (thay vì banner
 * chiếm chỗ phía trên hay modal riêng). Áp dụng cho mọi failureReason
 * persist trong DB (BE giữ qua reload — xem store/scanQuotaWarningFromItems).
 *
 * Tone mapping (theo palette mục 9 của spec):
 *   - red:    lỗi nghiêm trọng (parse fail, analysis fail) — user cần hành động.
 *   - amber:  cảnh báo quota (CV vẫn dùng được, điểm cũ giữ nguyên) — warning.
 *   - null:   không hiển thị box.
 *
 * Body text giải thích NGẮN để user hiểu lý do ngay, không phải click
 * "Chi tiết" mở modal → giảm friction. Format "Lý do: ..." cho failed,
 * ngắn gọn cho quota.
 * ==========================================================================*/
type ReasonBox = { tone: 'red' | 'amber'; title: string };

const cardReason = (cv: Cv): ReasonBox | null => {
  // 1. Parse quota fail (status=failed, không có parsedData — CV vô dụng)
  if (cv.status === 'failed' && cv.failureReason === 'quota_exceeded') {
    return {
      tone: 'red',
      title: 'Đã hết lượt upload CV',
    };
  }
  // 2. Parse error (network / bad content sau 3 retry BullMQ)
  if (cv.status === 'failed' && cv.failureReason === 'parse_error') {
    return {
      tone: 'red',
      title: 'Không thể xử lý CV',
    };
  }
  // 3. Invalid file (no fileUrl / fileType — validate fail)
  if (cv.status === 'failed' && cv.failureReason === 'invalid_file') {
    return {
      tone: 'red',
      title: 'File không hợp lệ',
    };
  }
  // 3b. Not a CV — AI detect nội dung không phải CV (vd. screenshot game, ảnh
  // ngẫu nhiên, tài liệu không liên quan). BE emit kèm status='failed' +
  // reason='not_a_cv' sau khi parse xong. Hiện message cụ thể để user hiểu
  // không phải lỗi kỹ thuật mà là sai nội dung.
  if (cv.status === 'failed' && cv.failureReason === 'not_a_cv') {
    return {
      tone: 'red',
      title: 'Nội dung không phải CV',
    };
  }
  // 4. Analysis quota fail (status=ready, điểm cũ vẫn được giữ trong DB).
  if (cv.status === 'ready' && cv.failureReason === 'quota_exceeded') {
    return {
      tone: 'amber',
      title: 'Đã hết lượt phân tích AI',
    };
  }
  // 5. Analysis error (sau retry exhausted — BE giữ reason trong DB)
  if (cv.failureReason === 'analysis_error') {
    return {
      tone: 'red',
      title: 'Phân tích AI thất bại',
    };
  }
  return null;
};

/* ============================================================================
 * Status badge cho card body — tone + label ngắn gọn (English để gọn trong
 * pill, khớp mockup). Mapping theo palette mục 9:
 *   - ready   → green
 *   - failed  → red
 *   - pending → amber
 *   - parsing → blue
 *   - deleted → slate
 * ==========================================================================*/
type BadgeTone = 'green' | 'red' | 'amber' | 'blue' | 'slate';

const statusBadge = (cv: Cv): { tone: BadgeTone; label: string } => {
  switch (cv.status) {
    case 'ready':
      return { tone: 'green', label: 'Ready' };
    case 'failed':
      return { tone: 'red', label: 'Failed' };
    case 'pending':
      return { tone: 'amber', label: 'Pending' };
    case 'parsing':
      return { tone: 'blue', label: 'Parsing' };
    case 'deleted':
      return { tone: 'slate', label: 'Đã xoá' };
  }
};

/* ============================================================================
 * Set primary
 * ==========================================================================*/
const settingPrimaryId = ref<string | null>(null);
const handleSetPrimary = async (cvId: string) => {
  settingPrimaryId.value = cvId;
  openMenuId.value = null; // đóng menu nếu mở
  try {
    await cvStore.setPrimary(cvId);
  } finally {
    settingPrimaryId.value = null;
  }
};

/* ============================================================================
 * Re-analyze — POST /cvs/:cvId/analyze (store: cvStore.triggerAnalysis).
 * Disable button khi đang pending/parsing; backend cũng 409 nếu lỡ click.
 * ==========================================================================*/
const analyzingId = ref<string | null>(null);
const handleAnalyze = async (cvId: string) => {
  openMenuId.value = null;
  analyzingId.value = cvId;
  try {
    await cvStore.triggerAnalysis(cvId);
  } catch {
    // store đã set error; UI banner hiện.
  } finally {
    analyzingId.value = null;
  }
};

/**
 * Cho phép re-analyze khi status ở terminal state (ready | failed).
 *
 * KHÔNG check parsedData ở đây — để button luôn hiện cho mọi CV ready/failed,
 * kể cả khi parsedData bị null (vd. status='failed' + reason='not_a_cv' do
 * parse worker không tạo được data). Nếu BE reject vì thiếu parsedData
 * (400 CV_NOT_PARSED) → toast báo lỗi cho user biết, vẫn tốt hơn ẩn nút.
 *
 * KHÔNG check quota ở đây — chỉ disable ở `:disabled="!hasAnalyzeQuota"`.
 *
 * Không lọt theo source: direct CV luôn có parsedData; upload CV đã parse xong
 * cũng hợp lệ. Đây là điểm khác biệt so với bản cũ (chỉ source='upload').
 */
const canAnalyze = (cv: Cv): boolean =>
  cv.status === 'ready' || cv.status === 'failed';

/**
 * Còn quota analyze AI không? Worker `cvAnalysis.worker.ts:165` ghi
 * `ai_cv_analysis` vào usage_logs khi re-analyze. Nếu `hasQuota` trả false →
 * usage đã đạt limit → disable nút Sparkles để khỏi tốn bandwidth + 5-30s đợi
 * worker rồi fail.
 *
 * Lưu ý: BE worker vẫn chạy và ghi `failureReason='quota_exceeded'` cho race
 * case (quota hết giữa lúc click). UI vẫn có banner + quota modal xử lý case
 * đó — chỉ là chặn trước khi user wasted thời gian.
 */
const hasAnalyzeQuota = computed<boolean>(() => planStore.hasQuota('ai_cv_analysis'));

/* ============================================================================
 * Delete — soft-delete + confirm modal.
 * ==========================================================================*/
const confirmDeleteId = ref<string | null>(null);

const askDelete = (cvId: string): void => {
  openMenuId.value = null;
  confirmDeleteId.value = cvId;
};
const cancelDelete = (): void => {
  confirmDeleteId.value = null;
};
const confirmDeleteAction = async (): Promise<void> => {
  const id = confirmDeleteId.value;
  if (!id) return;
  confirmDeleteId.value = null;
  try {
    await cvStore.remove(id);
    if (cvStore.items.length === 0 && cvStore.page > 1) {
      await cvStore.fetchList(undefined, 1);
    }
  } catch {
    // store đã set error
  }
};

/* ============================================================================
 * Click-to-preview.
 *
 * Lưu ý: store.setPrimary REPLACE items bằng `items.value.map(c => ...)`
 * (object mới, không mutate ref cũ) — nên nếu giữ `previewData = ref<Cv>`
 * snapshot 1 lần, sau setPrimary previewData.isPrimary vẫn false → button
 * "Đặt làm CV chính" vẫn hiện, user click lại → API 409 hoặc no-op.
 *
 * Cách fix: chỉ lưu `previewDataId`, derive `previewCv` qua computed từ
 * `items` theo id. Mọi mutation của store (setPrimary / refreshDetail /
 * socket cv:status-changed) đều tự đội sync mà không cần manual refresh.
 * ==========================================================================*/
const previewOpen = ref(false);
const previewDataId = ref<string | null>(null);

/** CV đang xem trong modal — lookup từ items theo id để auto-sync store mutations. */
const previewCv = computed<Cv | null>(() => {
  const id = previewDataId.value;
  if (!id) return null;
  return items.value.find((c) => c.id === id) ?? null;
});

const openPreview = (cv: Cv): void => {
  previewDataId.value = cv.id;
  previewOpen.value = true;
};
const closePreview = (): void => {
  previewOpen.value = false;
  previewDataId.value = null;
};

/* ============================================================================
 * Quota detail modal — mở khi user click "Chi tiết" trên warning strip.
 *
 * Tại sao modal (không phải inline popover):
 *   - Inline popover (slide-down dưới strip) đẩy thumbnail xuống → card
 *     dưới nhảy theo → ugly. Modal tách hẳn khỏi grid, không ảnh hưởng layout.
 *   - Tách biệt với CV preview modal (khác max-w, khác theme, khác nội dung):
 *     preview = xem CV; quota modal = giải thích lý do + CTA retry/upgrade.
 *   - Đóng bằng: backdrop click, nút X, hoặc nút "Đóng" trong footer.
 * ==========================================================================*/
const quotaDetailCvId = ref<string | null>(null);

/** CV đang hiển thị trong quota modal — lookup từ items theo id. */
const quotaCv = computed<Cv | null>(() => {
  const id = quotaDetailCvId.value;
  if (!id) return null;
  return items.value.find((c) => c.id === id) ?? null;
});

const closeQuotaDetail = (): void => {
  quotaDetailCvId.value = null;
};

/* ============================================================================
 * AI analysis modal — hiện chi tiết trường `ai_analysis` (total / strengths /
 * weaknesses / suggestions / verificationWarnings). Mở từ card quick-actions.
 *
 * Tách riêng khỏi preview modal:
 *   - preview modal = xem CV render thật / file PDF.
 *   - analysis modal = xem điểm AI + nhận xét (text-only, không cần iframe).
 *
 * Tránh mở khi CV chưa phân tích (button không hiện) hoặc `isCv=false` (sẽ
 * hiện warning riêng).
 * ==========================================================================*/
const analysisOpen = ref(false);
const analysisData = ref<Cv | null>(null);

const openAnalysis = (cv: Cv): void => {
  analysisData.value = cv;
  analysisOpen.value = true;
};
const closeAnalysis = (): void => {
  analysisOpen.value = false;
  analysisData.value = null;
};

/** Dùng cho UI: CV có mở nút "Xem phân tích" hay không. Có analysis + isCv. */
const canShowAnalysis = (cv: Cv): boolean =>
  cv.ai_analysis !== null && cv.ai_analysis.isCv === true;

/**
 * CV có warning quota hiển thị trên thẻ không?
 * ĐK: failureReason='quota_exceeded' (BE persist reason này trong DB nên
 * hiển thị survive reload — không phụ thuộc vào Pinia state).
 *
 * Áp dụng cho CẢ 2 case quota fail:
 *   - status='ready'  → analyze quota fail: parsedData còn, điểm cũ giữ,
 *                        CV vẫn dùng được, chỉ không tạo điểm mới.
 *   - status='failed' → parse quota fail:    CV không parse được, không có
 *                        parsedData, status='failed'/'quota_exceeded'.
 *
 * Hàm helper `isParseQuotaFail(cv)` phân biệt 2 case để strip + modal
 * hiển thị message + action phù hợp (parse không có nút "Thử lại" vì
 * không thể re-parse khi chưa upload lại).
 */
/** True nếu quota fail từ PARSE stage (CV không có parsedData). */
const isParseQuotaFail = (cv: Cv): boolean =>
  cv.status === 'failed' && cv.failureReason === 'quota_exceeded';

/** True nếu quota fail từ ANALYZE stage (CV có parsedData + điểm cũ). */
const isAnalyzeQuotaFail = (cv: Cv): boolean =>
  cv.status === 'ready' && cv.failureReason === 'quota_exceeded';

/** True nếu CV đang xem trong quota modal là case parse (dùng cho modal
 *  body + footer khác biệt). */
const quotaIsParse = computed<boolean>(() =>
  quotaCv.value ? isParseQuotaFail(quotaCv.value) : false,
);

/* ============================================================================
 * Thumbnail constants — scale CV template khi nhúng vào thumbnail A4.
 *
 * Template render min-width full, min-h-[1100px] → dùng 850×1100 làm inner.
 * Paper width = 132px → scale = 132/850 ≈ 0.1553.
 *
 * Preview-related computed (`previewRenderData`, `previewTemplateId`,
 * `previewPdfUrl`, `previewIsOffice`) đã được MOVE VÀO [CvPreview.vue](../components/cv/CvPreview.vue)
 * — parent chỉ giữ `previewOpen` + `previewDataId` (state) + `previewCv`
 * (derived từ items theo id, auto-sync store mutations).
 *
 * Lý do tách:
 *   - Chỉ phục vụ preview modal, không ai khác dùng.
 *   - Khi buildRenderData / office viewer logic đổi → sửa 1 chỗ trong
 *     CvPreview, không rò rỉ vào view quản lý CV.
 *   - MyResumesView gọn lại — chỉ lo list + state, không ôm cả logic preview.
 * ==========================================================================*/
const THUMBNAIL_RENDER_WIDTH = 850;
const THUMBNAIL_RENDER_HEIGHT = 1100;
const PAPER_WIDTH_PX = 132;
const THUMBNAIL_SCALE = PAPER_WIDTH_PX / THUMBNAIL_RENDER_WIDTH;

/** Hiệu ứng "xếp chồng giấy" phía sau thumbnail — thuần box-shadow, không thêm DOM. */
const PAPER_STACK_SHADOW =
  '0 1px 2px rgba(15,23,42,0.06), 4px 4px 0 -1px #fff, 4px 4px 0 0 rgba(15,23,42,0.07), 8px 8px 0 -1px #fff, 8px 8px 0 0 rgba(15,23,42,0.05)';

const handleCreate = (): void => {
  router.push('/candidate/resumes/new');
};
const handleUploadClick = (): void => {
  router.push('/candidate/resumes/new?mode=upload');
};

/* ============================================================================
 * Action menu (⋮) — Xem chi tiết / Tải PDF / Mở file gốc / Xóa.
 * ==========================================================================*/
const openMenuId = ref<string | null>(null);
const toggleMenu = (cvId: string, ev?: MouseEvent) => {
  ev?.stopPropagation();
  openMenuId.value = openMenuId.value === cvId ? null : cvId;
};
const previewFromMenu = (cv: Cv) => {
  openMenuId.value = null;
  openPreview(cv);
};
/** Tải CV — dùng composable chung với CvPreview modal (cùng handler/toast). */
const {
  downloading: menuDownloading,
  canOpenOriginal: menuCanOpenOriginal,
  openOriginalTooltip: menuOpenOriginalTooltip,
  handleDownload: menuHandleDownload,
  handleOpenOriginal: menuHandleOpenOriginal,
} = useCvDownload();
const downloadFromMenu = (cv: Cv) => {
  // Không đóng menu ngay — để user thấy spinner trên nút trong lúc tải.
  void menuHandleDownload(cv);
};
const openOriginalFromMenu = (cv: Cv) => {
  menuHandleOpenOriginal(cv);
  openMenuId.value = null;
};
/** Đóng menu khi click ra ngoài (delegate trên document, dùng data attr `data-cv-menu`).
 *  Quota modal đóng qua backdrop @click.self riêng — không cần check ở đây. */
const onDocClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (!target.closest('[data-cv-menu]')) openMenuId.value = null;
};
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

/** True nếu đang có filter/search khác mặc định — dùng để hiện chip "Xoá lọc".
 *  Đọc RAW searchQuery (chưa debounce) để chip hiện ngay khi user bắt đầu gõ,
 *  không phải đ�i 400ms. */
const hasActiveFilter = computed<boolean>(
  () => sourceFilter.value !== 'all' || searchQuery.value.trim().length > 0,
);
const clearAllFilters = async (): Promise<void> => {
  // Set searchQuery TRƯỚC sẽ trigger watch(searchQuery) — watch cancel timer
  // cũ rồi set timer mới cho 400ms sau. Phải cancel timer mới này SAU khi
  // watch fire để chặn race call (watch 400ms-later có thể dùng stale
  // query.value hoặc reset thứ khác trước khi clearAllFilters xong).
  if (searchTimer) clearTimeout(searchTimer);
  searchQuery.value = '';
  if (searchTimer) clearTimeout(searchTimer);
  sourceFilter.value = 'all';
  // ResetFilters=true → store clear query.source + query.q về undefined rồi
  // fetch lại từ DB. Nếu không có flag này, fetchList coi undefined = "giữ
  // nguyên" → API vẫn filter theo source cũ → list không đổi.
  await cvStore.fetchList(undefined, 1, undefined, true);
};
</script>

<template>
  <div class="min-h-screen bg-[#F7F8FA]">
    <div class="max-w-7xl mx-auto px-5 md:px-8 py-8 md:py-11">

      <!-- ============ Page Header ============ -->
      <header class="mb-7 flex items-start md:items-center justify-between gap-4 flex-col md:flex-row">
        <div class="flex items-center gap-3.5">
          <div class="w-11 h-11 rounded-2xl bg-slate-900 flex items-center justify-center shrink-0">
            <FileText class="w-5 h-5 text-white" />
          </div>
          <div>
            <div class="flex items-center gap-2.5">
              <h1 class="text-xl md:text-[24px] font-bold text-slate-900 tracking-tight">
                CV của tôi
              </h1>
              <span
                v-if="total > 0"
                class="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 tabular-nums"
              >
                {{ total }}
              </span>
            </div>
            <p class="text-sm text-slate-500 mt-0.5 max-w-xs sm:max-w-none">
              Quản lý, tổ chức và phân tích AI cho tất cả CV của bạn tại một nơi.
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2.5 shrink-0 self-stretch md:self-auto">
          <button
            type="button"
            class="btn-secondary flex-1 sm:flex-none inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium"
            @click="handleUploadClick"
          >
            <Upload class="w-4 h-4" /> <span class="hidden sm:inline">Upload CV</span><span class="sm:hidden">Upload</span>
          </button>
          <button
            type="button"
            class="btn-primary flex-1 sm:flex-none inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold shadow-sm shadow-primary-600/20"
            @click="handleCreate"
          >
            <Plus class="w-4 h-4" /> Tạo CV
          </button>
        </div>
      </header>

      <!-- ============ Toolbar / Filter ============ -->
      <div class="mb-6 bg-white ring-1 ring-slate-200/70 rounded-2xl px-3.5 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between shadow-sm shadow-slate-900/[0.02]">
        <!-- Segmented tabs: mỗi loại nguồn có icon riêng để nhận diện nhanh.
             Mobile: tabs phân bổ đều full-width; Desktop: gọn theo nội dung. -->
        <div
          class="tabs-scroll flex w-full md:w-auto md:inline-flex bg-slate-100/70 rounded-xl p-1 self-start shrink-0 overflow-x-auto"
          role="tablist"
        >
          <button
            v-for="opt in sourceOptions"
            :key="opt.value"
            type="button"
            role="tab"
            :aria-selected="sourceFilter === opt.value"
            @click="handleSourceChange(opt.value)"
            class="flex-1 md:flex-none justify-center px-2.5 sm:px-3.5 h-9 text-xs sm:text-sm font-medium rounded-lg transition-all duration-150 inline-flex items-center gap-1.5 whitespace-nowrap min-w-0"
            :class="sourceFilter === opt.value
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-800 hover:bg-white/70'"
          >
            <!-- Mobile (xs): icon-only + label ngắn. sm+: icon + label đầy đủ.
                 Để "CV tạo trực tiếp" không overflow 1/3 width (~106px) ở 320px. -->
            <Upload v-if="opt.value === 'upload'" class="w-3.5 h-3.5 shrink-0" :class="sourceFilter === opt.value ? 'opacity-90' : 'opacity-60'" />
            <FileText v-else-if="opt.value === 'direct'" class="w-3.5 h-3.5 shrink-0" :class="sourceFilter === opt.value ? 'opacity-90' : 'opacity-60'" />
            <span class="sm:hidden">{{ opt.shortLabel }}</span>
            <span class="hidden sm:inline">{{ opt.label }}</span>
          </button>
        </div>

        <!-- Search + trạng thái filter -->
        <div class="flex items-center gap-2 flex-wrap md:flex-nowrap w-full md:w-auto">
          <!-- Search input: mobile full-width (flex-1 trong flex-wrap row),
               desktop cố định 240px. min-w-[10rem] để không bị squish khi clear
               button chiếm chỗ. -->
          <div class="relative flex-1 min-w-[10rem] md:flex-none md:w-60 order-1">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Tìm theo tiêu đề..."
              class="h-9 pl-9 pr-4 w-full text-sm rounded-xl border border-slate-200 bg-slate-50/60 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/25 focus:border-primary-400 focus:bg-white transition"
            />
          </div>

          <!-- Clear button: mobile đứng riêng 1 dòng (basis-full) ngay dưới
               search cho dễ bấm. Desktop nằm cùng hàng ngang.
               min-w-[2.25rem] đảm bảo touch target ≥36px dù label "Xoá" ngắn. -->
          <Transition
            enter-active-class="transition duration-150 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition duration-100 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
          >
            <button
              v-if="hasActiveFilter"
              type="button"
              class="basis-full md:basis-auto h-9 min-w-[2.25rem] px-3 sm:px-3 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200/80 inline-flex items-center justify-center md:justify-start gap-1 transition-colors order-2"
              @click="clearAllFilters"
            >
              <X class="w-3.5 h-3.5 shrink-0" />
              <span class="hidden sm:inline">Xoá lọc</span>
              <span class="sm:hidden">Xoá bộ lọc</span>
            </button>
          </Transition>

          <!-- Item count: ẩn mobile để không chiếm chỗ, hiện từ lg+ -->
          <span v-if="items.length > 0" class="text-xs text-slate-400 shrink-0 hidden lg:inline tabular-nums order-3">
            {{ items.length }}<span class="text-slate-300 mx-0.5">/</span>{{ total }}
          </span>
        </div>
      </div>

      <!-- ============ Error banner ============ -->
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 -translate-y-1"
        enter-to-class="opacity-100 translate-y-0"
      >
        <div
          v-if="error"
          class="mb-5 rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 flex items-start gap-2.5"
        >
          <AlertCircle class="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p class="text-sm text-red-700">{{ error }}</p>
        </div>
      </Transition>

      <!-- ============ Quota warning hiển thị per-card (xem bên dưới) ============
           Hiện inline trên từng thẻ CV có `failureReason='quota_exceeded'` +
           `status='ready'` — banner global đã bỏ vì warning chỉ liên quan
           đến 1 CV cụ thể. Persist trong DB qua reload (BE giữ reason). -->

      <!-- ============ Loading (initial) — centered spinner trên nền trắng ============
           Thay vì skeleton grid (dễ bị đọc là "trống / đen" trên nền sáng
           lúc page vừa mount), hiện 1 icon spinner trắng xanh, text phụ —
           rõ ràng là "đang tải", không nhầm với empty state.
           Chiếm full viewport height để không bị "giật" layout khi list về. -->
      <div
        v-if="loading && items.length === 0"
        class="bg-white rounded-2xl border border-slate-200/70 flex flex-col items-center justify-center gap-3 min-h-[60vh]"
        role="status"
        aria-live="polite"
      >
        <div class="w-12 h-12 rounded-full bg-primary-50 ring-1 ring-primary-100 flex items-center justify-center">
          <Loader2 class="w-6 h-6 text-primary-600 animate-spin" />
        </div>
        <p class="text-sm font-medium text-slate-600">Đang tải CV của bạn…</p>
        <p class="text-xs text-slate-400">Vui lòng đợi trong giây lát.</p>
      </div>

      <!-- ============ Empty: no CV at all ============ -->
      <div
        v-else-if="items.length === 0 && total === 0"
        class="bg-white rounded-2xl border border-slate-200/80"
      >
        <div class="flex flex-col items-center justify-center py-12 sm:py-16 px-6 text-center">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100/60 ring-1 ring-primary-100 flex items-center justify-center mb-4">
            <FileText class="w-6 h-6 text-primary-600" />
          </div>
          <h3 class="text-base font-semibold text-slate-900">Bạn chưa có CV nào</h3>
          <p class="text-sm text-slate-500 mt-1.5 max-w-sm">
            Tạo CV trực tiếp trong vài phút hoặc upload CV có sẵn để bắt đầu.
          </p>
          <div class="mt-6 flex gap-2.5">
            <button
              type="button"
              class="btn-secondary h-10 px-4 text-sm font-medium inline-flex items-center gap-2"
              @click="handleUploadClick"
            >
              <Upload class="w-4 h-4" /> Upload CV
            </button>
            <button
              type="button"
              class="btn-primary h-10 px-4 text-sm font-semibold inline-flex items-center gap-2 shadow-sm shadow-primary-600/20"
              @click="handleCreate"
            >
              <Plus class="w-4 h-4" /> Tạo CV
            </button>
          </div>
        </div>
      </div>

      <!-- ============ Empty: filter returned 0 ============ -->
      <div
        v-else-if="items.length === 0"
        class="bg-white rounded-2xl border border-slate-200/80"
      >
        <div class="flex flex-col items-center justify-center py-10 sm:py-14 text-center px-6">
          <Search class="w-7 h-7 text-slate-300 mb-2" />
          <p class="text-sm text-slate-500">
            Không có CV nào khớp với bộ lọc / từ khoá hiện tại.
          </p>
          <button
            type="button"
            class="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium underline-offset-4 hover:underline"
            @click="clearAllFilters"
          >
            Xoá bộ lọc
          </button>
        </div>
      </div>

      <!-- ============ Grid: 1 / 2 / 3 / 4 cols ============ -->
      <div
        v-else
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5"
      >
        <article
          v-for="cv in items"
          :key="cv.id"
          class="group relative w-full bg-white rounded-2xl border border-slate-200/70 transition-all duration-200 ease-out cursor-pointer overflow-hidden flex flex-col hover:shadow-lg hover:shadow-slate-900/[0.07] hover:-translate-y-0.5 hover:border-slate-300"
          @click="openPreview(cv)"
        >
          <!-- Dải màu trạng thái mảnh ở mép trên — nhận diện nhanh -->
          <div class="h-[3px] w-full shrink-0" :class="statusDotClass[cv.status]" />

          <!-- Quota warning được chuyển vào CARD BODY (reason box inline) để
               không chiếm dải ngang dài phía trên thumbnail — xem cardReason()
               ở script. Strip banner cũ đã bỏ theo spec mục 3. -->

          <!-- ============ Thumbnail (visual trung tâm) ============ -->
          <div class="relative bg-gradient-to-b from-slate-50/70 to-white px-4 sm:px-7 pt-6 sm:pt-7 pb-5 sm:pb-6 flex items-center justify-center">

            <!-- Action bar (top-right): ⭐ Star + ✨ Sparkles (trigger AI) +
                 🧠 Brain (view AI) + ⋮ menu.
                 - Star: đặt CV chính (amber).
                 - Sparkles: GỌI AI phân tích lại (primary blue) — chỉ khi CV
                   có parsedData + status terminal. Click sẽ trigger worker.
                 - Brain: XEM kết quả AI đã có (violet) — chỉ khi CV đã có
                   analysis hợp lệ + isCv=true. Click mở modal.
                 Cả 2 icon AI đều hiện rõ 100% (không fade hover) để user
                 nhận biết ngay chức năng AI. -->
            <div class="absolute top-3 right-3 z-20 flex items-center gap-1.5" @click.stop>
              <!-- 1. Set primary quick-action (chỉ khi !isPrimary) -->
              <button
                v-if="!cv.isPrimary"
                type="button"
                class="w-9 h-9 sm:w-8 sm:h-8 rounded-full bg-white shadow-sm ring-1 ring-slate-200/80 inline-flex items-center justify-center transition-all duration-150 text-amber-500 hover:text-amber-600 hover:bg-amber-50"
                :disabled="settingPrimaryId === cv.id"
                title="Đặt làm CV chính"
                @click.stop="handleSetPrimary(cv.id)"
              >
                <Loader2 v-if="settingPrimaryId === cv.id" class="w-4 h-4 animate-spin" />
                <Star v-else class="w-4 h-4" />
              </button>

              <!-- 2. GỌI AI phân tích lại (chỉ khi CV có parsedData + status terminal).
                   Tone primary (blue) — phân biệt với Brain (violet). -->
              <button
                v-if="canAnalyze(cv)"
                type="button"
                class="w-9 h-9 sm:w-8 sm:h-8 rounded-full bg-primary-50 shadow-sm ring-1 ring-primary-300/70 inline-flex items-center justify-center transition-all duration-150 text-primary-700 hover:bg-primary-100 hover:text-primary-800 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="analyzingId === cv.id || !hasAnalyzeQuota"
                :title="hasAnalyzeQuota ? 'Gọi AI phân tích lại CV' : 'Đã hết lượt phân tích AI — nâng cấp gói để tiếp tục'"
                @click.stop="handleAnalyze(cv.id)"
              >
                <Loader2 v-if="analyzingId === cv.id" class="w-4 h-4 animate-spin" />
                <Sparkles v-else class="w-4 h-4" />
              </button>

              <!-- 3. XEM phân tích AI (chỉ khi CV đã có analysis hợp lệ + isCv=true).
                   Tone violet — phân biệt với Sparkles (primary). -->
              <button
                v-if="canShowAnalysis(cv)"
                type="button"
                class="w-9 h-9 sm:w-8 sm:h-8 rounded-full bg-violet-50 shadow-sm ring-1 ring-violet-300/70 inline-flex items-center justify-center transition-all duration-150 text-violet-700 hover:bg-violet-100 hover:text-violet-800"
                title="Xem phân tích AI"
                @click.stop="openAnalysis(cv)"
              >
                <Brain class="w-4 h-4" />
              </button>

              <!-- ⋮ Dropdown wrapper (data-cv-menu cho outside-click handler) -->
              <div class="relative" data-cv-menu>
                <button
                  type="button"
                  class="w-9 h-9 sm:w-8 sm:h-8 rounded-full bg-white text-slate-500 hover:text-slate-900 shadow-sm ring-1 ring-slate-200/80 inline-flex items-center justify-center transition-all duration-150"
                  :class="openMenuId === cv.id
                    ? 'opacity-100 text-slate-900'
                    : 'opacity-70 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'"
                  :aria-expanded="openMenuId === cv.id"
                  aria-haspopup="menu"
                  title="Thêm thao tác"
                  @click="(e) => toggleMenu(cv.id, e)"
                >
                  <MoreVertical class="w-4 h-4" />
                </button>

                <!-- Dropdown (Xem chi tiết + Tải PDF + Mở file gốc + Xóa — quick-actions đã lên trên) -->
                <Transition
                  enter-active-class="transition duration-120 ease-out"
                  enter-from-class="opacity-0 scale-95 -translate-y-1"
                  enter-to-class="opacity-100 scale-100 translate-y-0"
                  leave-active-class="transition duration-100 ease-in"
                  leave-from-class="opacity-100"
                  leave-to-class="opacity-0"
                >
                  <div
                    v-if="openMenuId === cv.id"
                    class="absolute right-0 mt-2 w-48 origin-top-right rounded-xl bg-white shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/5 py-1.5 z-30 focus:outline-none"
                    role="menu"
                  >
                    <button
                      type="button"
                      class="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      role="menuitem"
                      @click="previewFromMenu(cv)"
                    >
                      <Eye class="w-3.5 h-3.5 text-slate-400" />
                      Xem chi tiết
                    </button>
                    <button
                      type="button"
                      class="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white transition-colors"
                      role="menuitem"
                      :disabled="menuDownloading"
                      :title="cv.source === 'direct' ? 'Tải CV dạng PDF vector (Playwright render)' : 'Tải file CV gốc đã upload'"
                      @click="downloadFromMenu(cv)"
                    >
                      <Loader2 v-if="menuDownloading" class="w-3.5 h-3.5 animate-spin text-slate-400" />
                      <Download v-else class="w-3.5 h-3.5 text-slate-400" />
                      <span>Tải PDF</span>
                    </button>
                    <button
                      type="button"
                      class="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white transition-colors"
                      role="menuitem"
                      :disabled="!menuCanOpenOriginal(cv)"
                      :title="menuOpenOriginalTooltip(cv)"
                      @click="openOriginalFromMenu(cv)"
                    >
                      <ExternalLink class="w-3.5 h-3.5 text-slate-400" />
                      <span>Mở file gốc</span>
                    </button>
                    <div class="my-1 border-t border-slate-100" role="separator" />
                    <button
                      type="button"
                      class="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      role="menuitem"
                      @click="askDelete(cv.id)"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                      Xóa
                    </button>
                  </div>
                </Transition>
              </div>
            </div>

            <!-- A4 paper preview — hiệu ứng "xếp chồng giấy" bằng box-shadow -->
            <div
              class="relative bg-white rounded-[3px] ring-1 ring-slate-900/[0.06] overflow-hidden transition-transform duration-200 group-hover:-translate-y-0.5"
              :class="{
                'opacity-95': cv.status === 'pending' || cv.status === 'parsing',
              }"
              :style="{
                width: `${PAPER_WIDTH_PX}px`,
                aspectRatio: `${THUMBNAIL_RENDER_WIDTH} / ${THUMBNAIL_RENDER_HEIGHT}`,
                boxShadow: PAPER_STACK_SHADOW,
              }"
            >
              <!-- Render thumbnail — 1 component duy nhất, handle cả upload + direct.
                   Quyết định render gì (template mini / PDF embed / img / mockup)
                   được đẩy vào [CvThumbnail.vue](../components/cv/thumbnails/CvThumbnail.vue)
                   + folder thumbnails/ — folder parallel với templates/ chứa 5
                   bản thu nhỏ tương ứng CVTemplate1-5. -->
              <CvThumbnail :cv="cv" class="absolute inset-0" />

              <!-- Loading / parsing overlay — giữ ở ngoài CvThumbnail vì chỉ áp dụng
                   cho upload CV đang pending/parsing (trạng thái thuộc về CV row,
                   không phải thumbnail). -->
              <div
                v-if="cv.status === 'pending' || cv.status === 'parsing'"
                class="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center"
              >
                <Loader2 class="w-4 h-4 text-primary-600 animate-spin" />
              </div>

              <!-- File-type pill (upload only) — overlay góc dưới-phải thumbnail.
                   Vẫn giữ ở ngoài CvThumbnail vì nó thuộc về 'meta' của card, không
                   thuộc về thumbnail content. -->
              <span
                v-if="cv.source === 'upload'"
                class="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-slate-900/85 text-white z-10"
              >
                {{ fileTypeLabel(cv) }}
              </span>
            </div>
          </div>

          <!-- ============ Card body ============ -->
          <div class="p-3.5 pt-3 sm:p-4 sm:pt-3.5 flex flex-col gap-2.5 flex-1">

            <!-- Status row: badge trái (status) + badge phải (AI score HOẶC quota warning).
                 AI score ẩn khi analyze quota fail để tránh nhầm lẫn "điểm cũ" với
                 "điểm mới"; thay bằng badge "Đã hết lượt AI" amber. -->
            <div class="flex items-center justify-between gap-2 min-h-[1.5rem]">
              <!-- Status badge (pill với icon theo tone).
                   leading-none + shrink-0 icon + label trong span để icon và text
                   thẳng hàng tuyệt đối (lucide icons có baseline padding gây lệch). -->
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold leading-none ring-1"
                :class="{
                  'bg-emerald-50 text-emerald-700 ring-emerald-200/70': statusBadge(cv).tone === 'green',
                  'bg-red-50 text-red-700 ring-red-200/70': statusBadge(cv).tone === 'red',
                  'bg-amber-50 text-amber-700 ring-amber-200/70': statusBadge(cv).tone === 'amber',
                  'bg-blue-50 text-blue-700 ring-blue-200/70': statusBadge(cv).tone === 'blue',
                  'bg-slate-100 text-slate-500 ring-slate-200/70': statusBadge(cv).tone === 'slate',
                }"
              >
                <CheckCircle2 v-if="statusBadge(cv).tone === 'green'" class="w-3 h-3 shrink-0" />
                <XCircle v-else-if="statusBadge(cv).tone === 'red'" class="w-3 h-3 shrink-0" />
                <Clock v-else-if="statusBadge(cv).tone === 'amber'" class="w-3 h-3 shrink-0" />
                <Loader2 v-else-if="statusBadge(cv).tone === 'blue'" class="w-3 h-3 shrink-0 animate-spin" />
                <span>{{ statusBadge(cv).label }}</span>
              </span>

              <!-- Secondary badge (top-right) -->
              <span
                v-if="getAiScore(cv) !== null && !isAnalyzeQuotaFail(cv)"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold leading-none bg-violet-50 text-violet-700 ring-1 ring-violet-200/70"
                :title="`AI score: ${getAiScore(cv)}/100`"
              >
                <Sparkles class="w-3 h-3 shrink-0" />
                <span class="tabular-nums">{{ getAiScore(cv) }}</span>
                <span class="text-violet-400 font-medium">/100</span>
              </span>
              <span
                v-else-if="isAnalyzeQuotaFail(cv)"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold leading-none bg-amber-50 text-amber-700 ring-1 ring-amber-200/70"
                :title="'Đã hết lượt phân tích AI'"
              >
                <AlertTriangle class="w-3 h-3 shrink-0" />
                <span>Đã hết lượt AI</span>
              </span>
            </div>

            <!-- Title + CV chính badge -->
            <div class="flex items-start gap-1.5">
              <h3
                class="text-[15px] font-semibold text-slate-900 leading-snug line-clamp-2 flex-1 min-w-0"
                :title="getDisplayTitle(cv)"
              >
                {{ getDisplayTitle(cv) }}
              </h3>
              <span
                v-if="cv.isPrimary"
                class="shrink-0 inline-flex items-center gap-0.5 mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 ring-1 ring-amber-200/70"
                title="CV chính"
              >
                <Star class="w-2.5 h-2.5 fill-current" />
              </span>
            </div>

            <!-- Subtitle: vị trí (direct) hoặc "Tải lên — PDF/DOCX" -->
            <p class="text-[13px] text-slate-500 line-clamp-1 -mt-1" :title="getSubtitle(cv)">
              {{ getSubtitle(cv) }}
            </p>

            <!-- Inline reason box — hiển thị LÝ DO ngay trên card (không modal).
                 Tone red (lỗi) hoặc amber (quota warning).
                 items-center + leading-none text để icon và title thẳng hàng
                 (single-line, không cần items-start). -->
            <div
              v-if="cardReason(cv)"
              class="rounded-xl px-3 py-2.5 flex items-center gap-2.5 ring-1"
              :class="cardReason(cv)!.tone === 'red'
                ? 'bg-red-50 ring-red-200/70'
                : 'bg-amber-50 ring-amber-200/70'"
            >
              <div
                class="w-5 h-5 rounded-md flex items-center justify-center shrink-0 ring-1"
                :class="cardReason(cv)!.tone === 'red'
                  ? 'bg-red-100 ring-red-200/70'
                  : 'bg-amber-100 ring-amber-200/70'"
              >
                <AlertCircle
                  v-if="cardReason(cv)!.tone === 'red'"
                  class="w-3 h-3 text-red-600"
                />
                <AlertTriangle v-else class="w-3 h-3 text-amber-600" />
              </div>
              <p
                class="flex-1 min-w-0 text-[12px] font-semibold leading-none"
                :class="cardReason(cv)!.tone === 'red' ? 'text-red-900' : 'text-amber-900'"
              >
                {{ cardReason(cv)!.title }}
              </p>
            </div>

            <!-- Footer: date + file type / template -->
            <div class="flex items-center justify-between gap-2 mt-auto pt-1 text-[11px] text-slate-400">
              <span class="tabular-nums">
                {{ formatDate(cv) || '—' }}
              </span>
              <span
                v-if="cv.source === 'upload'"
                class="inline-flex items-center gap-1 text-slate-500"
              >
                <FileText class="w-3 h-3" />
                {{ fileTypeLabel(cv) }}
              </span>
              <span
                v-else-if="getTemplateId(cv)"
                class="text-slate-500"
              >
                Mẫu {{ getTemplateId(cv) }}
              </span>
            </div>
          </div>
        </article>
      </div>

      <!-- ============ Pagination (minimal) ============ -->
      <nav
        v-if="total > pageSize"
        class="mt-8 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 text-sm"
        aria-label="Pagination"
      >
        <p class="text-slate-500">
          Trang <strong class="text-slate-900 font-semibold">{{ page }}</strong>
          <span class="text-slate-300 mx-1">/</span>
          <strong class="text-slate-900 font-semibold">{{ totalPages }}</strong>
          <span class="mx-2 text-slate-300">·</span>
          Tổng <strong class="text-slate-900 font-semibold">{{ total }}</strong> CV
        </p>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="h-9 px-3 flex-1 sm:flex-none justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent inline-flex items-center gap-1 text-sm font-medium"
            :disabled="page <= 1 || loading"
            @click="goToPage(page - 1)"
          >
            <ChevronLeft class="w-4 h-4" /> Trước
          </button>
          <button
            type="button"
            class="h-9 px-3 flex-1 sm:flex-none justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent inline-flex items-center gap-1 text-sm font-medium"
            :disabled="page >= totalPages || loading"
            @click="goToPage(page + 1)"
          >
            Sau <ChevronRight class="w-4 h-4" />
          </button>
        </div>
      </nav>
    </div>

    <!-- ============ Preview modal ============ -->
    <CvPreview
      :open="previewOpen"
      :cv="previewCv"
      :setting-primary="settingPrimaryId === previewCv?.id"
      @close="closePreview"
      @set-primary="handleSetPrimary"
    />

    <!-- ============ AI analysis modal ============ -->
    <CvAiAnalysisView
      :open="analysisOpen"
      :cv="analysisData"
      @close="closeAnalysis"
    />

    <!-- ============ Delete confirm modal ============ -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="confirmDeleteId !== null"
          class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
          @click.self="cancelDelete"
        >
          <Transition
            appear
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
          >
            <div class="modal-scroll bg-white rounded-2xl shadow-2xl shadow-slate-900/20 max-w-sm w-full max-h-[85vh] overflow-y-auto p-5 ring-1 ring-slate-900/5">
              <div class="flex items-start gap-3">
                <div class="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0 ring-1 ring-red-100">
                  <Trash2 class="w-5 h-5 text-red-600" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="text-base font-semibold text-slate-900">Xóa CV</h3>
                  <p class="text-sm text-slate-500 mt-1.5 leading-relaxed">
                    Bạn có chắc muốn xóa CV này? Hành động này không thể hoàn tác.
                  </p>
                </div>
              </div>
              <div class="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  class="h-9 px-4 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                  @click="cancelDelete"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  class="h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors shadow-sm shadow-red-600/20"
                  @click="confirmDeleteAction"
                >
                  Xóa
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>

    <!-- ============ Quota detail modal ============
         Centered, amber-themed, tách hẳn khỏi grid (không đẩy thumbnail).
         Khác CV preview modal: max-w-md (nhỏ hơn), theme amber, nội dung
         giải thích lý do quota + CTA retry/upgrade thay vì render CV. -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="quotaDetailCvId !== null && quotaCv"
          class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          @click.self="closeQuotaDetail"
        >
          <Transition
            appear
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 scale-95 translate-y-2"
            enter-to-class="opacity-100 scale-100 translate-y-0"
          >
            <div
              class="modal-scroll bg-white rounded-2xl shadow-2xl shadow-slate-900/25 max-w-md w-full max-h-[85vh] overflow-y-auto ring-1 ring-slate-900/5"
              @click.stop
            >
              <!-- Header: gradient tone thay đổi theo context (amber=analyze, red=parse) -->
              <header
                class="relative px-5 sm:px-6 pt-5 pb-4 border-b"
                :class="quotaIsParse
                  ? 'bg-gradient-to-br from-red-50 via-red-50/40 to-white border-red-100/80'
                  : 'bg-gradient-to-br from-amber-50 via-amber-50/40 to-white border-amber-100/80'"
              >
                <div class="flex items-start gap-3">
                  <div
                    class="w-10 h-10 rounded-xl ring-1 flex items-center justify-center shrink-0"
                    :class="quotaIsParse
                      ? 'bg-gradient-to-br from-red-100 to-red-50 ring-red-200/70'
                      : 'bg-gradient-to-br from-amber-100 to-amber-50 ring-amber-200/70'"
                  >
                    <Sparkles
                      class="w-5 h-5"
                      :class="quotaIsParse ? 'text-red-700' : 'text-amber-700'"
                    />
                  </div>
                  <div class="flex-1 min-w-0 pt-0.5">
                    <h3 class="text-base font-semibold text-slate-900 leading-tight">
                      {{ quotaIsParse ? 'Hết lượt parse AI' : 'Hết lượt AI' }}
                    </h3>
                    <p class="text-xs text-slate-500 mt-1 truncate">
                      {{ quotaCv.title || 'CV này' }}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/70 transition-colors inline-flex items-center justify-center shrink-0 -mr-1 -mt-1"
                    @click="closeQuotaDetail"
                    aria-label="Đóng"
                  >
                    <X class="w-4 h-4" />
                  </button>
                </div>
              </header>

              <!-- Body -->
              <div class="px-5 sm:px-6 py-5 space-y-4">
                <!-- Body text — context-aware -->
                <p class="text-sm text-slate-700 leading-relaxed">
                  <template v-if="quotaIsParse">
                    Bạn đã dùng hết lượt parse AI trong tháng. CV này không thể xử lý cho tới khi bạn nâng cấp gói hoặc chờ reset đầu tháng sau.
                  </template>
                  <template v-else>
                    Bạn đã dùng hết lượt phân tích AI trong tháng. CV vẫn hiển thị bình thường và điểm phân tích trước vẫn được dùng cho tới khi bạn nâng cấp gói hoặc chờ reset đầu tháng sau.
                  </template>
                </p>

                <!-- Current AI score (chỉ analyze case — parse fail thì không có điểm) -->
                <div
                  v-if="!quotaIsParse && getAiScore(quotaCv) !== null"
                  class="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-violet-50/60 ring-1 ring-violet-100/80"
                >
                  <div class="w-9 h-9 rounded-lg bg-white ring-1 ring-violet-100 flex items-center justify-center shrink-0">
                    <Brain class="w-4 h-4 text-violet-600" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-[11px] text-slate-500 font-medium leading-tight">Điểm AI hiện tại</p>
                    <p class="text-base font-bold text-slate-900 tabular-nums leading-tight mt-0.5">
                      {{ getAiScore(quotaCv) }}<span class="text-slate-400 text-xs font-normal ml-0.5">/100</span>
                    </p>
                  </div>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 shrink-0"
                    :class="scoreLabel(getAiScore(quotaCv)!).tone"
                  >
                    {{ scoreLabel(getAiScore(quotaCv)!).label }}
                  </span>
                </div>

                <!-- Tip: context-aware -->
                <div class="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-slate-50 ring-1 ring-slate-200/70">
                  <AlertCircle class="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                  <p class="text-[11.5px] text-slate-600 leading-relaxed">
                    <template v-if="quotaIsParse">
                      CV này sẽ hiển thị trạng thái "Lỗi" cho tới khi quota được nạp — bạn không cần xóa, chỉ cần nâng cấp gói hoặc chờ reset tháng sau.
                    </template>
                    <template v-else>
                      Hệ thống vẫn giữ điểm cũ để bạn dùng tiếp — chỉ không tạo được điểm mới cho tới khi gói được nạp thêm lượt.
                    </template>
                  </p>
                </div>
              </div>

              <!-- Actions:
                   - Analyze case: Nâng cấp gói + Thử lại (re-analyze).
                   - Parse case:   chỉ Nâng cấp gói (full-width, không có
                                   Thử lại vì không re-parse được khi chưa
                                   upload lại — sẽ nhầm lẫn nếu để nút). -->
              <footer class="px-5 sm:px-6 pb-5 pt-1 flex items-center gap-2.5">
                <a
                  href="/candidate/subscription"
                  class="flex-1 h-10 rounded-xl text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 transition-colors inline-flex items-center justify-center gap-1.5"
                  @click="closeQuotaDetail"
                >
                  Nâng cấp gói
                </a>
                <button
                  v-if="!quotaIsParse"
                  type="button"
                  class="flex-1 h-10 rounded-xl text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-colors inline-flex items-center justify-center gap-1.5 shadow-sm shadow-amber-600/20 disabled:opacity-60"
                  :disabled="analyzingId === quotaCv.id"
                  @click="handleAnalyze(quotaCv.id); closeQuotaDetail()"
                >
                  <Loader2 v-if="analyzingId === quotaCv.id" class="w-4 h-4 animate-spin" />
                  <Sparkles v-else class="w-4 h-4" />
                  Thử lại
                </button>
              </footer>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* Scrollbar mỏng cho toolbar tabs (overflow-x-auto) + modal body. Global
 * page scrollbar (html/body) đã được style ở [style.css](../../style.css)
 * — chỗ này chỉ scope cho in-component scrollable. */
.tabs-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(203, 213, 225, 0.6) transparent;
}
.tabs-scroll::-webkit-scrollbar {
  height: 4px;
}
.tabs-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.tabs-scroll::-webkit-scrollbar-thumb {
  background-color: rgba(203, 213, 225, 0.6);
  border-radius: 9999px;
}
.tabs-scroll::-webkit-scrollbar-thumb:hover {
  background-color: rgba(148, 163, 184, 0.85);
}

.modal-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(203, 213, 225, 0.6) transparent;
}
.modal-scroll::-webkit-scrollbar {
  width: 4px;
}
.modal-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.modal-scroll::-webkit-scrollbar-thumb {
  background-color: rgba(203, 213, 225, 0.6);
  border-radius: 9999px;
}
.modal-scroll::-webkit-scrollbar-thumb:hover {
  background-color: rgba(148, 163, 184, 0.85);
}
</style>