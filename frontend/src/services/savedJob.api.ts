/**
 * Saved job API client — `GET/POST/DELETE /api/v1/saved-jobs`.
 *
 * Auth: Tất cả endpoint đều yêu cầu đăng nhập (backend `auth` middleware).
 *
 * Pattern giống `job.api.ts`: trả `AxiosResponse`, caller unwrap `data.data`.
 */
import { http } from './http';
import type { ListSavedJobsQuery, ListSavedJobsResponse } from '@/types/savedJob';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const savedJobApi = {
  /**
   * GET /saved-jobs — danh sách job đã lưu (sort theo savedAt DESC ở backend).
   * Có filter jobLevel/jobType/remoteOk/industry + pagination.
   */
  list: (params?: ListSavedJobsQuery) =>
    http.get<ApiResponse<ListSavedJobsResponse['data']> & {
      pagination: ListSavedJobsResponse['pagination'];
    }>('/saved-jobs', { params }),

  /**
   * GET /saved-jobs/ids — chỉ trả `jobId[]` (không join jobs/companies).
   * Nhẹ hơn nhiều so với `list()` — dùng cho client build Set<string> để
   * render bookmark icon (vd JobSearchView). Cap limit 500 ở BE.
   */
  ids: (params?: { limit?: number }) =>
    http.get<ApiResponse<string[]>>('/saved-jobs/ids', { params }),

  /** POST /saved-jobs — lưu 1 job (body: { jobId }). Idempotent nếu backend dùng ON CONFLICT. */
  save: (jobId: string) =>
    http.post<ApiResponse<{ userId: string; jobId: string; savedAt: Date }>>(
      '/saved-jobs',
      { jobId },
    ),

  /** DELETE /saved-jobs/:jobId — bỏ lưu. */
  unsave: (jobId: string) =>
    http.delete<ApiResponse<{ userId: string; jobId: string }>>(
      `/saved-jobs/${jobId}`,
    ),
};
