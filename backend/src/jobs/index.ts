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
import { logger } from '../config/logger';
import { aiQueue } from '../config/queue';
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


  // Schedule periodic jobs
  // Interview reminder — mỗi 15 phút
  const reminderQueue = new Queue('ai', { connection: redis });
  reminderQueue.add(
    'interview-reminder',
    {},
    { repeat: { pattern: '*/15 * * * *' } },
  );

  logger.info('All BullMQ workers started (CV parse/score, scan, GitHub, test, interview reminder)');
};