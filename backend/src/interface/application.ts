export interface ApplicationCvSnapshot {
  title: string | null;
  url: string | null;
  candidateId: string;
  template: number | null;
  parsedData: unknown;
}


export interface ApplicationMatchReasoning {
  matchedSkills?: string[];
  missingSkills?: string[];
  strengths?: string[];
  concerns?: string[];
  rationale?: string;
  /**
   * Trạng thái terminal của worker AI matching:
   *   - undefined: chưa chấm xong (đang chạy hoặc đang retry) — FE hiển thị "Đang so khớp".
   *   - 'success': chấm xong, có điểm → dùng kèm strengths/rationale/...
   *   - 'quota_exceeded': candidate hết quota `ai_cv_match` → không chấm được.
   *   - 'failed': LLM lỗi parse/rate-limit sau khi đã retry hết attempts.
   *
   * Lý do cần field này (vì sao `aiMatchScore IS NULL` chưa đủ):
   *   Worker KHÔNG update `aiMatchScore` khi quota/fail → cột này vẫn NULL.
   *   FE nếu chỉ check `aiMatchScore == null` sẽ render "Đang so khớp" mãi mãi
   *   cho cả 2 case terminal này (vì notification match-skipped chỉ là event, không
   *   persist). Lưu `reason` vào jsonb này để sau khi reload/refetch FE biết
   *   đây là trạng thái terminal và đổi badge phù hợp.
   */
  reason?: 'success' | 'quota_exceeded' | 'failed';
}

export interface CreateApplicationInput {
  jobId: string;
  /**
   * CV dùng để apply. BẮT BUỘC từ migration 0033 — "1 CV - 1 job" thay cho
   * "1 candidate - 1 job". Candidate có thể apply cùng job với nhiều CV.
   */
  cvId: string;
  coverLetter?: string;
}

export interface ApplicationListQuery {
  status?: ApplicationStatusValue;
  jobId?: string;
  page?: number;
  limit?: number;
}

export type ApplicationStatusValue =
  | 'pending'
  | 'viewed'
  | 'screening'
  | 'interview'
  | 'offered'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

/**
 * Row trả về cho candidate (`GET /me`) — JOIN job + company để FE render
 * card trực tiếp không cần query thêm.
 *
 * Phụ trộn thêm từ `applications` row (candidate-side):
 *   - `coverLetter`: full text để FE tự truncate hiển thị ở list.
 *   - `cvTitle`, `cvUrl`: lấy từ `applications.cv` jsonb snapshot (do CV có
 *     thể bị candidate edit/delete sau khi apply → đọc từ snapshot chứ
 *     không query `cvs` table). Null nếu candidate apply không kèm CV.
 *   - `jobPostedBy`: user id của recruiter đăng job. FE dùng cho nút
 *     "Chat" ngoài list (create conversation với employer này).
 */
export interface CandidateApplicationRow {
  id: string;
  jobId: string;
  jobTitle: string | null;
  jobSlug: string | null;
  jobPostedBy: string | null;
  companyId: string | null;
  companyName: string | null;
  companyLogoUrl: string | null;
  status: ApplicationStatusValue;
  stage: string | null;
  aiMatchScore: string | null;
  /**
   * Trạng thái terminal của worker AI matching — chỉ lấy field `reason` từ
   * `applications.aiMatchReasoning` jsonb (qua SQL `->>`) để tiết kiệm payload.
   *   - null: đang chấm hoặc chưa từng chạy → FE spinner "Đang so khớp"
   *   - 'quota_exceeded' | 'failed': chấm thất bại → FE badge terminal
   *   - 'success': đã chấm xong (điểm ở `aiMatchScore`)
   */
  aiMatchReason: 'success' | 'quota_exceeded' | 'failed' | null;
  /** Full cover letter text. FE tự truncate ở list (~120 chars). */
  coverLetter: string | null;
  /** CV title từ snapshot (`applications.cv->>'title'`). */
  cvTitle: string | null;
  /** FK sang `cvs.id` — null nếu CV đã bị xoá (CASCADE xoá application). */
  cvId: string | null;
  /** CV file URL từ snapshot — nếu null → FE không hiện nút tải. */
  cvUrl: string | null;
  appliedAt: Date;
  viewedAt: Date | null;
}

/**
 * Row trả về cho employer (`GET /job/:jobId` hoặc `GET /company`).
 * JOIN candidate info (full nếu isAnonymous=false, ẩn nếu true).
 */
export interface EmployerApplicationRow {
  id: string;
  jobId: string;
  jobTitle: string | null;
  candidateId: string;
  /** Tên candidate — null nếu isAnonymous=true (employer chỉ biết có application, không biết ai). */
  candidateName: string | null;
  candidateEmail: string | null;
  status: ApplicationStatusValue;
  stage: string | null;
  aiMatchScore: string | null;
  /** Xem `CandidateApplicationRow.aiMatchReason`. */
  aiMatchReason: 'success' | 'quota_exceeded' | 'failed' | null;
  isAnonymous: boolean;
  appliedAt: Date;
  viewedAt: Date | null;
}

/**
 * Full detail 1 application — dùng cho `GET /applications/:id`.
 *
 * Trả nhiều hơn `CandidateApplicationRow` vì detail có không gian hiển thị
 * (drawer / page riêng):
 *   - `coverLetter`: full text (không truncate).
 *   - `cv`: full `ApplicationCvSnapshot` (title + url + parsedData + template).
 *     Lý do trả cả object thay vì flatten title/url: future-proof nếu FE cần
 *     thêm field (ví dụ hiển thị template info).
 *   - `aiMatchReasoning`: full jsonb — FE render card reasoning (strengths,
 *     missingSkills, concerns, rationale).
 *   - `updatedAt`: để FE show "Cập nhật lần cuối …".
 *   - `jobLocation`: jsonb object từ `jobs.location` — null nếu employer không
 *     set. FE tự unwrap city/district/address để hiển thị.
 *   - `jobDeadline`: timestamp để FE hiển thị "Job hết hạn nộp …".
 *
 * Auth scoping:
 *   - Candidate chỉ xem của mình.
 *   - Employer phải là postedBy của job (hoặc admin).
 *   - Trả 404 nếu không match để không leak existence.
 */
export interface ApplicationDetail {
  id: string;
  jobId: string;
  jobTitle: string | null;
  jobSlug: string | null;
  jobLocation: { city?: string; district?: string; address?: string } | null;
  jobDeadline: Date | null;
  /** User id của người đăng job (recruiter). Null nếu job đã bị xoá hoặc không có postedBy.
   *  FE dùng để bấm "Liên hệ" → tạo conversation với employer này. */
  jobPostedBy: string | null;
  companyId: string | null;
  companyName: string | null;
  companyLogoUrl: string | null;
  status: ApplicationStatusValue;
  stage: string | null;
  aiMatchScore: string | null;
  aiMatchReasoning: ApplicationMatchReasoning | null;
  coverLetter: string | null;
  cv: ApplicationCvSnapshot | null;
  appliedAt: Date;
  viewedAt: Date | null;
  updatedAt: Date;
}
