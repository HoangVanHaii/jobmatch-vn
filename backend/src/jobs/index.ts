/**
 * Worker registry — start tất cả workers khi app boot
 */
import { cvParseWorker } from './cvParse.worker';
// import { emailWorker } from './email.worker';
// import { matchingWorker } from './matching.worker';
import { interviewReminderWorker } from './interviewReminder.worker';
import { jobModerationWorker } from './jobModeration.worker';
import { jobEmbeddingWorker } from './jobEmbedding.worker';
import { jobExpiryWorker, scheduleJobExpiry } from './jobExpiry.worker';
import { logger } from '../config/logger';
import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import { cvAnalysisWorker } from './cvAnalysis.worker';
import { cvMatchWorker } from './cvMatch.worker';
import { aiTestGenerateWorker } from './aiTestGenerate.worker';
import { exportWorker } from './export.worker';
import { paymentReconciliationWorker } from './paymentReconciliation.worker';
import { paymentReconcileQueue } from '../config/queue';

export const startWorkers = (): void => {
  void cvAnalysisWorker;
  void cvParseWorker;
  // void emailWorker;
  // void matchingWorker;
  void cvMatchWorker;
  void aiTestGenerateWorker;
  void interviewReminderWorker;
  void jobModerationWorker;
  void jobEmbeddingWorker;
  void jobExpiryWorker;
  void exportWorker;
  void paymentReconciliationWorker;


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

  // Payment reconciliation — mỗi 10 phút, đối chiếu payment 'pending' với PayOS
  // (fix HIGH #1). DRY_RUN mặc định: env PAYMENT_RECONCILE_DRY_RUN (default 'true').
  paymentReconcileQueue.add(
    'payment-reconcile',
    {},
    { repeat: { pattern: '*/10 * * * *' } },
  );

  logger.info(
    'All BullMQ workers started (CV parse/score, scan, GitHub, test, cv-match, interview reminder, job moderation, job embedding, job expiry)',
  );
};