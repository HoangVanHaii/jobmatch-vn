

/* ============================================================================
 * Source / Status
 * ==========================================================================*/
export type CvSource = 'upload' | 'direct';
export type CvStatus = 'pending' | 'parsing' | 'ready' | 'failed' | 'deleted';

/**
 * Lý do CV bị mark 'failed'.
 *
 * Phân biệt rõ để FE hiển thị message + CTA phù hợp:
 *   - 'quota_exceeded' → "Đã hết lượt AI, nâng cấp gói"
 *   - 'invalid_file'   → "File PDF/DOCX lỗi, upload lại"
 *   - 'parse_error'    → "Lỗi xử lý, thử lại sau"
 *   - 'not_a_cv'       → "File không phải CV"
 *
 * Phải đồng bộ với backend: backend/src/interface/cv.ts CvFailureReason.
 */
export type CvFailureReason =
  | 'quota_exceeded'
  | 'invalid_file'
  | 'parse_error'
  | 'not_a_cv'
  | 'analysis_error';

export interface AiAnalysis {
  isCv: boolean;
  total: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  verificationWarnings: VerificationWarning[];
}
export interface VerificationWarning {
  type: "github" | "linkedin";
  url: string;
  message: string;
}
/* ============================================================================
 * Direct CV — payload từ form web (CreateResumeView)
 * URL fields cho phép null: theo RFC 7396 (JSON Merge Patch) — null = xoá field.
 * Khi PATCH /cvs/:cvId, FE có thể gửi `contact.facebook: null` để clear link.
 * ==========================================================================*/

export interface DirectCvContact {
  name?: string;
  email?: string;
  phone?: string;
  portfolio?: string | null;
  github?: string | null;
  linkedin?: string | null;
  facebook?: string | null;
  avatarUrl?: string | null;
}

export interface DirectCvEducation {
  school: string;
  degree?: string;
  major?: string;
  startYear?: number;
  endYear?: number;
  description?: string;
}

export interface DirectCvExperience {
  company: string;
  position: string;
  startDate?: string;
  endDate?: string | null;
  description?: string;
}

export interface DirectCvLanguage {
  language: string;
  proficiency?: string;
}

export interface DirectCvProject {
  name: string;
  description?: string;
  /** URL cho phép null: PATCH có thể gửi null để clear link. */
  link?: string | null;
}

export interface DirectCvCertification {
  name: string;
  issuer?: string;
  date?: string;
}

/** Body của POST /cvs/direct — title + templateId bắt buộc. */
export interface CreateDirectCvInput {
  title: string;
  templateId: number;
  isPrimary?: boolean;
  summary?: string;
  contact?: DirectCvContact;
  education?: DirectCvEducation[];
  experience?: DirectCvExperience[];
  skills?: string[];
  languages?: DirectCvLanguage[];
  projects?: DirectCvProject[];
  certifications?: DirectCvCertification[];
}

/* ============================================================================
 * Upload CV — payload từ client sau khi upload file lên MinIO
 * ==========================================================================*/

export interface CreateUploadCvInput {
  title?: string;
  fileUrl?: string;
  fileType?: string;
  isPrimary?: boolean;
}

/* ============================================================================
 * Responses
 * ==========================================================================*/

/** Row trong bảng cvs (drizzle type) — full shape. */
export interface Cv {
  id: string;
  candidateId: string;
  title: string | null;
  fileUrl: string | null;
  fileType: string | null;
  isPrimary: boolean;
  status: CvStatus;
  source: CvSource;
  templateId: number | null;
  parsedData: Record<string, unknown> | null;
  ai_analysis: AiAnalysis | null;
  /** Lý do fail — chỉ set khi status='failed'. Reset NULL khi status khác. */
  failureReason: CvFailureReason | null;
  scoreUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CvDetail = Cv;

/** Query param GET /cvs — pagination + filter. */
export interface ListCvQuery {
  source?: CvSource;
  /** Từ khoá search theo title (ILIKE %q%). Debounce 400ms ở FE trước khi gọi. */
  q?: string;
  limit?: number;
  offset?: number;
}

/** Response của GET /cvs — items là FULL Cv row (BE getListDetail trả về
 *  parsedData + ai_analysis luôn), không phải slim. FE render trực tiếp CV
 *  thật trên thumbnail card mà không cần gọi thêm GET /cvs/:cvId. */
export interface ListCvResponse {
  items: Cv[];
  total: number;
}

/**
 * AI score (0–100) đọc từ `cv.ai_analysis.total`.
 * Trả `null` khi CV chưa phân tích hoặc analysis fail trước khi ghi score.
 */
export const getAiScore = (cv: Pick<Cv, 'ai_analysis'>): number | null =>
  typeof cv.ai_analysis?.total === 'number' ? cv.ai_analysis.total : null;

/* ============================================================================
 * CvRenderData — shape data chung cho 3 template render.
 * CreateResumeView build từ form → truyền xuống CVTemplateRenderer.
 * Mỗi template dùng field nào thì render, không có thì bỏ qua.
 *
 * Lưu ý: khác CreateDirectCvInput ở chỗ:
 *   - personalInfo gom 1 object (form dùng field lẻ, render gộp lại).
 *   - skills có level 1-5 (cho progress bar).
 *   - Có thêm activities + interests.
 *   - certificate (chứ không phải certification).
 * ==========================================================================*/
export interface CvRenderPersonalInfo {
  fullName: string;
  position: string;
  email: string;
  phone: string;
  address: string;
  facebook: string;
  linkedin: string;
  portfolio: string;
  github: string;
  avatarUrl: string;
  dob?: string;
  gender?: string;
}

export interface CvRenderEducation {
  school: string;
  major?: string;
  degree?: string;
  startYear?: string;
  endYear?: string;
  description?: string;
}

export interface CvRenderExperience {
  company: string;
  position: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

/** Mỗi skill: name + level 1-5 (cho progress bar). */
export interface CvRenderSkill {
  name: string;
  level?: number;
}

export interface CvRenderProject {
  name: string;
  role?: string;
  time?: string;
  description?: string;
  link?: string;
}

export interface CvRenderCertificate {
  name: string;
  issuer?: string;
  date?: string;
}

export interface CvRenderActivity {
  name: string;
  role?: string;
  time?: string;
  description?: string;
}

export interface CvRenderData {
  title: string;
  personalInfo: CvRenderPersonalInfo;
  summary: string;
  educations: CvRenderEducation[];
  experiences: CvRenderExperience[];
  skills: CvRenderSkill[];
  projects: CvRenderProject[];
  certificates: CvRenderCertificate[];
  activities: CvRenderActivity[];
  interests: string[];
}
