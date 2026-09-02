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
