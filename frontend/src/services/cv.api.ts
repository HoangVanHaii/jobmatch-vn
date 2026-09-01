/**
 * CV API — tầng giao tiếp với backend /api/v1/cvs.
 *
 * Luồng: gọi qua http.ts (axios + auto refresh token), trả AxiosResponse,
 * không unwrap ở đây. Nơi gọi tự destruct `const { data } = await ...`.
 *
 * Endpoint backend (router cv.ts):
 *   POST /cvs/upload                upload CV (đã có file URL từ MinIO)
 *   GET  /cvs                       list CV của candidate (?source=upload|direct)
 *   GET  /cvs/:cvId                 chi tiết 1 CV (full row)
 *   POST /cvs/direct                tạo CV thủ công từ form web
 *   PATCH /cvs/:cvId/primary        đặt CV primary
 *   GET  /cvs/:cvId/render-data     public, slim row cho render (HMAC token)
 */
import { http } from './http';
import type {
  CreateDirectCvInput,
  CreateUploadCvInput,
  Cv,
  CvDetail,
  CvSource,
  ListCvQuery,
  ListCvResponse,
} from '@/types/cv';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/** Slim row trả về từ GET /cvs/:cvId/render-data — chỉ field cần để render CV. */
export interface CvRenderRow {
  id: string;
  title: string | null;
  source: CvSource;
  templateId: number | null;
  parsedData: Record<string, unknown> | null;
}

export const cvApi = {
  /** POST /cvs/upload — create CV row với source='upload' (file đã lên MinIO). */
  upload: (data: CreateUploadCvInput) =>
    http.post<ApiResponse<Cv>>('/cvs/upload', data),

  /** GET /cvs — list CV (ẩn deleted); optional ?source, ?limit, ?offset. */
  list: (params?: ListCvQuery) =>
    http.get<ApiResponse<ListCvResponse>>('/cvs', { params }),

  /** GET /cvs/:cvId — full row. */
  getDetail: (cvId: string) =>
    http.get<ApiResponse<CvDetail>>(`/cvs/${cvId}`),

  /** POST /cvs/direct — tạo CV từ form web (title + templateId bắt buộc). */
  create: (data: CreateDirectCvInput) =>
    http.post<ApiResponse<Cv>>('/cvs/direct', data),

  /** PATCH /cvs/:cvId/primary — set primary (transaction reset các CV khác). */
  setPrimary: (cvId: string) =>
    http.patch<ApiResponse<Cv>>(`/cvs/${cvId}/primary`),

  /** POST /cvs/:cvId/analyze — trigger lại CV analysis (enqueue worker). */
  triggerAnalysis: (cvId: string) =>
    http.post<ApiResponse<Cv>>(`/cvs/${cvId}/analyze`),

  /** DELETE /cvs/:cvId — soft-delete CV (status='deleted', có reset primary invariant). */
  remove: (cvId: string) =>
    http.delete<ApiResponse<Cv>>(`/cvs/${cvId}`),

  /**
   * GET /cvs/:cvId/render-data — public endpoint, authorize bằng HMAC token
   * trong query string (KHÔNG yêu cầu Bearer).
   *
   * Mount ở cvRouter TRƯỚC auth middleware. Dùng bởi:
   *   - `<CVView>` Mode 3 (Playwright print page)
   *   - Sau này có thể: share link, recruiter preview qua signed URL
   *
   * Đi qua `http` instance để tận dụng auto-refresh interceptor (dù
   * endpoint public, vẫn consistent với codebase pattern). Khi gọi từ
   * Playwright: không có localStorage `access_token` → interceptor skip
   * Bearer → request đi ra với chỉ HMAC token trong query, đúng spec.
   *
   * @param cvId - ID CV cần lấy render data
   * @param token - Optional HMAC signed token (Playwright print page). Nếu
   *   không truyền → request vẫn hợp lệ cho endpoint public, nhưng BE sẽ
   *   reject với 401 vì không có token (route yêu cầu token bắt buộc).
   */
  getRenderData: (cvId: string, token?: string) =>
    http.get<ApiResponse<CvRenderRow>>(
      `/cvs/${encodeURIComponent(cvId)}/render-data`,
      { params: token ? { token } : {} },
    ),
};
