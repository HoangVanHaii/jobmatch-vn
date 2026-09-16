import { http } from './http';
import type {
  ApplicantsOverTimeResponse,
  JobDetail,
  JobFeedback,
  JobListItem,
  JobListResponse,
  JobRatingStats,
  ListCitiesResponse,
  ListIndustriesResponse,
  ListJobLevelsResponse,
  ListJobTypesResponse,
  ListJobQuery,
  CreateJobFeedbackBody,
  CreateJobFeedbackResponse,
  MyJobFeedbackResponse,
  JobApplicationStatusResponse,
  SalaryRangeResponse,
} from '@/types/job';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const jobApi = {
  list: (params?: ListJobQuery) =>
    http.get<ApiResponse<JobListItem[]> & { pagination: JobListResponse['pagination'] }>(
      '/jobs',
      { params },
    ),

  detail: (id: string) =>
    http.get<ApiResponse<JobDetail>>(`/jobs/${id}`),

  bySlug: (slug: string) =>
    http.get<ApiResponse<JobDetail>>(`/jobs/by-slug/${slug}`),

  search: (keyword: string, page = 1, limit = 20) =>
    http.get<ApiResponse<JobListItem[]> & { pagination: JobListResponse['pagination'] }>(
      '/jobs/search',
      { params: { keyword, page, limit } },
    ),

  semanticSearch: (query: string, opts?: { threshold?: number; locationCity?: string; limit?: number }) =>
    http.get<ApiResponse<JobListItem[]> & { meta: { query: string; threshold: number } }>(
      '/jobs/search/semantic',
      { params: { query, ...opts } },
    ),

  industries: () =>
    http.get<ListIndustriesResponse>('/jobs/industries'),

  /**
   * Distinct cities của các job `live` (đã strip prefix "Thành phố "/"Tỉnh ").
   * Dùng cho Location filter dropdown ở JobSearchView.
   */
  cities: () =>
    http.get<ListCitiesResponse>('/jobs/cities'),

  /**
   * JobType enum values từ DB (`job_type` enum) — full-time, part-time,
   * contract, internship, freelance. Dùng cho JobType filter dropdown ở
   * JobSearchView, sync với backend enum.
   */
  jobTypes: () =>
    http.get<ListJobTypesResponse>('/jobs/job-types'),

  /**
   * JobLevel enum values từ DB (`job_level` enum) — intern, fresher, junior,
   * mid, senior, lead, manager. Dùng cho Experience Level filter dropdown
   * ở JobSearchView, sync với backend enum.
   */
  jobLevels: () =>
    http.get<ListJobLevelsResponse>('/jobs/job-levels'),

  /**
   * Min/max salary (VND) trên toàn bộ job `live` — bounds cho Salary range
   * slider ở JobSearchView. Return `{ min: 0, max: 0 }` nếu DB chưa có data.
   */
  salaryRange: () =>
    http.get<SalaryRangeResponse>('/jobs/salary-range'),

 listByCompany: (params?: ListJobQuery) =>
    http.get<ApiResponse<JobListItem[]> & { pagination: JobListResponse['pagination'] }>(
      '/jobs/company',
      { params },
    ),

  create: (data: unknown) => http.post<ApiResponse<JobListItem>>('/jobs', data),

  generate: (data: { keyword: string; companyName?: string }) =>
    http.post<ApiResponse<unknown>>('/jobs/generate', data),

  update: (id: string, data: unknown) =>
    http.patch<ApiResponse<JobListItem>>(`/jobs/${id}`, data),

  delete: (id: string) => http.delete<ApiResponse<{ id: string }>>(`/jobs/${id}`),

  reopen: (id: string) =>
    http.post<ApiResponse<{ message: string }>>(`/jobs/${id}/reopen`, {}),

  submit: (id: string) =>
    http.post<ApiResponse<{ message: string }>>(`/jobs/${id}/submit`, {}),

  resubmit: (id: string) =>
    http.post<ApiResponse<{ message: string }>>(`/jobs/${id}/resubmit`, {}),

  scanResult: (id: string) =>
    http.get<ApiResponse<unknown>>(`/jobs/${id}/scan-result`),

  matches: (id: string) =>
    http.get<ApiResponse<unknown[]>>(`/jobs/${id}/matches`),

  apply: (_jobId: string, _body: { cvId?: string; coverLetter?: string }) =>
    http.post<ApiResponse<{ id: string }>>('/jobs/apply', _body),

  listFeedbacks: (id: string) =>
    http.get<ApiResponse<JobFeedback[]> & { stats: JobRatingStats }>(
      `/jobs/${id}/feedbacks`,
    ),

  createFeedback: (id: string, body: CreateJobFeedbackBody) =>
    http.post<CreateJobFeedbackResponse>(`/jobs/${id}/feedbacks`, body),

  myFeedback: (id: string) =>
    http.get<MyJobFeedbackResponse>(`/jobs/${id}/feedbacks/me`),

  myApplicationStatus: (slug: string) =>
    http.get<JobApplicationStatusResponse>(`/jobs/by-slug/${slug}/application-status`),

  /**
   * Timeseries applicants cho JobDetailView chart.
   * Public — không cần auth, chỉ aggregate count.
   */
  applicantsOverTime: (jobId: string, days = 10) =>
    http.get<ApplicantsOverTimeResponse>(`/jobs/${jobId}/applicants-over-time`, {
      params: { days },
    }),
};