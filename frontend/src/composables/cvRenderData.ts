/**
 * cvRenderData — utility + composable chia sẻ giữa các view render CV.
 *
 * Trước đây logic `buildRenderData` bị duplicate ở 2 chỗ:
 *   - MyResumesView.vue (preview modal + thumbnail): `(cv: Cv) => CvRenderData`
 *   - CvPrintView.vue (render-only cho Playwright): `(parsed, title) => CvRenderData`
 *
 * Hai signature khác nhau dù cùng transform — dễ drift khi thêm field mới.
 * Refactor về 1 utility duy nhất, nhận `{ parsedData, title }` (subset của Cv
 * row) → MyResumesView truyền nguyên `cv`, CvPrintView truyền slim row từ
 * BE `/cvs/:cvId/render-data`.
 *
 * CvRenderData shape xem [frontend/src/types/cv.ts](../types/cv.ts) — khác
 * CreateDirectCvInput ở chỗ gom personalInfo vào 1 object, skills có level,
 * thêm activities/interests, certificate (không phải certification).
 *
 * Architecture note:
 *   - `buildRenderData` là pure transform, không có state.
 *   - `useCvRenderData` là composable reactive — gọi qua `cvApi.getRenderData`
 *     (đi qua `http` instance để được auto-refresh interceptor), KHÔNG tự
 *     gọi axios trực tiếp. Component → composable → cvApi → http → BE.
 */
import { onUnmounted, ref, watch, type Ref } from 'vue';
import { cvApi, type CvRenderRow } from '@/services/cv.api';
import type { CvRenderData } from '@/types/cv';

/* ============================================================================
 * buildRenderData — pure transform
 *
 * Input: bất kỳ object nào có `parsedData` (Record | null) + `title` (string | null).
 *        Cv row thỏa mãn, slim row từ public endpoint cũng thỏa mãn.
 * Output: CvRenderData đầy đủ default ('' cho string, [] cho array).
 *
 * Tại sao default mọi field: CV templates check `{{ data.summary }}` etc.
 * trực tiếp → null/undefined sẽ render "null" hoặc crash. Default '' giữ
 * layout ổn định khi parsedData thiếu field.
 * ==========================================================================*/
export const buildRenderData = (input: {
  parsedData: Record<string, unknown> | null;
  title: string | null;
}): CvRenderData => {
  const p = input.parsedData ?? {};
  return {
    title: input.title ?? '',
    personalInfo: {
      fullName: (p.name as string) ?? '',
      position: (p.position as string) ?? '',
      email: (p.email as string) ?? '',
      phone: (p.phone as string) ?? '',
      address: (p.address as string) ?? '',
      dob: (p.dob as string) ?? '',
      gender: (p.gender as string) ?? '',
      facebook: (p.facebook as string) ?? '',
      linkedin: (p.linkedin as string) ?? '',
      portfolio: (p.portfolio as string) ?? '',
      github: (p.github as string) ?? '',
      avatarUrl: (p.avatarUrl as string) ?? '',
    },
    summary: (p.summary as string) ?? '',
    educations: Array.isArray(p.education)
      ? (p.education as CvRenderData['educations'])
      : [],
    experiences: Array.isArray(p.experience)
      ? (p.experience as CvRenderData['experiences'])
      : [],
    skills: Array.isArray(p.skills)
      ? (p.skills as Array<string | { name?: string; level?: number }>).map((s) => {
          if (typeof s === 'string') return { name: s };
          return { name: s.name ?? '', level: typeof s.level === 'number' ? s.level : undefined };
        })
      : [],
    projects: Array.isArray(p.projects)
      ? (p.projects as CvRenderData['projects'])
      : [],
    certificates: Array.isArray(p.certifications)
      ? (p.certifications as CvRenderData['certificates'])
      : [],
    activities: Array.isArray(p.activities)
      ? (p.activities as CvRenderData['activities'])
      : [],
    interests: Array.isArray(p.interests) ? (p.interests as string[]) : [],
  };
};

/* ============================================================================
 * useCvRenderData — composable fetch CV render data từ BE.
 *
 * Dùng khi caller chỉ có `cvId` (không có full data sẵn). Hỗ trợ 2 mode:
 *   - Bearer auth: mặc định — `http` interceptor tự gắn Bearer từ localStorage.
 *   - HMAC token: truyền `token` ref → gọi public endpoint với token trong
 *     query string (Playwright print page — không có localStorage).
 *
 * State exposed:
 *   - `data`     : CvRenderData | null  — null khi chưa fetch xong hoặc lỗi
 *   - `templateId` : number | null
 *   - `loading`  : boolean
 *   - `error`    : string | null
 *   - `dispose`  : manual cleanup (cho test ngoài component context)
 *
 * Caller watch `data` để biết khi nào render xong.
 *
 * Race + leak fix (tương tự Bug 1 + Bug 3 đã fix cho useDocxRenderer):
 *   - AbortController per fetch: mỗi fetch tạo AbortController riêng, abort
 *     request cũ trước khi tạo mới → click CV-A rồi CV-B nhanh, fetch A bị
 *     abort → user chỉ thấy data B (tránh data corruption).
 *   - `isComponentMounted` flag + `onUnmounted`: khi component dùng composable
 *     bị huỷ giữa lúc đang fetch → response trả về không ghi vào data.value
 *     (tránh set state trên component đã destroy → Vue warning hoặc stale UI).
 *   - AbortError / CanceledError filter ở catch: axios 1.x throw CanceledError
 *     khi abort → không set error state (im lặng, tránh UI flash error).
 *
 * Caller KHÔNG cần guard thêm — composable tự cleanup. Component lifecycle:
 *   - CvPreview inline mode: cvId đổi khi user đổi CV (prop binding).
 *   - CvPrintView (Playwright): cvId + token extract từ URL, 1 lần mount/unmount.
 * ==========================================================================*/
export const useCvRenderData = (
  cvId: Ref<string | null>,
  token: Ref<string | null> = ref(null),
): {
  data: Ref<CvRenderData | null>;
  templateId: Ref<number | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  refresh: () => Promise<void>;
  dispose: () => void;
} => {
  const data = ref<CvRenderData | null>(null);
  const templateId = ref<number | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Race + leak state — KHÔNG exposed ra ngoài.
  let activeController: AbortController | null = null;
  let isComponentMounted = true;

  /**
   * Manual cleanup cho test (ngoài component context). Component thật dùng
   * `onUnmounted` tự register; test gọi dispose() trực tiếp để simulate unmount.
   * Idempotent — gọi nhiều lần OK.
   */
  const dispose = (): void => {
    isComponentMounted = false;
    activeController?.abort();
  };
  onUnmounted(dispose);

  // Mỗi lần cvId hoặc token đổi → fetch lại.
  const fetchData = async (): Promise<void> => {
    const id = cvId.value;
    if (!id) {
      // Clear state khi cvId = null. Guard isMounted phòng edge case hiếm:
      // watch fire 1 lần cuối trước khi component destroy.
      if (!isComponentMounted) return;
      data.value = null;
      templateId.value = null;
      error.value = 'Thiếu cvId.';
      return;
    }

    // Abort request cũ (nếu có) trước khi tạo request mới — core của race fix.
    // Click CV-A rồi click CV-B nhanh → A abort → B chạy độc lập → data.value
    // chỉ chứa B. Không có abort → 2 fetch chạy parallel → B resolve xong,
    // A resolve sau → data bị A overwrite.
    activeController?.abort();
    const ctrl = new AbortController();
    activeController = ctrl;

    if (!isComponentMounted) return;
    loading.value = true;
    error.value = null;

    try {
      // Axios 1.x chấp nhận `signal` option trong config để cancel request qua
      // AbortController. Khi ctrl.abort() → axios throw AxiosError với
      // code='ERR_CANCELED', name='CanceledError'.
      const { data: resp } = await cvApi.getRenderData(id, token.value ?? undefined, {
        signal: ctrl.signal,
      });
      const row: CvRenderRow = resp.data;

      // Guard unmount SAU await — response có thể trả về SAU khi component đã
      // destroy (unmount giữa lúc fetch). Nếu set state trên unmounted ref →
      // Vue 3 warn "Set operation on key X failed".
      if (!isComponentMounted) return;
      // Guard abort: nếu request này đã bị abort bởi fetch mới → skip.
      if (ctrl.signal.aborted) return;

      if (row.source !== 'direct' || !row.templateId) {
        error.value = 'CV không hỗ trợ render (chỉ CV direct có templateId).';
        data.value = null;
        templateId.value = null;
        return;
      }
      templateId.value = row.templateId;
      data.value = buildRenderData({
        parsedData: row.parsedData,
        title: row.title,
      });
    } catch (err) {
      // Filter cancel — axios throw CanceledError (code='ERR_CANCELED'),
      // hoặc DOMException 'AbortError' trên một số browser/phiên bản.
      // KHÔNG set error state cho cancel (fetch mới sẽ set riêng).
      const errAny = err as { name?: string; code?: string };
      if (
        errAny?.name === 'AbortError' ||
        errAny?.name === 'CanceledError' ||
        errAny?.code === 'ERR_CANCELED'
      ) {
        return;
      }
      if (!isComponentMounted) return;
      // axios.isAxiosError(err) covers network errors + HTTP error responses.
      // Error response shape: { success: false, error: { code, message } }.
      const axErr = err as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
      const status = axErr.response?.status ?? '?';
      const msg = axErr.response?.data?.error?.message ?? axErr.message ?? String(err);
      error.value = `Không thể tải CV render data: ${status} ${msg}`;
      data.value = null;
      templateId.value = null;
    } finally {
      // Chỉ clear loading nếu đây vẫn là request active (không bị abort bởi
      // request mới). Tránh flash loading=false giữa 2 request liên tiếp.
      if (activeController === ctrl && isComponentMounted) {
        loading.value = false;
      }
    }
  };

  // Auto-fetch khi cvId/token thay đổi. immediate: true để chạy lần đầu.
  watch([cvId, token], fetchData, { immediate: true });

  return { data, templateId, loading, error, refresh: fetchData, dispose };
};
