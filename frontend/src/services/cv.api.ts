/**
 * CV API — tầng giao tiếp với backend /api/v1/cvs.
 *
 * Luồng: gọi qua http.ts (axios + auto refresh token), trả AxiosResponse,
 * không unwrap ở đây. Nơi gọi tự destruct `const { data } = await ...`.
 *
 * Endpoint backend (router cv.ts):
 *   POST /cvs/upload         upload CV (đã có file URL từ MinIO)
 *   GET  /cvs                list CV của candidate (?source=upload|direct)
 *   GET  /cvs/:cvId          chi tiết 1 CV (full row)
 *   POST /cvs/direct         tạo CV thủ công từ form web
 *   PATCH /cvs/:cvId/primary đặt CV primary
 */
import { http } from './http';
import type {
  CreateDirectCvInput,
  CreateUploadCvInput,
  Cv,
  CvDetail,
  ListCvQuery,
  ListCvResponse,
} from '@/types/cv';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
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
};
