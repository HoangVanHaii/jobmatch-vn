/**
 * Interview Reminder Service
 * Quản lý lịch nhắc nhở phỏng vấn qua Delayed Jobs (BullMQ) & trigger n8n webhook
 */
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import {
  interviews,
  applications,
  jobs,
  companies,
  users,
  userProfiles,
} from '../db/schema';
import { interviewReminderQueue } from '../config/queue';
import { logger } from '../config/logger';
import { n8nService } from './n8n.service';
import { notificationService } from './notification.service';
import { notificationGateway } from '../socket/notificationGateway';
import {
  getInterviewTypeLabel,
  sendInterviewReminderFallbackEmail,
} from '../utils/interviewEmail';

export interface InterviewReminderJobData {
  interviewId: string;
  reminderType: '24h' | '2h' | '15m';
  expectedScheduledAt: string;
}

/**
 * Lên lịch các Delayed Jobs nhắc nhở phỏng vấn (24h, 2h, 15m)
 * Chỉ schedule cho các mốc thời gian trong tương lai
 */
export const scheduleInterviewReminders = async (
  interviewId: string,
  scheduledAt: Date,
): Promise<void> => {
  const now = Date.now();
  const scheduledTime = scheduledAt.getTime();

  // Mốc 1: Trước 24 giờ
  const target24h = scheduledTime - 24 * 60 * 60 * 1000;
  if (target24h > now) {
    const delay24h = target24h - now;
    await interviewReminderQueue.add(
      'interview-reminder',
      {
        interviewId,
        reminderType: '24h',
        expectedScheduledAt: scheduledAt.toISOString(),
      } satisfies InterviewReminderJobData,
      {
        jobId: `reminder-${interviewId}-24h`,
        delay: delay24h,
      },
    );
    logger.info(
      { interviewId, delayMs: delay24h, targetTime: new Date(target24h).toISOString() },
      'Scheduled 24h interview reminder delayed job',
    );
  }

  // Mốc 2: Trước 2 giờ
  const target2h = scheduledTime - 2 * 60 * 60 * 1000;
  if (target2h > now) {
    const delay2h = target2h - now;
    await interviewReminderQueue.add(
      'interview-reminder',
      {
        interviewId,
        reminderType: '2h',
        expectedScheduledAt: scheduledAt.toISOString(),
      } satisfies InterviewReminderJobData,
      {
        jobId: `reminder-${interviewId}-2h`,
        delay: delay2h,
      },
    );
    logger.info(
      { interviewId, delayMs: delay2h, targetTime: new Date(target2h).toISOString() },
      'Scheduled 2h interview reminder delayed job',
    );
  }

  // Mốc 3: Trước 15 phút
  const target15m = scheduledTime - 15 * 60 * 1000;
  if (target15m > now) {
    const delay15m = target15m - now;
    await interviewReminderQueue.add(
      'interview-reminder',
      {
        interviewId,
        reminderType: '15m',
        expectedScheduledAt: scheduledAt.toISOString(),
      } satisfies InterviewReminderJobData,
      {
        jobId: `reminder-${interviewId}-15m`,
        delay: delay15m,
      },
    );
    logger.info(
      { interviewId, delayMs: delay15m, targetTime: new Date(target15m).toISOString() },
      'Scheduled 15m interview reminder delayed job',
    );
  }
};

/**
 * Xóa bỏ các Delayed Jobs đang chờ trong queue khi lịch bị hủy hoặc dời giờ
 */
export const cancelInterviewReminders = async (interviewId: string): Promise<void> => {
  const types: Array<'24h' | '2h' | '15m'> = ['24h', '2h', '15m'];
  for (const t of types) {
    const jobId = `reminder-${interviewId}-${t}`;
    try {
      const job = await interviewReminderQueue.getJob(jobId);
      if (job) {
        await job.remove();
        logger.info({ interviewId, jobId }, 'Removed pending interview reminder delayed job');
      }
    } catch (err) {
      logger.debug({ err, jobId }, 'Reminder job could not be removed or already executed');
    }
  }
};

/**
 * Xử lý khi Delayed Job nổ đúng giờ hẹn:
 * - Lazy Check điều kiện trong DB (trạng thái, giờ giấc, cờ đã gửi)
 * - Bắn webhook n8n (fallback Nodemailer nếu n8n tắt)
 * - Cập nhật cờ DB & gửi in-app notification
 */
export const processInterviewReminder = async (
  interviewId: string,
  reminderType: '24h' | '2h' | '15m',
  expectedScheduledAt: string,
): Promise<void> => {
  // 1. Lấy thông tin chi tiết cuộc phỏng vấn
  const [row] = await db
    .select({
      interview: interviews,
      application: applications,
      job: jobs,
      company: companies,
      candidate: users,
      candidateProfile: userProfiles,
    })
    .from(interviews)
    .innerJoin(applications, eq(interviews.applicationId, applications.id))
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(companies, eq(jobs.companyId, companies.id))
    .innerJoin(users, eq(applications.candidateId, users.id))
    .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
    .where(eq(interviews.id, interviewId))
    .limit(1);

  if (!row) {
    logger.warn({ interviewId, reminderType }, 'Interview not found for reminder job');
    return;
  }

  // 2. Lazy check 1: Trạng thái cuộc phỏng vấn phải là 'confirmed'
  if (row.interview.status !== 'confirmed') {
    logger.info(
      { interviewId, status: row.interview.status, reminderType },
      'Skipping reminder: interview status is not confirmed',
    );
    return;
  }

  // 3. Lazy check 2: Giờ phỏng vấn phải khớp với giờ lúc lên lịch (tránh trường hợp đã đổi giờ mà job cũ chưa bị xóa)
  const currentScheduledTime = row.interview.scheduledAt.getTime();
  const expectedTime = new Date(expectedScheduledAt).getTime();
  if (Math.abs(currentScheduledTime - expectedTime) > 60000) {
    logger.info(
      { interviewId, current: row.interview.scheduledAt, expected: expectedScheduledAt },
      'Skipping reminder: interview scheduledAt has been modified',
    );
    return;
  }

  // 4. Lazy check 3: Cờ chống gửi trùng
  if (reminderType === '24h' && row.interview.reminder24hSent) {
    logger.info({ interviewId }, 'Skipping: 24h reminder already sent');
    return;
  }
  if (reminderType === '2h' && row.interview.reminder2hSent) {
    logger.info({ interviewId }, 'Skipping: 2h reminder already sent');
    return;
  }
  if (reminderType === '15m' && row.interview.reminder15mSent) {
    logger.info({ interviewId }, 'Skipping: 15m reminder already sent');
    return;
  }

  // 5. Lấy tên người phỏng vấn nếu có
  let interviewerName = row.company?.name || '';
  if (row.interview.interviewerId) {
    const [interviewer] = await db
      .select({ fullName: userProfiles.fullName })
      .from(userProfiles)
      .where(eq(userProfiles.userId, row.interview.interviewerId))
      .limit(1);
    if (interviewer?.fullName) {
      interviewerName = interviewer.fullName;
    }
  }

  const candidateName = row.candidateProfile?.fullName || 'Ứng viên';
  const typeLabel = getInterviewTypeLabel(row.interview.interviewType);
  const locationText =
    row.interview.location ||
    (row.interview.meetingLink ? 'Online (Google Meet)' : 'Tại văn phòng');

  // 6. Kích hoạt Webhook n8n (ưu tiên) hoặc Fallback sang Nodemailer
  try {
    await n8nService.trigger('interview_reminder', {
      interviewId: row.interview.id,
      reminderType,
      candidateEmail: row.candidate.email,
      candidateName,
      jobTitle: row.job.title,
      companyName: row.company?.name || 'Doanh nghiệp',
      interviewType: row.interview.interviewType,
      interviewTypeLabel: typeLabel,
      scheduledAt: row.interview.scheduledAt.toISOString(),
      durationMin: row.interview.durationMin || 60,
      location: locationText,
      meetingLink: row.interview.meetingLink || undefined,
      interviewerName,
    });
    logger.info({ interviewId, reminderType }, 'n8n trigger interview_reminder thành công');
  } catch (n8nErr) {
    logger.warn(
      { err: n8nErr, interviewId, reminderType },
      'n8n trigger interview_reminder không phản hồi, tự động fallback sang direct mailer',
    );
    await sendInterviewReminderFallbackEmail({
      candidateEmail: row.candidate.email,
      candidateName,
      jobTitle: row.job.title,
      companyName: row.company?.name || 'Doanh nghiệp',
      interviewType: row.interview.interviewType,
      scheduledAt: row.interview.scheduledAt,
      durationMin: row.interview.durationMin || 60,
      meetingLink: row.interview.meetingLink,
      location: locationText,
      interviewerName,
      reminderType,
    });
  }

  // 7. Cập nhật cờ đánh dấu đã gửi vào Database
  const updateFlag =
    reminderType === '24h'
      ? { reminder24hSent: true }
      : reminderType === '2h'
        ? { reminder2hSent: true }
        : { reminder15mSent: true };

  await db.update(interviews).set(updateFlag).where(eq(interviews.id, interviewId));

  // 8. Đẩy thông báo In-app cho ứng viên & phát sự kiện Socket
  const timeDesc =
    reminderType === '24h'
      ? 'ngày mai'
      : reminderType === '2h'
        ? 'sau 2 giờ nữa'
        : 'trong 15 phút tới';

  void notificationService.create({
    userId: row.candidate.id,
    type: 'interview_updated',
    title: `Nhắc lịch: Phỏng vấn ${timeDesc}`,
    message: `Buổi phỏng vấn vị trí ${row.job.title} tại ${row.company?.name || 'Doanh nghiệp'} sẽ diễn ra ${timeDesc}. Hãy chuẩn bị sẵn sàng nhé!`,
    payload: {
      kind: 'interview_reminder',
      interviewId: row.interview.id,
      reminderType,
      scheduledAt: row.interview.scheduledAt.toISOString(),
      meetingLink: row.interview.meetingLink ?? undefined,
    },
  });

  notificationGateway.emitToUser(row.candidate.id, 'interview:reminder', {
    interviewId: row.interview.id,
    reminderType,
    scheduledAt: row.interview.scheduledAt.toISOString(),
  });
};

