/**
 * Application API client — 8 endpoints:
 *   - POST  /applications                       candidate apply
 *   - GET   /applications/me                   candidate list
 *   - GET   /applications/job/:jobId           employer list cho 1 job
 *   - GET   /applications/company              employer list cho tất cả company mình là member
 *   - GET   /applications/:id                  candidate/employer xem detail
 *   - PATCH /applications/:id/status           employer update status
 *   - POST  /applications/:id/recompute-match  employer yêu cầu chấm lại AI match
 *   - PATCH /applications/:id/withdraw         candidate rút đơn ứng tuyển
 *
 * Pattern giống các api khác: trả AxiosResponse, KHÔNG unwrap ở đây.
 * Caller tự destruct `const { data } = await ...` rồi lấy `data.data`.
 */
import { http } from './http';
import type {
  ApplicationDetail,
  CreateApplicationBody,
  CreatedApplication,
  ListApplicationQuery,
  ListEmployerResult,
  ListMineResult,
  RecomputeMatchResult,
  UpdatedStatus,
  UpdateStatusBody,
} from '@/types/application';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const applicationApi = {
  /** POST /applications — candidate apply job.
   *  Trả 201 với { id, status='pending' }. Backend side-effect:
   *  - notify employer (application_new)
   *  - enqueue cv-match worker (nếu có CV snapshot)
   *  - nếu queue/Redis down → vẫn 201 OK, matching sẽ skip → employer có thể
   *    bấm "So khớp AI" để retry. */
  create: (body: CreateApplicationBody) =>
    http.post<ApiResponse<CreatedApplication>>('/applications', body),

  /** GET /applications/me — danh sách application của candidate hiện tại.
   *  Query: ?status, ?page, ?limit */
  listMine: (params?: ListApplicationQuery) =>
    http.get<ApiResponse<ListMineResult>>('/applications/me', { params }),

  /** GET /applications/:id — full detail 1 application (drawer / page).
   *  Auth: candidate chỉ xem của mình; employer chỉ xem nếu owns job.
   *  Trả 404 nếu không match để không leak existence. */
  getById: (id: string) =>
    http.get<ApiResponse<ApplicationDetail>>(`/applications/${id}`),

  /** GET /applications/job/:jobId — danh sách application cho 1 job.
   *  Auth: employer (phải là postedBy của job) hoặc admin. */
  listByJob: (jobId: string, params?: ListApplicationQuery) =>
    http.get<ApiResponse<ListEmployerResult>>(`/applications/job/${jobId}`, { params }),

  /** GET /applications/company — danh sách application của TẤT CẢ company
   *  user là active member. Có thể filter ?jobId để chỉ xem 1 job. */
  listByCompany: (params?: ListApplicationQuery) =>
    http.get<ApiResponse<ListEmployerResult>>('/applications/company', { params }),

  /** PATCH /applications/:id/status — employer đổi status/stage. */
  updateStatus: (id: string, body: UpdateStatusBody) =>
    http.patch<ApiResponse<UpdatedStatus>>(`/applications/${id}/status`, body),

  /** POST /applications/:id/recompute-match — employer yêu cầu chấm lại AI match.
   *  Trả 202 vì matching chạy async. Đợi socket 'application:match-ready' để biết khi xong. */
  recomputeMatch: (id: string) =>
    http.post<ApiResponse<RecomputeMatchResult>>(`/applications/${id}/recompute-match`, {}),

  /** PATCH /applications/:id/withdraw — candidate rút đơn ứng tuyển.
   *  Chỉ rút được khi status='pending' hoặc 'viewed'. Idempotent nếu đã withdrawn.
   *  Trả { id, status='withdrawn' }. Side-effect: notify employer realtime. */
  withdraw: (id: string) =>
    http.patch<ApiResponse<CreatedApplication>>(`/applications/${id}/withdraw`, {}),
};
