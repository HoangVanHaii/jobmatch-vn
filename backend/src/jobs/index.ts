/**
 * Worker registry — start tất cả workers khi app boot
 */
import { cvParseWorker } from './cvParse.worker';
import { emailWorker } from './email.worker';
import { matchingWorker } from './matching.worker';
import { interviewReminderWorker } from './interviewReminder.worker';
import { jobModerationWorker } from './jobModeration.worker';
import { jobEmbeddingWorker } from './jobEmbedding.worker';
import { jobExpiryWorker, scheduleJobExpiry } from './jobExpiry.worker';
import { logger } from '../config/logger';
import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import { cvAnalysisWorker } from './cvAnalysis.worker';
import { exportWorker } from './export.worker';   

export const startWorkers = (): void => {
  void cvAnalysisWorker;
  void cvParseWorker;
  void emailWorker;
  void matchingWorker;
  void interviewReminderWorker;
  void jobModerationWorker;
  void jobEmbeddingWorker;
  void jobExpiryWorker;
  void exportWorker;


  // Schedule periodic jobs
  // Interview reminder — mỗi 15 phút
  const reminderQueue = new Queue('ai', { connection: redis });
  reminderQueue.add(
    'interview-reminder',
    {},
    { repeat: { pattern: '*/15 * * * *' } },
  );

  // Job expiry — mỗi ngày 0h (Asia/Ho_Chi_Minh) → live → expired khi quá deadline
  void scheduleJobExpiry();

  logger.info(
    'All BullMQ workers started (CV parse/score, scan, GitHub, test, interview reminder, job moderation, job embedding, job expiry)',
  );
};