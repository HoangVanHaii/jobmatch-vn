/**
 * Service `jobApplication` — query applications cho chatbot picker & handlers.
 * Chỉ phase 1: candidate-side. Employer-side (lọc applications theo job) → phase 2.
 *
 * Router cũ `backend/src/router/jobApplication.ts` chỉ inline CRUD; các query
 * cho chatbot tách riêng ở đây để tái sử dụng.
 */
import { db } from '../config/database';
import { applications, jobs, companies } from '../db/schema';
import { eq, desc, inArray, sql } from 'drizzle-orm';

export interface CandidateApplicationRow {
  applicationId: string;
  jobId: string;
  jobTitle: string | null;
  companyName: string | null;
  status: typeof applications.$inferSelect.status;
  stage: string | null;
  aiMatchScore: string | null;
  appliedAt: Date;
  viewedAt: Date | null;
}

/**
 * List applications gần nhất của candidate, kèm jobTitle + companyName (JOIN).
 * Dùng cho picker source='applied' + handler `application`.
 */
export const jobApplicationService = {
  listByCandidate: async (
    candidateId: string,
    limit = 10,
  ): Promise<CandidateApplicationRow[]> => {
    if (limit < 1) limit = 10;
    if (limit > 50) limit = 50;
    const rows = await db
      .select({
        applicationId: applications.id,
        jobId: applications.jobId,
        jobTitle: jobs.title,
        companyName: companies.name,
        status: applications.status,
        stage: applications.stage,
        aiMatchScore: applications.aiMatchScore,
        appliedAt: applications.appliedAt,
        viewedAt: applications.viewedAt,
      })
      .from(applications)
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(applications.candidateId, candidateId))
      .orderBy(desc(applications.appliedAt))
      .limit(limit);
    return rows;
  },

  /**
   * List jobs đã apply của candidate — chỉ trả job id + title + status.
   * Dùng cho picker source='applied' (chỉ job metadata, không trả application status).
   */
  listAppliedJobIds: async (candidateId: string): Promise<string[]> => {
    const rows = await db
      .select({ jobId: applications.jobId })
      .from(applications)
      .where(eq(applications.candidateId, candidateId));
    return rows.map((r) => r.jobId);
  },
};
