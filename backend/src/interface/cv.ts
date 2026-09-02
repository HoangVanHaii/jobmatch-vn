import type { cvs } from "../db/schema/cvs";
import type { cvStatusEnum, cvSourceEnum } from "../db/schema/enums";


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
export type Cv = typeof cvs.$inferSelect;
export type CvStatus = (typeof cvStatusEnum.enumValues)[number];
export type CvSource = (typeof cvSourceEnum.enumValues)[number];

/**
 * Lý do CV bị mark 'failed'.
 *
 * Phân biệt rõ để FE hiển thị message phù hợp + suggest CTA đúng:
 *   - 'quota_exceeded' → "Đã hết lượt AI, nâng cấp gói"
 *   - 'invalid_file'   → "File PDF/DOCX lỗi, upload lại"
 *   - 'parse_error'    → "Lỗi xử lý, thử lại sau"
 *   - 'not_a_cv'       → "File không phải CV"
 */
export type CvFailureReason =
    | 'quota_exceeded'
    | 'invalid_file'
    | 'parse_error'
    | 'not_a_cv'
    | 'analysis_error'

export interface CreateCvInput {
  title?: string;
  fileUrl?: string;
  fileType?: string;
  isPrimary?: boolean;
}

export type CreateCvResponse = Cv;


/**
 * Response của GET /cvs — items là FULL Cv row (parsedData + ai_analysis)
 * chứ không phải slim ListCv. FE render trực tiếp CV thật trên thumbnail
 * card mà không phải gọi thêm GET /cvs/:cvId.
 */
export interface ListCvResponse {
  items: Cv[];
  total: number;
}


export interface DirectCvContact {
  name?: string;
  email?: string;
  phone?: string;
  // URL fields cho phép null: PATCH semantics (RFC 7396) — null = xoá field.
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
  link?: string | null;
}

export interface DirectCvCertification {
  name: string;
  issuer?: string;
  date?: string;
}


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


export interface UpdateDirectCvInput {
  title?: string;
  parsedData?: Pick<
    CreateDirectCvInput,
    | "summary"
    | "contact"
    | "education"
    | "experience"
    | "skills"
    | "languages"
    | "projects"
    | "certifications"
  >;
}

export type CvDetail = Cv;
