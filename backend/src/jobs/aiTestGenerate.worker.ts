/**
 * aiTestGenerate.worker — sinh đề test (IQ/English) bằng Gemini trong nền.
 *
 * Flow: aiTest.service.generateOrReuse insert row `status='generating'` +
 * enqueue job này → worker gọi LLM → persist questions + `status='ready'`.
 * Lỗi sau attempts cuối → `status='failed'` (employer thấy nút thử lại).
 *
 * Pattern mirror cvMatch.worker: rate-limit 429 → wait + rethrow để BullMQ
 * retry; attempts từ queue config.
 */
import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { aiTests } from '../db/schema';
import { notificationGateway } from '../socket/notificationGateway';
import { isRateLimited, waitForRateLimit } from '../lib/llm/errors';
import { invokeAiTestGenerate } from '../lib/llm/aiTestGenerate';
import {
  AI_TEST_GENERATE_SYSTEM_PROMPT,
  buildAiTestGenerateUserPrompt,
} from '../prompts/aiTestGenerate';

const QUEUE_NAME = 'aiTestGenerate';

export interface AiTestGenerateJobData {
  testId: string;
  /** Employer yêu cầu sinh — nhận socket 'ai-test:ready' khi đề xong. */
  employerId: string;
  testType: 'iq' | 'english';
  level: string;
  questionCount: number;
  pointsPerQuestion: number;
  durationMin: number;
  jobTitle: string;
  jobRequirements?: string | null;
}

export const aiTestGenerateWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name !== 'ai-test-generate') return;

    const data = job.data as AiTestGenerateJobData;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 3;

    logger.info(
      { testId: data.testId, testType: data.testType, attempt, maxAttempts },
      'aiTestGenerate worker: bắt đầu sinh đề',
    );

    try {
      const { data: result } = await invokeAiTestGenerate(
        AI_TEST_GENERATE_SYSTEM_PROMPT,
        buildAiTestGenerateUserPrompt({
          testType: data.testType,
          level: data.level,
          questionCount: data.questionCount,
          pointsPerQuestion: data.pointsPerQuestion,
          durationMin: data.durationMin,
          jobTitle: data.jobTitle,
          jobRequirements: data.jobRequirements,
        }),
      );

      // Sanitize: tổng points thực tế từ questions (LLM đôi khi lệch số học).
      const totalPoints = result.questions.reduce((sum, q) => sum + (q.points ?? 0), 0);

      await db
        .update(aiTests)
        .set({
          questions: result.questions,
          totalPoints: totalPoints > 0 ? totalPoints : result.totalPoints,
          durationMin: result.durationMin,
          status: 'ready',
        })
        .where(eq(aiTests.id, data.testId));

      // Báo employer đề xong — FE tắt spinner "Đang tạo đề…" + tự mở review.
      notificationGateway.emitToUser(data.employerId, 'ai-test:ready', {
        testId: data.testId,
        testType: data.testType,
      });

      logger.info(
        { testId: data.testId, questions: result.questions.length, totalPoints },
        'aiTestGenerate worker: sinh đề xong → ready',
      );
      return result;
    } catch (err) {
      if (isRateLimited(err)) {
        logger.warn({ testId: data.testId, attempt }, 'aiTestGenerate worker: 429 rate limit, waiting');
        await waitForRateLimit();
        throw err; // BullMQ retry
      }

      const isLastAttempt = attempt >= maxAttempts;
      logger.error(
        { err, testId: data.testId, attempt, isLastAttempt },
        'aiTestGenerate worker: sinh đề thất bại',
      );

      if (isLastAttempt) {
        await db
          .update(aiTests)
          .set({ status: 'failed' })
          .where(eq(aiTests.id, data.testId));
      }
      throw err;
    }
  },
  { connection: redis, concurrency: 2 },
);
