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

/**
 * Mirror `hiring_status` enum ở backend (migration 0038). Employer set thủ
 * công — FE chỉ đọc + render badge tương ứng.
 *   - `urgent` : badge "Urgently Hiring" (màu hồng/đỏ)
 *   - `active` : badge "Actively Hiring" (màu xanh lá)
 *   - `normal` : không render badge
 */
export type HiringStatus = 'urgent' | 'active' | 'normal';

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
  descriptions: string | null;
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
  /** Badge status cho JobSearchView — mirror DB cột `hiring_status`. */
  hiringStatus: HiringStatus;
  viewsCount: number;
  appliesCount: number;
  publishedAt: Date | null;
  /** Ngày tạo job — BE sort theo field này (publishedAt NULL với draft/flagged/closed). */
  createdAt: Date;
  /**
   * Trung bình rating 1–5 (1 chữ số thập phân) từ `job_feedbacks`. `null`
   * khi job chưa có feedback. Tính bằng correlated subquery trong
   * `jobService.list` SELECT — dùng index `idx_job_feedbacks_job(job_id,
   * createdAt)`. FE dùng để hiển thị icon sao + số sau company name.
   */
  ratingAvg: number | null;
  /** Số feedback của job. Companion của `ratingAvg`. */
  ratingCount: number;
  /** Description ngắn gọn — BE trả ở list để render card (JobSearchView). */
  description?: string | null;
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
  /**
   * Per-criterion breakdown 0-100 — extract từ `aiMatchReasoning` JSONB. FE render
   * 3 bars trong card "Your Scope" của JobDetailView (Experience / Industry / Skills).
   * Null khi application cũ / terminal state / LLM skip. FE fallback 0% + badge.
   */
  aiExperienceScore?: number | null;
  aiIndustryScore?: number | null;
  aiSkillsScore?: number | null;
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

// ============================================================================
// Applicants-over-time chart (JobDetailView SVG chart)
// ============================================================================

/** 1 điểm timeseries — `date` format DD/MM, `count` applicants ngày đó. */
export interface ApplicantsOverTimePoint {
  date: string;
  count: number;
}

/**
 * Response `GET /jobs/:id/applicants-over-time?days=N` — series fill đủ N ngày
 * gần nhất (kể cả 0 applicant), `peak` là điểm count cao nhất (null nếu all 0).
 */
export interface ApplicantsOverTimeResponse {
  success: boolean;
  data: {
    series: ApplicantsOverTimePoint[];
    peak: ApplicantsOverTimePoint | null;
    totalApplicants: number;
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

/**
 * Response của GET /api/v1/jobs/cities — danh sách city distinct đã strip
 * prefix "Thành phố "/"Tỉnh " (sorted ASC theo locale vi). Dùng cho Location
 * filter dropdown ở JobSearchView.
 */
export interface ListCitiesResponse {
  success: boolean;
  data: string[];
}

/**
 * Response của GET /api/v1/jobs/job-types — danh sách JobType enum values
 * từ DB enum `job_type` (sorted theo enumsortorder). Dùng cho JobType filter
 * dropdown ở JobSearchView — sync với backend, không hardcode.
 */
export interface ListJobTypesResponse {
  success: boolean;
  data: string[];
}

/**
 * Response của GET /api/v1/jobs/job-levels — danh sách JobLevel enum values
 * từ DB enum `job_level` (sorted theo enumsortorder). Dùng cho Experience
 * Level filter dropdown ở JobSearchView.
 */
export interface ListJobLevelsResponse {
  success: boolean;
  data: string[];
}

/**
 * Response của GET /jobs/salary-range — min/max salary (VND) trên toàn bộ
 * job `live`. Dùng để set bounds cho Salary range slider ở JobSearchView.
 */
export interface SalaryRangeResponse {
  success: boolean;
  data: { min: number; max: number };
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
  /**
   * Salary range filter (VND). Cả 2 optional; backend dùng overlap semantics
   * khi truyền cả 2: `job.salary_max >= user.salary_min AND
   * job.salary_min <= user.salary_max` (chuẩn LinkedIn/Indeed UX). Truyền
   * `undefined` (không truyền key) để clear filter trong store.
   */
  salaryMin?: number;
  salaryMax?: number;
  page?: number;
  limit?: number;
}