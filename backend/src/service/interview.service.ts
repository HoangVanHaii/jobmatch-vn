/**
 * Service `interview` — query interviews cho chatbot.
 * Phase 1: candidate-side (interviews của applications mà candidate đã apply).
 */
import { db } from '../config/database';
import { interviews, applications, jobs, companies } from '../db/schema';
import { eq, and, gte, asc, desc, sql, inArray } from 'drizzle-orm';

export interface CandidateInterviewRow {
  interviewId: string;
  applicationId: string;
  jobId: string;
  jobTitle: string | null;
  companyName: string | null;
  scheduledAt: Date;
  durationMin: number | null;
  location: string | null;
  meetingLink: string | null;
  status: string | null;
}

export const interviewService = {
  /**
   * List interviews sắp tới hoặc gần đây của candidate.
   * - upcoming=true: chỉ scheduledAt >= now AND status NOT IN ('cancelled')
   * - upcoming=false: trả tất cả (limit gần đây nhất)
   */
  listByCandidate: async (
    candidateId: string,
    opts: { upcoming?: boolean; limit?: number } = {},
  ): Promise<CandidateInterviewRow[]> => {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);

    // Lấy applications của candidate trước (filter ở app level),
    // JOIN interviews với status còn pending/active.
    const conditions = [eq(applications.candidateId, candidateId)];
    if (opts.upcoming) {
      conditions.push(gte(interviews.scheduledAt, sql`now()`));
    }

    const rows = await db
      .select({
        interviewId: interviews.id,
        applicationId: interviews.applicationId,
        jobId: applications.jobId,
        jobTitle: jobs.title,
        companyName: companies.name,
        scheduledAt: interviews.scheduledAt,
        durationMin: interviews.durationMin,
        location: interviews.location,
        meetingLink: interviews.meetingLink,
        status: interviews.status,
      })
      .from(interviews)
      .innerJoin(applications, eq(interviews.applicationId, applications.id))
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(companies, eq(jobs.companyId, companies.id))
      .where(and(...conditions))
      .orderBy(opts.upcoming ? asc(interviews.scheduledAt) : desc(interviews.scheduledAt))
      .limit(limit);

    if (opts.upcoming) {
      // Filter status != 'cancelled' chỉ áp dụng cho upcoming
      return rows.filter((r) => r.status !== 'cancelled' && r.status !== null);
    }
    return rows;
  },
};
