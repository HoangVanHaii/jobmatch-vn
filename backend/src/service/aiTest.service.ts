/**
 * AI test service — sinh đề + giao bài cho ứng viên (Phase 3).
 *
 * Luồng (docs/n8nAndAI.md §5.6, quyết định thiết kế đã chốt):
 *   1. REUSE-OR-GENERATE: đề theo (jobId, testType) — có 'ready' thì dùng
 *      lại (công bằng so điểm, tiết kiệm Gemini), chưa có mới sinh.
 *   2. HR REVIEW trước khi giao — đề 'generating' không giao được.
 *   3. ASSIGN: token 32B + hạn 7 ngày → n8n gửi email link → AUTO-STAGE
 *      ('iq-test'/'english-test') + emit socket (pattern reference check).
 *   4. Candidate làm bài qua link public /test/:token — token là vé, không
 *      login. BE serve câu hỏi đã STRIP đáp án + shuffle theo token.
 *   5. SUBMIT: chấm trắc nghiệm bằng code, essay để phase sau. Machine
 *      chỉ chấm điểm + ĐÁNH DẤU nghi ngờ (anti-cheat MVP), HR quyết.
 */
import crypto from 'crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import {
  aiTests,
  applications,
  jobs,
  testAssignments,
  userProfiles,
  users,
} from '../db/schema';
import { n8nService } from './n8n.service';
import { notificationGateway } from '../socket/notificationGateway';
import { assertEmployerOwnsApplication } from './referenceVerify.service';

const ASSIGNMENT_TTL_DAYS = 7;

/** Cấu hình đề mặc định theo loại — HR có thể tinh chỉnh sau qua UI. */
const TEST_PRESETS: Record<'iq' | 'english', {
  questionCount: number;
  pointsPerQuestion: number;
  durationMin: number;
  level: string;
}> = {
  iq: { questionCount: 20, pointsPerQuestion: 5, durationMin: 30, level: 'medium' },
  english: { questionCount: 15, pointsPerQuestion: 6, durationMin: 25, level: 'medium' },
};

const generateToken = (): string => crypto.randomBytes(32).toString('hex');

// ============================================================================
// Employer endpoints
// ============================================================================

/**
 * Sinh đề test cho job — REUSE-OR-GENERATE:
 *   - Có đề 'ready' cùng (jobId, testType) → trả luôn (reused=true), không
 *     tốn Gemini.
 *   - Chưa có → insert 'generating' + enqueue BullMQ; FE poll/đợi socket.
 */
export const generateOrReuse = async (input: {
  jobId: string;
  testType: 'iq' | 'english';
  employerId: string;
  employerRole: string;
}): Promise<{ testId: string; status: string; reused: boolean }> => {
  // Ownership: employer phải own job (postedBy / active member / admin).
  const [job] = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      requirements: jobs.requirements,
      companyId: jobs.companyId,
      postedBy: jobs.postedBy,
    })
    .from(jobs)
    .where(eq(jobs.id, input.jobId))
    .limit(1);

  if (!job) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Job không tồn tại');
  }
  if (input.employerRole !== 'admin' && job.postedBy !== input.employerId) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Job không tồn tại');
  }

  // Reuse — đề 'ready' mới nhất của job + type.
  const [existing] = await db
    .select({ id: aiTests.id, status: aiTests.status })
    .from(aiTests)
    .where(
      and(
        eq(aiTests.jobId, input.jobId),
        eq(aiTests.testType, input.testType),
        eq(aiTests.status, 'ready'),
      ),
    )
    .orderBy(desc(aiTests.createdAt))
    .limit(1);

  if (existing) {
    return { testId: existing.id, status: existing.status, reused: true };
  }

  // Có đề đang generating/failed → báo trạng thái để FE không enqueue trùng.
  const [inFlight] = await db
    .select({ id: aiTests.id, status: aiTests.status })
    .from(aiTests)
    .where(
      and(
        eq(aiTests.jobId, input.jobId),
        eq(aiTests.testType, input.testType),
        inArray(aiTests.status, ['generating', 'failed']),
      ),
    )
    .orderBy(desc(aiTests.createdAt))
    .limit(1);

  if (inFlight?.status === 'generating') {
    return { testId: inFlight.id, status: 'generating', reused: false };
  }

  // Sinh mới (hoặc retry sau 'failed').
  const preset = TEST_PRESETS[input.testType];
  const [created] = await db
    .insert(aiTests)
    .values({
      jobId: input.jobId,
      createdBy: input.employerId,
      testType: input.testType,
      level: preset.level,
      status: 'generating',
    })
    .returning({ id: aiTests.id });

  if (!created) {
    throw new AppError(500, 'INSERT_FAILED', 'Không tạo được đề test');
  }

  const { aiTestGenerateQueue } = await import('../config/queue');
  try {
    await aiTestGenerateQueue.add(
      'ai-test-generate',
      {
        testId: created.id,
        employerId: input.employerId,
        testType: input.testType,
        level: preset.level,
        questionCount: preset.questionCount,
        pointsPerQuestion: preset.pointsPerQuestion,
        durationMin: preset.durationMin,
        jobTitle: job.title,
        jobRequirements: job.requirements ?? null,
      } satisfies import('../jobs/aiTestGenerate.worker').AiTestGenerateJobData,
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    );
  } catch (err) {
    // Queue down → đánh dấu failed để FE hiện nút thử lại.
    await db.update(aiTests).set({ status: 'failed' }).where(eq(aiTests.id, created.id));
    logger.error({ err, testId: created.id }, 'aiTest.generateOrReuse: enqueue thất bại');
    throw new AppError(502, 'QUEUE_DOWN', 'Hệ thống bận — thử tạo đề lại sau');
  }

  logger.info(
    { testId: created.id, jobId: input.jobId, testType: input.testType },
    'aiTest: enqueue sinh đề',
  );

  return { testId: created.id, status: 'generating', reused: false };
};

/** Danh sách đề của 1 job (mọi trạng thái) — employer owns job. */
export const listTestsForJob = async (
  jobId: string,
  employerId: string,
  employerRole: string,
) => {
  const [job] = await db
    .select({ postedBy: jobs.postedBy })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job không tồn tại');
  if (employerRole !== 'admin' && job.postedBy !== employerId) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Job không tồn tại');
  }

  return db
    .select({
      id: aiTests.id,
      testType: aiTests.testType,
      level: aiTests.level,
      status: aiTests.status,
      totalPoints: aiTests.totalPoints,
      durationMin: aiTests.durationMin,
      questionCount: sql<number>`jsonb_array_length(coalesce(${aiTests.questions}, '[]'::jsonb))`,
      createdAt: aiTests.createdAt,
    })
    .from(aiTests)
    .where(eq(aiTests.jobId, jobId))
    .orderBy(desc(aiTests.createdAt));
};

/** Review đề đầy đủ (kèm đáp án) — employer owns job của đề. */
export const getTestDetail = async (testId: string, employerId: string, employerRole: string) => {
  const [test] = await db
    .select({
      id: aiTests.id,
      jobId: aiTests.jobId,
      postedBy: jobs.postedBy,
      testType: aiTests.testType,
      level: aiTests.level,
      status: aiTests.status,
      questions: aiTests.questions,
      totalPoints: aiTests.totalPoints,
      durationMin: aiTests.durationMin,
      passingScore: aiTests.passingScore,
      createdAt: aiTests.createdAt,
    })
    .from(aiTests)
    .innerJoin(jobs, eq(jobs.id, aiTests.jobId))
    .where(eq(aiTests.id, testId))
    .limit(1);

  if (!test) throw new AppError(404, 'TEST_NOT_FOUND', 'Đề test không tồn tại');
  if (employerRole !== 'admin' && test.postedBy !== employerId) {
    throw new AppError(404, 'TEST_NOT_FOUND', 'Đề test không tồn tại');
  }

  return test;
};

/** Assignments của 1 application — employer owns application. */
export const listAssignmentsForApplication = async (
  applicationId: string,
  employerId: string,
  employerRole: string,
) => {
  await assertEmployerOwnsApplication(applicationId, employerId, employerRole);

  return db
    .select({
      id: testAssignments.id,
      testId: testAssignments.testId,
      testType: aiTests.testType,
      testStatus: aiTests.status,
      status: testAssignments.status,
      score: testAssignments.score,
      sentAt: testAssignments.sentAt,
      submittedAt: testAssignments.submittedAt,
      expiresAt: testAssignments.expiresAt,
      flags: testAssignments.flags,
    })
    .from(testAssignments)
    .innerJoin(aiTests, eq(aiTests.id, testAssignments.testId))
    .where(eq(testAssignments.applicationId, applicationId))
    .orderBy(desc(testAssignments.sentAt));
};

/**
 * Assignments của CANDIDATE theo application — owner check: application
 * phải thuộc candidate đang gọi. FE panel "Hoạt động" dựng timeline test.
 */
export const listAssignmentsForCandidate = async (
  applicationId: string,
  candidateId: string,
) => {
  const [app] = await db
    .select({ candidateId: applications.candidateId })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!app || app.candidateId !== candidateId) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application không tồn tại');
  }

  return db
    .select({
      id: testAssignments.id,
      testType: aiTests.testType,
      status: testAssignments.status,
      score: testAssignments.score,
      passingScore: aiTests.passingScore,
      sentAt: testAssignments.sentAt,
      submittedAt: testAssignments.submittedAt,
      expiresAt: testAssignments.expiresAt,
    })
    .from(testAssignments)
    .innerJoin(aiTests, eq(aiTests.id, testAssignments.testId))
    .where(eq(testAssignments.applicationId, applicationId))
    .orderBy(desc(testAssignments.sentAt));
};

/**
 * Chi tiết 1 lần làm bài — đề (kèm đáp án đúng) + answers của candidate
 * + điểm/timeline/flags. Employer owns application chứa assignment.
 */
export const getAssignmentDetail = async (
  assignmentId: string,
  employerId: string,
  employerRole: string,
) => {
  const [row] = await db
    .select()
    .from(testAssignments)
    .where(eq(testAssignments.id, assignmentId))
    .limit(1);

  if (!row) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment không tồn tại');
  }

  await assertEmployerOwnsApplication(row.applicationId, employerId, employerRole);

  const [test] = await db
    .select({
      id: aiTests.id,
      testType: aiTests.testType,
      questions: aiTests.questions,
      totalPoints: aiTests.totalPoints,
      durationMin: aiTests.durationMin,
      passingScore: aiTests.passingScore,
    })
    .from(aiTests)
    .where(eq(aiTests.id, row.testId))
    .limit(1);

  // KHÔNG trả accessToken về FE (không cần, tránh leak link làm bài).
  const { accessToken: _token, ...assignment } = row;
  void _token;

  return { assignment, test };
};

/**
 * Giao bài cho ứng viên: tạo assignment + n8n gửi email + AUTO-STAGE
 * ('iq-test'/'english-test' theo testType) — chép pattern reference check.
 */
export const assignTest = async (
  input: { applicationId: string; testId: string },
  employerId: string,
  employerRole: string,
): Promise<{ assignmentId: string; status: string; expiresAt: Date }> => {
  const { applicationId } = await assertEmployerOwnsApplication(
    input.applicationId,
    employerId,
    employerRole,
  );

  // Đề phải 'ready' + cùng job với application.
  const [app] = await db
    .select({ jobId: applications.jobId, candidateId: applications.candidateId })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);
  if (!app) throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application không tồn tại');

  const [test] = await db
    .select({
      id: aiTests.id,
      jobId: aiTests.jobId,
      testType: aiTests.testType,
      status: aiTests.status,
      durationMin: aiTests.durationMin,
    })
    .from(aiTests)
    .where(eq(aiTests.id, input.testId))
    .limit(1);

  if (!test || test.status !== 'ready') {
    throw new AppError(400, 'TEST_NOT_READY', 'Đề chưa sẵn sàng hoặc không tồn tại');
  }
  if (test.jobId !== app.jobId) {
    throw new AppError(400, 'TEST_JOB_MISMATCH', 'Đề test không thuộc job của đơn này');
  }

  // Idempotency + retry: row 'pending' mà sentAt IS NULL = lần giao trước
  // n8n fail (email chưa từng đi) → XOÁ row cũ, tạo mới (token + hạn mới).
  // Còn 'sent'/'in_progress' đang hiệu lực → 409 chặn như cũ.
  const [orphan] = await db
    .select({ id: testAssignments.id })
    .from(testAssignments)
    .where(
      and(
        eq(testAssignments.applicationId, applicationId),
        eq(testAssignments.testId, input.testId),
        eq(testAssignments.status, 'pending'),
      ),
    )
    .limit(1);

  if (orphan) {
    await db.delete(testAssignments).where(eq(testAssignments.id, orphan.id));
    logger.warn(
      { assignmentId: orphan.id, applicationId },
      'aiTest.assign: xoá assignment pending chưa gửi được (retry)',
    );
  }

  const [active] = await db
    .select({ id: testAssignments.id })
    .from(testAssignments)
    .where(
      and(
        eq(testAssignments.applicationId, applicationId),
        eq(testAssignments.testId, input.testId),
        inArray(testAssignments.status, ['sent', 'in_progress']),
      ),
    )
    .limit(1);

  if (active) {
    throw new AppError(409, 'ASSIGNMENT_ACTIVE', 'Đã có bài test đang chờ ứng viên làm');
  }

  // Candidate email + name cho email n8n.
  const [cand] = await db
    .select({ email: users.email, fullName: userProfiles.fullName })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, app.candidateId))
    .limit(1);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + ASSIGNMENT_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(testAssignments)
    .values({
      applicationId,
      testId: input.testId,
      accessToken: token,
      status: 'pending',
      expiresAt,
    })
    .returning({ id: testAssignments.id });

  if (!row) {
    throw new AppError(500, 'INSERT_FAILED', 'Không tạo được assignment');
  }

  const testUrl = `${env.FRONTEND_URL}/test/${token}`;
  const stage = test.testType === 'iq' ? 'iq-test' : 'english-test';

  try {
    await n8nService.trigger('ai_test_assign', {
      assignmentId: row.id,
      candidateEmail: cand?.email,
      candidateName: cand?.fullName ?? 'Ứng viên',
      testType: test.testType,
      durationMin: test.durationMin,
      testUrl,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err, assignmentId: row.id }, 'aiTest.assign: n8n trigger thất bại');
    throw new AppError(502, 'N8N_TRIGGER_FAILED', 'Gửi email thất bại — thử lại sau');
  }

  await db
    .update(testAssignments)
    .set({ status: 'sent', sentAt: new Date() })
    .where(eq(testAssignments.id, row.id));

  // AUTO-STAGE + emit cho 2 phía (chép pattern reference check).
  const now = new Date();
  await db
    .update(applications)
    .set({ stage, updatedAt: now })
    .where(eq(applications.id, applicationId));

  const payload = {
    applicationId,
    stage,
    updatedAt: now.toISOString(),
  };
  notificationGateway.emitToUser(employerId, 'application:status-changed', payload);
  notificationGateway.emitToUser(app.candidateId, 'application:status-changed', payload);

  logger.info(
    { assignmentId: row.id, applicationId, testType: test.testType },
    'aiTest.assign: đã giao bài + email qua n8n',
  );

  return { assignmentId: row.id, status: 'sent', expiresAt };
};

// ============================================================================
// Public endpoints — candidate làm bài qua /test/:token (KHÔNG login)
// ============================================================================

/** Lookup assignment + đề theo token — dùng chung cho get/submit. */
const loadAssignmentByToken = async (token: string) => {
  const [row] = await db
    .select()
    .from(testAssignments)
    .where(eq(testAssignments.accessToken, token))
    .limit(1);
  if (!row) {
    throw new AppError(404, 'TEST_NOT_FOUND', 'Link bài test không hợp lệ');
  }

  const [test] = await db
    .select({
      id: aiTests.id,
      testType: aiTests.testType,
      questions: aiTests.questions,
      totalPoints: aiTests.totalPoints,
      durationMin: aiTests.durationMin,
      passingScore: aiTests.passingScore,
    })
    .from(aiTests)
    .where(eq(aiTests.id, row.testId))
    .limit(1);

  return { row, test };
};

/** Shuffle deterministic từ token — cùng token cùng thứ tự (re-load ok). */
const shuffleSeeded = <T>(items: T[], seed: string): T[] => {
  const arr = [...items];
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    hash = (hash * 1103515245 + 12345) >>> 0;
    const j = hash % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
};

/**
 * Candidate mở link → đề đã STRIP đáp án + shuffle (câu + options) theo
 * token. Lần đầu mở → set startedAt (bấm đồng hồ durationMin phía FE).
 */
export const getPublicTest = async (token: string) => {
  const { row, test } = await loadAssignmentByToken(token);

  if (!test || !test.questions?.length) {
    throw new AppError(409, 'TEST_NOT_READY', 'Bài test chưa sẵn sàng');
  }
  const expired = row.expiresAt ? row.expiresAt < new Date() : false;
  if (expired) {
    throw new AppError(410, 'TEST_EXPIRED', 'Bài test đã hết hạn');
  }
  if (row.submittedAt) {
    throw new AppError(409, 'ALREADY_SUBMITTED', 'Bài test đã được nộp');
  }

  if (!row.startedAt) {
    await db
      .update(testAssignments)
      .set({ startedAt: new Date(), status: row.status === 'sent' ? 'in_progress' : row.status })
      .where(eq(testAssignments.id, row.id));
  }

  // Strip đáp án + shuffle câu + options (seed theo token).
  const questions = shuffleSeeded(test.questions, token).map((q, idx) => ({
    id: q.id,
    order: idx + 1,
    type: q.type,
    question: q.question,
    options: q.options ? shuffleSeeded(q.options, `${token}:${q.id}`) : undefined,
    points: q.points,
  }));

  return {
    testType: test.testType,
    durationMin: test.durationMin,
    totalPoints: test.totalPoints,
    startedAt: row.startedAt ?? new Date().toISOString(),
    questions,
  };
};

/**
 * AUTOSAVE từng câu — candidate chọn đáp án là lưu ngay (merge 1 key vào
 * answers jsonb). Chống mất bài khi đóng tab/đứt mạng giữa chừng; nộp bài
 * vẫn gửi full answers làm source of truth.
 * Guards: token hợp lệ, chưa hết hạn, chưa nộp, questionId thuộc đề.
 */
export const saveAnswer = async (
  token: string,
  questionId: string,
  answer: string,
): Promise<void> => {
  const { row, test } = await loadAssignmentByToken(token);

  if (row.expiresAt && row.expiresAt < new Date()) {
    throw new AppError(410, 'TEST_EXPIRED', 'Bài test đã hết hạn');
  }
  if (row.submittedAt) {
    throw new AppError(409, 'ALREADY_SUBMITTED', 'Bài test đã được nộp');
  }
  if (!test?.questions?.length) {
    throw new AppError(409, 'TEST_NOT_READY', 'Bài test chưa sẵn sàng');
  }
  if (!test.questions.some((q) => q.id === questionId)) {
    throw new AppError(400, 'INVALID_QUESTION', 'Câu hỏi không thuộc bài test này');
  }

  const now = new Date();
  await db
    .update(testAssignments)
    .set({
      answers: { ...(row.answers ?? {}), [questionId]: answer },
      startedAt: row.startedAt ?? now,
      status: row.status === 'sent' || row.status === 'pending' ? 'in_progress' : row.status,
    })
    .where(eq(testAssignments.id, row.id));
};

/**
 * Candidate nộp bài → chấm trắc nghiệm bằng CODE (so normalize string),
 * lưu answers/score/gradedAt + flags anti-cheat MVP. Essay (correctAnswer
 * trống) chưa chấm — phase sau dùng Gemini.
 */
export const submitTest = async (
  token: string,
  answers: Record<string, string>,
  ip?: string,
): Promise<{ score: number; totalPoints: number; passed: boolean }> => {
  const { row, test } = await loadAssignmentByToken(token);

  if (row.expiresAt && row.expiresAt < new Date()) {
    throw new AppError(410, 'TEST_EXPIRED', 'Bài test đã hết hạn');
  }
  if (row.submittedAt) {
    throw new AppError(409, 'ALREADY_SUBMITTED', 'Bài test đã được nộp trước đó');
  }
  if (!test?.questions?.length) {
    throw new AppError(409, 'TEST_NOT_READY', 'Bài test chưa sẵn sàng');
  }

  // Chấm multiple-choice: normalize (trim + lowercase) so correctAnswer.
  const normalize = (s: string): string => s.trim().toLowerCase();
  let score = 0;
  let maxScorable = 0;
  for (const q of test.questions) {
    if (!q.correctAnswer) continue; // essay — phase sau
    maxScorable += q.points;
    const answer = answers[q.id];
    if (answer && normalize(answer) === normalize(q.correctAnswer)) {
      score += q.points;
    }
  }
  const totalPoints = test.questions.reduce((sum, q) => sum + q.points, 0);
  const passingScore = Number(test.passingScore ?? 60);
  const percent = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
  const passed = percent >= passingScore;

  // Anti-cheat flags MVP: nộp quá nhanh so với duration.
  const flags: string[] = [];
  if (row.startedAt) {
    const minutes = (Date.now() - row.startedAt.getTime()) / 60_000;
    const durationMin = test.durationMin ?? 30;
    if (minutes < durationMin * 0.25 && percent > 80) {
      flags.push('too-fast-high-score');
    }
  }

  const now = new Date();
  await db
    .update(testAssignments)
    .set({
      answers,
      score: String(percent),
      status: 'submitted',
      submittedAt: now,
      gradedAt: now,
      ipAddress: ip ?? null,
      flags: flags.length > 0 ? flags : null,
    })
    .where(eq(testAssignments.id, row.id));

  // Nhắc employer (application → job.postedBy).
  const [appRow] = await db
    .select({ jobId: applications.jobId })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(applications.id, row.applicationId))
    .limit(1);

  if (appRow) {
    const [job] = await db
      .select({ postedBy: jobs.postedBy })
      .from(jobs)
      .where(eq(jobs.id, appRow.jobId))
      .limit(1);
    if (job) {
      notificationGateway.emitToUser(job.postedBy, 'ai-test:graded', {
        applicationId: row.applicationId,
        assignmentId: row.id,
        score: percent,
        passed,
        flags,
      });
    }
  }

  logger.info(
    { assignmentId: row.id, score: percent, passed, flags },
    'aiTest.submit: candidate nộp bài',
  );

  return { score: percent, totalPoints, passed };
};

export const aiTestService = {
  generateOrReuse,
  listTestsForJob,
  getTestDetail,
  listAssignmentsForApplication,
  listAssignmentsForCandidate,
  getAssignmentDetail,
  assignTest,
  getPublicTest,
  saveAnswer,
  submitTest,
};
