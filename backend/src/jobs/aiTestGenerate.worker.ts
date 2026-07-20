/**
 * AI Test Generate worker — Phase 3
 * Background generation cho test lớn
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { aiTestService } from '../service/aiTest.service';

export const aiTestGenerateWorker = new Worker(
  'ai',
  async (job) => {
    if (job.name === 'ai-test-generate') {
      const { jobId, type, level } = job.data as { jobId: string; type: 'iq' | 'english'; level?: string };
      logger.info({ jobId, type }, 'Worker: AI test generation started');
      return aiTestService.generate(jobId, type, level);
    }
  },
  { connection: redis, concurrency: 2 },
);

aiTestGenerateWorker.on('failed', (job, err) => logger.error({ jobId: job.id, err }, 'AI test generation failed'));