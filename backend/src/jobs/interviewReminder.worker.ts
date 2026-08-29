/**
 * Interview Reminder worker — Phase 3
 * Cron mỗi 15 phút, gửi reminder 24h/2h/15m trước
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { interviewService } from '../service/interview.service';

export const interviewReminderWorker = new Worker(
  'ai',
  async (job) => {
    if (job.name === 'interview-reminder') {
      logger.info('Worker: Interview reminder check started');
      // await interviewService.sendReminders();
    }
  },
  { connection: redis, concurrency: 1 },
);

interviewReminderWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Interview reminder failed'));