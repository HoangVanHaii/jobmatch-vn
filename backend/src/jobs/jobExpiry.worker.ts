import { Worker, Queue } from 'bullmq';
import { redis } from '../config/redis';
import { db } from '../config/database';
import { jobs } from '../db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { logger } from '../config/logger';

const EXPIRY_CRON = '0 0 * * *'; // mỗi ngày 0h
const QUEUE_NAME = 'jobExpiry';

const expiryQueue = new Queue(QUEUE_NAME, { connection: redis });

/** Worker pick job từ queue + chạy logic expire. */
export const jobExpiryWorker = new Worker(QUEUE_NAME, async () => {
  const result = await db
    .update(jobs)
    .set({ status: 'expired' })
    .where(and(
      eq(jobs.status, 'live'),
      sql`${jobs.deadline} IS NOT NULL AND ${jobs.deadline} < NOW()`,
    ))
    .returning();

  logger.info({ count: result.length }, 'Expired jobs');
  return { expired: result.length };
}, { connection: redis });

jobExpiryWorker.on('failed', (job, err) => {
  logger.error({ bullJobId: job?.id, err }, 'Job expiry worker failed');
});

/** Schedule repeatable job — gọi 1 lần khi app boot.
 *  jobId cố định → BullMQ update thay vì duplicate nếu restart. */
export const scheduleJobExpiry = async (): Promise<void> => {
  await expiryQueue.add(
    'expire-stale-jobs',
    {},
    {
      repeat: {
        pattern: EXPIRY_CRON,
        tz: 'Asia/Ho_Chi_Minh',
      },
      jobId: 'daily-expiry',
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 10 },
    },
  );
  logger.info({ cron: EXPIRY_CRON, tz: 'Asia/Ho_Chi_Minh' }, 'Job expiry scheduled');
};