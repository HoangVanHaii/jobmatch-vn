/**
 * Interview Reminder Worker
 * Lắng nghe các Delayed Jobs từ `interviewReminder` queue và thực thi gửi thông báo nhắc lịch
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import {
  processInterviewReminder,
  type InterviewReminderJobData,
} from '../service/interviewReminder.service';

export const interviewReminderWorker = new Worker<InterviewReminderJobData>(
  'interviewReminder',
  async (job) => {
    logger.info(
      { jobId: job.id, interviewId: job.data.interviewId, reminderType: job.data.reminderType },
      'Interview reminder delayed job fired',
    );

    const { interviewId, reminderType, expectedScheduledAt } = job.data;
    if (!interviewId || !reminderType) {
      logger.warn({ jobId: job.id, data: job.data }, 'Invalid interview reminder job data, skipping');
      return;
    }

    await processInterviewReminder(interviewId, reminderType, expectedScheduledAt);
  },
  { connection: redis, concurrency: 5 },
);

interviewReminderWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Interview reminder delayed job failed');
});

interviewReminderWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Interview reminder delayed job completed successfully');
});
