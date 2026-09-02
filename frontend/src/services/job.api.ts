/**
 * Job API client.
 *
 * - Public read (list, detail, search): không cần auth.
 * - Write endpoints (create/update/delete/apply/matches): chỉ dành cho employer/admin.
 *
 * Pattern giống `cv.api.ts`: trả `AxiosResponse`, unwrap `data.data` ở caller.
 */
import { http } from './http';
import type {
  JobDetail,
  JobListItem,
  JobListResponse,
  ListIndustriesResponse,
  ListJobQuery,
} from '@/types/job';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const jobApi = {
  /** GET /jobs — danh sách job `status='live'`, có filter + pagination. */
  list: (params?: ListJobQuery) =>
    http.get<ApiResponse<JobListItem[]> & { pagination: JobListResponse['pagination'] }>(
      '/jobs',
      { params },
    ),

  /** GET /jobs/:id — full detail. Side-effect: tăng viewsCount +1. */
  detail: (id: string) =>
    http.get<ApiResponse<JobDetail>>(`/jobs/${id}`),

  /** GET /jobs/search — full-text search (ts_rank order). */
  search: (keyword: string, page = 1, limit = 20) =>
    http.get<ApiResponse<JobListItem[]> & { pagination: JobListResponse['pagination'] }>(
      '/jobs/search',
      { params: { keyword, page, limit } },
    ),

  /** GET /jobs/search/semantic — vector similarity search. */
  semanticSearch: (query: string, opts?: { threshold?: number; locationCity?: string; limit?: number }) =>
    http.get<ApiResponse<JobListItem[]> & { meta: { query: string; threshold: number } }>(
      '/jobs/search/semantic',
      { params: { query, ...opts } },
    ),

  /** GET /jobs/industries — distinct industry từ các job `status='live'` (sorted ASC). */
  industries: () =>
    http.get<ListIndustriesResponse>('/jobs/industries'),

  /** GET /jobs/company — job thuộc company của employer hiện tại (auth required).
   *  Backend tự resolve companyId từ session user qua companyMembers. */
  listByCompany: (params?: ListJobQuery) =>
    http.get<ApiResponse<JobListItem[]> & { pagination: JobListResponse['pagination'] }>(
      '/jobs/company',
      { params },
    ),

  // === Employer-only (giữ cho admin/employer tool) ===

  /** POST /jobs */
  create: (data: unknown) => http.post<ApiResponse<JobListItem>>('/jobs', data),

  /**
   * POST /jobs/generate — AI generate JD draft từ keyword ngắn (5-500 ký tự).
   * Trả về `{ title, description, requirements, suggestedSkills,
   * suggestedJobLevel, suggestedJobType, suggestedLocation, suggestedSalaryMin,
   * suggestedSalaryMax, suggestedSalaryCurrency }` để fill vào form tạo job.
   * Có rate-limit (jobWriteRateLimiter) + quota tracking (gói hiện tại).
   */
  generate: (data: { keyword: string; companyName?: string }) =>
    http.post<ApiResponse<unknown>>('/jobs/generate', data),

  /** PATCH /jobs/:id */
  update: (id: string, data: unknown) =>
    http.patch<ApiResponse<JobListItem>>(`/jobs/${id}`, data),

  /** DELETE /jobs/:id (soft delete → status='closed') */
  delete: (id: string) => http.delete<ApiResponse<{ id: string }>>(`/jobs/${id}`),

  /**
   * POST /jobs/:id/reopen — owner mở lại job đã đóng (closed → draft).
   * Reverse của delete; KHÔNG tự gửi AI scan. Sau khi reopen, user cần
   * edit + bấm "Gửi kiểm duyệt AI" để quay lại pipeline moderation.
   * Backend gate: chỉ job `status='closed'` mới reopen được.
   */
  reopen: (id: string) =>
    http.post<ApiResponse<{ message: string }>>(`/jobs/${id}/reopen`, {}),

  /**
   * POST /jobs/:id/submit — owner gửi job cho AI moderation.
   * Chỉ job ở status='draft' mới submit được (backend kiểm tra).
   */
  submit: (id: string) =>
    http.post<ApiResponse<{ message: string }>>(`/jobs/${id}/submit`, {}),

  /**
   * POST /jobs/:id/resubmit — admin force re-scan (queue lại job, set
   * status='ai_scanning' rồi enqueue worker). Backend không check ownership
   * vì chỉ admin mới gọi được.
   */
  resubmit: (id: string) =>
    http.post<ApiResponse<{ message: string }>>(`/jobs/${id}/resubmit`, {}),

  /**
   * GET /jobs/:id/scan-result — lấy kết quả scan mới nhất + danh sách flag.
   * Owner hoặc admin mới xem được (backend `employerOnly` middleware + check
   * `job.postedBy`). Trả `null` nếu job chưa từng được scan.
   */
  scanResult: (id: string) =>
    http.get<ApiResponse<unknown>>(`/jobs/${id}/scan-result`),

  /** GET /jobs/:id/matches — top candidates match (stub). */
  matches: (id: string) =>
    http.get<ApiResponse<unknown[]>>(`/jobs/${id}/matches`),

  /**
   * POST /jobs/:id/apply — candidate ứng tuyển.
   * TODO: implement khi backend có endpoint /applications. Hiện tại ApplyJob.vue
   * (legacy stub) đang gọi hàm này với signature lệch — giữ chỗ để không vỡ TS.
   */
  apply: (_jobId: string, _body: { cvId?: string; coverLetter?: string }) =>
    http.post<ApiResponse<{ id: string }>>('/jobs/apply', _body),
};