/**
 * Job service — business logic cho CRUD + list/matches.
 * Ném AppError cho mọi lỗi nghiệp vụ; HTTP shape do controller đảm nhiệm.
 */
import crypto from 'crypto';
import { db } from '../config/database';
import { jobs, companies, jobSkills } from '../db/schema';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { Job } from '@/interface/job';
import {
  JobListQuery,
  JobCreateBody,
  JobUpdateBody,
} from '../middleware/job';

/** Slugify đơn giản — bỏ dấu + ký tự đặc biệt; append hash ngắn chống trùng. */
const slugify = (s: string): string => {
  const base = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${base || 'job'}-${crypto.randomBytes(3).toString('hex')}`;
};

export const jobService = {
  /** Public list — chỉ trả job đã `live`. */
  list: async (filters: JobListQuery): Promise<Job[]> => {
    const conditions = [eq(jobs.status, 'live')];
    if (filters.search) {
      conditions.push(sql`${jobs.searchTsv} @@ plainto_tsquery('simple', ${filters.search})`);
    }
    if (filters.jobLevel) conditions.push(eq(jobs.jobLevel, filters.jobLevel));
    if (filters.jobType) conditions.push(eq(jobs.jobType, filters.jobType));

    return db.query.jobs.findMany({
      where: and(...conditions),
      orderBy: [desc(jobs.publishedAt)],
      limit: filters.limit,
      offset: (filters.page - 1) * filters.limit,
    });
  },

  /** Public detail — atomic +1 view_count. */
  getById: async (id: string): Promise<Job> => {
    const [row] = await db
      .update(jobs)
      .set({ viewsCount: sql`${jobs.viewsCount} + 1` })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'live')))
      .returning();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    return row;
  },

  /** Employer tạo job. Set `publishedAt` nếu status='live' ngay. */
  create: async (userId: string, data: JobCreateBody) => {
    const company = await db.query.companies.findFirst({
      where: eq(companies.id, data.companyId),
    });
    if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');

    // Drizzle map NUMERIC → string; coerce salaryMin/Max từ number (zod) sang string
    const [row] = await db
      .insert(jobs)
      .values({
        ...data,
        slug: slugify(data.title),
        postedBy: userId,
        publishedAt: data.status === 'live' ? new Date() : null,
        salaryMin: data.salaryMin != null ? String(data.salaryMin) : undefined,
        salaryMax: data.salaryMax != null ? String(data.salaryMax) : undefined,
      } as any)
      .returning();
    return row;
  },

  /** Cập nhật — ownership check (chỉ chủ job hoặc admin đổi được — admin TODO). */
  update: async (userId: string, id: string, data: JobUpdateBody) => {
    const existing = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (existing.postedBy !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không sở hữu job này');
    }

    const patch: Record<string, unknown> = { ...data, updatedAt: new Date() };
    // Chuyển draft/pending/expired/closed -> live lần đầu → set publishedAt
    if (data.status === 'live' && existing.status !== 'live') {
      patch.publishedAt = new Date();
    }

    const [row] = await db.update(jobs).set(patch as any).where(eq(jobs.id, id)).returning();
    return row;
  },

  /** Xóa cứng — cascade xóa applications, job_skills. */
  delete: async (userId: string, id: string): Promise<void> => {
    const existing = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (existing.postedBy !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không sở hữu job này');
    }
    await db.delete(jobs).where(eq(jobs.id, id));
  },

  /**
   * Top ứng viên match — hiện stub.
   * Khi có schema `applications` chính thức, query kiểu:
   *   SELECT * FROM applications
   *   WHERE job_id = $1 AND ai_match_score IS NOT NULL
   *   ORDER BY ai_match_score DESC LIMIT 20;
   */
  getMatches: async (userId: string, jobId: string) => {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (job.postedBy !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không sở hữu job này');
    }
    // TODO: join applications + sort ai_match_score
    return [];
  },
} as const;
