import type { cvs } from "../db/schema/cvs";
import type { cvStatusEnum, cvSourceEnum } from "../db/schema/enums";

/**
 * Shape của cột `ai_score` jsonb — do AI chấm sau khi parse CV xong.
 * Single source of truth: BE Drizzle schema + BE interface + FE types đều
 * dùng shape này (FE copy thủ công vì FE chưa share types với BE).
 */
export interface AiScore {
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
export type Cv = typeof cvs.$inferSelect;
export type CvStatus = (typeof cvStatusEnum.enumValues)[number];
export type CvSource = (typeof cvSourceEnum.enumValues)[number];

export interface CreateCvInput {
  title?: string;
  fileUrl?: string;
  fileType?: string;
  isPrimary?: boolean;
}

export interface ListCv {
  id: string;
  candidateId: string;
  title: string | null;
  fileUrl: string | null;
  fileType: string | null;
  isPrimary: boolean;
  templateId: number | null;
  status: CvStatus;
  source: CvSource;
  aiScoreTotal: number | null;
}

export type CreateCvResponse = Cv;

/* ============================================================================
 * Response của GET /cvs — phân trang.
 * - items: trang hiện tại (limit rows, bắt đầu từ offset).
 * - total: tổng số CV khớp filter (không phụ thuộc limit/offset) — FE dùng
 *   để tính tổng số trang.
 * ==========================================================================*/
export interface ListCvResponse {
  items: ListCv[];
  total: number;
}

/* ============================================================================
 * Direct CV (web form, không upload file) — lưu vào cvs.parsedData jsonb.
 * Schema parse_data trong DB dùng Record<string, unknown> cho items → các
 * interface dưới đây có field typed chặt hơn, Drizzle sẽ cast tự động.
 * ==========================================================================*/

export interface DirectCvContact {
  name?: string;
  email?: string;
  phone?: string;
  portfolio?: string;
  github?: string;
  linkedin?: string;
  facebook?: string;
  avatarUrl?: string;
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
  link?: string;
}

export interface DirectCvCertification {
  name: string;
  issuer?: string;
  date?: string;
}


/**
 * Body của POST /cvs/direct — user nhập CV thủ công qua form web.
 * - title, templateId bắt buộc.
 * - các field khác optional.
 */
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
 * GET /cvs/:cvId — 1 endpoint duy nhất, trả về toàn bộ row.
 *
 * Trả luôn `Cv` (drizzle inferred type) — đã có đủ mọi field:
 * id, candidateId, title, fileUrl, fileType, isPrimary, status, source,
 * templateId, parsedData, aiScore, scoreUpdatedAt, createdAt, updatedAt.
 *
 * FE đọc `source` để switch UX:
 * - source='upload': dùng fileUrl để mở file gốc; parsedData do AI sở hữu.
 * - source='direct': dùng templateId để render; parsedData là form user nhập.
 *
 * Vài field có thể null:
 * - fileUrl/fileType: NULL với direct CV.
 * - templateId: NULL với upload CV.
 * - parsedData: NULL khi upload CV status=pending/parsing/failed.
 * - aiScore/scoreUpdatedAt: NULL khi upload CV chưa score xong, hoặc luôn NULL với direct.
 * ==========================================================================*/

export type CvDetail = Cv;
