import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { jobFeedbacks } from '../db/schema/jobFeedbacks';
import { applications } from '../db/schema/applications';
import { userProfiles } from '../db/schema/users';
import { AppError } from '../middleware/errorHandler';
import type {
  JobFeedback,
  JobRatingStats,
} from '../interface/job';

export const jobFeedbackService = {
  listForJob: async (
    jobId: string,
    viewerId?: string,
  ): Promise<{ data: JobFeedback[]; stats: JobRatingStats }> => {
    // Aggregate stats (count + avg) — chạy song song với list query.
    const [rows, statsRow] = await Promise.all([
      db
        .select({
          id: jobFeedbacks.id,
          jobId: jobFeedbacks.jobId,
          candidateId: jobFeedbacks.candidateId,
          candidateName: userProfiles.fullName,
          rating: jobFeedbacks.rating,
          comment: jobFeedbacks.comment,
          createdAt: jobFeedbacks.createdAt,
          updatedAt: jobFeedbacks.updatedAt,
        })
        .from(jobFeedbacks)
        .leftJoin(userProfiles, eq(userProfiles.userId, jobFeedbacks.candidateId))
        .where(eq(jobFeedbacks.jobId, jobId))
        .orderBy(desc(jobFeedbacks.createdAt))
        .limit(200), // cap để tránh job có >1000 feedback load chậm
      db
        .select({
          count: count(),
          average: sql<string | null>`AVG(${jobFeedbacks.rating})::numeric(10,2)::text`,
        })
        .from(jobFeedbacks)
        .where(eq(jobFeedbacks.jobId, jobId)),
    ]);

    const stats: JobRatingStats = {
      count: Number(statsRow[0]?.count ?? 0),
      average: statsRow[0]?.average != null ? Number(Number(statsRow[0].average).toFixed(1)) : null,
    };

    const data: JobFeedback[] = rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      candidateId: r.candidateId,
      candidateName: r.candidateName,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      isMine: viewerId != null && r.candidateId === viewerId ? true : undefined,
    }));

    return { data, stats };
  },

  upsert: async (
    jobId: string,
    candidateId: string,
    rating: number,
    comment: string | null,
  ): Promise<JobFeedback> => {
    // 1. Verify candidate đã apply job này (trừ withdrawn vẫn được đánh giá).
    const [applied] = await db
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.candidateId, candidateId), eq(applications.jobId, jobId)))
      .limit(1);

    if (!applied) {
      throw new AppError(
        403,
        'NOT_APPLIED',
        'Bạn cần ứng tuyển job này trước khi đánh giá',
      );
    }

    const [row] = await db
      .insert(jobFeedbacks)
      .values({ jobId, candidateId, rating, comment })
      .onConflictDoUpdate({
        target: [jobFeedbacks.jobId, jobFeedbacks.candidateId],
        set: {
          rating,
          comment,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) {
      throw new AppError(500, 'UPSERT_FAILED', 'Không lưu được đánh giá');
    }

    const [withName] = await db
      .select({
        id: jobFeedbacks.id,
        jobId: jobFeedbacks.jobId,
        candidateId: jobFeedbacks.candidateId,
        candidateName: userProfiles.fullName,
        rating: jobFeedbacks.rating,
        comment: jobFeedbacks.comment,
        createdAt: jobFeedbacks.createdAt,
        updatedAt: jobFeedbacks.updatedAt,
      })
      .from(jobFeedbacks)
      .leftJoin(userProfiles, eq(userProfiles.userId, jobFeedbacks.candidateId))
      .where(eq(jobFeedbacks.id, row.id))
      .limit(1);

    if (!withName) {
      throw new AppError(500, 'FEEDBACK_NOT_FOUND', 'Feedback vừa tạo không tìm thấy');
    }

    return {
      id: withName.id,
      jobId: withName.jobId,
      candidateId: withName.candidateId,
      candidateName: withName.candidateName,
      rating: withName.rating,
      comment: withName.comment,
      createdAt: withName.createdAt,
      updatedAt: withName.updatedAt,
      isMine: true,
    };
  },

  getMine: async (jobId: string, candidateId: string): Promise<JobFeedback | null> => {
    const [row] = await db
      .select({
        id: jobFeedbacks.id,
        jobId: jobFeedbacks.jobId,
        candidateId: jobFeedbacks.candidateId,
        candidateName: userProfiles.fullName,
        rating: jobFeedbacks.rating,
        comment: jobFeedbacks.comment,
        createdAt: jobFeedbacks.createdAt,
        updatedAt: jobFeedbacks.updatedAt,
      })
      .from(jobFeedbacks)
      .leftJoin(userProfiles, eq(userProfiles.userId, jobFeedbacks.candidateId))
      .where(
        and(
          eq(jobFeedbacks.jobId, jobId),
          eq(jobFeedbacks.candidateId, candidateId),
        ),
      )
      .limit(1);

    if (!row) return null;
    return {
      id: row.id,
      jobId: row.jobId,
      candidateId: row.candidateId,
      candidateName: row.candidateName,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isMine: true,
    };
  },

  getStats: async (jobId: string): Promise<JobRatingStats> => {
    const [statsRow] = await db
      .select({
        count: count(),
        average: sql<string | null>`AVG(${jobFeedbacks.rating})::numeric(10,2)::text`,
      })
      .from(jobFeedbacks)
      .where(eq(jobFeedbacks.jobId, jobId));
    return {
      count: Number(statsRow?.count ?? 0),
      average: statsRow?.average != null ? Number(Number(statsRow.average).toFixed(1)) : null,
    };
  },
};
