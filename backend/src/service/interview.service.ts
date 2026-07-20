/**
 * Interview Scheduling service — Phase 3
 */
import crypto from 'crypto';
import { db } from '../config/database';
import { interviews, interviewerAvailability, applications } from '../db/schema';
import { eq, and, between, gte, lte, ne } from 'drizzle-orm';
import { logger } from '../config/logger';
import { n8nService } from './n8n.service';

const REMINDER_THRESHOLDS = [
  { hours: 24, field: 'reminder24hSent' as const },
  { hours: 2, field: 'reminder2hSent' as const },
  { hours: 0.25, field: 'reminder15mSent' as const },
];

export const interviewService = {
  /**
   * Tạo interview slot + gửi email confirm
   */
  create: async (data: {
    applicationId: string;
    interviewerId: string;
    scheduledAt: Date;
    durationMin?: number;
    location?: string;
    meetingLink?: string;
  }): Promise<{ id: string; confirmationToken: string }> => {
    // Check conflict
    const startWindow = new Date(data.scheduledAt.getTime() - (data.durationMin ?? 60) * 60 * 1000);
    const endWindow = new Date(data.scheduledAt.getTime() + (data.durationMin ?? 60) * 60 * 1000);

    const conflict = await db.query.interviews.findFirst({
      where: and(
        eq(interviews.interviewerId, data.interviewerId),
        ne(interviews.status, 'cancelled'),
        between(interviews.scheduledAt, startWindow, endWindow),
      ),
    });
    if (conflict) throw new Error('Interviewer has conflicting slot');

    const confirmationToken = crypto.randomBytes(32).toString('hex');

    const [interview] = await db.insert(interviews).values({
      applicationId: data.applicationId,
      interviewerId: data.interviewerId,
      scheduledAt: data.scheduledAt,
      durationMin: data.durationMin ?? 60,
      location: data.location,
      meetingLink: data.meetingLink,
      status: 'pending',
      confirmationToken,
    }).returning();

    // Update application stage
    await db.update(applications).set({
      stage: 'interview',
      interviewStatus: 'pending',
    }).where(eq(applications.id, data.applicationId));

    // Gửi email cho ứng viên qua n8n
    await n8nService.trigger('interview_invite', {
      interviewId: interview.id,
      applicationId: data.applicationId,
      confirmationUrl: `${process.env.FRONTEND_URL}/interview/confirm?token=${confirmationToken}`,
    });

    logger.info({ interviewId: interview.id, scheduledAt: data.scheduledAt }, 'Interview created');
    return { id: interview.id, confirmationToken };
  },

  /**
   * Ứng viên xác nhận
   */
  confirm: async (token: string, action: 'confirm' | 'reschedule' | 'cancel'): Promise<void> => {
    const interview = await db.query.interviews.findFirst({
      where: eq(interviews.confirmationToken, token),
    });
    if (!interview) throw new Error('Invalid token');

    if (action === 'confirm') {
      await db.update(interviews).set({
        status: 'confirmed',
        confirmedAt: new Date(),
      }).where(eq(interviews.id, interview.id));
      await db.update(applications).set({ interviewStatus: 'confirmed' }).where(eq(applications.id, interview.applicationId));
      await n8nService.trigger('interview_confirmed', { interviewId: interview.id, action: 'confirm' });
    } else if (action === 'cancel') {
      await db.update(interviews).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(interviews.id, interview.id));
      await db.update(applications).set({ interviewStatus: 'cancelled' }).where(eq(applications.id, interview.applicationId));
      await n8nService.trigger('interview_cancelled', { interviewId: interview.id });
    }
    // reschedule: mở lại form chọn slot mới
  },

  /**
   * Background job: gửi reminder 24h/2h/15m trước
   * Chạy bởi BullMQ worker mỗi 15 phút
   */
  sendReminders: async (): Promise<void> => {
    const now = new Date();
    for (const { hours, field } of REMINDER_THRESHOLDS) {
      const targetTime = new Date(now.getTime() + hours * 3600 * 1000);
      const windowStart = new Date(targetTime.getTime() - 10 * 60 * 1000);
      const windowEnd = new Date(targetTime.getTime() + 10 * 60 * 1000);

      const due = await db.query.interviews.findMany({
        where: and(
          eq(interviews.status, 'confirmed'),
          eq(field, false),
          between(interviews.scheduledAt, windowStart, windowEnd),
        ),
      });

      for (const i of due) {
        await n8nService.trigger('interview_reminder', { interviewId: i.id, hoursBefore: hours });
        await db.update(interviews).set({ [field]: true }).where(eq(interviews.id, i.id));
        logger.info({ interviewId: i.id, hours }, 'Interview reminder sent');
      }
    }
  },

  /**
   * Interviewer nộp feedback
   */
  submitFeedback: async (interviewId: string, feedback: {
    scores: Record<string, number>;
    comments: string;
    recommendation: 'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire';
  }): Promise<void> => {
    await db.update(interviews).set({
      feedback: feedback as any,
      feedbackSubmittedAt: new Date(),
      status: 'completed',
    }).where(eq(interviews.id, interviewId));

    // Cập nhật application stage
    const interview = await db.query.interviews.findFirst({ where: eq(interviews.id, interviewId) });
    if (interview) {
      const newStage = ['strong_hire', 'hire'].includes(feedback.recommendation) ? 'offer' : 'rejected';
      await db.update(applications).set({ stage: newStage }).where(eq(applications.id, interview.applicationId));
    }
  },
};