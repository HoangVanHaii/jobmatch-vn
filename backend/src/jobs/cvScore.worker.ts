/**
 * BullMQ worker — CV scoring (chạy sau cv-parse)
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { db } from '../config/database';
import { cvs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { generationProvider } from '../config/ai';
import { CV_SCORE_SYSTEM_PROMPT, CV_SCORE_USER_PROMPT } from '../ai/prompts/cv_score.v1';

export const cvScoreWorker = new Worker(
  'ai',
  async (job) => {
    if (job.name !== 'cv-score') return;
    const { cvId } = job.data as { cvId: string };
    logger.info({ cvId }, 'Scoring CV...');

    const cv = await db.query.cvs.findFirst({ where: eq(cvs.id, cvId) });
    if (!cv?.parsedData) throw new Error('CV not parsed yet');

    const result = await generationProvider.chat(
      [{ role: 'system', content: CV_SCORE_SYSTEM_PROMPT }, { role: 'user', content: CV_SCORE_USER_PROMPT(JSON.stringify(cv.parsedData)) }],
      { temperature: 0.3 },
    );

    const score = JSON.parse(result.content);
    await db.update(cvs).set({ aiScore: score, scoreUpdatedAt: new Date() }).where(eq(cvs.id, cvId));

    logger.info({ cvId, total: score.total }, 'CV scored');
    return score;
  },
  { connection: redis, concurrency: 2 },
);

cvScoreWorker.on('failed', (job, err) => logger.error({ jobId: job.id, err }, 'CV score failed'));