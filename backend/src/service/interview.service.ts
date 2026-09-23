/**
 * Service `interview`
 *
 * Section:
 *   - Candidate-side: listByCandidate (dùng cho chatbot)
 *   - Employer-side (HR): create / list / getById / update / cancel / submitFeedback
 *
 * Quy tắc ownership:
 *   - HR chỉ tạo/quản lý interview cho applications thuộc jobs của company mình.
 *   - Kiểm tra qua: application -> job -> job.postedBy === HR hoặc job.companyId
 *     thuộc các company HR là active member.
 *   - Người submit feedback phải là interviewerId của record đó (hoặc admin).
 */
import { db } from '../config/database';
import { interviews, applications, jobs, companies, users, userProfiles, companyMembers } from '../db/schema';
import { eq, and, gte, asc, desc, sql, inArray } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import { notificationService } from './notification.service';
import { notificationGateway } from '../socket/notificationGateway';
import type { CreateInterviewBody, UpdateInterviewBody } from '../middleware/interview';
import type { CandidateInterviewRow, EmployerInterviewRow, InterviewDetail } from '../interface/interview';

// ============================================================================
// Private helpers (không expose qua interviewService object)
// ============================================================================

const OFFSET = (page: number, limit: number): number => (page - 1) * limit;

/**
 * Verify application tồn tại + thuộc company của HR (qua postedBy hoặc membership).
 * Admin bypass: role='admin' -> skip membership check.
 */
const assertApplicationBelongsToHR = async (
  applicationId: string,
  hrId: string,
  hrRole: 'employer' | 'admin',
): Promise<{ candidateId: string; jobId: string; companyId: string | null }> => {
  const [app] = await db
    .select({
      id: applications.id,
      candidateId: applications.candidateId,
      jobId: applications.jobId,
      jobPostedBy: jobs.postedBy,
      companyId: jobs.companyId,
    })
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!app) throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found');

  if (hrRole !== 'admin' && app.jobPostedBy !== hrId) {
    if (app.companyId) {
      const [membership] = await db
        .select({ id: companyMembers.id })
        .from(companyMembers)
        .where(and(eq(companyMembers.userId, hrId), eq(companyMembers.companyId, app.companyId), eq(companyMembers.status, 'active')))
        .limit(1);
      if (!membership) throw new AppError(403, 'INTERVIEW_FORBIDDEN', 'You do not have permission to manage interviews for this application');
    } else {
      throw new AppError(403, 'INTERVIEW_FORBIDDEN', 'You do not have permission to manage interviews for this application');
    }
  }

  return { candidateId: app.candidateId, jobId: app.jobId, companyId: app.companyId };
};

/**
 * Verify interview ton tai + HR co quyen quan ly (qua job ownership).
 * Dung 404 thay 403 de khong leak existence.
 */
const assertInterviewBelongsToHR = async (
  interviewId: string,
  hrId: string,
  hrRole: 'employer' | 'admin',
): Promise<{ id: string; applicationId: string; interviewerId: string; status: string | null; candidateId: string; jobId: string | null; companyId: string | null }> => {
  const [row] = await db
    .select({
      id: interviews.id,
      applicationId: interviews.applicationId,
      interviewerId: interviews.interviewerId,
      status: interviews.status,
      candidateId: applications.candidateId,
      jobId: applications.jobId,
      jobPostedBy: jobs.postedBy,
      companyId: jobs.companyId,
    })
    .from(interviews)
    .innerJoin(applications, eq(interviews.applicationId, applications.id))
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .where(eq(interviews.id, interviewId))
    .limit(1);

  if (!row) throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');

  if (hrRole !== 'admin' && row.jobPostedBy !== hrId) {
    if (row.companyId) {
      const [membership] = await db
        .select({ id: companyMembers.id })
        .from(companyMembers)
        .where(and(eq(companyMembers.userId, hrId), eq(companyMembers.companyId, row.companyId), eq(companyMembers.status, 'active')))
        .limit(1);
      if (!membership) throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');
    } else {
      throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');
    }
  }

  return row;
};

/** Best-effort: notify candidate khi co lich phong van moi. */
const notifyScheduled = async (candidateId: string, interviewId: string, applicationId: string, scheduledAt: Date): Promise<void> => {
  await notificationService.create({ userId: candidateId, type: 'interview_scheduled', title: 'New interview scheduled', payload: { interviewId, applicationId, scheduledAt: scheduledAt.toISOString() } });
  notificationGateway.emitToUser(candidateId, 'interview:scheduled', { interviewId, applicationId, scheduledAt: scheduledAt.toISOString() });
};

/** Best-effort: notify candidate khi lich phong van duoc cap nhat. */
const notifyUpdated = async (candidateId: string, interviewId: string): Promise<void> => {
  await notificationService.create({ userId: candidateId, type: 'interview_updated', title: 'Your interview schedule has been updated', payload: { interviewId } });
  notificationGateway.emitToUser(candidateId, 'interview:updated', { interviewId });
};

/** Best-effort: notify candidate khi lich phong van bi huy. */
const notifyCancelled = async (candidateId: string, interviewId: string, cancelReason: string | undefined): Promise<void> => {
  await notificationService.create({ userId: candidateId, type: 'interview_cancelled', title: 'Your interview schedule has been cancelled', payload: { interviewId, cancelReason } });
  notificationGateway.emitToUser(candidateId, 'interview:cancelled', { interviewId, cancelReason });
};

// ============================================================================
// Export — inline style (giong cv.service.ts)
// ============================================================================

export const interviewService = {
  // --------------------------------------------------------------------------
  // Employer-side (HR)
  // --------------------------------------------------------------------------

  /**
   * HR tao lich phong van moi — POST /interviews.
   * 1. Verify application thuoc company cua HR.
   * 2. Insert interview voi status='pending'.
   * 3. Notify candidate (best-effort).
   */
  create: async (body: CreateInterviewBody, hrId: string, hrRole: 'employer' | 'admin'): Promise<{ id: string; status: string }> => {
    const { candidateId } = await assertApplicationBelongsToHR(body.applicationId, hrId, hrRole);

    const [created] = await db
      .insert(interviews)
      .values({
        applicationId: body.applicationId,
        interviewerId: body.interviewerId,
        scheduledAt: new Date(body.scheduledAt),
        durationMin: body.durationMin,
        location: body.location ?? null,
        meetingLink: body.meetingLink ?? null,
        status: 'pending',
      })
      .returning({ id: interviews.id, status: interviews.status });

    if (!created) throw new AppError(500, 'INSERT_FAILED', 'Failed to create interview');

    void notifyScheduled(candidateId, created.id, body.applicationId, new Date(body.scheduledAt))
      .catch((err) => logger.warn({ err, interviewId: created.id }, 'create: notify candidate failed (non-fatal)'));

    return { id: created.id, status: created.status ?? 'pending' };
  },

  /**
   * HR list lich phong van cua company — GET /interviews.
   * Admin: xem tat ca. Employer: loc theo companyIds la active member.
   */
  list: async (
    hrId: string,
    hrRole: 'employer' | 'admin',
    query: { status?: string; applicationId?: string; interviewerId?: string; page: number; limit: number },
  ): Promise<{ rows: EmployerInterviewRow[]; total: number; page: number; limit: number }> => {
    const { page, limit } = query;

    let companyIds: string[] = [];
    if (hrRole !== 'admin') {
      const memberships = await db
        .select({ companyId: companyMembers.companyId })
        .from(companyMembers)
        .where(and(eq(companyMembers.userId, hrId), eq(companyMembers.status, 'active')));
      companyIds = memberships.map((m) => m.companyId);
      if (companyIds.length === 0) return { rows: [], total: 0, page, limit };
    }

    const conditions = [];
    if (query.status) conditions.push(eq(interviews.status, query.status));
    if (query.applicationId) conditions.push(eq(interviews.applicationId, query.applicationId));
    if (query.interviewerId) conditions.push(eq(interviews.interviewerId, query.interviewerId));
    if (companyIds.length > 0) conditions.push(inArray(jobs.companyId, companyIds));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRow] = await Promise.all([
      db.select({
        id: interviews.id,
        applicationId: interviews.applicationId,
        jobId: applications.jobId,
        jobTitle: jobs.title,
        candidateId: applications.candidateId,
        candidateName: userProfiles.fullName,
        candidateEmail: users.email,
        interviewerId: interviews.interviewerId,
        scheduledAt: interviews.scheduledAt,
        durationMin: interviews.durationMin,
        location: interviews.location,
        meetingLink: interviews.meetingLink,
        status: interviews.status,
        confirmedAt: interviews.confirmedAt,
        createdAt: interviews.createdAt,
      })
      .from(interviews)
      .innerJoin(applications, eq(interviews.applicationId, applications.id))
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(users, eq(applications.candidateId, users.id))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(whereClause)
      .orderBy(asc(interviews.scheduledAt))
      .limit(limit)
      .offset(OFFSET(page, limit)),
      db.select({ count: sql<number>`COUNT(*)::int` })
      .from(interviews)
      .innerJoin(applications, eq(interviews.applicationId, applications.id))
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .where(whereClause),
    ]);

    return { rows: rows as EmployerInterviewRow[], total: totalRow[0]?.count ?? 0, page, limit };
  },

  /**
   * Xem full detail 1 interview — GET /interviews/:id.
   * Tra ve InterviewDetail gom ca feedback + cancel info.
   */
  getById: async (interviewId: string, hrId: string, hrRole: 'employer' | 'admin'): Promise<InterviewDetail> => {
    await assertInterviewBelongsToHR(interviewId, hrId, hrRole);

    const [row] = await db
      .select({
        id: interviews.id,
        applicationId: interviews.applicationId,
        jobId: applications.jobId,
        jobTitle: jobs.title,
        candidateId: applications.candidateId,
        candidateName: userProfiles.fullName,
        candidateEmail: users.email,
        interviewerId: interviews.interviewerId,
        scheduledAt: interviews.scheduledAt,
        durationMin: interviews.durationMin,
        location: interviews.location,
        meetingLink: interviews.meetingLink,
        status: interviews.status,
        confirmedAt: interviews.confirmedAt,
        cancelledAt: interviews.cancelledAt,
        cancelReason: interviews.cancelReason,
        feedback: interviews.feedback,
        feedbackSubmittedAt: interviews.feedbackSubmittedAt,
        createdAt: interviews.createdAt,
      })
      .from(interviews)
      .innerJoin(applications, eq(interviews.applicationId, applications.id))
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(users, eq(applications.candidateId, users.id))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(eq(interviews.id, interviewId))
      .limit(1);

    if (!row) throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');

    return row as unknown as InterviewDetail;
  },

  /**
   * HR cap nhat lich phong van — PUT /interviews/:id.
   * Chi update khi status='pending'/'confirmed'.
   * Neu doi scheduledAt -> reset confirmedAt (candidate can confirm lai).
   */
  update: async (interviewId: string, body: UpdateInterviewBody, hrId: string, hrRole: 'employer' | 'admin'): Promise<{ id: string; status: string }> => {
    const existing = await assertInterviewBelongsToHR(interviewId, hrId, hrRole);

    if (existing.status === 'cancelled' || existing.status === 'completed') {
      throw new AppError(400, 'INTERVIEW_IMMUTABLE', `Cannot update interview with status "${existing.status}"`);
    }

    const resetConfirm = body.scheduledAt ? { confirmedAt: null } : {};

    const [updated] = await db
      .update(interviews)
      .set({
        ...(body.interviewerId ? { interviewerId: body.interviewerId } : {}),
        ...(body.scheduledAt ? { scheduledAt: new Date(body.scheduledAt) } : {}),
        ...(body.durationMin !== undefined ? { durationMin: body.durationMin } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.meetingLink !== undefined ? { meetingLink: body.meetingLink } : {}),
        ...resetConfirm,
      })
      .where(eq(interviews.id, interviewId))
      .returning({ id: interviews.id, status: interviews.status });

    if (!updated) throw new AppError(500, 'UPDATE_FAILED', 'Failed to update interview');

    void notifyUpdated(existing.candidateId, updated.id)
      .catch((err) => logger.warn({ err, interviewId }, 'update: notify candidate failed (non-fatal)'));

    return { id: updated.id, status: updated.status ?? 'pending' };
  },

  /**
   * HR huy lich phong van — PUT /interviews/:id/cancel.
   * Set status='cancelled', luu cancelReason + cancelledAt.
   */
  cancel: async (interviewId: string, cancelReason: string | undefined, hrId: string, hrRole: 'employer' | 'admin'): Promise<{ id: string; status: string }> => {
    const existing = await assertInterviewBelongsToHR(interviewId, hrId, hrRole);

    if (existing.status === 'cancelled') throw new AppError(400, 'ALREADY_CANCELLED', 'Interview is already cancelled');
    if (existing.status === 'completed') throw new AppError(400, 'INTERVIEW_COMPLETED', 'Cannot cancel a completed interview');

    const [updated] = await db
      .update(interviews)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: cancelReason ?? null })
      .where(eq(interviews.id, interviewId))
      .returning({ id: interviews.id, status: interviews.status });

    if (!updated) throw new AppError(500, 'UPDATE_FAILED', 'Failed to cancel interview');

    void notifyCancelled(existing.candidateId, updated.id, cancelReason)
      .catch((err) => logger.warn({ err, interviewId }, 'cancel: notify candidate failed (non-fatal)'));

    return { id: updated.id, status: updated.status ?? 'cancelled' };
  },

  /**
   * Nguoi phong van submit feedback — PUT /interviews/:id/feedback.
   * Chi interviewerId hoac admin moi duoc submit.
   * Sau khi submit: status -> 'completed'.
   */
  submitFeedback: async (
    interviewId: string,
    feedback: { scores: Record<string, number>; comments: string; recommendation: 'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire' },
    userId: string,
    userRole: 'employer' | 'admin',
  ): Promise<{ id: string; status: string }> => {
    const [row] = await db
      .select({ id: interviews.id, interviewerId: interviews.interviewerId, status: interviews.status })
      .from(interviews)
      .where(eq(interviews.id, interviewId))
      .limit(1);

    if (!row) throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');
    if (userRole !== 'admin' && row.interviewerId !== userId) throw new AppError(403, 'FEEDBACK_FORBIDDEN', 'Only the assigned interviewer can submit feedback');
    if (row.status === 'cancelled') throw new AppError(400, 'INTERVIEW_CANCELLED', 'Cannot submit feedback for a cancelled interview');
    if (row.status === 'completed') throw new AppError(400, 'FEEDBACK_ALREADY_SUBMITTED', 'Feedback has already been submitted');

    const [updated] = await db
      .update(interviews)
      .set({ feedback, feedbackSubmittedAt: new Date(), status: 'completed' })
      .where(eq(interviews.id, interviewId))
      .returning({ id: interviews.id, status: interviews.status });

    if (!updated) throw new AppError(500, 'UPDATE_FAILED', 'Failed to save feedback');

    return { id: updated.id, status: updated.status ?? 'completed' };
  },

  // --------------------------------------------------------------------------
  // Candidate-side (chatbot)
  // --------------------------------------------------------------------------

  /**
   * List interviews sap toi hoac gan day cua candidate.
   * - upcoming=true: chi scheduledAt >= now AND status NOT IN ('cancelled')
   * - upcoming=false: tra tat ca lich su, kem theo phan trang (page/limit)
   */
  listByCandidate: async (
    candidateId: string,
    opts: { upcoming?: boolean; page?: number; limit?: number } = {},
  ): Promise<{ rows: CandidateInterviewRow[]; total: number; page: number; limit: number }> => {
    const page = opts.page ?? 1;
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);

    const conditions = [eq(applications.candidateId, candidateId)];
    if (opts.upcoming) {
      conditions.push(gte(interviews.scheduledAt, sql`now()`));
      // Nếu là upcoming, ẩn các lịch đã bị hủy
      conditions.push(sql`${interviews.status} != 'cancelled'`);
      conditions.push(sql`${interviews.status} IS NOT NULL`);
    }

    const whereClause = and(...conditions);

    const [rows, totalRow] = await Promise.all([
      db.select({
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
      .where(whereClause)
      .orderBy(opts.upcoming ? asc(interviews.scheduledAt) : desc(interviews.scheduledAt))
      .limit(limit)
      .offset(OFFSET(page, limit)),

      db.select({ count: sql<number>`COUNT(*)::int` })
      .from(interviews)
      .innerJoin(applications, eq(interviews.applicationId, applications.id))
      .where(whereClause),
    ]);

    return {
      rows: rows as CandidateInterviewRow[],
      total: totalRow[0]?.count ?? 0,
      page,
      limit,
    };
  },

  /**
   * Xem chi tiết 1 lịch phỏng vấn dành cho Candidate — GET /interviews/candidate/:id.
   * Tra ve chi tiet, kem theo cancelReason, notes... (nhung KHONG tra ve feedback cua HR).
   */
  getDetailByCandidate: async (interviewId: string, candidateId: string) => {
    const [row] = await db
      .select({
        id: interviews.id,
        applicationId: interviews.applicationId,
        jobId: applications.jobId,
        jobTitle: jobs.title,
        companyName: companies.name,
        scheduledAt: interviews.scheduledAt,
        durationMin: interviews.durationMin,
        location: interviews.location,
        meetingLink: interviews.meetingLink,
        status: interviews.status,
        confirmedAt: interviews.confirmedAt,
        cancelledAt: interviews.cancelledAt,
        cancelReason: interviews.cancelReason,
        // Giả sử schema có cột notes, nếu không có thì bỏ dòng này đi
        // notes: interviews.notes, 
        createdAt: interviews.createdAt,
      })
      .from(interviews)
      .innerJoin(applications, eq(interviews.applicationId, applications.id))
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .leftJoin(companies, eq(jobs.companyId, companies.id))
      .where(and(eq(interviews.id, interviewId), eq(applications.candidateId, candidateId)))
      .limit(1);

    if (!row) throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found or you do not have permission to view it');

    return row;
  },

  /**
   * Candidate xac nhan tham gia phong van — PUT /interviews/candidate/:id/confirm.
   * Chi confirm duoc khi status='pending'.
   */
  confirm: async (interviewId: string, candidateId: string): Promise<{ id: string; status: string }> => {
    const [row] = await db
      .select({
        id: interviews.id,
        status: interviews.status,
        candidateId: applications.candidateId,
        scheduledAt: interviews.scheduledAt,
      })
      .from(interviews)
      .innerJoin(applications, eq(interviews.applicationId, applications.id))
      .where(eq(interviews.id, interviewId))
      .limit(1);

    if (!row) throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');
    if (row.candidateId !== candidateId) throw new AppError(403, 'INTERVIEW_FORBIDDEN', 'You do not have permission to confirm this interview');
    if (row.status === 'cancelled') throw new AppError(400, 'INTERVIEW_CANCELLED', 'Cannot confirm a cancelled interview');
    if (row.status === 'completed') throw new AppError(400, 'INTERVIEW_COMPLETED', 'Cannot confirm a completed interview');
    if (row.status === 'confirmed') throw new AppError(400, 'ALREADY_CONFIRMED', 'Interview is already confirmed');

    const [updated] = await db
      .update(interviews)
      .set({ status: 'confirmed', confirmedAt: new Date() })
      .where(eq(interviews.id, interviewId))
      .returning({ id: interviews.id, status: interviews.status });

    if (!updated) throw new AppError(500, 'UPDATE_FAILED', 'Failed to confirm interview');

    return { id: updated.id, status: updated.status ?? 'confirmed' };
  },

  /**
   * Candidate tu choi tham gia phong van — PUT /interviews/candidate/:id/reject.
   * Chi reject duoc khi status='pending' hoac 'confirmed'.
   * Notify HR (best-effort).
   */
  reject: async (interviewId: string, candidateId: string, reason?: string): Promise<{ id: string; status: string }> => {
    const [row] = await db
      .select({
        id: interviews.id,
        status: interviews.status,
        candidateId: applications.candidateId,
        interviewerId: interviews.interviewerId,
      })
      .from(interviews)
      .innerJoin(applications, eq(interviews.applicationId, applications.id))
      .where(eq(interviews.id, interviewId))
      .limit(1);

    if (!row) throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');
    if (row.candidateId !== candidateId) throw new AppError(403, 'INTERVIEW_FORBIDDEN', 'You do not have permission to reject this interview');
    if (row.status === 'cancelled') throw new AppError(400, 'INTERVIEW_CANCELLED', 'Cannot reject a cancelled interview');
    if (row.status === 'completed') throw new AppError(400, 'INTERVIEW_COMPLETED', 'Cannot reject a completed interview');

    const [updated] = await db
      .update(interviews)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason ?? null })
      .where(eq(interviews.id, interviewId))
      .returning({ id: interviews.id, status: interviews.status });

    if (!updated) throw new AppError(500, 'UPDATE_FAILED', 'Failed to reject interview');

    // Notify HR (interviewer) best-effort
    void notificationService.create({
      userId: row.interviewerId,
      type: 'interview_cancelled',
      title: 'Candidate declined the interview',
      payload: { interviewId, reason },
    }).catch((err) => logger.warn({ err, interviewId }, 'reject: notify interviewer failed (non-fatal)'));

    void notificationGateway.emitToUser(row.interviewerId, 'interview:rejected', { interviewId, reason });

    return { id: updated.id, status: updated.status ?? 'cancelled' };
  },
};