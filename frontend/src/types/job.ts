/**
 * Job types — mirror 1:1 với backend `src/interface/job.ts`.
 * Update cả 2 cùng nhau khi schema đổi.
 */

export type JobLevel =
  | 'intern' | 'fresher' | 'junior' | 'mid'
  | 'senior' | 'lead' | 'manager';

export type JobType =
  | 'full-time' | 'part-time' | 'contract' | 'internship' | 'freelance';

export type JobStatus =
  | 'draft' | 'pending' | 'ai_scanning' | 'ai_flagged'
  | 'live' | 'expired' | 'closed';

export interface JobLocation {
  city?: string;
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

/**
 * Shape trả về bởi GET /api/v1/jobs (list) — đã LEFT JOIN companies.
 * FE dùng trực tiếp để render card, KHÔNG cần thêm request.
 */
export interface JobListItem {
  id: string;
  title: string;
  slug: string | null;
  companyId: string;
  companyName: string | null;
  companyLogoUrl: string | null;
  jobLevel: JobLevel | null;
  jobType: JobType | null;
  industry: string | null;
  salaryMin: string | null;
  salaryMax: string | null;
  salaryCurrency: string | null;
  salaryVisible: boolean | null;
  location: JobLocation | null;
  remoteOk: boolean | null;
  deadline: Date | null;
  status: JobStatus;
  viewsCount: number;
  appliesCount: number;
  publishedAt: Date | null;
  /** Ngày tạo job — BE sort theo field này (publishedAt NULL với draft/flagged/closed). */
  createdAt: Date;
  /**
   * User id của recruiter đăng job — chat với employer yêu cầu field này.
   * BE chỉ trả ở detail (`getBySlug` returning all cols); list thường KHÔNG
   * có → marked optional. FE dùng để tạo conversation qua `chatApi.createOrGet`.
   */
  postedBy?: string | null;
}

/**
 * Full job shape từ GET /api/v1/jobs/:id — extends list item với description,
 * requirements, benefits, skills, experience years. `featured` không có trong
 * list nhưng luôn có ở detail (default false ở DB).
 *
 * Mở rộng thêm `feedbacks` + `feedbackStats` từ `job_feedbacks` — BE nhúng luôn
 * vào detail để FE không phải gọi thêm API. `feedbacks` mới nhất trước, cap 200.
 */
export interface JobDetail extends JobListItem {
  description: string;
  requirements: string | null;
  benefits: string | null;
  experienceYearsMin: number | null;
  experienceYearsMax: number | null;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  featured: boolean;
  featuredUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  extraData: Record<string, unknown> | null;
  /** Danh sách feedback của candidate cho job này (mới nhất trước). */
  feedbacks: JobFeedback[];
  /** Aggregate rating. */
  feedbackStats: JobRatingStats;
}

/**
 * 1 feedback của candidate cho job — mirror backend `JobFeedback`.
 *
 * `isMine` true khi feedback thuộc về candidate đang request (BE populate
 * dựa trên session). FE dùng để highlight + cho phép sửa.
 */
export interface JobFeedback {
  id: string;
  jobId: string;
  candidateId: string;
  candidateName: string | null;
  rating: number; // 1-5
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  isMine?: boolean;
}

/** Aggregate rating cho job — count + trung bình (1 chữ số thập phân). */
export interface JobRatingStats {
  count: number;
  /** null khi chưa có feedback nào. */
  average: number | null;
}

/** Body POST /jobs/:id/feedbacks — candidate tạo/sửa feedback. */
export interface CreateJobFeedbackBody {
  rating: number; // 1-5
  comment?: string | null;
}

/** Response POST /jobs/:id/feedbacks. */
export interface CreateJobFeedbackResponse {
  success: boolean;
  data: JobFeedback;
}

/** Response GET /jobs/:id/feedbacks/me — null khi chưa rate. */
export interface MyJobFeedbackResponse {
  success: boolean;
  data: JobFeedback | null;
}

// ============================================================================
// Application status (candidate-self view)
// ============================================================================

/** Mirror backend `ApplicationStatusValue`. */
export type JobApplicationStatusValue =
  | 'pending'
  | 'viewed'
  | 'screening'
  | 'interview'
  | 'offered'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

/** Lý do terminal của AI matching worker (xem backend `AiMatchReason`). */
export type JobAiMatchReason = 'success' | 'quota_exceeded' | 'failed' | null;

/**
 * Response `GET /jobs/by-slug/:slug/application-status` — danh sách application
 * của candidate hiện tại cho job này (1 entry/CV đã apply).
 * Mảng rỗng khi chưa apply CV nào.
 */
export interface JobApplicationStatus {
  status: JobApplicationStatusValue;
  applicationId: string;
  appliedAt: string;
  /** CV đã dùng để apply. `null` nếu CV đã bị xoá (CASCADE). */
  cvId: string;
  cvTitle: string | null;
  /** Điểm AI match 0-100, làm tròn 1 chữ số thập phân. `null` nếu chưa chấm. */
  aiMatchScore: number | null;
  aiMatchReason: JobAiMatchReason;
}

/** Response wrapper cho application-status endpoint — mảng JobApplicationStatus. */
export interface JobApplicationStatusResponse {
  success: boolean;
  data: JobApplicationStatus[];
}

export interface JobListResponse {
  success: boolean;
  data: JobListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface JobDetailResponse {
  success: boolean;
  data: JobDetail;
}

/** Response của GET /api/v1/jobs/industries — danh sách industry distinct (sorted ASC). */
export interface ListIndustriesResponse {
  success: boolean;
  data: string[];
}

/** Query params cho GET /jobs. Mọi field optional — backend default = không filter. */
export interface ListJobQuery {
  search?: string;
  jobLevel?: JobLevel;
  jobType?: JobType;
  /**
   * Filter theo status. Single value là đủ cho UI dropdown hiện tại.
   * Backend (Zod) cũng chấp nhận comma-joined string `?status=live,ai_scanning`
   * nếu sau này cần multi-select.
   *  - Public `/jobs` (candidate): nếu không truyền → backend mặc định chỉ trả 'live'.
   *  - Employer `/jobs/company`: nếu không truyền → backend trả mọi status.
   */
  status?: JobStatus;
  locationCity?: string;
  remoteOk?: boolean;
  industry?: string;
  page?: number;
  limit?: number;
}