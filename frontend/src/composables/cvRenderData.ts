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
import { ref, watch, type Ref } from 'vue';
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
      ? (p.skills as string[]).map((name) => ({ name }))
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
 *
 * Caller watch `data` để biết khi nào render xong.
 *
 * Lưu ý:
 *   - Đi qua `cvApi` (services layer) → `http` (axios + interceptors) → BE.
 *     KHÔNG import axios trực tiếp — bỏ qua sẽ mất auto-refresh on 401.
 *   - Mount trong setup() của component, lifecycle gắn với component đó.
 *     Nếu component unmount giữa chừng → fetch vẫn chạy (axios không cancel).
 *     Caller cần guard unmount state nếu cần thiết.
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
} => {
  const data = ref<CvRenderData | null>(null);
  const templateId = ref<number | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Mỗi lần cvId hoặc token đổi → fetch lại.
  const fetchData = async (): Promise<void> => {
    const id = cvId.value;
    if (!id) {
      data.value = null;
      templateId.value = null;
      error.value = 'Thiếu cvId.';
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const { data: resp } = await cvApi.getRenderData(id, token.value ?? undefined);
      const row: CvRenderRow = resp.data;
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
      // axios.isAxiosError(err) covers network errors + HTTP error responses.
      // Error response shape: { success: false, error: { code, message } }.
      const axErr = err as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
      const status = axErr.response?.status ?? '?';
      const msg = axErr.response?.data?.error?.message ?? axErr.message ?? String(err);
      error.value = `Không thể tải CV render data: ${status} ${msg}`;
      data.value = null;
      templateId.value = null;
    } finally {
      loading.value = false;
    }
  };

  // Auto-fetch khi cvId/token thay đổi. immediate: true để chạy lần đầu.
  watch([cvId, token], fetchData, { immediate: true });

  return { data, templateId, loading, error, refresh: fetchData };
};
