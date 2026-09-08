import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { db } from '../config/database';
import { applications, jobs } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  CV_MATCH_SYSTEM_PROMPT,
  buildCvMatchUserPrompt,
} from '../prompts/chatbot/cvMatch';
import { invokeCvMatch } from '../lib/llm/cvMatch';
import { isRateLimited, waitForRateLimit } from '../lib/llm/errors';
import { usageLogService } from '../service/usageLog.service';
import { notificationService } from '../service/notification.service';
import { notificationGateway } from '../socket/notificationGateway';

const QUEUE_NAME = 'cvMatch';
const AI_CV_MATCH_FEATURE = 'ai_cv_match';

export const cvMatchWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    // Job name phải khớp với queue.add('cv-match', ...) ở application.service.
    if (job.name !== 'cv-match') return;

    const { applicationId, jobId } = job.data as {
      applicationId: string;
      jobId: string;
    };

    const [app] = await db
      .select({
        id: applications.id,
        candidateId: applications.candidateId,
        cv: applications.cv,
      })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .limit(1);

    if (!app) {
      logger.warn({ applicationId, bullJobId: job.id }, 'cvMatch worker: application không tồn tại, skip');
      return;
    }

    const [dbJob] = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        requiredSkills: jobs.requiredSkills,
        niceToHaveSkills: jobs.niceToHaveSkills,
        requirements: jobs.requirements,
        experienceYearsMin: jobs.experienceYearsMin,
        jobLevel: jobs.jobLevel,
        jobType: jobs.jobType,
        industry: jobs.industry,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!dbJob) {
      logger.warn({ jobId, applicationId, bullJobId: job.id }, 'cvMatch worker: job không tồn tại, skip');
      return;
    }

    // Nếu CV không có (candidate apply không kèm CV) → skip matching, không có gì để chấm.
    if (!app.cv?.parsedData) {
      logger.info({ applicationId, bullJobId: job.id }, 'cvMatch worker: application không có CV snapshot, skip');
      return;
    }

    // -----------------------------------------------------------------------
    // 2. Quota check (chỉ reserve ở attempt đầu, retry không double-count)
    // -----------------------------------------------------------------------
    const reservedThisAttempt = job.attemptsMade === 0;
    if (reservedThisAttempt) {
      const reserved = await usageLogService.createOrIncrementUsage(
        app.candidateId,
        AI_CV_MATCH_FEATURE,
      );
            if (!reserved) {
              // Hết quota → update application với reason='quota_exceeded' để FE
              // nhận biết đây là trạng thái TERMINAL (không phải "đang chấm").
              // Không touch aiMatchScore (vẫn NULL). Lý do phải persist reason:
              // FE chỉ check `aiMatchScore IS NULL` thì sẽ render spinner mãi.
              logger.warn(
                { applicationId, candidateId: app.candidateId },
                'cvMatch worker: hết quota ai_cv_match, skip LLM',
              );

              await db
                .update(applications)
                .set({
                  aiMatchReasoning: { reason: 'quota_exceeded' },
                  updatedAt: new Date(),
                })
                .where(eq(applications.id, applicationId));

              // Notify candidate: biết "matching skipped" — bell + realtime.
              await notifyCandidateOfMatchResult({
                candidateId: app.candidateId,
                applicationId,
                jobId,
                jobTitle: dbJob.title,
                reason: 'quota_exceeded',
                matchPercent: null,
                rationale: null,
              });

              // Emit socket với reason để FE patch row realtime (không phải chờ refetch).
              notificationGateway.emitToUser(app.candidateId, 'application:match-ready', {
                applicationId,
                jobId,
                reason: 'quota_exceeded',
                matchPercent: null,
                rationale: null,
              });
              // Legacy event giữ backward-compat với listener cũ.
              notificationGateway.emitToUser(app.candidateId, 'application:match-skipped', {
                applicationId,
                jobId,
                reason: 'quota_exceeded',
              });
              return;
            }
    }

    // -----------------------------------------------------------------------
    // 3. Gọi LLM
    // -----------------------------------------------------------------------
    try {
      const result = await invokeCvMatch(
        CV_MATCH_SYSTEM_PROMPT,
        buildCvMatchUserPrompt({
          cvTitle: app.cv.title ?? '(không đặt tên)',
          cvParsedData: app.cv.parsedData,
          jobTitle: dbJob.title,
          jobRequiredSkills: dbJob.requiredSkills ?? [],
          jobNiceToHaveSkills: dbJob.niceToHaveSkills ?? [],
          jobRequirements: dbJob.requirements,
          jobExperienceYearsMin: dbJob.experienceYearsMin,
          jobLevel: dbJob.jobLevel,
          jobType: dbJob.jobType,
          jobIndustry: dbJob.industry,
        }),
      );

      const tokenUsed = result.usage.totalTokens ?? 0;

      // ---------------------------------------------------------------------
      // 4. Update applications: matchPercent + reasoning jsonb
      // ---------------------------------------------------------------------
      // Tách matchPercent ra numeric (dễ sort/filter) — 5 field còn lại vào jsonb.
      // Drizzle numeric column yêu cầu string (pg driver không nhận number trực tiếp
      // cho high-precision numeric). Match percent từ LLM có 1-2 chữ số thập phân.
      await db
        .update(applications)
        .set({
          aiMatchScore: String(result.data.matchPercent),
          aiMatchReasoning: {
            // Persist reason='success' để list query extract `->>'reason'` thấy
            // 'success' thay vì NULL → FE biết row đã match xong (kèm score).
            reason: 'success',
            strengths: result.data.strengths,
            concerns: result.data.concerns ?? [],
            matchedSkills: result.data.matchedSkills ?? [],
            missingSkills: result.data.missingSkills ?? [],
            rationale: result.data.rationale,
          },
          updatedAt: new Date(),
        })
        .where(eq(applications.id, applicationId));

      // Track token cost.
      if (tokenUsed > 0) {
        await usageLogService.insertOrIncrementToken(
          app.candidateId,
          AI_CV_MATCH_FEATURE,
          tokenUsed,
        );
      }

      logger.info(
        {
          applicationId,
          jobId,
          matchPercent: result.data.matchPercent,
          matchedSkills: result.data.matchedSkills.length,
          missingSkills: result.data.missingSkills.length,
          tokens: tokenUsed,
        },
        'cvMatch worker: chấm điểm xong',
      );

      // ---------------------------------------------------------------------
      // 5. Realtime push tới candidate — notification (DB + bell) + socket
      // ---------------------------------------------------------------------
      await notifyCandidateOfMatchResult({
        candidateId: app.candidateId,
        applicationId,
        jobId,
        jobTitle: dbJob.title,
        reason: 'success',
        matchPercent: result.data.matchPercent,
        rationale: result.data.rationale,
      });

      notificationGateway.emitToUser(app.candidateId, 'application:match-ready', {
        applicationId,
        jobId,
        reason: 'success',
        matchPercent: result.data.matchPercent,
        rationale: result.data.rationale,
      });

      return result.data;
    } catch (err) {
      // 429: chờ + throw để BullMQ retry (queue config đã set attempts:3).
      if (isRateLimited(err)) {
        logger.warn(
          { applicationId, attempt: job.attemptsMade + 1 },
          'cvMatch worker: 429 rate limit, waiting',
        );
        await waitForRateLimit();
        logger.warn({ applicationId }, 'cvMatch worker: rate limit wait done — rethrowing for retry');
        throw err;
      }

      // Lỗi khác (network, parse, invalid shape):
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 3;
      const isLastAttempt = attempt >= maxAttempts;

      logger.error(
        { applicationId, attempt, maxAttempts, isLastAttempt, err },
        'cvMatch worker: attempt failed',
      );

      // Chỉ rollback quota ở attempt cuối (đã hết retry). Attempt trước giữ quota
      // để attempt sau không bị double-reserve.
      if (isLastAttempt) {
        await usageLogService.decrementCount(app.candidateId, AI_CV_MATCH_FEATURE);

        // Persist reason='failed' vào DB để FE hiển thị badge terminal thay
        // vì spinner vô hạn sau khi reload. Mirror pattern của quota path.
        await db
          .update(applications)
          .set({
            aiMatchReasoning: { reason: 'failed' },
            updatedAt: new Date(),
          })
          .where(eq(applications.id, applicationId));

        // Notify candidate về lỗi (chỉ ở attempt cuối, retry đầu không notify
        // để tránh báo 2 lần nếu attempt sau thành công).
        await notifyCandidateOfMatchResult({
          candidateId: app.candidateId,
          applicationId,
          jobId,
          jobTitle: dbJob.title,
          reason: 'failed',
          matchPercent: null,
          rationale: null,
        });

        // Realtime push để FE patch row ngay (không cần đợi refetch).
        notificationGateway.emitToUser(app.candidateId, 'application:match-ready', {
          applicationId,
          jobId,
          reason: 'failed',
          matchPercent: null,
          rationale: null,
        });
      }

      throw err; // BullMQ sẽ retry hoặc mark failed nếu đã hết attempts.
    }
  },
  { connection: redis, concurrency: 2 },  // LLM calls expensive → low concurrency
);

cvMatchWorker.on('failed', (job, err) => {
  logger.error(
    { applicationId: (job?.data as { applicationId?: string })?.applicationId, err },
    'cvMatch worker: job failed (final)',
  );
});

cvMatchWorker.on('completed', (job) => {
  logger.info(
    { applicationId: (job.data as { applicationId: string }).applicationId },
    'cvMatch worker: job completed',
  );
});

/**
 * Best-effort: tạo notification `application_match_ready` cho candidate + emit socket.
 *
 * KHÔNG throw để tránh break worker. Lỗi notification KHÔNG rollback matching
 * (điểm + reasoning đã update DB thành công).
 *
 * Payload gửi FE:
 *   - applicationId: để navigate tới detail hoặc re-fetch
 *   - jobId, jobTitle: hiển thị context ("Job Senior Frontend Developer")
 *   - reason: 'success' | 'quota_exceeded' | 'failed' — để FE render UI phù hợp:
 *       - success: show matchPercent + rationale (xanh)
 *       - quota_exceeded: show "Đã apply thành công, không có AI match (hết quota)"
 *       - failed: show "Matching thất bại, thử lại sau"
 *   - matchPercent, rationale: null nếu không phải success
 */
const notifyCandidateOfMatchResult = async (params: {
  candidateId: string;
  applicationId: string;
  jobId: string;
  jobTitle: string;
  reason: 'success' | 'quota_exceeded' | 'failed';
  matchPercent: number | null;
  rationale: string | null;
}): Promise<void> => {
  const { candidateId, applicationId, jobId, jobTitle, reason, matchPercent, rationale } = params;

  try {
    const titleMap: Record<typeof reason, string> = {
      success: `AI chấm ${matchPercent}% match cho ${jobTitle}`,
      quota_exceeded: `Đã nộp hồ sơ cho ${jobTitle} — AI match tạm thời không khả dụng`,
      failed: `AI match cho ${jobTitle} thất bại, thử lại sau`,
    };

    await notificationService.create({
      userId: candidateId,
      type: 'application_match_ready',
      title: titleMap[reason],
      payload: {
        applicationId,
        jobId,
        jobTitle,
        reason,
        matchPercent,
        rationale,
      },
    });
  } catch (err) {
    // Matching đã chạy xong — notification chỉ là UX. Log warn, không throw.
    logger.warn(
      { err, applicationId, candidateId, reason },
      'notifyCandidateOfMatchResult: lỗi (best-effort, match data OK)',
    );
  }
};
