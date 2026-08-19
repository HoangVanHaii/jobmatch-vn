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
  viewsCount: number;
  appliesCount: number;
  publishedAt: Date | null;
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
