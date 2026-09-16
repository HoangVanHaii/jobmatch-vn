/**
 * Job interfaces — API response & row shape.
 * Match với DB row (src/db/schema/jobs.ts) nhưng API-friendly (extraData là JSON object).
 */
export type JobLevel =
  | 'intern' | 'fresher' | 'junior' | 'mid'
  | 'senior' | 'lead' | 'manager';

export type JobType =
  | 'full-time' | 'part-time' | 'contract' | 'internship' | 'freelance';

export type JobStatus =
  | 'draft' | 'pending' | 'ai_scanning' | 'ai_flagged' | 'live' | 'expired' | 'closed';

/**
 * Trạng thái tuyển dụng do employer set thủ công — dùng cho badge UI ở
 * JobSearchView. Không tự compute từ deadline/engagement; chỉ phản ánh
 * ý định của employer.
 *   - `urgent` : badge "Urgently Hiring"
 *   - `active` : badge "Actively Hiring"
 *   - `normal` : không render badge
 * Xem migration 0038_add_hiring_status.sql.
 */
export type HiringStatus = 'urgent' | 'active' | 'normal';

export interface JobLocation {
  city?: string;
  district?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

/** Một job record — DB row đầy đủ (Drizzle inferred).
 *  Lưu ý: salaryCurrency/salaryVisible/remoteOk/featured lý thuyết nullable
 *  vì schema dùng `.default(...)` không `.notNull()`. Mặc dù DB luôn có giá trị
 *  (nhờ default), TS khoan dung null để khớp với Drizzle inferred type.
 *  searchTsv: tsvector GENERATED — không nên lộ ra API (TODO: loại bằng select). */
export interface Job {
  id: string;
  companyId: string;
  postedBy: string;
  title: string;
  slug: string | null;
  description: string;
  requirements: string | null;
  benefits: string | null;
  jobLevel: JobLevel | null;
  jobType: JobType | null;
  industry: string | null;
  salaryMin: string | null;        // Drizzle NUMERIC → string
  salaryMax: string | null;
  salaryCurrency: string | null;
  salaryVisible: boolean | null;
  location: JobLocation | null;
  remoteOk: boolean | null;
  experienceYearsMin: number | null;
  experienceYearsMax: number | null;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  deadline: Date | null;
  status: JobStatus;
  hiringStatus: HiringStatus;
  featured: boolean | null;
  featuredUntil: Date | null;
  viewsCount: number;
  appliesCount: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  extraData: Record<string, unknown> | null;
  /** @internal tsvector GENERATED — không nên lộ ra response client. */
  searchTsv: string | null;
}
// src/interface/job.ts — thêm
export interface JobListItem {
  id: string;
  title: string;
  slug: string | null;
  companyId: string;
  /**
   * Tên + logo công ty — LEFT JOIN từ bảng `companies` trong service để frontend
   * không phải gọi thêm API. NULL nếu job.companyId trỏ tới company đã xoá /
   * không tồn tại (LEFT JOIN bảo toàn job row).
   */
  companyName: string | null;
  companyLogoUrl: string | null;
  descriptions: string | null;
  jobLevel: JobLevel | null;
  jobType: JobType | null;
  industry: string | null;
  salaryMin: string | null;
  salaryMax: string | null;
  // requiredSkills: string[];
  // niceToHaveSkills: string[];
  salaryCurrency: string | null;
  salaryVisible: boolean | null;
  location: JobLocation | null;
  remoteOk: boolean | null;
  deadline: Date | null;
  status: JobStatus;
  /** Badge status cho FE — mirror cột `jobs.hiring_status` ở DB. Default
   *  'normal' (no badge). Xem `HiringStatus` + migration 0038. */
  hiringStatus: HiringStatus;
  viewsCount: number;
  appliesCount: number;
  publishedAt: Date | null;
  /** Ngày tạo job (NOT NULL, defaultNow). Dùng làm sort key trong
   *  jobService.list() vì `publishedAt` NULL với job draft/flagged/closed
   *  sẽ làm NULLS LAST đẩy job mới tạo xuống cuối danh sách. */
  createdAt: Date;
  /**
   * Trung bình rating 1–5 từ `job_feedbacks`, làm tròn 1 chữ số thập phân
   * (`numeric(3,1)`). `null` khi job chưa có feedback nào.
   * Tính bằng correlated subquery trong `jobService.list` SELECT — dùng index
   * `idx_job_feedbacks_job(job_id, createdAt)`, không ảnh hưởng pagination.
   */
  ratingAvg: number | null;
  /** Số feedback của job — `0` khi chưa có. Companion của `ratingAvg`. */
  ratingCount: number;
  // KHÔNG có: description, requirements, benefits, extraData, postedBy, searchTsv
}
/** GET /api/v1/jobs — danh sách có phân trang. */
export interface JobListResponse {
  success: boolean;
  data: Job[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** GET /api/v1/jobs/:id — chi tiết 1 job. */
export interface JobDetailResponse {
  success: boolean;
  data: Job;
}

/**
 * Payload mở rộng cho job detail — bao gồm Job row + feedbacks + aggregate.
 *
 * Lý do tách khỏi `Job`:
 *   - `feedbacks` + `feedbackStats` chỉ có ở detail endpoint, không có ở list.
 *   - Service getById query thêm 2 bảng (jobFeedbacks + users) → response nặng
 *     hơn list. Tách interface giúp caller biết rõ cost.
 *   - FE có thể check optional `feedbacks` để biết response từ endpoint nào.
 */
export interface JobDetailPayload extends Job {
  /** Danh sách feedback mới nhất trước, cap 200. Empty array nếu chưa có. */
  feedbacks: JobFeedback[];
  /** Aggregate rating — count + average. */
  feedbackStats: JobRatingStats;
}

/**
 * 1 feedback của candidate cho job — mirror `job_feedbacks` row + candidate info
 * qua LEFT JOIN `users`.
 *
 * `isMine` được set runtime bởi service khi trả response: true nếu feedback
 * thuộc về candidate đang request (để FE disable nút "Sửa"/"Xoá" feedback của
 * người khác). Với list public, FE chỉ dùng để hiển thị highlight "Đánh giá
 * của bạn" ở đầu list.
 */
export interface JobFeedback {
  id: string;
  jobId: string;
  candidateId: string;
  /** Tên candidate hiển thị (fallback 'Ứng viên ẩn danh' nếu null). */
  candidateName: string | null;
  rating: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Set bởi service khi requester đã auth — true nếu feedback này của họ. */
  isMine?: boolean;
}

/** Aggregate rating cho job — tính từ `job_feedbacks`. */
export interface JobRatingStats {
  count: number;
  /** Trung bình rating (1-5), làm tròn 1 chữ số thập phân. `null` nếu chưa có feedback. */
  average: number | null;
}

/** Response POST /jobs/:id/feedbacks — trả về feedback vừa tạo/sửa. */
export interface CreateJobFeedbackResponse {
  feedback: JobFeedback;
}

/** Response GET /jobs/:id/feedbacks — list + aggregate. */
export interface ListJobFeedbacksResponse {
  data: JobFeedback[];
  stats: JobRatingStats;
}

// ============================================================================
// Application status (candidate-self view)
// ============================================================================

/**
 * Status của application do candidate đó tạo cho job này.
 * Mirror với `applications.status` (xem backend `interface/application.ts`).
 */
export type ApplicationStatusValue =
  | 'pending'
  | 'viewed'
  | 'screening'
  | 'interview'
  | 'offered'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

/** Lý do terminal của AI matching worker — copy từ CandidateApplicationRow. */
export type AiMatchReason = 'success' | 'quota_exceeded' | 'failed' | null;

/**
 * Response `GET /jobs/by-slug/:slug/application-status` — chỉ trả về cho
 * candidate đang request. Từ migration 0033, 1 candidate có thể apply cùng job
 * bằng NHIỀU CV → response là MẢNG các application (1 entry/CV đã apply).
 *
 * FE dùng để:
 *   - Render danh sách "CV đã ứng tuyển + điểm AI match" bên dưới Apply button.
 *   - Disable nút ứng tuyển với CV đã có trong list (tránh duplicate).
 *   - Click vào entry → navigate sang trang đơn ứng tuyển (`?application=<id>`).
 *
 * Tách riêng khỏi `by-slug` để giữ slug endpoint public/clean.
 */
export interface JobApplicationStatus {
  status: ApplicationStatusValue;
  applicationId: string;
  appliedAt: string;
  /** CV đã dùng để apply. `null` nếu CV đã bị xoá (CASCADE). */
  cvId: string;
  cvTitle: string | null;
  /** Điểm AI match 0-100 (1 số thập phân). `null` nếu chưa chấm hoặc fail. */
  aiMatchScore: number | null;
  /** Lý do terminal của worker — FE dùng để hiển thị badge "Chưa chấm được". */
  aiMatchReason: AiMatchReason;
  /**
   * Per-criterion breakdown 0-100 — extract từ `aiMatchReasoning` JSONB
   * (`->>'experienceScore' ::numeric`, ...). FE render 3 bars trong card
   * "Your Scope" của JobDetailView.
   *
   * Có thể null khi:
   *   - Application cũ (trước khi schema prompt thêm 3 field) không có data.
   *   - Terminal states (quota_exceeded/failed) không produce score.
   *   - LLM skip field (hiếm).
   *
   * FE nên fallback 0% + badge "(điểm chưa có)" khi gặp null.
   */
  aiExperienceScore?: number | null;
  aiIndustryScore?: number | null;
  aiSkillsScore?: number | null;
}

/** Response wrapper cho application-status endpoint — mảng JobApplicationStatus. */
export type JobApplicationStatusList = JobApplicationStatus[];

export interface ExportApplicationsJobData {
  targetJobId: string;
  requestedBy: string;
}

// ============================================================================
// Applicants-over-time chart (candidate JobDetailView)
// ============================================================================

/** 1 điểm trên timeseries — `date` format DD/MM theo mockup, `count` applicants. */
export interface ApplicantsOverTimePoint {
  date: string;
  count: number;
}

/**
 * Response `GET /jobs/:id/applicants-over-time?days=N`.
 *
 * Public (optionalAuth) — chỉ trả aggregate count, không lộ PII applicant.
 * `series` fill đủ N ngày gần nhất (kể cả ngày 0 applicant) nhờ `generate_series`.
 * `peak` là điểm count cao nhất trong series, dùng để vẽ dot highlight ở FE.
 */
export interface ApplicantsOverTimeResponse {
  series: ApplicantsOverTimePoint[];
  peak: ApplicantsOverTimePoint | null;
  totalApplicants: number;
}