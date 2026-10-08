/**
 * Reference verification service — luồng xác minh người tham chiếu.
 *
 * Luồng (xem docs/n8nAndAI.md §5.3 + n8n-workflows/03-reference-verify.json):
 *   1. HR mở application detail → FE gọi `listForApplication` — merge
 *      referees từ `cvs.parsed_data.references` (template do LLM extract)
 *      với các row `reference_verifications` đã tồn tại.
 *   2. HR click "Gửi yêu cầu xác minh" → `sendVerification`:
 *      tạo row (token random 32 bytes, expiresAt +14 ngày) → trigger n8n
 *      `reference_verify` → n8n gửi email có link verify.
 *   3. Referee (người ngoài, không login) mở link → `getPublicByToken`
 *      trả thông tin tối thiểu để render form confirm/decline.
 *   4. Referee submit → `submitByToken` — validate token + expiry + status
 *      rồi update `status` + `response`.
 *
 * Phân vai: backend sở hữu token + trạng thái; n8n CHỈ gửi email;
 * referee tự xác nhận; HR đọc kết quả và quyết định.
 */
import crypto from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { applications, jobs, referenceVerifications, userProfiles, users, companyMembers } from '../db/schema';
import { n8nService } from './n8n.service';
import { notificationService } from './notification.service';
import { notificationGateway } from '../socket/notificationGateway';

/** Shape referee trong cvs.parsed_data.references (khớp type trong schema cvs.ts). */
interface CvReferenceSource {
  name: string;
  email?: string;
  phone?: string;
  relationship?: string;
  company?: string;
  position?: string;
}

/** Link verify có hiệu lực 14 ngày (match docs §7.2). */
const TOKEN_TTL_DAYS = 14;

/** Random 32 bytes hex — match docs §7.2 (reference verification token). */
const generateToken = (): string => crypto.randomBytes(32).toString('hex');

/**
 * Employer chỉ thao tác trên application của job mình post (hoặc member
 * của company post job). Mirror pattern ownership của listByJob.
 */
const assertEmployerOwnsApplication = async (
  applicationId: string,
  employerId: string,
  employerRole: string,
): Promise<{
  applicationId: string;
  candidateId: string;
  jobTitle: string;
}> => {
  const [row] = await db
    .select({
      id: applications.id,
      candidateId: applications.candidateId,
      jobTitle: jobs.title,
      companyId: jobs.companyId,
      postedBy: jobs.postedBy,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!row) {
    throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application không tồn tại');
  }

  if (employerRole === 'admin' || row.postedBy === employerId) {
    return { applicationId: row.id, candidateId: row.candidateId, jobTitle: row.jobTitle };
  }

  // postedBy khác → check active member của company post job.
  if (row.companyId) {
    const [member] = await db
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, row.companyId),
          eq(companyMembers.userId, employerId),
          eq(companyMembers.status, 'active'),
        ),
      )
      .limit(1);
    if (member) {
      return { applicationId: row.id, candidateId: row.candidateId, jobTitle: row.jobTitle };
    }
  }

  throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application không tồn tại');
};

// ============================================================================
// Employer endpoints
// ============================================================================

/**
 * HR xem danh sách referees của 1 application:
 *   - `source`: referees LLM extract từ CV (`cvs.parsed_data.references`)
 *     — template để HR chọn gửi; CV cũ/thiếu → mảng rỗng.
 *   - `verifications`: các row đã tạo kèm trạng thái verify.
 * FE merge 2 list theo `refereeEmail` để hiển thị badge trạng thái.
 */
export const listForApplication = async (
  applicationId: string,
  employerId: string,
  employerRole: string,
) => {
  await assertEmployerOwnsApplication(applicationId, employerId, employerRole);

  // Đọc CV snapshot lưu sẵn trong application (freeze tại thời điểm apply)
  // thay vì query lại bảng cvs — 1 query ít hơn và semantic đúng hơn: HR
  // phải thấy referees của bản CV candidate đã nộp, không phải bản CV
  // hiện tại (có thể đã sửa/xoá sau khi apply).
  const [app] = await db
    .select({ cv: applications.cv })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);

  // Snapshot parsedData đang là `unknown` (ApplicationCvSnapshot) — cast về
  // shape references đã thêm vào schema cvs.ts. Application cũ (snapshot
  // trước khi có field) → references undefined → mảng rỗng.
  const parsed = app?.cv?.parsedData as { references?: CvReferenceSource[] } | undefined;

  const verifications = await db
    .select()
    .from(referenceVerifications)
    .where(eq(referenceVerifications.applicationId, applicationId))
    .orderBy(desc(referenceVerifications.createdAt));

  return {
    source: parsed?.references ?? [],
    verifications: verifications.map((v) => ({
      id: v.id,
      refereeName: v.refereeName,
      refereeEmail: v.refereeEmail,
      relationship: v.relationship,
      company: v.company,
      status: v.status,
      sentAt: v.sentAt,
      verifiedAt: v.verifiedAt,
      expiresAt: v.expiresAt,
      response: v.response,
    })),
  };
};

/**
 * HR gửi email xác minh cho 1 referee.
 *
 * Idempotency (docs §7.3): chặn gửi trùng khi còn 1 row pending/sent chưa
 * verify với cùng email — referee chưa trả lời thì không gửi đè. Row
 * verified/failed/expired → cho tạo row mới (resend hợp lệ).
 *
 * Trả `{ status: 'sent' }` chỉ khi n8n webhook nhận thành công —
 * webhook fail → row giữ status='pending' + throw để HR retry (docs §7.4).
 */
export const sendVerification = async (
  input: {
    applicationId: string;
    refereeName: string;
    refereeEmail: string;
    relationship?: string;
    company?: string;
  },
  employerId: string,
  employerRole: string,
): Promise<{ id: string; status: string; expiresAt: Date }> => {
  const { applicationId, candidateId, jobTitle } = await assertEmployerOwnsApplication(
    input.applicationId,
    employerId,
    employerRole,
  );

  // Candidate name cho email (referee cần biết ai liệt kê mình).
  const [cand] = await db
    .select({ fullName: userProfiles.fullName })
    .from(userProfiles)
    .where(eq(userProfiles.userId, candidateId))
    .limit(1);

  // Chặn duplicate đang chờ phản hồi (pending = chưa gửi được email hoặc
  // đã gửi nhưng referee chưa verify).
  const [pending] = await db
    .select({ id: referenceVerifications.id })
    .from(referenceVerifications)
    .where(
      and(
        eq(referenceVerifications.applicationId, applicationId),
        eq(referenceVerifications.refereeEmail, input.refereeEmail.toLowerCase()),
        eq(referenceVerifications.status, 'pending'),
      ),
    )
    .limit(1);

  if (pending) {
    throw new AppError(
      409,
      'VERIFICATION_PENDING',
      'Đã có yêu cầu xác minh đang chờ phản hồi cho email này',
    );
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(referenceVerifications)
    .values({
      applicationId,
      refereeName: input.refereeName,
      refereeEmail: input.refereeEmail.toLowerCase(),
      refereePhone: null,
      relationship: input.relationship,
      company: input.company,
      verificationToken: token,
      status: 'pending',
      expiresAt,
    })
    .returning({ id: referenceVerifications.id });

  const verifyUrl = `${env.FRONTEND_URL}/verify/reference/${token}`;

  try {
    await n8nService.trigger('reference_verify', {
      referenceId: row.id,
      refereeEmail: input.refereeEmail,
      refereeName: input.refereeName,
      candidateName: cand?.fullName ?? '(Ứng viên)',
      jobTitle,
      relationship: input.relationship,
      company: input.company,
      verifyUrl,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    // n8n down/timeout → giữ row 'pending' để HR retry (đợi n8n sống lại,
    // resend sẽ bị 409 nếu row vẫn pending — xoá row pending cũ hoặc chờ
    // expiry). Throw để FE hiện lỗi, KHÔNG báo "đã gửi".
    logger.error({ err, referenceId: row.id }, 'referenceVerify: n8n trigger failed');
    throw new AppError(502, 'N8N_TRIGGER_FAILED', 'Gửi email thất bại — thử lại sau');
  }

  // Webhook nhận OK → đánh dấu sent (email workflow đã start; delivery
  // do SMTP, nhưng đây là best-effort mark như docs §5.3).
  await db
    .update(referenceVerifications)
    .set({ status: 'sent', sentAt: new Date() })
    .where(eq(referenceVerifications.id, row.id));

  logger.info(
    { referenceId: row.id, applicationId, refereeEmail: input.refereeEmail },
    'referenceVerify: email xác minh đã trigger qua n8n',
  );

  return { id: row.id, status: 'sent', expiresAt };
};

// ============================================================================
// Public endpoints (referee — KHÔNG login, token là proof-of-access)
// ============================================================================

/** Lookup row + context (candidate name, job title) theo token. */
const loadByToken = async (token: string) => {
  const [row] = await db
    .select()
    .from(referenceVerifications)
    .where(eq(referenceVerifications.verificationToken, token))
    .limit(1);

  if (!row) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Link xác minh không hợp lệ');
  }

  const [ctx] = await db
    .select({
      jobTitle: jobs.title,
      candidateName: userProfiles.fullName,
      // Employer nhận notify khi referee phản hồi (submitByToken).
      postedBy: jobs.postedBy,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(users, eq(users.id, applications.candidateId))
    .leftJoin(userProfiles, eq(userProfiles.userId, applications.candidateId))
    .where(eq(applications.id, row.applicationId))
    .limit(1);

  return { row, ctx };
};

/**
 * Referee mở link → trả thông tin tối thiểu để render form.
 * KHÔNG trả token/response nội bộ; không login nhưng chỉ đọc được record
 * tương ứng token (random 32 bytes — không đoán được).
 */
export const getPublicByToken = async (token: string) => {
  const { row, ctx } = await loadByToken(token);

  const expired = row.expiresAt ? row.expiresAt < new Date() : false;

  return {
    refereeName: row.refereeName,
    candidateName: ctx?.candidateName ?? '(Ứng viên)',
    jobTitle: ctx?.jobTitle ?? '',
    relationship: row.relationship,
    company: row.company,
    status: row.status,
    expired,
    expiresAt: row.expiresAt,
  };
};

/**
 * Referee submit form confirm/decline.
 *
 * Validate (theo thứ tự):
 *   1. Token tồn tại → 404
 *   2. expiresAt < now → 410 (link hết hạn, HR phải gửi link mới)
 *   3. status đã 'verified'/'failed' → 409 (chặn verify 2 lần)
 *
 * confirmed=true → status='verified'; false → 'failed'. Cả 2 lưu
 * `response` {confirmed, notes} + `verifiedAt` để HR đọc.
 */
export const submitByToken = async (
  token: string,
  confirmed: boolean,
  notes?: string,
): Promise<{ status: string; verifiedAt: Date }> => {
  const { row, ctx } = await loadByToken(token);

  if (row.expiresAt && row.expiresAt < new Date()) {
    throw new AppError(410, 'LINK_EXPIRED', 'Link xác minh đã hết hạn');
  }
  if (row.status === 'verified' || row.status === 'failed') {
    throw new AppError(409, 'ALREADY_VERIFIED', 'Yêu cầu xác minh này đã được phản hồi');
  }

  const verifiedAt = new Date();
  await db
    .update(referenceVerifications)
    .set({
      status: confirmed ? 'verified' : 'failed',
      verifiedAt,
      response: { confirmed, notes: notes?.slice(0, 2000) },
    })
    .where(eq(referenceVerifications.id, row.id));

  // ---------------------------------------------------------------------------
  // Realtime push cho employer (best-effort — lỗi notify không ảnh hưởng
  // submit của referee, row đã update thành công trong DB).
  //   1. notificationService.create → insert bell (notification bell icon)
  //      + emit 'notification:new' (pattern chung của app).
  //   2. emitToUser 'reference:verified' → event riêng để ReferencesModal
  //      đang mở refresh list ngay mà không cần poll/reload.
  // ---------------------------------------------------------------------------
  try {
    if (ctx?.postedBy) {
      await notificationService.create({
        userId: ctx.postedBy,
        type: 'reference_verified',
        title: confirmed
          ? `${row.refereeName} đã XÁC NHẬN tham chiếu của ${ctx.candidateName ?? 'ứng viên'}`
          : `${row.refereeName} đã TỪ CHỐI xác nhận tham chiếu của ${ctx.candidateName ?? 'ứng viên'}`,
        payload: {
          applicationId: row.applicationId,
          referenceId: row.id,
          confirmed,
          refereeName: row.refereeName,
          refereeEmail: row.refereeEmail,
          jobTitle: ctx.jobTitle,
        },
      });

      notificationGateway.emitToUser(ctx.postedBy, 'reference:verified', {
        applicationId: row.applicationId,
        referenceId: row.id,
        status: confirmed ? 'verified' : 'failed',
        refereeName: row.refereeName,
        refereeEmail: row.refereeEmail,
        verifiedAt: verifiedAt.toISOString(),
      });
    }
  } catch (err) {
    logger.warn(
      { err, referenceId: row.id },
      'referenceVerify: notify employer thất bại (best-effort, submit OK)',
    );
  }

  logger.info(
    { referenceId: row.id, confirmed },
    'referenceVerify: referee đã phản hồi',
  );

  return { status: confirmed ? 'verified' : 'failed', verifiedAt };
};

export const referenceVerifyService = {
  listForApplication,
  sendVerification,
  getPublicByToken,
  submitByToken,
};
