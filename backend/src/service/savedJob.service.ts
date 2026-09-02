import { db } from '../config/database';
import { savedJobs } from '../db/schema/applications';
import { jobs, companies } from '../db/schema';
import { and, eq, desc, count, sql } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import type { SavedJobListQuery } from '../middleware/savedJob';
import type { ListSavedJobsResponse, SaveJobResponse } from '../interface/savedJob';

export const savedJobService = {
  list: async (userId: string, filters: SavedJobListQuery): Promise<ListSavedJobsResponse> => {
    const conditions = [eq(savedJobs.userId, userId)];
    if (filters.jobLevel) conditions.push(eq(jobs.jobLevel, filters.jobLevel));
    if (filters.jobType) conditions.push(eq(jobs.jobType, filters.jobType));
    if (filters.remoteOk != null) conditions.push(eq(jobs.remoteOk, filters.remoteOk));
    if (filters.industry) conditions.push(eq(jobs.industry, filters.industry));
    if (filters.search) {
      // Free-text search trên job đã lưu: title (qua searchTsv), company name
      // và required skills. ILIKE để match substring không cần normalize
      // Vietnamese (searchTsv dùng 'simple' dictionary không strip dấu).
      const q = `%${filters.search}%`;
      conditions.push(sql`(
        ${jobs.searchTsv} @@ plainto_tsquery('simple', ${filters.search})
        OR ${jobs.title} ILIKE ${q}
        OR ${companies.name} ILIKE ${q}
      )`);
    }

    const [data, [{ total }]] = await Promise.all([
      db
        .select({
          savedAt: savedJobs.savedAt,
          job: {
            id: jobs.id,
            title: jobs.title,
            slug: jobs.slug,
            companyId: jobs.companyId,
            // LEFT JOIN companies — match pattern ở job.service.ts:list/search.
            companyName: companies.name,
            companyLogoUrl: companies.logoUrl,
            jobLevel: jobs.jobLevel,
            jobType: jobs.jobType,
            industry: jobs.industry,
            salaryMin: jobs.salaryMin,
            salaryMax: jobs.salaryMax,
            salaryCurrency: jobs.salaryCurrency,
            salaryVisible: jobs.salaryVisible,
            location: jobs.location,
            remoteOk: jobs.remoteOk,
            deadline: jobs.deadline,
            status: jobs.status,
            viewsCount: jobs.viewsCount,
            appliesCount: jobs.appliesCount,
            publishedAt: jobs.publishedAt,
          },
        })
        .from(savedJobs)
        .innerJoin(jobs, eq(jobs.id, savedJobs.jobId))
        .leftJoin(companies, eq(jobs.companyId, companies.id))
        .where(and(...conditions))
        .orderBy(desc(savedJobs.savedAt))
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit),

      db
        .select({ total: count() })
        .from(savedJobs)
        .innerJoin(jobs, eq(jobs.id, savedJobs.jobId))
        .where(and(...conditions)),
    ]);

    return {
      success: true,
      data,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  },

  save: async (userId: string, jobId: string): Promise<SaveJobResponse> => {
    const [row] = await db
      .insert(savedJobs)
      .values({ userId, jobId })
      .onConflictDoNothing()
      .returning();

    if (!row) {
      throw new AppError(409, 'ALREADY_SAVED', 'Job đã được lưu trước đó');
    }
    return row;
  },

  /** Bỏ lưu 1 job. Không lỗi nếu trước đó chưa lưu (xoá 0 dòng thì thôi). */
  unsave: async (userId: string, jobId: string): Promise<void> => {
    await db
      .delete(savedJobs)
      .where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId)));
  },
};