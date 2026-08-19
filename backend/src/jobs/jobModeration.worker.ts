import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { db } from '../config/database';
import { jobs, jobAiScans, jobAiFlags } from '../db/schema';
import { eq } from 'drizzle-orm';
import { invokeJobModeration } from '../lib/llm';
import { JOB_MODERATION_SYSTEM_PROMPT, buildJobModerationUserPrompt } from '../prompts/jobModeration';
import { notificationGateway } from '../socket/notificationGateway';
import { jobEmbeddingQueue } from '../config/queue';

export const jobModerationWorker = new Worker('jobModeration', async (job) => {
    if (job.name !== 'job-scan') return;
    const { jobId } = job.data as { jobId: string };

    const dbJob = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!dbJob) {
      logger.warn({ jobId, bullJobId: job.id }, 'Worker: job không tồn tại, skip');
      return;
    }
    if (dbJob.status !== 'ai_scanning') {
      logger.warn({ jobId, status: dbJob.status }, 'Worker: job không ở ai_scanning, skip');
      return;
    }

    logger.info({ jobId, bullJobId: job.id }, 'Worker: bắt đầu scan job');

    // Gọi Gemini qua LangChain (auto-trace sang LangSmith)
    const result = await invokeJobModeration(
      JOB_MODERATION_SYSTEM_PROMPT,
      buildJobModerationUserPrompt(dbJob),
    );

    // Lưu scan + flags + cập nhật status (transactional)
    await db.transaction(async (tx) => {
      const [scan] = await tx.insert(jobAiScans).values({
        jobId,
        verdict: result.verdict,
        score: String(result.score),
        model: 'gemini-2.5-flash',
        rawResponse: result as unknown as Record<string, unknown>,
        scannedBy: 'system',
      }).returning();

      if (result.flags.length) {
        await tx.insert(jobAiFlags).values(
          result.flags.map(f => ({
            scanId: scan.id,
            severity: f.severity,
            category: f.category,
            field: f.field,
            quote: f.quote,
            reasoning: f.reasoning,
            suggestion: f.suggestion ?? null,
            lawRef: f.lawRef ?? null,
          }))
        );
      }

      const newStatus = result.verdict === 'approved' ? 'live' : 'ai_flagged';
      await tx.update(jobs).set({ status: newStatus }).where(eq(jobs.id, jobId));
    });
    await jobEmbeddingQueue.add('embed-job', { jobId });

    logger.info(
      { jobId, verdict: result.verdict, flagsCount: result.flags.length, score: result.score },
      'Worker: scan xong',
    );

    // Realtime push tới employer (socket room: user:${postedBy})
    notificationGateway.emitToUser(dbJob.postedBy, 'job_scan_complete', {
      jobId,
      verdict: result.verdict,
      score: result.score,
      flaggedCount: result.flags.length,
    });
  },
  { connection: redis, concurrency: 5 },
);

jobModerationWorker.on('failed', (job, err) => {
  logger.error({ bullJobId: job?.id, err }, 'Job moderation worker failed');
});
