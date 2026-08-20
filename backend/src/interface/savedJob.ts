import type { savedJobs } from '../db/schema/applications';
import type { JobListItem } from '../interface/job';
 
export type SavedJob = typeof savedJobs.$inferSelect;
 
/**
 * Dùng JobListItem (bản rút gọn, không có description/requirements/benefits...)
 * thay vì Job đầy đủ — khớp convention job.service.ts:list (PR #5).
 */
export interface SavedJobWithDetail {
  savedAt: SavedJob['savedAt'];
  job: JobListItem;
}
 
/**
 * GET /saved-jobs — có filter + pagination, khớp shape JobListResponse
 * (page/limit/total/totalPages), theo đúng convention job.ts đang dùng.
 */
export interface ListSavedJobsResponse {
  success: boolean;
  data: SavedJobWithDetail[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
 
export type SaveJobResponse = SavedJob;