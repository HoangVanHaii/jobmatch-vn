/**
 * Application service — CRUD cho 4 endpoints + helpers cho chatbot picker.
 *
 * Section:
 *   - Core CRUD: create / listMine / listByJob / listByCompany
 *   - Chatbot helpers: listByCandidateForChatbot / listAppliedJobIds (move từ jobApplication.service.ts)
 *
 * Quy tắc ownership:
 *   - Candidate-side: chỉ truy cập applications của chính mình.
 *   - Employer-side (`listByJob`): phải là postedBy của job đó (owner hoặc member của company post job).
 *   - Employer-side (`listByCompany`): lấy tất cả companies user là active member → query apps theo companyIds.
 *     Lý do không yêu cầu companyId trong query: 1 user có thể là member của nhiều company,
 *     endpoint trả hết để FE filter client-side (UI dashboard employer thường cần nhìn tổng).
 */
import { db } from '../config/database';
import {
  applications,
  jobs,
  companies,
  cvs,
  users,
  userProfiles,
  companyMembers,
} from '../db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import { notificationService } from './notification.service';
import { notificationGateway } from '../socket/notificationGateway';
import type {
  ApplicationCvSnapshot,
  ApplicationDetail,
  ApplicationMatchReasoning,
  CandidateApplicationRow,
  CreateApplicationInput,
  EmployerApplicationRow,
  ApplicationListQuery,
  ApplicationStatusValue,
} from '../interface/application';

// ============================================================================
// Helpers
// ============================================================================

const OFFSET = (page: number, limit: number): number => (page - 1) * limit;

/** Chuẩn hoá list query: clamp limit, default page/limit. */
const normalizeListQuery = (
  q: ApplicationListQuery,
): { status: ApplicationStatusValue | undefined; jobId: string | undefined; page: number; limit: number } => {
  const limit = q.limit ?? 20;
  const page = q.page ?? 1;
  return { status: q.status, jobId: q.jobId, page, limit };
};

/**
 * Snapshot CV từ cvs row → ApplicationCvSnapshot. Throw nếu CV không thuộc candidate.
 *
 * Tại sao copy data thay vì giữ FK:
 *   - Candidate có thể edit/delete CV sau khi apply → application cũ không nên break.
 *   - Snapshot là single source of truth cho "ứng viên đã nộp cái gì".
 */
const snapshotCv = async (cvId: string, candidateId: string): Promise<ApplicationCvSnapshot> => {
  const [cv] = await db
    .select({
      candidateId: cvs.candidateId,
      title: cvs.title,
      fileUrl: cvs.fileUrl,
      templateId: cvs.templateId,
      parsedData: cvs.parsedData,
    })
    .from(cvs)
    .where(eq(cvs.id, cvId))
    .limit(1);

  if (!cv) {
    throw new AppError(404, 'CV_NOT_FOUND', 'CV không tồn tại hoặc đã bị xoá');
  }
  if (cv.candidateId !== candidateId) {
    throw new AppError(403, 'CV_FORBIDDEN', 'CV này không thuộc về bạn');
  }

  return {
    title: cv.title,
    url: cv.fileUrl,
    candidateId: cv.candidateId,
    template: cv.templateId,
    parsedData: cv.parsedData ?? null,
  };
};

/**
 * Verify job tồn tại + status='live' + chưa hết hạn. Throw nếu không hợp lệ.
 * Trả về { companyId, postedBy } để caller dùng tiếp (vd check ownership cho employer).
 */
const assertJobIsApplyable = async (
  jobId: string,
): Promise<{ companyId: string; postedBy: string }> => {
  const [job] = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      companyId: jobs.companyId,
      postedBy: jobs.postedBy,
      deadline: jobs.deadline,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Job không tồn tại hoặc đã bị xoá');
  }
  if (job.status !== 'live') {
    throw new AppError(
      400,
      'JOB_NOT_APPLYABLE',
      `Job đang ở trạng thái "${job.status}", không nhận hồ sơ mới.`,
    );
  }
  if (job.deadline && job.deadline < new Date()) {
    throw new AppError(400, 'JOB_EXPIRED', 'Job đã hết hạn nộp hồ sơ');
  }
  if (!job.companyId) {
    throw new AppError(500, 'JOB_DATA_INVALID', 'Job thiếu companyId — liên hệ admin');
  }

  return { companyId: job.companyId, postedBy: job.postedBy };
};

// ============================================================================
// Core CRUD
// ============================================================================

/**
 * Candidate tạo application mới.
 *
 * Flow:
 *   1. Verify job applyable (status='live', chưa hết hạn).
 *   2. Snapshot CV (verify ownership) — cvId BẮT BUỘC từ migration 0033.
 *      "1 CV - 1 job" thay cho "1 candidate - 1 job": 1 candidate có thể apply
 *      cùng job bằng nhiều CV, mỗi CV là 1 application riêng với điểm AI riêng.
 *   3. Insert application. DB unique (cvId, jobId) chặn duplicate → catch error.
 *   4. Notify employer (postedBy) — bắn NGAY khi insert, không đợi matching.
 *      Mục đích: employer mở tab ứng tuyển thấy badge realtime "có 1 đơn mới".
 *      Best-effort: lỗi notify KHÔNG rollback application (notification là
 *      side-effect, application đã valid trong DB).
 *   5. Enqueue AI matching worker (cv-match) — chạy async, không block response.
 *      Worker sẽ gọi Gemini với prompt cv_match.ts → update aiMatchScore +
 *      aiMatchReasoning + notify candidate. Nếu hết quota → worker skip +
 *      vẫn bắn notification `application_match_ready` với reason quota_exceeded
 *      để candidate biết "đã apply thành công, nhưng không có AI match".
 *
 * Lưu ý:
 *   - Enqueue là fire-and-forget: nếu queue down → log warn, application vẫn
 *     tạo OK (user có thể retry matching qua endpoint admin/manual sau).
 *   - KHÔNG chờ worker (sync) — response time ổn định, FE poll hoặc nhận socket
 *     event 'application:match-ready' để hiển thị điểm.
 */
export const create = async (
  input: CreateApplicationInput,
  candidateId: string,
): Promise<{ id: string; status: ApplicationStatusValue }> => {
  const { postedBy, companyId } = await assertJobIsApplyable(input.jobId);

  if (!input.cvId) {
    throw new AppError(400, 'CV_ID_REQUIRED', 'Vui lòng chọn CV để ứng tuyển.');
  }
  const cvSnapshot = await snapshotCv(input.cvId, candidateId);

  try {
    const [created] = await db
      .insert(applications)
      .values({
        candidateId,
        jobId: input.jobId,
        cvId: input.cvId,
        cv: cvSnapshot,
        coverLetter: input.coverLetter ?? null,
        status: 'pending',
        stage: 'new',
        // aiMatchScore + aiMatchReasoning: NULL ban đầu, AI worker sẽ fill sau.
        isAnonymous: false,
      })
      .returning({ id: applications.id, status: applications.status });

    if (!created) {
      throw new AppError(500, 'INSERT_FAILED', 'Không tạo được application');
    }

    void notifyEmployerOfNewApplication({
      employerId: postedBy,
      applicationId: created.id,
      jobId: input.jobId,
      candidateId,
      companyId,
    });

    try {
      const { cvMatchQueue } = await import('../config/queue');
      await cvMatchQueue.add('cv-match', {
        applicationId: created.id,
        jobId: input.jobId,
      });
    } catch (err) {
      logger.warn(
        { err, applicationId: created.id },
        'create: enqueue cvMatchQueue thất bại, application OK nhưng sẽ không có AI match score',
      );
    }

    return created;
  } catch (err) {
    // PostgreSQL unique violation (23505) — trùng (cv_id, job_id).
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      throw new AppError(
        409,
        'ALREADY_APPLIED',
        'Bạn đã ứng tuyển job này bằng CV này rồi.',
      );
    }
    throw err;
  }
};

/**
 * Best-effort: tạo notification `application_new` cho employer (postedBy).
 *
 * KHÔNG await từ `create()` để giữ response latency ổn định. Lỗi chỉ log.
 *
 * Tại sao "best-effort":
 *   - Application đã insert OK — đó là source of truth. Notification là
 *     side-effect giúp UX (badge realtime), không critical.
 *   - Nếu notification fail: employer vẫn thấy application khi refresh trang
 *     (qua GET /applications/job/:jobId), chỉ là không có badge realtime.
 *
 * Payload gửi FE:
 *   - applicationId: để navigate tới detail
 *   - jobId, jobTitle, jobSlug: để render link "Xem job"
 *   - candidateId, candidateName: để hiển thị "Nguyễn Văn A vừa ứng tuyển"
 *   - isAnonymous: FE tôn trọng ẩn tên → không hiển thị candidateName
 */
const notifyEmployerOfNewApplication = async (params: {
  employerId: string;
  applicationId: string;
  jobId: string;
  candidateId: string;
  companyId: string;
}): Promise<void> => {
  const { employerId, applicationId, jobId, candidateId } = params;

  try {
    // Lookup tên candidate + job title (1 query, 2 join).
    const [row] = await db
      .select({
        candidateName: userProfiles.fullName,
        jobTitle: jobs.title,
        jobSlug: jobs.slug,
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(users, eq(applications.candidateId, users.id))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(eq(applications.id, applicationId))
      .limit(1);

    if (!row) return;

    const candidateName = row.candidateName ?? 'Một ứng viên';
    const jobTitle = row.jobTitle ?? 'một job';

    await notificationService.create({
      userId: employerId,
      type: 'application_new',
      title: `${candidateName} vừa ứng tuyển ${jobTitle}`,
      payload: {
        applicationId,
        jobId,
        jobTitle: row.jobTitle,
        jobSlug: row.jobSlug,
        candidateId,
        candidateName: row.candidateName,
        appliedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    // KHÔNG throw — application vẫn valid. Chỉ log để debug.
    logger.warn(
      { err, applicationId, employerId },
      'notifyEmployerOfNewApplication: lỗi (best-effort, application OK)',
    );
  }
};

/**
 * List application của 1 candidate — dùng cho `GET /applications/me`.
 * JOIN job + company để FE render card trực tiếp.
 */
export const listMine = async (
  candidateId: string,
  query: ApplicationListQuery,
): Promise<{ rows: CandidateApplicationRow[]; total: number; page: number; limit: number }> => {
  const { status, page, limit } = normalizeListQuery(query);
  const where = status
    ? and(eq(applications.candidateId, candidateId), eq(applications.status, status))
    : eq(applications.candidateId, candidateId);

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: applications.id,
        jobId: applications.jobId,
        jobTitle: jobs.title,
        jobSlug: jobs.slug,
        // User id của recruiter đăng job — FE dùng cho nút "Chat" ngoài list
        // (create conversation với employer này).
        jobPostedBy: jobs.postedBy,
        companyId: companies.id,
        companyName: companies.name,
        companyLogoUrl: companies.logoUrl,
        status: applications.status,
        stage: applications.stage,
        aiMatchScore: applications.aiMatchScore,
        // Chỉ lấy field `reason` từ jsonb để render badge terminal khi match fail.
        aiMatchReason: sql<'success' | 'quota_exceeded' | 'failed' | null>`${applications.aiMatchReasoning}->>'reason'`,
        coverLetter: applications.coverLetter,
        // CV title + URL đọc từ `applications.cv` jsonb snapshot — candidate
        // có thể đã xoá CV gốc nhưng snapshot vẫn còn để hiển thị.
        cvTitle: sql<string | null>`${applications.cv}->>'title'`,
        cvUrl: sql<string | null>`${applications.cv}->>'url'`,
        cvId: applications.cvId,
        appliedAt: applications.appliedAt,
        viewedAt: applications.viewedAt,
      })
      .from(applications)
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(companies, eq(jobs.companyId, companies.id))
      .where(where)
      .orderBy(desc(applications.appliedAt))
      .limit(limit)
      .offset(OFFSET(page, limit)),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(applications)
      .where(where),
  ]);

  return {
    rows: rows as CandidateApplicationRow[],
    total: totalRow[0]?.count ?? 0,
    page,
    limit,
  };
};

/**
 * Lấy full detail 1 application — dùng cho `GET /applications/:id`.
 *
 * Trả về `ApplicationDetail` (xem `interface/application.ts`) với:
 *   - coverLetter full text.
 *   - cv jsonb snapshot (candidate edit/delete CV gốc cũng OK).
 *   - aiMatchReasoning jsonb.
 *   - Job context (location/employmentType/deadline) để FE render drawer
 *     chi tiết mà không cần query thêm job detail endpoint.
 *
 * Auth scoping:
 *   - `userRole='candidate'` → chỉ trả khi `applications.candidateId === userId`.
 *     Sai → 404 (không 403, để không leak existence application của candidate khác).
 *   - `userRole='employer'` → chỉ trả khi employer là `jobs.postedBy`. Sai → 404.
 *   - `userRole='admin'` → trả bất kỳ.
 *
 * Lưu ý:
 *   - 404 thay vì 403 là deliberate: candidate có thể thử id ngẫu nhiên, nếu
 *     trả 403 chứng tỏ id tồn tại → leak. Với 404 cả 2 case (không tồn tại /
 *     không có quyền) trả cùng status → không leak.
 */
export const getById = async (
  applicationId: string,
  userId: string,
  userRole: 'candidate' | 'employer' | 'admin',
): Promise<ApplicationDetail> => {
  const [row] = await db
    .select({
      id: applications.id,
      candidateId: applications.candidateId,
      jobId: applications.jobId,
      jobTitle: jobs.title,
      jobSlug: jobs.slug,
      jobLocation: jobs.location,
      jobDeadline: jobs.deadline,
      jobPostedBy: jobs.postedBy,
      companyId: companies.id,
      companyName: companies.name,
      companyLogoUrl: companies.logoUrl,
      status: applications.status,
      stage: applications.stage,
      aiMatchScore: applications.aiMatchScore,
      aiMatchReasoning: applications.aiMatchReasoning,
      coverLetter: applications.coverLetter,
      cv: applications.cv,
      appliedAt: applications.appliedAt,
      viewedAt: applications.viewedAt,
      updatedAt: applications.updatedAt,
    })
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!row) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application không tồn tại');
  }

  if (userRole === 'candidate' && row.candidateId !== userId) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application không tồn tại');
  }
  if (userRole === 'employer' && row.jobPostedBy !== userId) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application không tồn tại');
  }

  // Strip helper field `candidateId` (chỉ dùng cho auth scoping, không
  // nằm trong ApplicationDetail public shape). `jobPostedBy` GIỮ LẠI vì FE
  // dùng để bấm "Liên hệ" → tạo conversation với employer đăng job.
  const { candidateId: _candidateId, ...rest } = row;
  void _candidateId;
  return rest as unknown as ApplicationDetail;
};

/**
 * List application cho 1 job — dùng cho `GET /applications/job/:jobId`.
 *
 * Auth scoping:
 *   - Admin pass luôn.
 *   - Employer phải là postedBy của job (owner company post job).
 *   - Nếu không phải owner / admin → 403.
 */
export const listByJob = async (
  jobId: string,
  employerId: string,
  employerRole: 'employer' | 'admin',
  query: ApplicationListQuery,
): Promise<{ rows: EmployerApplicationRow[]; total: number; page: number; limit: number }> => {
  const { companyId, postedBy } = await assertJobIsApplyable(jobId);

  if (employerRole !== 'admin' && postedBy !== employerId) {
    throw new AppError(
      403,
      'JOB_FORBIDDEN',
      'Bạn không sở hữu job này (chỉ người đăng job hoặc admin mới xem được).',
    );
  }

  const { status, page, limit } = normalizeListQuery(query);
  const where = status
    ? and(eq(applications.jobId, jobId), eq(applications.status, status))
    : eq(applications.jobId, jobId);

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: applications.id,
        jobId: applications.jobId,
        jobTitle: jobs.title,
        candidateId: applications.candidateId,
        candidateName: userProfiles.fullName,
        candidateEmail: users.email,
        status: applications.status,
        stage: applications.stage,
        aiMatchScore: applications.aiMatchScore,
        // Chỉ lấy field `reason` từ jsonb để render badge terminal khi match fail.
        aiMatchReason: sql<'success' | 'quota_exceeded' | 'failed' | null>`${applications.aiMatchReasoning}->>'reason'`,
        isAnonymous: applications.isAnonymous,
        appliedAt: applications.appliedAt,
        viewedAt: applications.viewedAt,
      })
      .from(applications)
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(users, eq(applications.candidateId, users.id))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(where)
      .orderBy(desc(applications.appliedAt))
      .limit(limit)
      .offset(OFFSET(page, limit)),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(applications)
      .where(where),
  ]);

  // Ẩn PII nếu isAnonymous=true (trả null cho name/email).
  const masked = (rows as Array<Omit<EmployerApplicationRow, 'candidateName' | 'candidateEmail'> & { candidateName: string | null; candidateEmail: string | null }>).map((r) => ({
    ...r,
    candidateName: r.isAnonymous ? null : r.candidateName,
    candidateEmail: r.isAnonymous ? null : r.candidateEmail,
  })) as EmployerApplicationRow[];

  return {
    rows: masked,
    total: totalRow[0]?.count ?? 0,
    page,
    limit,
  };
};

/**
 * List application của TẤT CẢ company user là active member — dùng cho `GET /applications/company`.
 *
 * Auth scoping:
 *   - Admin pass luôn (xem tất cả).
 *   - Employer: lấy danh sách companyIds user là active member → query apps theo IN (...).
 *
 * Nếu user không thuộc công ty nào → trả về [].
 *
 * Lưu ý: `query.jobId` optional — filter thêm theo job cụ thể (vd dashboard chỉ
 * muốn xem application của 1 job trong company).
 */
export const listByCompany = async (
  employerId: string,
  employerRole: 'employer' | 'admin',
  query: ApplicationListQuery,
): Promise<{ rows: EmployerApplicationRow[]; total: number; page: number; limit: number }> => {
  const { status, jobId, page, limit } = normalizeListQuery(query);

  let companyIds: string[] = [];

  if (employerRole === 'admin') {
    // Admin xem tất cả — skip filter companyIds.
    companyIds = [];
  } else {
    const memberships = await db
      .select({ companyId: companyMembers.companyId })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.userId, employerId),
          eq(companyMembers.status, 'active'),
        ),
      );
    companyIds = memberships.map((m) => m.companyId);

    if (companyIds.length === 0) {
      return { rows: [], total: 0, page, limit };
    }
  }

  // Build where clause:
  //   - Nếu admin: chỉ filter status + optional jobId.
  //   - Nếu employer: lọc job.companyId IN companyIds, plus status + optional jobId.
  const conditions = [];
  if (status) conditions.push(eq(applications.status, status));
  if (jobId) conditions.push(eq(applications.jobId, jobId));
  if (companyIds.length > 0) {
    conditions.push(inArray(jobs.companyId, companyIds));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: applications.id,
        jobId: applications.jobId,
        jobTitle: jobs.title,
        candidateId: applications.candidateId,
        candidateName: userProfiles.fullName,
        candidateEmail: users.email,
        status: applications.status,
        stage: applications.stage,
        aiMatchScore: applications.aiMatchScore,
        // Chỉ lấy field `reason` từ jsonb để render badge terminal khi match fail.
        aiMatchReason: sql<'success' | 'quota_exceeded' | 'failed' | null>`${applications.aiMatchReasoning}->>'reason'`,
        isAnonymous: applications.isAnonymous,
        appliedAt: applications.appliedAt,
        viewedAt: applications.viewedAt,
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(users, eq(applications.candidateId, users.id))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(where)
      .orderBy(desc(applications.appliedAt))
      .limit(limit)
      .offset(OFFSET(page, limit)),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .where(where),
  ]);

  const masked = (rows as Array<Omit<EmployerApplicationRow, 'candidateName' | 'candidateEmail'> & { candidateName: string | null; candidateEmail: string | null }>).map((r) => ({
    ...r,
    candidateName: r.isAnonymous ? null : r.candidateName,
    candidateEmail: r.isAnonymous ? null : r.candidateEmail,
  })) as EmployerApplicationRow[];

  return {
    rows: masked,
    total: totalRow[0]?.count ?? 0,
    page,
    limit,
  };
};

/**
 * Update application status — dùng cho `PATCH /applications/:id/status`.
 * Verify employer owns the job trước khi update (cùng auth scoping như listByJob).
 *
 * Realtime: sau khi update xong, bắn `application:status-changed` tới candidate
 * (chủ sở hữu application) để list + detail panel update mà không cần refetch.
 * Best-effort — lỗi emit KHÔNG rollback DB (đã commit).
 */
export const updateStatus = async (
  applicationId: string,
  employerId: string,
  employerRole: 'employer' | 'admin',
  status: ApplicationStatusValue,
  stage?: string,
): Promise<{ id: string; status: ApplicationStatusValue; stage: string | null }> => {
  // Load application + job để check ownership.
  const [app] = await db
    .select({
      id: applications.id,
      jobId: applications.jobId,
      candidateId: applications.candidateId,
    })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!app) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application không tồn tại');
  }

  // Reuse ownership check.
  await listByJob(app.jobId, employerId, employerRole, { page: 1, limit: 1 });

  const viewedAt = status === 'viewed' ? new Date() : undefined;

  const [updated] = await db
    .update(applications)
    .set({
      status,
      stage: stage ?? null,
      updatedAt: new Date(),
      // Auto-set viewedAt khi employer lần đầu xem (status chuyển từ pending → viewed).
      ...(viewedAt ? { viewedAt } : {}),
    })
    .where(eq(applications.id, applicationId))
    .returning({
      id: applications.id,
      status: applications.status,
      stage: applications.stage,
      viewedAt: applications.viewedAt,
      updatedAt: applications.updatedAt,
    });

  if (!updated) {
    throw new AppError(500, 'UPDATE_FAILED', 'Không update được application');
  }

  // Realtime push tới candidate — cùng pattern với application:match-ready
  // (xem cvMatch.worker.ts). Best-effort: socket chưa sẵn sàng cũng OK.
  try {
    notificationGateway.emitToUser(app.candidateId, 'application:status-changed', {
      applicationId: updated.id,
      jobId: app.jobId,
      status: updated.status,
      stage: updated.stage,
      viewedAt: updated.viewedAt ? new Date(updated.viewedAt).toISOString() : null,
      updatedAt: new Date(updated.updatedAt).toISOString(),
    });
  } catch (err) {
    logger.warn(
      { applicationId: updated.id, err },
      '[application] emit status-changed failed (non-fatal)',
    );
  }

  return {
    id: updated.id,
    status: updated.status as ApplicationStatusValue,
    stage: updated.stage,
  };
};

/**
 * Employer yêu cầu chấm lại AI match — dùng cho `POST /applications/:id/recompute-match`.
 *
 * Use case:
 *   - Candidate apply khi candidate hết quota `ai_cv_match` → application được tạo
 *     nhưng `aiMatchScore` = NULL (worker skip).
 *   - Sau đó candidate mua thêm quota, hoặc employer muốn xem điểm match để
 *     quyết định screening → bấm nút "So khớp AI" → gọi endpoint này.
 *
 * Flow:
 *   1. Verify application tồn tại + employer owns job (postedBy hoặc admin).
 *   2. Verify application có CV snapshot (nếu không → 400, không match được).
 *   3. Reset `aiMatchScore = NULL` + clear `aiMatchReasoning` để FE hiển thị
 *      "đang chấm lại..." (loading state).
 *   4. Enqueue `cv-match` job — worker sẽ charge quota `ai_cv_match` của
 *      candidate (chủ sở hữu CV) cho lần gọi LLM này.
 *      Nếu candidate vẫn hết quota → worker skip + notify candidate với
 *      reason quota_exceeded (giống flow ban đầu).
 *   5. Trả `{ id, aiMatchScore: null, aiMatchReasoning: null, recomputeEnqueued: true }`
 *      để FE update UI ngay.
 *
 * Lưu ý:
 *   - Endpoint này do EMPLOYER trigger, nhưng quota bị charge cho CANDIDATE.
 *     Hợp lý vì quota `ai_cv_match` đo "số lần AI đánh giá CV của candidate này".
 *   - Endpoint KHÔNG giới hạn cooldown — FE muốn chặn spam thì debounce ở client.
 *   - Khi queue down: application giữ nguyên score cũ (KHÔNG reset), trả 503
 *     để FE biết phải retry. Nếu đã reset thì data sẽ "trống" vĩnh viễn nếu
 *     queue down → bad UX.
 */
export const recomputeMatch = async (
  applicationId: string,
  employerId: string,
  employerRole: 'employer' | 'admin',
): Promise<{
  id: string;
  jobId: string;
  aiMatchScore: string | null;
  aiMatchReasoning: ApplicationMatchReasoning | null;
  recomputeEnqueued: boolean;
}> => {
  // --------------------------------------------------------------------------
  // 1. Load application + verify ownership (employer là postedBy của job)
  // --------------------------------------------------------------------------
  const [app] = await db
    .select({
      id: applications.id,
      jobId: applications.jobId,
      cv: applications.cv,
    })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!app) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application không tồn tại');
  }

  // Ownership check: reuse listByJob (nó đã assertJobIsApplyable + check postedBy).
  // Lấy thêm postedBy từ job để không cần query riêng.
  const [job] = await db
    .select({ postedBy: jobs.postedBy })
    .from(jobs)
    .where(eq(jobs.id, app.jobId))
    .limit(1);

  if (!job) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Job của application này không còn tồn tại');
  }

  if (employerRole !== 'admin' && job.postedBy !== employerId) {
    throw new AppError(
      403,
      'JOB_FORBIDDEN',
      'Bạn không sở hữu job này (chỉ người đăng job hoặc admin mới recompute được).',
    );
  }

  // --------------------------------------------------------------------------
  // 2. Verify có CV snapshot (worker cần parsedData để chấm)
  // --------------------------------------------------------------------------
  if (!app.cv?.parsedData) {
    throw new AppError(
      400,
      'NO_CV_SNAPSHOT',
      'Application này không có CV snapshot (candidate apply không kèm CV) — không thể AI match.',
    );
  }

  // --------------------------------------------------------------------------
  // 3. Enqueue TRƯỚC, chỉ reset DB nếu enqueue OK.
  // --------------------------------------------------------------------------
  // Tại sao enqueue trước reset: nếu queue down → application giữ score cũ
  // (nếu có) thay vì bị NULL vĩnh viễn. Còn nếu enqueue OK → reset an toàn
  // vì worker sẽ fill lại score mới trong vài giây.
  let enqueued = false;
  try {
    const { cvMatchQueue } = await import('../config/queue');
    await cvMatchQueue.add('cv-match', {
      applicationId: app.id,
      jobId: app.jobId,
    });
    enqueued = true;
  } catch (err) {
    logger.error(
      { err, applicationId, employerId },
      'recomputeMatch: enqueue cvMatchQueue thất bại (queue down?)',
    );
    throw new AppError(
      503,
      'QUEUE_UNAVAILABLE',
      'Queue tạm thời không khả dụng. Vui lòng thử lại sau ít phút.',
    );
  }

  // --------------------------------------------------------------------------
  // 4. Reset aiMatchScore + aiMatchReasoning → FE thấy loading
  // --------------------------------------------------------------------------
  // KHÔNG throw nếu reset fail (queue đã enqueue OK). Log warn, FE sẽ poll
  // application detail và thấy score mới khi worker xong.
  let aiMatchScore: string | null = null;
  try {
    const [updated] = await db
      .update(applications)
      .set({
        aiMatchScore: null,
        aiMatchReasoning: null,
        updatedAt: new Date(),
      })
      .where(eq(applications.id, applicationId))
      .returning({
        aiMatchScore: applications.aiMatchScore,
        aiMatchReasoning: applications.aiMatchReasoning,
      });

    aiMatchScore = updated?.aiMatchScore ?? null;
  } catch (err) {
    logger.warn(
      { err, applicationId },
      'recomputeMatch: reset aiMatchScore thất bại (queue đã enqueue, score cũ giữ nguyên cho tới worker update)',
    );
  }

  logger.info(
    { applicationId, employerId, jobId: app.jobId },
    'recomputeMatch: enqueue cv-match thành công, score đang được tính lại',
  );

  return {
    id: app.id,
    jobId: app.jobId,
    aiMatchScore,
    aiMatchReasoning: null,
    recomputeEnqueued: enqueued,
  };
};

/**
 * Candidate rút đơn ứng tuyển — dùng cho `PATCH /applications/:id/withdraw`.
 *
 * Quy tắc rút:
 *   - Chỉ candidate sở hữu application mới được rút (auth scoping).
 *   - CHỈ cho phép rút khi status hiện tại là `pending` hoặc `viewed`.
 *     Lý do: sau khi vào screening/interview/offered thì candidate đã "engage"
 *     với employer nặng hơn — việc rút không hợp lý về mặt UX. Nếu muốn
 *     dừng thì candidate nên reply trực tiếp + để employer đổi status sang
 *     `rejected`.
 *   - KHÔNG cho rút khi:
 *       - `hired` (đã nhận job)
 *       - `rejected` (đã bị từ chối — không cần rút)
 *       - `withdrawn` (đã rút rồi — idempotent return success)
 *
 * Flow:
 *   1. Verify application tồn tại + thuộc candidate.
 *   2. Verify status transition hợp lệ (pending|viewed → withdrawn).
 *   3. UPDATE status='withdrawn', stage=null.
 *   4. Notify employer (best-effort, void) — type=application_withdrawn để
 *      employer bell + tab ứng tuyển realtime.
 *
 * Idempotent:
 *   - Nếu application đã ở status='withdrawn' → trả success (không throw 409).
 *     Hợp lý vì user có thể double-click nút "Rút đơn".
 *
 * Lưu ý:
 *   - KHÔNG xoá row, chỉ flip status. Lý do: giữ audit trail (employer có thể
 *     xem lại "candidate X đã apply rồi rút" qua filter status='withdrawn').
 *   - KHÔNG gọi notification 'application_new' hay 'application_match_ready'
 *     (đã qua rồi). Chỉ bắn 1 notification mới: application_withdrawn.
 */
export const withdraw = async (
  applicationId: string,
  candidateId: string,
): Promise<{ id: string; status: ApplicationStatusValue }> => {
  // --------------------------------------------------------------------------
  // 1. Load application + verify ownership
  // --------------------------------------------------------------------------
  const [app] = await db
    .select({
      id: applications.id,
      candidateId: applications.candidateId,
      jobId: applications.jobId,
      status: applications.status,
    })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!app) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application không tồn tại');
  }
  if (app.candidateId !== candidateId) {
    throw new AppError(403, 'APPLICATION_FORBIDDEN', 'Bạn không sở hữu application này');
  }

  // --------------------------------------------------------------------------
  // 2. Status transition check
  // --------------------------------------------------------------------------
  // Idempotent: nếu đã withdrawn → return success (không throw).
  if (app.status === 'withdrawn') {
    return { id: app.id, status: 'withdrawn' };
  }

  const WITHDRAWABLE: ApplicationStatusValue[] = ['pending', 'viewed'];
  if (!WITHDRAWABLE.includes(app.status)) {
    throw new AppError(
      409,
      'CANNOT_WITHDRAW',
      `Không thể rút đơn khi đang ở trạng thái "${app.status}". ` +
        `Chỉ có thể rút khi đơn đang ở trạng thái "pending" hoặc "viewed".`,
    );
  }

  // --------------------------------------------------------------------------
  // 3. UPDATE status=withdrawn
  // --------------------------------------------------------------------------
  const [updated] = await db
    .update(applications)
    .set({
      status: 'withdrawn',
      stage: null,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, applicationId))
    .returning({
      id: applications.id,
      status: applications.status,
    });

  if (!updated) {
    throw new AppError(500, 'UPDATE_FAILED', 'Không rút được application');
  }

  // --------------------------------------------------------------------------
  // 4. Notify employer (best-effort)
  // --------------------------------------------------------------------------
  // Lookup job.postedBy + jobTitle + tên candidate để render title đẹp.
  void notifyEmployerOfWithdrawal({
    applicationId: app.id,
    jobId: app.jobId,
    candidateId,
  });

  logger.info(
    { applicationId, candidateId, jobId: app.jobId, prevStatus: app.status },
    'withdraw: candidate đã rút đơn',
  );

  return { id: updated.id, status: updated.status as ApplicationStatusValue };
};

/**
 * Best-effort: tạo notification `application_withdrawn` cho employer (postedBy).
 *
 * Pattern giống `notifyEmployerOfNewApplication` (cùng file):
 *   - Lookup 1 query gộp (applications + jobs + userProfiles).
 *   - Best-effort: lỗi KHÔNG rollback status update (đã commit DB).
 *   - FE bell + tab ứng tuyển auto refresh khi nhận notification:new.
 */
const notifyEmployerOfWithdrawal = async (params: {
  applicationId: string;
  jobId: string;
  candidateId: string;
}): Promise<void> => {
  const { applicationId, jobId, candidateId } = params;

  try {
    const [row] = await db
      .select({
        employerId: jobs.postedBy,
        candidateName: userProfiles.fullName,
        jobTitle: jobs.title,
        jobSlug: jobs.slug,
      })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(users, eq(applications.candidateId, users.id))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(eq(applications.id, applicationId))
      .limit(1);

    if (!row) return;

    const candidateName = row.candidateName ?? 'Một ứng viên';
    const jobTitle = row.jobTitle ?? 'một job';

    await notificationService.create({
      userId: row.employerId,
      type: 'application_withdrawn',
      title: `${candidateName} đã rút đơn ứng tuyển ${jobTitle}`,
      payload: {
        applicationId,
        jobId,
        jobTitle: row.jobTitle,
        jobSlug: row.jobSlug,
        candidateId,
        candidateName: row.candidateName,
        withdrawnAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.warn(
      { err, applicationId },
      'notifyEmployerOfWithdrawal: lỗi (best-effort, withdraw OK)',
    );
  }
};

// ============================================================================
// Chatbot helpers — move từ jobApplication.service.ts (cũ).
//
// Dùng cho chatbot handler `application.ts`:
//   - listByCandidateForChatbot: top N applications gần nhất, JOIN job/company
//   - listAppliedJobIds: list jobId user đã apply (cho picker source='applied')
// ============================================================================

/**
 * Slim row cho chatbot — chỉ field cần thiết để LLM cite data.
 * Tương thích với handler cũ (rename `id` → `applicationId` cho rõ context chatbot).
 */
export interface ChatbotApplicationRow {
  applicationId: string;
  jobId: string;
  jobTitle: string | null;
  companyName: string | null;
  status: ApplicationStatusValue;
  stage: string | null;
  aiMatchScore: string | null;
  appliedAt: Date;
  viewedAt: Date | null;
}

export const listByCandidateForChatbot = async (
  candidateId: string,
  limit = 10,
): Promise<ChatbotApplicationRow[]> => {
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
  return rows as ChatbotApplicationRow[];
};

/** List jobIds user đã apply — dùng cho chatbot picker. */
export const listAppliedJobIds = async (candidateId: string): Promise<string[]> => {
  const rows = await db
    .select({ jobId: applications.jobId })
    .from(applications)
    .where(eq(applications.candidateId, candidateId));
  return rows.map((r) => r.jobId);
};

/**
 * Lấy status + AI match score của application do `candidateId` tạo cho `jobId`.
 * Trả `null` status nếu chưa apply job này (FE render Apply button thường).
 *
 * List applications của 1 candidate cho 1 job (kèm AI match + CV title).
 * Từ migration 0033: 1 candidate có thể apply cùng job bằng NHIỀU CV → endpoint
 * `GET /jobs/by-slug/:slug/application-status` trả MẢNG thay vì 1 row đơn.
 *
 * Lưu ý:
 *   - `aiMatchScore` lưu dạng numeric(5,2) → cast qua `::text` rồi `Number(...)`
 *     để ra số 0-100 với 1 chữ số thập phân.
 *   - `aiMatchReason` extract từ jsonb `ai_match_reasoning->>'reason'`.
 *   - LEFT JOIN cvs để lấy title cho UI "Danh sách CV đã ứng tuyển".
 *   - Trả [] nếu chưa apply (FE render empty state).
 */
export const getStatusForCandidate = async (
  candidateId: string,
  jobId: string,
): Promise<Array<{
  status: string;
  applicationId: string;
  appliedAt: string;
  cvId: string;
  cvTitle: string | null;
  aiMatchScore: number | null;
  aiMatchReason: 'success' | 'quota_exceeded' | 'failed' | null;
}>> => {
  const rows = await db
    .select({
      status: applications.status,
      applicationId: applications.id,
      appliedAt: applications.appliedAt,
      cvId: applications.cvId,
      cvTitle: cvs.title,
      aiMatchScore: sql<string | null>`${applications.aiMatchScore}::text`,
      aiMatchReason: sql<
        'success' | 'quota_exceeded' | 'failed' | null
      >`${applications.aiMatchReasoning}->>'reason'`,
    })
    .from(applications)
    .leftJoin(cvs, eq(cvs.id, applications.cvId))
    .where(
      and(
        eq(applications.candidateId, candidateId),
        eq(applications.jobId, jobId),
      ),
    )
    .orderBy(desc(applications.appliedAt));

  return rows.map((r) => ({
    status: r.status,
    applicationId: r.applicationId,
    appliedAt: r.appliedAt.toISOString(),
    cvId: r.cvId,
    cvTitle: r.cvTitle,
    aiMatchScore:
      r.aiMatchScore != null ? Number(Number(r.aiMatchScore).toFixed(1)) : null,
    aiMatchReason: r.aiMatchReason,
  }));
};

// ============================================================================
// Export gộp (giữ tương thích ngược nếu chỗ nào đang dùng `applicationService.X`).
// ============================================================================

export const applicationService = {
  create,
  listMine,
  listByJob,
  listByCompany,
  getById,
  updateStatus,
  recomputeMatch,
  withdraw,
  getStatusForCandidate,
  // Chatbot helpers
  listByCandidateForChatbot,
  listAppliedJobIds,
};
