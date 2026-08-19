/**
 * Worker registry — start tất cả workers khi app boot
 */
import { cvParseWorker } from './cvParse.worker';
import { cvScoreWorker } from './cvScore.worker';
import { emailWorker } from './email.worker';
import { matchingWorker } from './matching.worker';
import { cvScanWorker } from './cvScan.worker';
import { githubLookupWorker } from './githubLookup.worker';
import { interviewReminderWorker } from './interviewReminder.worker';
import { aiTestGenerateWorker } from './aiTestGenerate.worker';
import { jobModerationWorker } from './jobModeration.worker';
import { jobEmbeddingWorker } from './jobEmbedding.worker';
import { jobExpiryWorker, scheduleJobExpiry } from './jobExpiry.worker';
import { logger } from '../config/logger';
import { Queue } from 'bullmq';
import { redis } from '../config/redis';

export const startWorkers = (): void => {
  void cvParseWorker;
  void cvScoreWorker;
  void emailWorker;
  void matchingWorker;
  void cvScanWorker;
  void githubLookupWorker;
  void interviewReminderWorker;
  void aiTestGenerateWorker;
  void jobModerationWorker;
  void jobEmbeddingWorker;
  void jobExpiryWorker;


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