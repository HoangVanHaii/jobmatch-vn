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
import { usageLogService } from '../service/usageLog.service';

const JOB_POST_FEATURE = 'job_post';

/**
 * Hoàn 1 lượt `job_post` khi job early-exit TRƯỚC khi LLM chạy.
 *
 * CHỈ hoàn khi `chargeQuota !== false` — forceScan admin bypass quota
 * (không reserve) nên không được hoàn oan lượt chưa tiêu. Default `!== false`
 * để job cũ pre-deploy (payload không có flag) giữ behavior cũ.
 *
 * `postedBy` lấy từ job payload — job cũ pre-deploy (payload thiếu field)
 * sẽ warn + skip refund.
 */
const refundModerationQuota = async (
    postedBy: string | undefined,
    chargeQuota: boolean,
    why: string,
): Promise<void> => {
    if (!chargeQuota) return;
    if (!postedBy) {
        logger.warn(
            { why },
            'Worker: refund skipped — payload thiếu postedBy (job cũ pre-deploy)',
        );
        return;
    }
    await usageLogService.decrementCount(postedBy, JOB_POST_FEATURE);
};

export const jobModerationWorker = new Worker('jobModeration', async (job) => {
    if (job.name !== 'job-scan') return;
    // `postedBy` + `chargeQuota` từ payload (enqueue site thêm từ refactor
    // reserve-tại-service). Job cũ pre-deploy thiếu field → refund tự skip;
    // chargeQuota undefined coi như `true` (giữ behavior cũ).
    const { jobId, postedBy, chargeQuota: chargeQuotaRaw } = job.data as {
        jobId: string;
        postedBy?: string;
        chargeQuota?: boolean;
    };
    const chargeQuota = chargeQuotaRaw !== false;

    const dbJob = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!dbJob) {
      logger.warn({ jobId, bullJobId: job.id }, 'Worker: job không tồn tại, skip');
      await refundModerationQuota(postedBy, chargeQuota, 'job deleted after enqueue');
      return;
    }
    if (dbJob.status !== 'ai_scanning') {
      logger.warn({ jobId, status: dbJob.status }, 'Worker: jobstatus khác ai_scanning, skip');
      await refundModerationQuota(dbJob.postedBy, chargeQuota, 'status guard skip (duplicate/processed job)');
      return;
    }

    logger.info({ jobId, bullJobId: job.id }, 'Worker: bắt đầu scan job');

    // QUOTA: đã được service reserve (reserveQuota) TRƯỚC khi enqueue với
    // luồng submit thường; forceScan admin bypass (chargeQuota=false). Worker
    // KHÔNG reserve/check nữa. Lỗi LLM → catch cuối vẫn decrement (nếu charge).

    try {
      // Gọi Gemini qua LangChain (auto-trace sang LangSmith)
      const result = await invokeJobModeration(
        JOB_MODERATION_SYSTEM_PROMPT,
        buildJobModerationUserPrompt(dbJob),
      );

      // Ghi nhận token thực tế sau LLM success.
      const tokenUsed = result.usage.totalTokens ?? 0;
      if (tokenUsed > 0) {
        await usageLogService.insertOrIncrementToken(
          dbJob.postedBy,
          JOB_POST_FEATURE,
          tokenUsed,
        );
      }

      // Lưu scan + flags + cập nhật status (transactional)
      await db.transaction(async (tx) => {
        const [scan] = await tx.insert(jobAiScans).values({
          jobId,
          verdict: result.data.verdict,
          score: String(result.data.score),
          model: 'gemini-2.5-flash',
          rawResponse: result.data as unknown as Record<string, unknown>,
          scannedBy: 'system',
        }).returning();

        if (result.data.flags.length) {
          await tx.insert(jobAiFlags).values(
            result.data.flags.map(f => ({
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

        const newStatus = result.data.verdict === 'approved' ? 'live' : 'ai_flagged';
        await tx.update(jobs).set({ status: newStatus }).where(eq(jobs.id, jobId));
      });
      await jobEmbeddingQueue.add('embed-job', { jobId });

      logger.info(
        { jobId, verdict: result.data.verdict, flagsCount: result.data.flags.length, score: result.data.score, tokens: tokenUsed },
        'Worker: scan xong',
      );

      // Realtime push tới employer (socket room: user:${postedBy})
      notificationGateway.emitToUser(dbJob.postedBy, 'job_scan_complete', {
        jobId,
        verdict: result.data.verdict,
        score: result.data.score,
        flaggedCount: result.data.flags.length,
      });
    } catch (err) {
      // Rollback quota ở attempt cuối (đã hết retry).
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 3;
      const isLastAttempt = attempt >= maxAttempts;

      logger.error(
        { jobId, attempt, maxAttempts, isLastAttempt, err },
        'Worker: scan attempt failed',
      );

      if (isLastAttempt) {
        await refundModerationQuota(dbJob.postedBy, chargeQuota, 'LLM failed, last attempt');
      }
      throw err;
    }
  },
  { connection: redis, concurrency: 5 },
);

jobModerationWorker.on('failed', (job, err) => {
  logger.error({ bullJobId: job?.id, err }, 'Job moderation worker failed');
});
