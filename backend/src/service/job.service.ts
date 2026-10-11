import crypto from 'crypto';
import { db } from '../config/database';
import { jobs, companies, jobSkills, jobAiScans, jobAiFlags, companyMembers, users, userProfiles } from '../db/schema';
import { eq, desc, asc, and, or, ilike, sql, inArray, gt, lt, type SQL } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import { notificationService } from './notification.service';
import { notificationGateway } from '../socket/notificationGateway';
import { Job, JobListItem, ExportApplicationsJobData, JobStatus, JobDetailPayload } from '@/interface/job';
import {
  JobListQuery,
  JobCreateBody,
  JobUpdateBody,
  JobSemanticSearchQuery,
} from '../middleware/job';
import { jobModerationQueue, jobEmbeddingQueue, exportQueue } from '../config/queue';
import { invokeJobGeneration } from '../lib/llm/jobGeneration';
import { JOB_GENERATION_SYSTEM_PROMPT, buildJobGenerationUserPrompt } from '../prompts/jobGeneration';
import { searchSimilarJobs, SemanticSearchResult } from '../lib/llm/jobEmbedding';
import { usageLogService } from './usageLog.service';
import { jobFeedbackService } from './jobFeedback.service';
import { tryCatch } from 'bullmq';

/**
 * Build prefix-matching `to_tsquery` từ keyword người dùng nhập.
 *
 *  Vấn đề với `plainto_tsquery` mặc định: chỉ match exact token, KHÔNG hỗ trợ
 *  prefix → user gõ "b" / "ba" / "back" → 0 kết quả dù job có "Backend".
 *
 *  Cách fix: build `to_tsquery` với `:*` suffix cho mỗi token để enable prefix
 *  match (vd "back:*" sẽ match "backend", "back-end", "backbone"...).
 *
 *  Sanitize input — to_tsquery operators có thể throw lỗi parse nếu gặp
 *  ký tự đặc biệt: `& | ! ( ) : * \ '`. Strip hết trước khi build query.
 *  Đồng thời lowercase + trim whitespace để khớp với tsvector ('simple' config
 *  đã lower case lúc index).
 *
 *  Return `null` nếu input rỗng sau sanitize — caller skip query (match all).
 */
const buildPrefixTsquery = (keyword: string): string | null => {
  if (!keyword) return null;
  // Lowercase + strip to_tsquery operators + non-word chars (giữ lại chữ cái
  // Unicode + số). Trim + collapse whitespace.
  const cleaned = keyword
    .toLowerCase()
    .replace(/[&|!()':*\\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  // Mỗi token kèm `:*` để enable prefix match; nối bằng `&` (AND logic —
  // job phải chứa TẤT CẢ tokens).
  return tokens.map((t) => `${t}:*`).join(' & ');
};

/**
 * Map sort param → Drizzle ORDER BY clause.
 * Tie-break luôn bằng `createdAt DESC` để order ổn định khi count bằng nhau
 * (vd nhiều job cùng viewsCount=0).
 */
const SORT_MAP: Record<'newest' | 'oldest' | 'views' | 'applies', SQL> = {
  newest:  desc(jobs.createdAt),
  oldest:  asc(jobs.createdAt),
  views:   desc(jobs.viewsCount),
  applies: desc(jobs.appliesCount),
};

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

/**
 * Sinh slug unique bằng cách retry với random suffix mới khi gặp unique
 * constraint violation. `jobs.slug` có partial unique index (xem migration
 * 0032). Collision rate cực thấp (6 hex chars → ~16M combo) nhưng vẫn cần
 * retry-safe để tránh race condition giữa 2 insert đồng thời.
 *
 * Loop tối đa 5 lần để tránh infinite; nếu vẫn trùng (gần như不可能) → ném
 * 500 để caller retry request.
 */
const generateUniqueSlug = async (title: string): Promise<string> => {
  for (let i = 0; i < 5; i += 1) {
    const candidate = slugify(title);
    const [existing] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  // 5 lần trượt → quay lại insert để DB tự reject, hoặc trả lỗi.
  throw new AppError(500, 'SLUG_GENERATION_FAILED', 'Không sinh được slug unique');
};

/**
 * Lấy Job liền trước (mới hơn) và liền sau (cũ hơn) của cùng 1 company
 * dựa trên createdAt để phục vụ nút Next/Previous Job.
 * Sử dụng SQL subquery trực tiếp để tránh mất độ chính xác microsecond khi map qua JS Date
 * và loại bỏ hoàn toàn khả năng trùng với job hiện tại.
 */
const getAdjacentJobs = async (
  companyId: string,
  currentJobId: string,
): Promise<{
  prevJob: { id: string; title: string; slug: string | null } | null;
  nextJob: { id: string; title: string; slug: string | null } | null;
}> => {
  const [prevRes, nextRes] = await Promise.all([
    // Prev job: mới hơn trong danh sách (createdAt lớn hơn hoặc id lớn hơn nếu trùng createdAt)
    db.execute<{ id: string; title: string; slug: string | null }>(sql`
      SELECT id, title, slug FROM jobs
      WHERE company_id = ${companyId}::uuid
        AND id != ${currentJobId}::uuid
        AND (
          created_at > (SELECT created_at FROM jobs WHERE id = ${currentJobId}::uuid)
          OR (
            created_at = (SELECT created_at FROM jobs WHERE id = ${currentJobId}::uuid)
            AND id > ${currentJobId}::uuid
          )
        )
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `),
    // Next job: cũ hơn trong danh sách (createdAt nhỏ hơn hoặc id nhỏ hơn nếu trùng createdAt)
    db.execute<{ id: string; title: string; slug: string | null }>(sql`
      SELECT id, title, slug FROM jobs
      WHERE company_id = ${companyId}::uuid
        AND id != ${currentJobId}::uuid
        AND (
          created_at < (SELECT created_at FROM jobs WHERE id = ${currentJobId}::uuid)
          OR (
            created_at = (SELECT created_at FROM jobs WHERE id = ${currentJobId}::uuid)
            AND id < ${currentJobId}::uuid
          )
        )
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `),
  ]);

  return {
    prevJob: prevRes.rows[0] ?? null,
    nextJob: nextRes.rows[0] ?? null,
  };
};

export const jobService = {
  /**
   * Slim list id + title của job thuộc 1 company — cho dropdown filter
   * trang Applications (employer). Không phân trang: 1 company có ít job,
   * trả hết 1 lần để FE populate dropdown. Chỉ select 2 cột để nhẹ.
   *
   * `keyword` optional — filter title ILIKE %keyword% (case-insensitive,
   * FE debounce 300ms khi user gõ). Trim + rỗng → bỏ filter.
   */
  listJobNames: async (
    companyId: string,
    keyword?: string,
    userContext?: { userId: string; role: 'owner' | 'member' },
  ): Promise<Array<{ id: string; title: string }>> => {
    const kw = keyword?.trim();
    const conditions = [eq(jobs.companyId, companyId)];
    if (kw) conditions.push(ilike(jobs.title, `%${kw}%`));

    if (userContext && userContext.role === 'member') {
      conditions.push(
        or(
          eq(jobs.postedBy, userContext.userId),
          eq(jobs.assignedTo, userContext.userId),
        )!,
      );
    }

    return db
      .select({ id: jobs.id, title: jobs.title })
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.createdAt));
  },

  list: async (
    filters: JobListQuery,
    companyId?: string,
    userContext?: { userId: string; role: 'owner' | 'member' },
  ): Promise<{ data: JobListItem[]; total: number }> => {
    const conditions = [];
    // Logic filter status tuỳ ngữ cảnh:
    //  - Public `/jobs` (candidate, no companyId) mặc định chỉ trả status='live'
    //    để ứng viên không thấy job draft/ai_flagged/closed. Nếu caller truyền
    //    `filters.status` thì ghi đè bằng `inArray(...)` (multi-status).
    //  - Employer `/jobs/company` (có companyId) KHÔNG filter status mặc định —
    //    employer cần thấy mọi trạng thái trong pipeline moderation. Nếu
    //    caller truyền `filters.status` thì AND thêm (xem block dưới).
    if (companyId) {
      conditions.push(eq(jobs.companyId, companyId));

      // Phân quyền nội bộ công ty:
      // - Member thường: Chỉ thấy tin do mình tạo (postedBy) HOẶC được gán (assignedTo)
      // - Owner: Thấy toàn bộ tin của công ty
      if (userContext && userContext.role === 'member') {
        conditions.push(
          or(
            eq(jobs.postedBy, userContext.userId),
            eq(jobs.assignedTo, userContext.userId),
          )!,
        );
      }
    } else if (filters.status && filters.status.length > 0) {
      conditions.push(inArray(jobs.status, filters.status));
    } else {
      conditions.push(eq(jobs.status, 'live'));
    }
    if (filters.search) {
      // Dùng buildPrefixTsquery thay vì `plainto_tsquery` — hỗ trợ prefix match
      // (user gõ "b" / "ba" / "back" đều tìm thấy job có "Backend"...).
      const tsq = buildPrefixTsquery(filters.search);
      if (tsq) {
        conditions.push(sql`${jobs.searchTsv} @@ to_tsquery('simple', ${tsq})`);
      }
      // Input rỗng sau sanitize → match all (giữ nguyên filter khác).
    }
    if (filters.jobLevel && filters.jobLevel.length > 0) {
      conditions.push(inArray(jobs.jobLevel, filters.jobLevel));
    }
    if (filters.jobType && filters.jobType.length > 0) {
      conditions.push(inArray(jobs.jobType, filters.jobType));
    }

    // Nếu employer truyền cả `companyId` lẫn `filters.status` (filter thêm trong
    // trang "Job đã đăng") → AND thêm điều kiện status. Nhánh `if (companyId)`
    // ở trên không push status, nên phải push riêng ở đây.
    if (companyId && filters.status && filters.status.length > 0) {
      conditions.push(inArray(jobs.status, filters.status));
    }

    if (filters.locationCity) {
      // Match cả 2 dạng: data cũ có thể lưu "Thành phố Hà Nội" (nguyên từ API)
      // hoặc "Hà Nội" (employer nhập tay). FE giờ luôn gửi shortName (strip
      // prefix), nên để job-match ngon cả data cũ lẫn mới → so khớp cả exact
      // và bằng cách strip "Thành phố "/"Tỉnh " ở DB column.
      conditions.push(sql`(
        ${jobs.location}->>'city' = ${filters.locationCity}
        OR ${jobs.location}->>'city' = ${'Thành phố ' + filters.locationCity}
        OR ${jobs.location}->>'city' = ${'Tỉnh ' + filters.locationCity}
      )`);
    }
    if (filters.salaryMin != null && filters.salaryMax != null) {
      // Overlap filter — job's salary range phải overlap với user's filter range.
      // Chuẩn LinkedIn/Indeed UX: job [20M, 30M] hiện khi filter [10M, 25M] vì overlap.
      // Dùng LEAST/GREATEST để bound chính xác cho data cũ có thể có min > max.
      conditions.push(sql`${jobs.salaryMax} >= ${String(filters.salaryMin)}`);
      conditions.push(sql`${jobs.salaryMin} <= ${String(filters.salaryMax)}`);
    } else if (filters.salaryMin != null) {
      conditions.push(sql`${jobs.salaryMax} >= ${String(filters.salaryMin)}`);
    } else if (filters.salaryMax != null) {
      conditions.push(sql`${jobs.salaryMin} <= ${String(filters.salaryMax)}`);
    }
    if (filters.workType) {
      conditions.push(eq(jobs.workType, filters.workType));
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
        postedBy: jobs.postedBy,
        assignedTo: jobs.assignedTo,
        // LEFT JOIN companies — lấy tên + logo để FE render card không cần
        // gọi thêm API. NULL nếu company không tồn tại (job vẫn được trả).
        companyName: companies.name,
        companyLogoUrl: companies.logoUrl,
        descriptions: jobs.description,
        jobLevel: jobs.jobLevel,
        jobType: jobs.jobType,
        industry: jobs.industry,
        salaryMin: jobs.salaryMin,
        salaryMax: jobs.salaryMax,
        salaryCurrency: jobs.salaryCurrency,
        salaryVisible: jobs.salaryVisible,
        location: jobs.location,
        workType: jobs.workType,
        experienceYearsMin: jobs.experienceYearsMin,
        experienceYearsMax: jobs.experienceYearsMax,
        requiredSkills: jobs.requiredSkills,
        deadline: jobs.deadline,
        status: jobs.status,
        hiringStatus: jobs.hiringStatus,
        viewsCount: jobs.viewsCount,
        appliesCount: jobs.appliesCount,
        publishedAt: jobs.publishedAt,
        createdAt: jobs.createdAt,
        /**
         * Trung bình rating 1–5 + số feedback của job. Correlated subquery —
         * dùng index `idx_job_feedbacks_job(job_id, createdAt)`, không làm
         * phình row (khác LEFT JOIN + GROUP BY) và KHÔNG ảnh hưởng pagination
         * COUNT(*). Trả `null` rating khi job chưa có feedback.
         *
         * Lưu ý: cast `float8` thay vì `numeric(3,1)` — pg-node serialize
         * `numeric` thành STRING mặc định, làm FE `ratingAvg.toFixed()`
         * throw. `float8` trả về JS number đúng type contract.
         */
        ratingAvg: sql<number | null>`(
          SELECT AVG(rating)::float8
          FROM job_feedbacks
          WHERE job_id = ${jobs.id}
        )`,
        ratingCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM job_feedbacks
          WHERE job_id = ${jobs.id}
        )`,
      })
        .from(jobs)
        .leftJoin(companies, eq(jobs.companyId, companies.id))
        .where(and(...conditions))
        // Order theo filter.sort (Zod default = 'newest'). Tie-break createdAt DESC.
        .orderBy(SORT_MAP[filters.sort ?? 'newest'], desc(jobs.createdAt))
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit),

      db.select({ total: sql<number>`count(*)::int` }).from(jobs).where(and(...conditions)),
    ]);
    return { data, total } as { data: JobListItem[]; total: number };
  },
  
  /**
   * Lấy danh sách industry distinct từ các job đang `live` (dùng cho filter dropdown).
   * Industry lưu dạng text tự do → trả về sorted ascending cho FE dễ render.
   * Loại bỏ NULL + chuỗi rỗng.
   */
  listIndustries: async (): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ industry: jobs.industry })
      .from(jobs)
      .where(and(eq(jobs.status, 'live'), sql`${jobs.industry} IS NOT NULL`, sql`${jobs.industry} <> ''`))
      .orderBy(jobs.industry);
    return rows.map((r) => r.industry).filter((s): s is string => Boolean(s));
  },

  /**
   * Lấy danh sách `city` distinct từ `jobs.location` JSONB (chỉ job `live`).
   * Dùng cho Location filter dropdown ở JobSearchView.
   *
   * - Distinct ở raw value (giữ nguyên prefix "Thành phố "/"Tỉnh " nếu data
   *   cũ vẫn còn) → strip prefix ngay tại đây + dedup lại, để FE nhận về
   *   shortName ("Hà Nội") và gửi lại cho filter `locationCity` exact-match
   *   (filter đã có fallback cho data cũ ở `jobService.list`).
   * - Loại bỏ null / empty.
   * - Sort ascending cho UX dễ scan.
   */
  listCities: async (): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ city: sql<string>`${jobs.location}->>'city'` })
      .from(jobs)
      .where(and(eq(jobs.status, 'live'), sql`${jobs.location}->>'city' IS NOT NULL`, sql`${jobs.location}->>'city' <> ''`));
    const set = new Set<string>();
    for (const r of rows) {
      const raw = r.city;
      if (!raw) continue;
      const stripped = raw.replace(/^(Thành phố |Tỉnh )/i, '').trim();
      if (stripped) set.add(stripped);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  },

  /**
   * Lấy danh sách JobType enum values từ DB enum `job_type`. Dùng cho FE
   * JobType filter dropdown — sync với backend, không hardcode.
   *
   * Query `pg_enum` system catalog:
   *   - enums.enumlabel = string value ('full-time', 'part-time', ...)
   *   - enums.enumtypid = OID của enum type 'job_type'
   *   - enums.enumsortorder = thứ tự khai báo trong CREATE TYPE
   *
   * Trả về sorted theo enumsortorder (giữ thứ tự enum declaration), fallback
   * locale sort nếu order bằng nhau.
   */
  listJobTypes: async (): Promise<string[]> => {
    const rows = await db.execute<{ enumlabel: string }>(sql`
      SELECT enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'job_type'
      ORDER BY e.enumsortorder ASC
    `);
    return rows.rows.map((r) => r.enumlabel);
  },

  /** Tương tự `listJobTypes` cho enum `job_level` (Experience Level filter). */
  listJobLevels: async (): Promise<string[]> => {
    const rows = await db.execute<{ enumlabel: string }>(sql`
      SELECT enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'job_level'
      ORDER BY e.enumsortorder ASC
    `);
    return rows.rows.map((r) => r.enumlabel);
  },

  /**
   * Lấy min/max salary thực tế (VND) trên toàn bộ job `live` — dùng để set
   * bounds cho Salary range slider ở JobSearchView. Dùng `LEAST/GREATEST` để
   * bound chính xác trong trường hợp data cũ có `salary_min > salary_max`
   * (employer set ngược). Aggregate nhẹ — partial index `idx_jobs_salary_range`
   * (status='live') phủ toàn bộ scan.
   *
   * Return `{ min: 0, max: 0 }` khi DB chưa có job live nào có salary —
   * FE fallback hiển thị slider disabled với range mặc định.
   */
  listSalaryRange: async (): Promise<{ min: number; max: number }> => {
    const result = await db.execute<{ min: string | null; max: string | null }>(sql`
      SELECT
        MIN(LEAST(salary_min, salary_max))::text  AS min,
        MAX(GREATEST(salary_min, salary_max))::text AS max
      FROM jobs
      WHERE status = 'live'
        AND salary_min IS NOT NULL
        AND salary_max IS NOT NULL
    `);
    const row = result.rows[0];
    return {
      min: row?.min != null ? Number(row.min) : 0,
      max: row?.max != null ? Number(row.max) : 0,
    };
  },

  getById: async (id: string): Promise<JobDetailPayload> => {
    const [row] = await db
      .update(jobs)
      .set({ viewsCount: sql`${jobs.viewsCount} + 1` })
      .where(eq(jobs.id, id))
      .returning();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Job not found');

    const [{ data: feedbacks, stats }, { prevJob, nextJob }, [company]] = await Promise.all([
      jobFeedbackService.listForJob(id),
      getAdjacentJobs(row.companyId, row.id),
      db
        .select({
          id: companies.id,
          name: companies.name,
          logoUrl: companies.logoUrl,
          slug: companies.slug,
        })
        .from(companies)
        .where(eq(companies.id, row.companyId))
        .limit(1),
    ]);

    // Populate thông tin người phụ trách (assignedTo hoặc fallback postedBy)
    const assigneeUserId = row.assignedTo || row.postedBy;
    let assignedToUser: { id: string; fullName: string | null; email: string; avatarUrl: string | null } | null = null;
    if (assigneeUserId) {
      const [u] = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: userProfiles.fullName,
          avatarUrl: userProfiles.avatarUrl,
        })
        .from(users)
        .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
        .where(eq(users.id, assigneeUserId))
        .limit(1);
      if (u) assignedToUser = u;
    }

    return {
      ...row,
      companyName: company?.name ?? null,
      companyLogoUrl: company?.logoUrl ?? null,
      companySlug: company?.slug ?? null,
      company: company ?? null,
      ratingAvg: stats.average,
      ratingCount: stats.count,
      assignedToUser,
      feedbacks,
      feedbackStats: stats,
      prevJob,
      nextJob,
    };
  },

  /**
   * Lấy job theo slug (URL SEO-friendly). Mirror `getById`:
   *   - Tăng viewsCount +1 (side-effect như getById).
   *   - Nhúng feedbacks + feedbackStats vào response.
   *   - Nhúng company info (companyName, companyLogoUrl, companySlug).
   *   - Hỗ trợ fallback tìm theo UUID nếu tham số là id.
   *   - 404 nếu slug không tồn tại.
   */
  getBySlug: async (slug: string): Promise<JobDetailPayload> => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
    const condition = isUuid
      ? or(eq(jobs.slug, slug), eq(jobs.id, slug))
      : eq(jobs.slug, slug);

    const [row] = await db
      .update(jobs)
      .set({ viewsCount: sql`${jobs.viewsCount} + 1` })
      .where(condition)
      .returning();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Job not found');

    const [{ data: feedbacks, stats }, { prevJob, nextJob }, [company]] = await Promise.all([
      jobFeedbackService.listForJob(row.id),
      getAdjacentJobs(row.companyId, row.id),
      db
        .select({
          id: companies.id,
          name: companies.name,
          logoUrl: companies.logoUrl,
          slug: companies.slug,
        })
        .from(companies)
        .where(eq(companies.id, row.companyId))
        .limit(1),
    ]);

    const assigneeUserId = row.assignedTo || row.postedBy;
    let assignedToUser: { id: string; fullName: string | null; email: string; avatarUrl: string | null } | null = null;
    if (assigneeUserId) {
      const [u] = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: userProfiles.fullName,
          avatarUrl: userProfiles.avatarUrl,
        })
        .from(users)
        .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
        .where(eq(users.id, assigneeUserId))
        .limit(1);
      if (u) assignedToUser = u;
    }

    return {
      ...row,
      companyName: company?.name ?? null,
      companyLogoUrl: company?.logoUrl ?? null,
      companySlug: company?.slug ?? null,
      company: company ?? null,
      ratingAvg: stats.average,
      ratingCount: stats.count,
      assignedToUser,
      feedbacks,
      feedbackStats: stats,
      prevJob,
      nextJob,
    };
  },

  /**
   * Resolve jobId từ slug — dùng cho các sub-endpoint cần FK vào applications
   * (vd `GET /jobs/by-slug/:slug/application-status`). Trả `null` nếu không
   * tìm thấy (controller tự throw 404). Nhẹ hơn `getBySlug` vì không tăng
   * viewsCount, không embed feedbacks.
   */
  getIdBySlug: async (slug: string): Promise<{ id: string } | null> => {
    const [row] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.slug, slug))
      .limit(1);
    return row ?? null;
  },

  searchByKeyWord: async (keyword: string, page = 1, limit = 20): Promise<{ data: JobListItem[]; total: number }> => {
    // Build prefix tsquery thay vì plainto_tsquery — hỗ trợ user gõ "b" / "ba"
    // (xem buildPrefixTsquery comment ở đầu file).
    const tsqExpr = buildPrefixTsquery(keyword);
    const tsq = tsqExpr
      ? sql`to_tsquery('simple', ${tsqExpr})`
      : sql`true`;  // empty → match all
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
          companyName: companies.name,
          companyLogoUrl: companies.logoUrl,
          descriptions: jobs.description,
          jobLevel: jobs.jobLevel,
          jobType: jobs.jobType,
          industry: jobs.industry,
          salaryMin: jobs.salaryMin,
          salaryMax: jobs.salaryMax,
          salaryCurrency: jobs.salaryCurrency,
          salaryVisible: jobs.salaryVisible,
          location: jobs.location,
          workType: jobs.workType,
          experienceYearsMin: jobs.experienceYearsMin,
          experienceYearsMax: jobs.experienceYearsMax,
          requiredSkills: jobs.requiredSkills,
          deadline: jobs.deadline,
          status: jobs.status,
          viewsCount: jobs.viewsCount,
          appliesCount: jobs.appliesCount,
          publishedAt: jobs.publishedAt,
          createdAt: jobs.createdAt,
          hiringStatus: jobs.hiringStatus,
          // Bonus: rank score để frontend có thể debug/sort
          rank: sql<number>`ts_rank(${jobs.searchTsv}, ${tsq})`,
          // Mirror jobService.list để FE có cùng shape dù gọi /search hay /
          // (ratingAvg dùng ::float8 để pg-node trả JS number, không phải string)
          ratingAvg: sql<number | null>`(
            SELECT AVG(rating)::float8
            FROM job_feedbacks
            WHERE job_id = ${jobs.id}
          )`,
          ratingCount: sql<number>`(
            SELECT COUNT(*)::int
            FROM job_feedbacks
            WHERE job_id = ${jobs.id}
          )`,
        })
        .from(jobs)
        .leftJoin(companies, eq(jobs.companyId, companies.id))
        .where(and(...conditions))
        .orderBy(sql`ts_rank(${jobs.searchTsv}, ${tsq}) DESC`)
        .limit(limit)
        .offset((page - 1) * limit),

      db
        .select({ total: sql<number>`count(*)::int` })
        .from(jobs)
        .where(and(...conditions)),
    ]);

    return { data, total } as { data: JobListItem[]; total: number };
  },

   
  submit: async (userId: string, jobId: string): Promise<void> => {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (job.postedBy !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không sở hữu job này');
    }
    // if (!['draft', 'ai_flagged', ''].includes(job.status)) {
    //   throw new AppError(400, 'INVALID_STATUS', `Không thể submit từ trạng thái ${job.status}`);
    // }

    // Reserve quota TRƯỚC khi đổi status/enqueue — hết lượt → 402 QUOTA_EXCEEDED
    // ngay, job không vào queue. (Trước đây reserve trong worker.)
    await usageLogService.reserveQuota(userId, 'job_post');

    await db.update(jobs).set({ status: 'ai_scanning' }).where(eq(jobs.id, jobId));

    // Enqueue fail (Redis down) → revert status + hoàn lượt + 503.
    try {
      await jobModerationQueue.add('job-scan', {
        jobId,
        postedBy: userId,
        chargeQuota: true,
      });
    } catch (e) {
      await db
        .update(jobs)
        .set({ status: job.status })
        .where(eq(jobs.id, jobId));
      await usageLogService.decrementCount(userId, 'job_post');
      throw new AppError(
        503,
        'QUEUE_UNAVAILABLE',
        'Hệ thống bận, vui lòng thử lại.',
      );
    }
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
   *
   * BYPASS quota — thao tác vận hành admin, KHÔNG reserve `job_post` của chủ
   * job (tránh 402 thay người khác / hoàn oan lượt chưa tiêu). Worker nhận
   * `chargeQuota: false` để biết không được decrement khi fail.
   */
  forceScan: async (jobId: string): Promise<void> => {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    await db.update(jobs).set({ status: 'ai_scanning' }).where(eq(jobs.id, jobId));
    await jobModerationQueue.add('job-scan', {
      jobId,
      postedBy: job.postedBy,
      chargeQuota: false,
    });
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

    // Xác thực membership của người tạo
    const [membership] = await db
      .select({ role: companyMembers.role, status: companyMembers.status })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, data.companyId),
          eq(companyMembers.userId, userId),
          eq(companyMembers.status, 'active'),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không phải thành viên active của công ty này');
    }

    // Mặc định khi member tạo tin: assignedTo = userId
    let assignedTo = userId;

    // Nếu Owner tạo tin và có chỉ định assignedTo:
    if (membership.role === 'owner' && data.assignedTo) {
      const [targetMember] = await db
        .select({ id: companyMembers.id })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, data.companyId),
            eq(companyMembers.userId, data.assignedTo),
            eq(companyMembers.status, 'active'),
          ),
        )
        .limit(1);

      if (!targetMember) {
        throw new AppError(
          400,
          'INVALID_ASSIGNEE',
          'Người được gán phải là thành viên đang hoạt động (active) của công ty',
        );
      }
      assignedTo = data.assignedTo;
    }

    const [row] = await db
      .insert(jobs)
      .values({
        ...data,
        deadline: data.deadline ? new Date(data.deadline) : null,
        status: 'draft', // Luôn ép status là 'draft' khi tạo mới, bắt buộc qua /submit để AI kiểm duyệt
        publishedAt: null, // Chỉ được set publishedAt khi hệ thống AI duyệt thành 'live'
        slug: await generateUniqueSlug(data.title),
        postedBy: userId,
        assignedTo,
        salaryMin: data.salaryMin != null ? String(data.salaryMin) : undefined,
        salaryMax: data.salaryMax != null ? String(data.salaryMax) : undefined,
        requiredSkills: data.requiredSkills ?? [],
        niceToHaveSkills: data.niceToHaveSkills ?? [],
      } as any)
      .returning();

    // Nếu gán cho nhân viên khác, gửi realtime notification
    if (assignedTo !== userId) {
      try {
        await notificationService.create({
          userId: assignedTo,
          type: 'company',
          title: `Bạn được gán phụ trách tin tuyển dụng "${row.title}"`,
          payload: {
            jobId: row.id,
            jobTitle: row.title,
            assignedBy: userId,
            message: `Chủ doanh nghiệp đã gán bạn phụ trách tin tuyển dụng "${row.title}".`,
          },
        });

        notificationGateway.emitToUser(assignedTo, 'job:assigned', {
          jobId: row.id,
          jobTitle: row.title,
          assignedBy: userId,
          assignedAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn({ err, jobId: row.id, assignedTo }, 'create: gửi thông báo gán job thất bại');
      }
    }

    return row;
  },

  /**
   * Owner gán tin tuyển dụng cho nhân viên khác trong cùng công ty
   * PATCH /jobs/:id/assign
   */
  assignJob: async (ownerUserId: string, id: string, newAssignedToUserId: string) => {
    const [job] = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        companyId: jobs.companyId,
        postedBy: jobs.postedBy,
        assignedTo: jobs.assignedTo,
      })
      .from(jobs)
      .where(eq(jobs.id, id))
      .limit(1);

    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Tin tuyển dụng không tồn tại');
    }

    // 1. Kiểm tra quyền: Người gọi phải là Owner active của công ty sở hữu job
    const [requesterMember] = await db
      .select({ role: companyMembers.role, status: companyMembers.status })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, job.companyId),
          eq(companyMembers.userId, ownerUserId),
        ),
      )
      .limit(1);

    if (!requesterMember || requesterMember.role !== 'owner' || requesterMember.status !== 'active') {
      throw new AppError(
        403,
        'FORBIDDEN_NOT_OWNER',
        'Chỉ chủ doanh nghiệp (Owner) của công ty mới có quyền gán tin tuyển dụng.',
      );
    }

    // 2. Kiểm tra người nhận việc: Phải là thành viên active trong cùng công ty
    const [targetMember] = await db
      .select({ id: companyMembers.id, userId: companyMembers.userId, status: companyMembers.status })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, job.companyId),
          eq(companyMembers.userId, newAssignedToUserId),
          eq(companyMembers.status, 'active'),
        ),
      )
      .limit(1);

    if (!targetMember) {
      throw new AppError(
        400,
        'INVALID_ASSIGNEE',
        'Người nhận việc phải là thành viên đang hoạt động (active) trong cùng công ty.',
      );
    }

    // 3. Cập nhật assigned_to
    const [updatedJob] = await db
      .update(jobs)
      .set({
        assignedTo: newAssignedToUserId,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id))
      .returning();

    // 4. Gửi thông báo Notification và Realtime Socket tới nhân viên được gán
    try {
      await notificationService.create({
        userId: newAssignedToUserId,
        type: 'company',
        title: `Bạn được gán phụ trách tin tuyển dụng "${job.title}"`,
        payload: {
          jobId: job.id,
          jobTitle: job.title,
          assignedBy: ownerUserId,
          message: `Chủ doanh nghiệp đã gán bạn phụ trách tin tuyển dụng "${job.title}".`,
        },
      });

      notificationGateway.emitToUser(newAssignedToUserId, 'job:assigned', {
        jobId: job.id,
        jobTitle: job.title,
        assignedBy: ownerUserId,
        assignedAt: new Date().toISOString(),
      });
    } catch (notifyErr) {
      logger.warn({ err: notifyErr, jobId: id, newAssignedToUserId }, 'assignJob: emit socket/notif thất bại');
    }

    return updatedJob;
  },

  update: async (userId: string, id: string, data: JobUpdateBody) => {
    const existing = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Job not found');

    // Quyền sửa tin: Là người tạo (postedBy), hoặc người được gán (assignedTo), hoặc là Owner của công ty
    const isDirectPerson = existing.postedBy === userId || existing.assignedTo === userId;
    if (!isDirectPerson) {
      const [membership] = await db
        .select({ role: companyMembers.role })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, existing.companyId),
            eq(companyMembers.userId, userId),
            eq(companyMembers.status, 'active'),
          ),
        )
        .limit(1);

      if (!membership || membership.role !== 'owner') {
        throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền chỉnh sửa tin tuyển dụng này');
      }
    }

    const patch: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.deadline !== undefined) {
      patch.deadline = data.deadline ? new Date(data.deadline) : null;
    }
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
   * Mở lại job đã đóng (status='closed' → 'draft').
   *
   * Lưu ý:
   *  - KHÔNG tự gửi AI scan — user phải bấm "Gửi kiểm duyệt AI" sau khi sửa.
   *  - KHÔNG reset publishedAt/appliesCount/viewsCount: job re-open giữ
   *    engagement data lịch sử. Khi user submit lại và worker duyệt OK,
   *    `jobService.update` sẽ refresh publishedAt = now() (đảm bảo ngày đăng
   *    mới, không phải ngày cũ trước khi close).
   */
  reopen: async (userId: string, id: string): Promise<void> => {
    const existing = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (existing.postedBy !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không sở hữu job này');
    }
    if (existing.status !== 'closed') {
      throw new AppError(400, 'INVALID_STATUS', 'Chỉ có thể mở lại job đã đóng');
    }
    await db
      .update(jobs)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(jobs.id, id));
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
   * `GET /jobs/:id/applicants-over-time?days=N` — timeseries applicants theo ngày
   * cho JobDetailView chart (candidate-side). Public — chỉ aggregate count.
   *
   * SQL dùng `generate_series` LEFT JOIN applications để fill đủ N ngày gần
   * nhất (kể cả ngày 0 applicant) — không bị gap khi job mới tạo.
   *
   * `peak` là điểm count cao nhất trong series (null nếu toàn bộ = 0).
   * `totalApplicants` đếm TOÀN BỘ application của job (không giới hạn days).
   */
  getApplicantsOverTime: async (
    jobId: string,
    days: number,
  ): Promise<{
    series: { date: string; count: number }[];
    peak: { date: string; count: number } | null;
    totalApplicants: number;
  }> => {
    // Verify job tồn tại — 404 thay vì trả series rỗng (FE có thể hiểu nhầm).
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: { id: true },
    });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');

    const seriesResult = await db.execute<{ date: string; count: string }>(sql`
      WITH days AS (
        SELECT generate_series(
          (CURRENT_DATE - (${days - 1}) * INTERVAL '1 day')::date,
          CURRENT_DATE::date,
          '1 day'
        )::date AS d
      )
      SELECT to_char(d.d, 'DD/MM') AS date,
             COUNT(a.id)::text     AS count
      FROM days d
      LEFT JOIN applications a
        ON DATE(a.applied_at) = d.d
       AND a.job_id = ${jobId}
      GROUP BY d.d
      ORDER BY d.d ASC
    `);

    const series = seriesResult.rows.map((r) => ({
      date: r.date,
      count: Number(r.count),
    }));
    const peak = series.reduce<{ date: string; count: number } | null>(
      (best, p) => (best == null || p.count > best.count ? p : best),
      null,
    );

    const [totalRow] = (await db.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c
      FROM applications
      WHERE job_id = ${jobId}
    `)).rows;

    return {
      series,
      peak: peak && peak.count > 0 ? peak : null,
      totalApplicants: Number(totalRow?.c ?? 0),
    };
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

  /**
   * POST /jobs/:id/export — check quyền rồi đẩy task vào exportQueue (BullMQ).
   * KHÔNG tự sinh CSV ở đây — export.worker.ts (chạy nền) mới làm việc đó,
   * xong sẽ báo qua notificationGateway (socket.io), không trả file ngay.
   * Pattern check ownership giống hệt getMatches() ở trên.
   */
  requestExportApplications: async (targetJobId: string, requestedBy: string): Promise<void> => {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, targetJobId) });
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
    if (job.postedBy !== requestedBy) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không sở hữu job này');
    }

    const jobData: ExportApplicationsJobData = { targetJobId, requestedBy };
    await exportQueue.add('export-applications', jobData);
  },
    
   /**
   * Lấy nhiều job theo id — KHÔNG filter status (vì còn job 'closed' → warning).
   * Phase 1: chỉ trả 'live' hoặc 'closed' (ẩn 'draft'/'pending'/'ai_scanning'/'ai_flagged'/'expired').
   * Jobs là public nên KHÔNG cần ownership filter.
   */
  getByIdsPublic: async (ids: string[]): Promise<Job[]> => {
    if (!ids.length) return [];
    const rows = await db
      .select()
      .from(jobs)
      .where(
        and(
          inArray(jobs.id, ids),
          sql`${jobs.status} IN ('live', 'closed')`,
        ),
    );
    return rows;
  },

  /* ==========================================================================
   * ADMIN METHODS — KHÔNG check ownership, KHÔNG filter status mặc định.
   * Dùng cho /admin/jobs page.
   * ========================================================================== */

  /**
   * List TẤT CẢ jobs (mọi status) cho admin — bỏ filter status='live' mặc định
   * của /jobs public, kết hợp được tất cả filter.
   */
  listAll: async (filters: JobListQuery): Promise<{ data: JobListItem[]; total: number }> => {
    const conditions: SQL[] = [];

    if (filters.status && filters.status.length > 0) {
      conditions.push(inArray(jobs.status, filters.status));
    }
    if (filters.jobLevel && filters.jobLevel.length > 0) {
      conditions.push(inArray(jobs.jobLevel, filters.jobLevel));
    }
    if (filters.jobType && filters.jobType.length > 0) {
      conditions.push(inArray(jobs.jobType, filters.jobType));
    }
    if (filters.search) {
      // Dùng buildPrefixTsquery thay vì `plainto_tsquery` — hỗ trợ prefix match
      // (user gõ "b" / "ba" / "back" đều tìm thấy job có "Backend"...).
      const tsq = buildPrefixTsquery(filters.search);
      if (tsq) {
        conditions.push(sql`${jobs.searchTsv} @@ to_tsquery('simple', ${tsq})`);
      }
      // Input rỗng sau sanitize → match all (giữ nguyên filter khác).
    }
    if (filters.industry) {
      conditions.push(eq(jobs.industry, filters.industry));
    }
    if (filters.locationCity) {
      conditions.push(sql`${jobs.location}->>'city' = ${filters.locationCity}`);
    }
    if (filters.workType) {
      conditions.push(eq(jobs.workType, filters.workType));
    }
    // Salary range filter (admin) — same overlap semantics as list() public.
    if (filters.salaryMin != null && filters.salaryMax != null) {
      conditions.push(sql`${jobs.salaryMax} >= ${String(filters.salaryMin)}`);
      conditions.push(sql`${jobs.salaryMin} <= ${String(filters.salaryMax)}`);
    } else if (filters.salaryMin != null) {
      conditions.push(sql`${jobs.salaryMax} >= ${String(filters.salaryMin)}`);
    } else if (filters.salaryMax != null) {
      conditions.push(sql`${jobs.salaryMin} <= ${String(filters.salaryMax)}`);
    }

    // Sort theo filter.sort (Zod đã default = 'newest'). Tie-break createdAt DESC.
    const sortClause = SORT_MAP[filters.sort ?? 'newest'];

    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const rows = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        slug: jobs.slug,
        companyId: jobs.companyId,
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
        workType: jobs.workType,
        deadline: jobs.deadline,
        status: jobs.status,
        viewsCount: jobs.viewsCount,
        appliesCount: jobs.appliesCount,
        publishedAt: jobs.publishedAt,
        createdAt: jobs.createdAt,
        hiringStatus: jobs.hiringStatus,
        ratingAvg: sql<number | null>`(
          SELECT AVG(rating)::float8
          FROM job_feedbacks
          WHERE job_id = ${jobs.id}
        )`,
        ratingCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM job_feedbacks
          WHERE job_id = ${jobs.id}
        )`,
      })
      .from(jobs)
      .leftJoin(companies, eq(jobs.companyId, companies.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sortClause, desc(jobs.createdAt))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit);

    return { data: rows as JobListItem[], total };
  },

  /**
   * Đếm jobs theo status + tổng applicants — cho Admin summary row.
   * totalApplicants dùng cho hero stat (toàn bộ job, không phụ thuộc filter/page).
   */
  countByStatus: async (): Promise<{
    total: number;
    totalApplicants: number;
    byStatus: Record<string, number>;
  }> => {
    const [rows, [{ totalApplicants }]] = await Promise.all([
      db
        .select({ status: jobs.status, count: sql<number>`count(*)::int` })
        .from(jobs)
        .groupBy(jobs.status),
      db
        .select({
          totalApplicants: sql<number>`coalesce(sum(${jobs.appliesCount}), 0)::int`,
        })
        .from(jobs),
    ]);

    const byStatus: Record<string, number> = {
      draft: 0, pending: 0, ai_scanning: 0, ai_flagged: 0,
      live: 0, expired: 0, closed: 0,
    };
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = r.count;
      total += r.count;
    }
    return { total, totalApplicants, byStatus };
  },

  /**
   * Admin thay đổi status Job — bypass ownership, có thể đổi bất kỳ status nào
   * (kể cả live → closed để đóng job ngay).
   */
  changeStatusAdmin: async (jobId: string, status: JobStatus): Promise<void> => {
    await db.update(jobs).set({ status, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  },
} as const;

