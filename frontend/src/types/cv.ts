

/* ============================================================================
 * Source / Status
 * ==========================================================================*/
export type CvSource = 'upload' | 'direct';

/**
 * CV lifecycle status — phải đồng bộ với backend/src/db/schema/enums.ts cvStatusEnum.
 *
 * Phân biệt rõ 2 giai đoạn "đang xử lý":
 *   - 'pending'   — vừa upload/tạo, queue chờ worker pick up
 *   - 'parsing'   — cvParse worker đang parse text + LLM extract (chỉ cho
 *                   source='upload' sau khi upload xong)
 *   - 'analyzing' — cvAnalysis worker đang chạy AI analysis (re-analyze,
 *                   hoặc direct CV vừa edit content → re-score)
 *   - 'ready'     — parsed + analyzed (parsedData + ai_analysis có data)
 *   - 'failed'    — fail (kèm `failureReason`)
 *   - 'deleted'   — soft-delete
 *
 * Lý do tách 'parsing' vs 'analyzing' (thay vì dùng chung 'parsing' như trước):
 *   FE overlay hiện message khác nhau cho user — "Đang đọc CV…" vs
 *   "Đang phân tích AI…". Cùng status string → không phân biệt được 2 phase
 *   có timing khác nhau (~10-30s parse vs ~5-15s analyze).
 *
 * Backward compat: rows cũ trong DB có status='parsing' do analysis worker
 * set trước refactor — vẫn hợp lệ, chỉ là worker mới từ giờ set 'analyzing'.
 */
export type CvStatus = 'pending' | 'parsing' | 'analyzing' | 'ready' | 'failed' | 'deleted';

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
  /** Vai trò trong dự án — vd "Tech Lead / Solo Dev / Founder". */
  role?: string;
  /** Khoảng thời gian — vd "2023 — 2024". */
  time?: string;
  description?: string;
  /** URL cho phép null: PATCH có thể gửi null để clear link. */
  link?: string | null;
}

export interface DirectCvCertification {
  name: string;
  issuer?: string;
  date?: string;
}

/** Skill có level 1-5 cho progress bar + dots picker ở form edit. */
export interface DirectCvSkill {
  name: string;
  level: number;
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
  /**
   * FE luôn gửi `{name, level}` (round-trip preservation). BE chấp nhận cả
   * `string[]` để tương thích ngược (CV cũ trong DB / client cũ).
   */
  skills?: Array<string | DirectCvSkill>;
  languages?: DirectCvLanguage[];
  projects?: DirectCvProject[];
  certifications?: DirectCvCertification[];
}

/**
 * Body của PATCH /cvs/:cvId — chỉ dành cho source='direct'.
 *
 * Field nào gửi → update field đó. Field không gửi → giữ nguyên (server
 * merge vào parsedData hiện có qua deepMerge RFC 7396).
 *
 * KHÔNG gồm `templateId`: templateId thuộc root row (cvs table), không nằm
 * trong parsedData → nếu user muốn đổi template phải thêm field riêng. Hiện
 * tại BE chưa nhận templateId qua PATCH (chỉ qua POST tạo mới).
 *
 * Sau update: BE set status='analyzing' + enqueue cvAnalysisQueue (re-score).
 * FE đợi socket `cv:status-changed` hoặc refresh list để thấy điểm mới.
 */
export interface UpdateDirectCvInput {
  title?: string;
  parsedData?: Pick<
    CreateDirectCvInput,
    | 'summary'
    | 'contact'
    | 'education'
    | 'experience'
    | 'skills'
    | 'languages'
    | 'projects'
    | 'certifications'
  >;
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
