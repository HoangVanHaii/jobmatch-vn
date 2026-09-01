/**
 * CV Pinia store — state chung cho list + detail CV của candidate.
 *
 * Phân trách nhiệm (theo pattern skills store):
 *   - cvApi: gọi HTTP, trả AxiosResponse.
 *   - store (file này): unwrap, giữ state (items, loading, error),
 *     đồng bộ local sau khi các write endpoint trả về full Cv.
 *   - UI chỉ đọc state + gọi action.
 *
 * items giờ là FULL Cv row (parsedData + ai_analysis) — BE getListDetail
 * trả về đầy đủ → render CV thật trên thumbnail không cần gọi thêm detail.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { cvApi } from '@services/cv.api';
import type {
  CreateDirectCvInput,
  CreateUploadCvInput,
  Cv,
  CvDetail,
  CvFailureReason,
  CvSource,
  CvStatus,
  ListCvQuery,
} from '@/types/cv';

export const useCvStore = defineStore('cv', () => {
  // --- State ---
  const items = ref<Cv[]>([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(8);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Quota warning hiện trên UI — set khi BE worker emit `cv:quota-warning`
   * (reanalyze bị revert về 'ready' vì quota AI hết, hoặc parse fail do
   * quota). Sống ở store (không ở view ref) để SURVIVE qua navigation: nếu
   * user click "Phân tích lại" rồi chuyển tab / route trong 5s, banner vẫn
   * còn khi quay lại.
   *
   * `context` phân biệt nguồn quota:
   *   - 'parse'  — parse worker (CV status='failed', không có parsedData).
   *   - 'analyze' — analyze worker (CV status='ready', giữ điểm cũ).
   * FE dùng context để hiển thị message + action phù hợp (parse không có
   * "Thử lại" vì không re-parse được khi chưa upload lại).
   *
   * Cặp với `cvId` để UI có thể filter "chỉ hiện khi user đang ở trang CV
   * tương ứng" — nhưng hiện tại hiển thị global cho đơn giản.
   */
  const quotaWarning = ref<{
    cvId: string;
    message: string;
    context: 'parse' | 'analyze';
    at: number;
  } | null>(null);

  /** Query hiện tại cho list: filter theo source + pagination. */
  const query = ref<ListCvQuery>({});

  // --- Computed ---
  /** CV đang đánh dấu primary (1 cái duy nhất). */
  const primary = computed(() => items.value.find((c) => c.isPrimary) ?? null);
  /** Tổng số trang. */
  const totalPages = computed(() =>
    total.value === 0 ? 1 : Math.ceil(total.value / pageSize.value),
  );

  // --- Helpers ---
  /** Map error code từ BE error handler → message tiếng Việt thân thiện. */
  const ERROR_MESSAGES: Record<string, string> = {
    CV_AI_RATE_LIMITED: 'Bạn phân tích quá nhanh (tối đa 3 lượt/phút). Vui lòng đợi một chút.',
    ALREADY_PROCESSING: 'CV đang được phân tích. Vui lòng đợi.',
    CV_NOT_PARSED: 'CV chưa parse xong. Vui lòng đợi hoặc upload lại.',
    CV_NOT_FOUND: 'CV không tồn tại hoặc đã bị xoá.',
  };
  const setError = (e: unknown): void => {
    const res = (e as { response?: { data?: { error?: { code?: string; message?: string } } } })?.response;
    const code = res?.data?.error?.code;
    error.value =
      (code && ERROR_MESSAGES[code]) ??
      res?.data?.error?.message ??
      (e instanceof Error ? e.message : 'Đã có lỗi xảy ra');
  };

  /**
   * Merge 1 full row từ API vào list local (no-op nếu row không ở trang hiện tại).
   * Dùng cho các endpoint write (setPrimary / triggerAnalysis / getDetail) mà
   * response trả về full `Cv` — replace nguyên row, không patch field lẻ.
   */
  const applyRow = (row: Cv): void => {
    const idx = items.value.findIndex((c) => c.id === row.id);
    if (idx === -1) return;
    items.value[idx] = row;
  };

  // --- Actions ---

  /**
   * Lấy danh sách CV của candidate đang đăng nhập (có phân trang).
   * Response là FULL Cv row → render trực tiếp trên card thumbnail.
   * @param source — optional filter: 'upload' | 'direct'. Bỏ trống → giữ nguyên
   *   source hiện tại trong `query.source` (không reset).
   * @param pageNum — trang muốn load (1-based). Mặc định giữ nguyên page hiện tại.
   * @param q — optional từ khoá search theo title (case-insensitive ILIKE). Mặc
   *   định giữ nguyên `query.q` hiện tại. Khi search thay đổi → reset page=1.
   * @param resetFilters — true → clear source + q về undefined (dùng cho chip
   *   "Xóa lọc"). Cần flag riêng vì mặc định `undefined` cho source/q nghĩa
   *   "giữ nguyên" → không reset được.
   *
   * Search là server-side (BE `?q=`): đẩy filter xuống DB để list không phải
   * tải hết về rồi filter client. FE debounce 400ms trước khi gọi → không
   * spam DB khi user gõ.
   */
  const fetchList = async (
    source?: CvSource,
    pageNum?: number,
    q?: string,
    resetFilters?: boolean,
  ): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      // `resetFilters=true` → thay nguyên object `query` (clear source + q +
      // mọi key cũ) để axios chắc chắn không serialize key `source` còn sót.
      // Mặc định `undefined` cho source/q = "giữ nguyên" giúp watch(searchQuery)
      // chỉ đổi q mà không reset source.
      if (resetFilters) {
        query.value = {};
      } else {
        if (source !== undefined) query.value.source = source;
        // Search thay đổi → luôn về page 1; pageNum truyền tường minh → ưu tiên.
        // Khi q truyền nhưng bằng giá trị hiện tại → không reset (tránh reset
        // oan khi user chỉ chuyển tab).
        const qChanged = q !== undefined && q !== query.value.q;
        if (q !== undefined) query.value.q = q;
        if (pageNum === undefined && qChanged) page.value = 1;
      }
      // pageNum truyền tường minh → ưu tiên tuyệt đối (cả trong resetFilters
      // branch — clearAllFilters luôn pass page=1 để về trang đầu).
      if (pageNum !== undefined) page.value = pageNum;
      query.value.limit = pageSize.value;
      query.value.offset = (page.value - 1) * pageSize.value;
      const { data } = await cvApi.list(query.value);
      items.value = data.data.items;
      total.value = data.data.total;
      // Sau khi có data → scan CV rows tìm quota_exceeded persist trong DB
      // (BE giữ failureReason='quota_exceeded' khi revert về 'ready' vì quota
      // hết). Nếu thấy → set quotaWarning, kể cả khi user reload trang (state
      // Pinia mất, DB vẫn còn). Banner sẽ tự xoá khi triggerAnalysis thành
      // công (changeAnalysisAsReady set failureReason=null).
      scanQuotaWarningFromItems();
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /**
   * Scan `items` tìm CV có failureReason='quota_exceeded' (persist từ BE
   * sau lần parse quota fail → status='failed', hoặc analyze quota fail →
   * status='ready' vẫn giữ parsedData). Nếu tìm thấy và chưa có warning
   * trong store → set quotaWarning với context tương ứng. Nếu không có
   * quota_exceeded nào → clear.
   *
   * Idempotent — gọi nhiều lần OK.
   */
  const QUOTA_WARNING_MESSAGE = {
    parse: 'Đã hết lượt parse AI. Upload CV mới sẽ thất bại cho tới khi nạp thêm lượt.',
    analyze:
      'Đã hết lượt AI. Điểm phân tích trước đó được giữ nguyên.',
  };
  const scanQuotaWarningFromItems = (): void => {
    const cv = items.value.find((c) => c.failureReason === 'quota_exceeded');
    if (cv) {
      // status='failed' = parse quota fail (CV chưa bao giờ parse xong).
      // status='ready'  = analyze quota fail (parsedData vẫn còn, điểm cũ
      //                   được giữ) — worker revert để user vẫn dùng được.
      const context: 'parse' | 'analyze' = cv.status === 'failed' ? 'parse' : 'analyze';
      if (
        quotaWarning.value?.cvId !== cv.id ||
        quotaWarning.value?.context !== context
      ) {
        quotaWarning.value = {
          cvId: cv.id,
          message: QUOTA_WARNING_MESSAGE[context],
          context,
          at: Date.now(),
        };
      }
    } else {
      // Hết quota_exceeded trong DB → clear warning (kể cả khi socket đã set).
      quotaWarning.value = null;
    }
  };

  /** Chi tiết 1 CV (full row) — trả về detail để view dùng luôn (không giữ trong store). */
  const fetchDetail = async (cvId: string): Promise<CvDetail | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await cvApi.getDetail(cvId);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Set primary cho 1 CV. Backend đã reset các CV khác về isPrimary=false
   * trong transaction + trả về full `Cv` của target. Store merge response
   * vào list + set các row khác về isPrimary=false (tránh race khi socket
   * chậm).
   */
  const setPrimary = async (cvId: string): Promise<boolean> => {
    error.value = null;
    try {
      const { data } = await cvApi.setPrimary(cvId);
      const updated = data.data;
      items.value = items.value.map((c) =>
        c.id === updated.id ? updated : (c.isPrimary ? { ...c, isPrimary: false } : c),
      );
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };

  /**
   * Soft-delete CV. Backend set status='deleted' + reset primary invariant
   * nếu cần; store đồng bộ local bằng cách filter ra khỏi items + giảm total.
   */
  const remove = async (cvId: string): Promise<boolean> => {
    error.value = null;
    try {
      await cvApi.remove(cvId);
      items.value = items.value.filter((c) => c.id !== cvId);
      total.value = Math.max(0, total.value - 1);
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };

  /**
   * Patch status của 1 CV trong local list — dùng khi nhận socket
   * `cv:status-changed` từ BE (worker xong analyze / PATCH trigger / failed).
   * Không gọi API — chỉ đồng bộ UI với state BE vừa báo.
   * Nếu CV không có trong list hiện tại (do pagination) → bỏ qua.
   *
   * Cập nhật kèm failureReason:
   *   - status='failed' → reason được set (BE luôn gửi kèm).
   *   - status khác     → reason = null (CV đã recover, không còn lý do fail).
   */
  const updateStatus = (
    cvId: string,
    status: CvStatus,
    failureReason: CvFailureReason | null = null,
  ): void => {
    const idx = items.value.findIndex((c) => c.id === cvId);
    if (idx === -1) return;
    items.value[idx] = {
      ...items.value[idx],
      status,
      failureReason: status === 'failed' ? failureReason : null,
    };
  };

  /**
   * Re-fetch detail 1 CV để lấy parsedData + ai_analysis mới (sau khi
   * status='ready' worker vừa chấm xong). Im lặng nếu lỗi — list vẫn
   * hiển thị state cũ.
   */
  const refreshDetail = async (cvId: string): Promise<void> => {
    try {
      const { data } = await cvApi.getDetail(cvId);
      applyRow(data.data);
    } catch {
      // ignore — UI vẫn giữ state cũ
    }
  };

  /**
   * Trigger lại CV analysis — gọi API POST /cvs/:cvId/analyze.
   * BE set status='parsing' + trả về full `Cv` → merge vào list NGAY để UI
   * hiện "Đang phân tích" không phải đợi socket (khi socket chậm/mất).
   * Socket `cv:status-changed` sẽ patch lại khi worker chạy xong.
   *
   * @returns cvId nếu success, null nếu fail.
   */
  const triggerAnalysis = async (cvId: string): Promise<string | null> => {
    error.value = null;
    try {
      const { data } = await cvApi.triggerAnalysis(cvId);
      applyRow(data.data);
      // Optimistic trigger — clear quota warning của CV này (nếu có). Worker
      // sẽ set lại nếu quota vẫn hết.
      if (quotaWarning.value?.cvId === cvId) quotaWarning.value = null;
      return cvId;
    } catch (e) {
      setError(e);
      return null;
    }
  };

  /**
   * Set quota warning — gọi từ App.vue global socket listener.
   * Timestamp `at` để UI có thể tự ẩn sau N giây (không bắt buộc — banner
   * sẽ tồn tại đến khi user dismiss hoặc triggerAnalysis success).
   *
   * `context` mặc định 'analyze' để giữ backward-compat với các BE worker
   * cũ chưa gửi trường này. BE parse worker luôn gửi 'parse'.
   */
  const setQuotaWarning = (
    cvId: string,
    message: string,
    context: 'parse' | 'analyze' = 'analyze',
  ): void => {
    quotaWarning.value = { cvId, message, context, at: Date.now() };
  };

  /** User dismiss quota warning thủ công (click X). */
  const dismissQuotaWarning = (): void => {
    quotaWarning.value = null;
  };

  /**
   * Tạo CV thủ công (direct) từ form web — POST /cvs/direct.
   * Không tốn quota (BE không qua parse/analyze worker).
   * Trả về Cv row mới để caller có thể navigate hoặc refresh list.
   *
   * @returns Cv nếu thành công, null nếu lỗi (message ở `error`).
   */
  const create = async (input: CreateDirectCvInput): Promise<Cv | null> => {
    error.value = null;
    try {
      const { data } = await cvApi.create(input);
      // Không thêm vào `items` vì view gọi xong sẽ navigate đi → list
      // sẽ được fetchList lại khi user quay về trang My Resumes.
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    }
  };

  /**
   * Tạo CV từ file đã upload — POST /cvs/upload (file url lấy từ /uploads/file).
   * Thường được gọi sau `uploadStore.uploadFile()` để có `fileUrl`.
   * Trả về Cv row mới; caller tự navigate + refresh list.
   *
   * @returns Cv nếu thành công, null nếu lỗi (message ở `error`).
   */
  const upload = async (input: CreateUploadCvInput): Promise<Cv | null> => {
    error.value = null;
    try {
      const { data } = await cvApi.upload(input);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    }
  };

  return {
    // state
    items, total, page, pageSize, loading, error, query, quotaWarning,
    // computed
    primary, totalPages,
    // actions
    fetchList, fetchDetail, setPrimary, remove, triggerAnalysis,
    updateStatus, refreshDetail,
    setQuotaWarning, dismissQuotaWarning,
    create, upload,
  };
});