/**
 * Application types — mirror 1:1 với backend `src/interface/application.ts`
 * và `src/service/application.service.ts` row shapes.
 *
 * Update cả 2 cùng nhau khi schema đổi.
 */

/** 8 status values của application_status enum (match DB enum). */
export type ApplicationStatus =
  | 'pending'
  | 'viewed'
  | 'screening'
  | 'interview'
  | 'offered'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

/** Body POST /applications — candidate apply. */
export interface CreateApplicationBody {
  jobId: string;
  cvId?: string;
  coverLetter?: string;
}

/** Response POST /applications — { id, status }. */
export interface CreatedApplication {
  id: string;
  status: ApplicationStatus;
}

/** Query chung cho list endpoints (?status, ?jobId, ?page, ?limit). */
export interface ListApplicationQuery {
  status?: ApplicationStatus;
  jobId?: string;
  page?: number;
  limit?: number;
}

/** Pagination meta trả về kèm list. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

/** Row cho candidate (GET /me). JOIN job + company. */
export interface CandidateApplicationRow {
  id: string;
  jobId: string;
  jobTitle: string | null;
  jobSlug: string | null;
  /** User id của recruiter đăng job — dùng cho nút "Chat" ngoài list. */
  jobPostedBy: string | null;
  companyId: string | null;
  companyName: string | null;
  companyLogoUrl: string | null;
  status: ApplicationStatus;
  stage: string | null;
  /** Match percent từ LLM (string vì DB column là numeric). null = chưa có AI match. */
  aiMatchScore: string | null;
  /**
   * Worker AI matching trạng thái terminal — extract từ `applications.aiMatchReasoning->>'reason'`.
   *   - null: đang chấm hoặc chưa chạy → FE spinner "Đang so khớp"
   *   - 'success': chấm xong (điểm ở `aiMatchScore`)
   *   - 'quota_exceeded' | 'failed': chấm thất bại → FE badge terminal
   * Mirror với backend `CandidateApplicationRow.aiMatchReason`.
   */
  aiMatchReason: 'success' | 'quota_exceeded' | 'failed' | null;
  /** Cover letter full text (BE trả full, FE tự truncate khi hiển thị list). */
  coverLetter: string | null;
  /** CV title từ `applications.cv` snapshot. Null nếu apply không kèm CV. */
  cvTitle: string | null;
  /** CV file URL từ snapshot — null nếu CV không có file hoặc apply không kèm CV. */
  cvUrl: string | null;
  appliedAt: string; // ISO 8601
  viewedAt: string | null;
}

/** Row cho employer (GET /job/:jobId hoặc /company). JOIN candidate info. */
export interface EmployerApplicationRow {
  id: string;
  jobId: string;
  jobTitle: string | null;
  candidateId: string;
  /** null nếu isAnonymous=true (employer không biết candidate là ai). */
  candidateName: string | null;
  candidateEmail: string | null;
  status: ApplicationStatus;
  stage: string | null;
  aiMatchScore: string | null;
  /** Xem `CandidateApplicationRow.aiMatchReason`. */
  aiMatchReason: 'success' | 'quota_exceeded' | 'failed' | null;
  isAnonymous: boolean;
  appliedAt: string;
  viewedAt: string | null;
}

/** Response listMine (candidate). */
export interface ListMineResult {
  rows: CandidateApplicationRow[];
  total: number;
  page: number;
  limit: number;
}

/** Response listByJob / listByCompany (employer). */
export interface ListEmployerResult {
  rows: EmployerApplicationRow[];
  total: number;
  page: number;
  limit: number;
}

/** Body PATCH /:id/status — employer đổi status/stage. */
export interface UpdateStatusBody {
  status: ApplicationStatus;
  stage?: string;
}

/** Response PATCH /:id/status. */
export interface UpdatedStatus {
  id: string;
  status: ApplicationStatus;
  stage: string | null;
}

/**
 * Full detail 1 application — dùng cho `GET /applications/:id`.
 *
 * Mirror với backend `ApplicationDetail` interface.
 */
export interface ApplicationDetail {
  id: string;
  jobId: string;
  jobTitle: string | null;
  jobSlug: string | null;
  /** JSON object từ `jobs.location` (null nếu employer không set). */
  jobLocation: { city?: string; district?: string; address?: string } | null;
  /** Job deadline (ISO string) — null nếu job không có deadline. */
  jobDeadline: string | null;
  /** User id của recruiter đăng job. Null nếu job bị xoá. Dùng cho nút "Liên hệ". */
  jobPostedBy: string | null;
  companyId: string | null;
  companyName: string | null;
  companyLogoUrl: string | null;
  status: ApplicationStatus;
  stage: string | null;
  /** Match percent string (null = chưa có / hết quota / worker fail). */
  aiMatchScore: string | null;
  /** AI reasoning JSON từ worker — null nếu chưa từng match. */
  aiMatchReasoning: ApplicationMatchReasoning | null;
  /** Full cover letter text. */
  coverLetter: string | null;
  /** CV snapshot đầy đủ — null nếu apply không kèm CV. */
  cv: ApplicationCvSnapshot | null;
  appliedAt: string;
  viewedAt: string | null;
  updatedAt: string;
}

/**
 * CV snapshot lưu trong `applications.cv` jsonb — mirror backend
 * `ApplicationCvSnapshot`. Có thể là null nếu candidate apply không kèm CV.
 */
export interface ApplicationCvSnapshot {
  title: string | null;
  url: string | null;
  candidateId: string;
  template: number | null;
  parsedData: unknown;
}

/** Response POST /:id/recompute-match — employer yêu cầu chấm lại AI. */
export interface RecomputeMatchResult {
  id: string;
  jobId: string;
  /** Sau khi reset → null. Worker sẽ fill lại score mới trong vài giây. */
  aiMatchScore: string | null;
  aiMatchReasoning: ApplicationMatchReasoning | null;
  recomputeEnqueued: boolean;
}

/** Reasoning structure (jsonb field aiMatchReasoning trong DB).
 *
 * `reason` là trạng thái terminal của worker AI matching:
 *   - undefined: đang chấm (worker chưa xong hoặc đang retry) — FE spinner
 *   - 'success': chấm xong, có điểm + strengths/rationale/...
 *   - 'quota_exceeded': candidate hết quota `ai_cv_match`
 *   - 'failed': LLM lỗi sau hết retry attempts
 *
 * Vì worker KHÔNG update `aiMatchScore` khi quota/fail, FE cần `reason` để
 * phân biệt "đang chấm" (spinner) vs "thất bại" (badge terminal) khi render
 * card list. Mirror 1:1 với backend `interface/application.ts`.
 */
export interface ApplicationMatchReasoning {
  matchedSkills?: string[];
  missingSkills?: string[];
  strengths?: string[];
  concerns?: string[];
  rationale?: string;
  reason?: 'success' | 'quota_exceeded' | 'failed';
}

/**
 * Socket realtime event payload — candidate nhận khi AI matching xong.
 *
 * Tương ứng backend `cvMatch.worker.ts`:
 *   - reason='success' → matchPercent + rationale có data
 *   - reason='quota_exceeded' → matchPercent=null, FE show "hết quota"
 *   - reason='failed' → matchPercent=null, FE show "thử lại sau"
 */
export interface ApplicationMatchReadyPayload {
  applicationId: string;
  jobId: string;
  reason?: 'success' | 'quota_exceeded' | 'failed';
  matchPercent?: number | null;
  rationale?: string | null;
}

/**
 * Socket realtime event payload — candidate nhận khi matching bị skip
 * (chỉ phát khi quota_exceeded; success dùng application:match-ready).
 */
export interface ApplicationMatchSkippedPayload {
  applicationId: string;
  jobId: string;
  reason: 'quota_exceeded';
}

/**
 * Socket realtime event payload — candidate nhận khi employer đổi trạng thái
 * đơn (vd. pending → viewed → screening → interview → offered/hired/rejected).
 *
 * Phát từ `applicationService.updateStatus()` ngay sau khi DB update xong —
 * candidate list/detail update tức thì không cần refetch.
 *
 * `viewedAt` chỉ fill khi employer lần đầu chuyển sang 'viewed' (BE chỉ set
 * 1 lần, các lần sau null).
 */
export interface ApplicationStatusChangedPayload {
  applicationId: string;
  jobId: string;
  status: ApplicationStatus;
  stage: string | null;
  /** ISO string — chỉ có khi status='viewed' lần đầu; null các lần sau. */
  viewedAt: string | null;
  /** ISO string — lần update gần nhất, dùng để sort nếu cần. */
  updatedAt: string;
}
