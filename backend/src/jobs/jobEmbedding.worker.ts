import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { db } from '../config/database';
import { jobs } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  buildJobEmbeddingText,
  upsertJobEmbedding,
} from '../lib/llm/jobEmbedding';

const QUEUE_NAME = 'jobEmbedding';

export const jobEmbeddingWorker = new Worker(QUEUE_NAME, async (job) => {
    if (job.name !== 'embed-job') return;
    const { jobId } = job.data as { jobId: string };

    const dbJob = await db.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
      columns: {
        id: true,
        title: true,
        description: true,
        requirements: true,
        requiredSkills: true,
        niceToHaveSkills: true,
        benefits: true,
        industry: true,
        location: true,
        status: true,
      },
    });
    if (!dbJob) {
      logger.warn({ jobId, bullJobId: job.id }, 'Embed worker: job không tồn tại, skip');
      return;
    }

    const text = buildJobEmbeddingText(dbJob);
    const result = await upsertJobEmbedding(jobId, text);

    if (result.skipped) {
      logger.info({ jobId, bullJobId: job.id }, 'Embed worker: text không đổi, skip');
    } else {
      logger.info(
        { jobId, bullJobId: job.id, status: dbJob.status, textLen: text.length },
        'Embed worker: embedded job',
      );
    }

    return result;
  },
  { connection: redis, concurrency: 10 }, // embedding calls rẻ + độc lập → chạy parallel
);

jobEmbeddingWorker.on('failed', (job, err) => {
  logger.error({ bullJobId: job?.id, err }, 'Job embedding worker failed');
});