/**
 * CV Pinia store — state chung cho list + detail CV của candidate.
 *
 * Phân trách nhiệm (theo pattern skills store):
 *   - cvApi: gọi HTTP, trả AxiosResponse.
 *   - store (file này): unwrap, giữ state (items, loading, error),
 *     đồng bộ local sau khi setPrimary.
 *   - UI chỉ đọc state + gọi action.
 *
 * Backend chưa có endpoint delete CV (chỉ soft-delete qua DB) → store
 * không expose delete action. Set primary là thao tác duy nhất với data.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { cvApi } from '@services/cv.api';
import type {
  CvDetail,
  CvFailureReason,
  CvSource,
  CvStatus,
  ListCv,
  ListCvQuery,
} from '@/types/cv';

export const useCvStore = defineStore('cv', () => {
  // --- State ---
  const items = ref<ListCv[]>([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(8);
  const loading = ref(false);
  const error = ref<string | null>(null);

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
  const setError = (e: unknown): void => {
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  };

  // --- Actions ---

  /**
   * Lấy danh sách CV của candidate đang đăng nhập (có phân trang).
   * @param source — optional filter: 'upload' | 'direct'. Bỏ trống → cả 2.
   * @param pageNum — trang muốn load (1-based). Mặc định giữ nguyên page hiện tại.
   */
  const fetchList = async (
    source?: CvSource,
    pageNum?: number,
  ): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      if (source !== undefined) query.value.source = source;
      const targetPage = pageNum ?? page.value;
      page.value = targetPage;
      query.value.limit = pageSize.value;
      query.value.offset = (targetPage - 1) * pageSize.value;
      const { data } = await cvApi.list(query.value);
      items.value = data.data.items;
      total.value = data.data.total;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
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
   * trong transaction; store đồng bộ local: clear isPrimary của tất cả,
   * set CV này về true.
   */
  const setPrimary = async (cvId: string): Promise<boolean> => {
    error.value = null;
    try {
      await cvApi.setPrimary(cvId);
      items.value = items.value.map((c) => ({
        ...c,
        isPrimary: c.id === cvId,
      }));
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
   * Re-fetch detail 1 CV để lấy aiAnalysisTotal mới (sau khi status='ready').
   * Im lặng nếu lỗi — list vẫn hiển thị status cũ.
   */
  const refreshDetail = async (cvId: string): Promise<void> => {
    try {
      const { data } = await cvApi.getDetail(cvId);
      const updated = data.data;
      const idx = items.value.findIndex((c) => c.id === cvId);
      if (idx === -1) return;
      items.value[idx] = {
        ...items.value[idx],
        status: updated.status,
        aiAnalysisTotal: updated.ai_analysis?.total ?? null,
      };
    } catch {
      // ignore — UI vẫn giữ state cũ
    }
  };

  /**
   * Trigger lại CV analysis — gọi API POST /cvs/:cvId/analyze.
   *
   * BE đã set status='parsing' trong DB. FE không cần update local — để
   * socket `cv:status-changed` emit về sẽ tự patch khi worker chạy xong.
   *
   * @returns cvId nếu success, null nếu fail.
   */
  const triggerAnalysis = async (cvId: string): Promise<string | null> => {
    error.value = null;
    try {
      await cvApi.triggerAnalysis(cvId);
      return cvId;
    } catch (e) {
      setError(e);
      return null;
    }
  };

  return {
    // state
    items, total, page, pageSize, loading, error, query,
    // computed
    primary, totalPages,
    // actions
    fetchList, fetchDetail, setPrimary, remove, triggerAnalysis,
    updateStatus, refreshDetail,
  };
});
