/**
 * Admin Job API — endpoints riêng cho admin (bypass ownership).
 * Mount tại /admin/jobs qua BE router.
 *
 * Lưu ý: Endpoint này trả TẤT CẢ status job (không filter 'live'),
 * khác với /jobs public chỉ trả 'live'.
 */
import { http } from './http';
import type { JobListItem, JobDetail, JobListResponse } from '@/types/job';

export type AdminJobSort = 'newest' | 'oldest' | 'views' | 'applies';

export interface AdminJobListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string[];     // CSV array: 'live,pending,...'
  jobLevel?: string;
  jobType?: string;
  industry?: string;
  locationCity?: string;
  remoteOk?: boolean;
  sort?: AdminJobSort;
}

export interface AdminJobCounts {
  total: number;
  /** Tổng applicants trên TOÀN BỘ job (không phụ thuộc filter/page) — dùng cho hero stat. */
  totalApplicants: number;
  byStatus: Record<string, number>;
}

export const adminJobApi = {
  /** GET /admin/jobs — list tất cả jobs (admin) */
  list: (params: AdminJobListParams = {}) => {
    const clean: Record<string, string | number | boolean> = {};
    if (params.page) clean.page = params.page;
    if (params.limit) clean.limit = params.limit;
    if (params.search) clean.search = params.search;
    if (params.status && params.status.length > 0) clean.status = params.status.join(',');
    if (params.jobLevel) clean.jobLevel = params.jobLevel;
    if (params.jobType) clean.jobType = params.jobType;
    if (params.industry) clean.industry = params.industry;
    if (params.locationCity) clean.locationCity = params.locationCity;
    if (params.remoteOk !== undefined) clean.remoteOk = String(params.remoteOk);
    if (params.sort) clean.sort = params.sort;
    return http.get<{ data: JobListItem[]; pagination: JobListResponse['pagination'] }>(
      '/admin/jobs',
      { params: clean },
    );
  },

  /** GET /admin/jobs/counts — tổng + breakdown theo status.
   *  BE trả `{ success: true, total, byStatus }` (không wrap `data`) — generic = AdminJobCounts. */
  counts: () =>
    http.get<AdminJobCounts>('/admin/jobs/counts'),

  /** GET /admin/jobs/:id — BE trả `{ success: true, data: JobDetail }`. */
  detail: (id: string) =>
    http.get<{ data: JobDetail }>(`/admin/jobs/${id}`),

  /** PATCH /admin/jobs/:id/status — admin override status */
  changeStatus: (id: string, status: string) =>
    http.patch<{ message: string }>(`/admin/jobs/${id}/status`, { status }),
};
