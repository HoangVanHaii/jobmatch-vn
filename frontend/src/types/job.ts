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
}

/**
 * Full job shape từ GET /api/v1/jobs/:id — extends list item với description,
 * requirements, benefits, skills, experience years. `featured` không có trong
 * list nhưng luôn có ở detail (default false ở DB).
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