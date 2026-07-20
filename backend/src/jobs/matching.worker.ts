/**
 * BullMQ worker — AI matching (re-rank top candidates cho 1 job)
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { db } from '../config/database';
import { jobs, applications } from '../db/schema';
import { eq } from 'drizzle-orm';
import { embedWithCache } from '../ai/embeddings';
import { db as database } from '../config/database';

export const matchingWorker = new Worker(
  'ai',
  async (job) => {
    if (job.name !== 'match-compute') return;
    const { jobId } = job.data as { jobId: string };
    logger.info({ jobId }, 'Computing matches...');

    // TODO:
    // 1. Lấy job description
    // 2. Embed thành vector
    // 3. Query pgvector top-K candidates
    // 4. LLM re-rank
    // 5. Lưu vào applications.ai_match_score + ai_match_reasoning
  },
  { connection: redis, concurrency: 2 },
);

matchingWorker.on('failed', (job, err) => logger.error({ jobId: job.id, err }, 'Matching failed'));