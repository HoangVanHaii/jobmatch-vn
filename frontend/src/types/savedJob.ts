/**
 * Saved job types — mirror backend `src/interface/savedJob.ts` + `src/middleware/savedJob.ts`.
 *
 * Backend `GET /api/v1/saved-jobs` filter:
 *   - jobLevel, jobType, remoteOk, industry (text)
 *   - search (full-text + ILIKE trên title/companyName)
 *   - page, limit (default 20)
 */
import type { JobListItem, JobLevel, JobType } from './job';

export interface SavedJobItem {
  /** Thời điểm user lưu job. */
  savedAt: Date;
  /** JobListItem đã LEFT JOIN companies (xem savedJob.service.ts). */
  job: JobListItem;
}

export interface ListSavedJobsResponse {
  success: boolean;
  data: SavedJobItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ListSavedJobsQuery {
  jobLevel?: JobLevel;
  jobType?: JobType;
  remoteOk?: boolean;
  industry?: string;
  /** Free-text search trên job title / company name. */
  search?: string;
  page?: number;
  limit?: number;
}
