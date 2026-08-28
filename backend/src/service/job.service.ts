import crypto from 'crypto';
import { db } from '../config/database';
import { jobs, companies, jobSkills, jobAiScans, jobAiFlags } from '../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { Job, JobListItem } from '@/interface/job';
import {
  JobListQuery,
  JobCreateBody,
  JobUpdateBody,
  JobSemanticSearchQuery,
} from '../middleware/job';
import { jobModerationQueue, jobEmbeddingQueue } from '../config/queue';
import { invokeJobGeneration } from '../lib/llm/jobGeneration';
import { JOB_GENERATION_SYSTEM_PROMPT, buildJobGenerationUserPrompt } from '../prompts/jobGeneration';
import { searchSimilarJobs, SemanticSearchResult } from '../lib/llm/jobEmbedding';
import { usageLogService } from './usageLog.service';
import { tryCatch } from 'bullmq';

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
  list: async (filters: JobListQuery, companyId?: string): Promise<{ data: JobListItem[]; total: number }> => {
    const conditions = [];
    conditions.push(
      companyId
        ? eq(jobs.companyId, companyId)
        : eq(jobs.status, 'live')
    );
    if (filters.search) {
      conditions.push(sql`${jobs.searchTsv} @@ plainto_tsquery('simple', ${filters.search})`);
    }
    if (filters.jobLevel) conditions.push(eq(jobs.jobLevel, filters.jobLevel));
    if (filters.jobType) conditions.push(eq(jobs.jobType, filters.jobType));

    if (filters.locationCity) {
      conditions.push(sql`${jobs.location}->>'city' = ${filters.locationCity}`);
    }
    if (filters.salaryMin != null) {
      conditions.push(sql`${jobs.salaryMax} >= ${String(filters.salaryMin)}`);
    }
    if (filters.remoteOk != null) {
      conditions.push(eq(jobs.remoteOk, filters.remoteOk));
    }
    if (filters.industry) {
      conditions.push(eq(jobs.industry, filters.industry));
    }

    const [data, [{ total }]] = await Promise.all([
      db.select({
        id: jobs.id,
        title: jobs.title,
        slug: jobs.slug,
        companyId: jobs.companyId,
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
      })
        .from(jobs)
        .where(and(...conditions))
        .orderBy(desc(jobs.publishedAt))
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit),
      
      db.select({ total: sql<number>`count(*)::int` }).from(jobs).where(and(...conditions)),
    ]);
    return { data, total } 
  },
  
  getById: async (id: string): Promise<Job> => {
    const [row] = await db
      .update(jobs)
      .set({ viewsCount: sql`${jobs.viewsCount} + 1` })
      .where(eq(jobs.id, id))
      .returning();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    return row;
  },

  searchByKeyWord: async (keyword: string, page = 1, limit = 20): Promise<{ data: JobListItem[]; total: number }> => {
    const tsq = sql`plainto_tsquery('simple', ${keyword})`;

    const conditions = [
      eq(jobs.status, 'live'),
      sql`${jobs.searchTsv} @@ ${tsq}`,
    ];

    // Chạy song song: lấy data + đếm total
    const [data, [{ total }]] = await Promise.all([
      db
        .select({
          id: jobs.id,
          title: jobs.title,
          slug: jobs.slug,
          companyId: jobs.companyId,
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
          // Bonus: rank score để frontend có thể debug/sort
          rank: sql<number>`ts_rank(${jobs.searchTsv}, ${tsq})`,
        })
        .from(jobs)
        .where(and(...conditions))
        .orderBy(sql`ts_rank(${jobs.searchTsv}, ${tsq}) DESC`)
        .limit(limit)
        .offset((page - 1) * limit),

      db
        .select({ total: sql<number>`count(*)::int` })
        .from(jobs)
        .where(and(...conditions)),
    ]);

    return { data, total };
  },

   
  submit: async (userId: string, jobId: string): Promise<void> => {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (job.postedBy !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không sở hữu job này');
    }
    if (!['draft', 'ai_flagged'].includes(job.status)) {
      throw new AppError(400, 'INVALID_STATUS', `Không thể submit từ trạng thái ${job.status}`);
    }
    await db.update(jobs).set({ status: 'ai_scanning' }).where(eq(jobs.id, jobId));
    await jobModerationQueue.add('job-scan', { jobId });
    // Embed song song với moderation — khi status='live' đã có embedding sẵn
  },

  getScanResult: async (userId: string, jobId: string, role: string) => {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (job.postedBy !== userId && role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền xem scan này');
    }
    const [latestScan] = await db
      .select()
      .from(jobAiScans)
      .where(eq(jobAiScans.jobId, jobId))
      .orderBy(desc(jobAiScans.scannedAt))
      .limit(1);

    if (!latestScan) {
      return null; 
    }
    const flags = await db
      .select()
      .from(jobAiFlags)
      .where(eq(jobAiFlags.scanId, latestScan.id))
      .orderBy(desc(jobAiFlags.severity));

    return {
      scan: {
        id: latestScan.id,
        verdict: latestScan.verdict,
        score: latestScan.score,
        model: latestScan.model,
        scannedAt: latestScan.scannedAt,
      },
      flags,
    };
  },

  /**
   * Admin force re-scan (không cần check status hiện tại).
   * Set status='ai_scanning' trước khi enqueue.
   */
  forceScan: async (jobId: string): Promise<void> => {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    await db.update(jobs).set({ status: 'ai_scanning' }).where(eq(jobs.id, jobId));
    await jobModerationQueue.add('job-scan', { jobId });
  },

    /**
 * Generate draft job description bằng LLM, có quota tracking.
 *
 * Flow:
 *   1. createOrIncrementUsage (reserve quota) → quota_exceeded → 402.
 *   2. invokeJobGeneration (LLM call).
 *      - Success: insertOrIncrementToken (ghi tokens) → return data.
 *      - Fail: decrementCount (rollback) → re-throw.
 *
 * Lưu ý:
 *   - Đây là API call (không phải worker) → không cần retry logic.
 *   - createOrIncrementUsage đã race-safe (advisory lock) → concurrent requests OK.
 */
generateDraft: async (
    userId: string,
    input: { keyword: string; companyName?: string },
) => {
    const FEATURE_KEY = "job_generation";

    // 1. Reserve quota + check limit.
    const reserved = await usageLogService.createOrIncrementUsage(
        userId,
        FEATURE_KEY,
    );
    if (!reserved) {
        throw new AppError(
            402,
            "QUOTA_EXCEEDED",
            "Đã hết lượt generate draft trong gói hiện tại. Vui lòng nâng cấp gói.",
        );
    }

    // 2. Gọi LLM — wrap try/catch để rollback quota nếu fail.
    let result: Awaited<ReturnType<typeof invokeJobGeneration>>;
    try {
        result = await invokeJobGeneration(
            JOB_GENERATION_SYSTEM_PROMPT,
            buildJobGenerationUserPrompt(input),
        );
    } catch (err) {
        // LLM fail → trả lại slot quota (không tính lượt user đã chưa dùng được).
        await usageLogService.decrementCount(userId, FEATURE_KEY);
        throw err;
    }

    // 3. Ghi nhận token sau khi LLM success.
    const tokenUsed = result.usage?.totalTokens ?? 0;
    if (tokenUsed > 0) {
        await usageLogService.insertOrIncrementToken(
            userId,
            FEATURE_KEY,
            tokenUsed,
        );
    }

    return result.data;
},

  create: async (userId: string, data: JobCreateBody) => {
      const company = await db.query.companies.findFirst({
        where: eq(companies.id, data.companyId),
      });
    if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');

    const [row] = await db
      .insert(jobs)
      .values({
        ...data,
        slug: slugify(data.title),
        postedBy: userId,
        publishedAt: data.status === 'live' ? new Date() : null,
        salaryMin: data.salaryMin != null ? String(data.salaryMin) : undefined,
        salaryMax: data.salaryMax != null ? String(data.salaryMax) : undefined,
        requiredSkills: data.requiredSkills ?? [],
        niceToHaveSkills: data.niceToHaveSkills ?? [],
      } as any)
      .returning();
    return row;
  },

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
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Job not found');

    // Re-embed nếu text fields đã đổi — worker dedup qua textHash nên không tốn
    // token nếu text không thực sự đổi.
    const textFields: (keyof JobUpdateBody)[] = ['title', 'description', 'requirements', 'requiredSkills', 'niceToHaveSkills', 'benefits', 'industry'];
    const textChanged = textFields.some((f) => data[f] !== undefined && data[f] !== (existing as any)[f]);
    if (textChanged) {
      await jobEmbeddingQueue.add('embed-job', { jobId: id });
    }

    return row;
  },

  softDelete: async (userId: string, id: string): Promise<void> => {
    const existing = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (existing.postedBy !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không sở hữu job này');
    }
    await db.update(jobs).set({ status: 'closed' }).where(eq(jobs.id, id));
    // await db.delete(jobs).where(eq(jobs.id, id));
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

  /**
   * Semantic search bằng cosine similarity (pgvector).
   * Query được embed → so sánh với embeddings của jobs đang 'live'.
   * Khác searchByKeyWord ở chỗ: tìm theo NGỮ NGHĨA (synonyms, related concepts)
   * thay vì match keyword chính xác.
   *
   * Ví dụ: query "lập trình viên backend NodeJS"
   *   → searchByKeyWord: chỉ match jobs có chữ "lập trình viên backend NodeJS"
   *   → searchSemantic: match cả jobs "Backend Engineer Node.js", "Server-side Developer", ...
   */
  searchSemantic: async (filters: JobSemanticSearchQuery): Promise<{ data: SemanticSearchResult[] }> => {
    const data = await searchSimilarJobs(filters.query, {
      limit: filters.limit,
      threshold: filters.threshold,
      locationCity: filters.locationCity,
      jobLevel: filters.jobLevel,
      jobType: filters.jobType,
    });
    return { data };
  },
} as const;
