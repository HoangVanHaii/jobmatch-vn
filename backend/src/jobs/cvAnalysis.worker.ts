import { Worker } from "bullmq";
import { redis } from "../config/redis";
import { logger } from "../config/logger";
import { db } from "../config/database";
import { cvs } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  CV_ANALYSIS_SYSTEM_PROMPT,
  buildCvAnalysisUserPrompt,
} from "../prompts/cvAnalysis";
import { invokeCvAnalysis } from "../lib/llm/cvAnalysis";
import { cvService } from "..//service/cv.service";

const QUEUE_NAME = "cvAnalysis";
import { isRateLimited, waitForRateLimit } from "../lib/llm/errors";


export const cvAnalysisWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name !== "cv-analysis") return;

    const { cvId } = job.data as { cvId: string };

    logger.info(
      { cvId, attempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts },
      "Worker: CV analysis job started",
    );

    const dbCv = await db.query.cvs.findFirst({ where: eq(cvs.id, cvId) });

    if (!dbCv) {
      logger.warn({ cvId }, "Worker: CV not found, skipping");
      return;
    }

    if (dbCv.status !== 'pending' && dbCv.status !== 'parsing') {
      logger.warn(
        { cvId, currentStatus: dbCv.status },
        "Worker: CV not in analysis state, skipping",
      ); 
      return;
    }

    if (dbCv.status === 'pending') {
      await cvService.changeStatus(dbCv.candidateId, dbCv.id, "parsing");
    }

    if (!dbCv?.parsedData) {
      logger.warn({ cvId }, "Worker: CV has not been parsed yet");
      if (dbCv) await cvService.changeAnalysisAsNotCv(dbCv.candidateId, cvId);
      return;
    }

    const parsed = dbCv.parsedData;

    const hasContent =
      parsed.name ||
      parsed.email ||
      parsed.phone ||
      parsed.summary ||
      parsed.experience?.length ||
      parsed.education?.length ||
      parsed.skills?.length ||
      parsed.languages?.length ||
      parsed.projects?.length ||
      parsed.certifications?.length;

    if (!hasContent) {
      logger.warn({ cvId }, "Worker: parsed CV data is empty, marking as not a CV");
      await cvService.changeAnalysisAsNotCv(dbCv.candidateId, cvId);
      return;
    }
    try {
      logger.warn({ cvId }, "Worker: CV analysis with LLM started");
      const analysis = await invokeCvAnalysis(
        CV_ANALYSIS_SYSTEM_PROMPT,
        buildCvAnalysisUserPrompt(dbCv.parsedData),
      );

      if (!analysis.isCv) {
        logger.warn(
          { cvId },
          "Worker: LLM detected that the document is not a CV",
        );
        await cvService.changeAnalysisAsNotCv(dbCv.candidateId, cvId);
        return;
      }
      analysis.verificationWarnings = await cvService.buildVerificationWarnings(
        dbCv.parsedData,
      );

      await cvService.changeAnalysisAsReady(dbCv.candidateId, cvId, analysis);

      logger.info(
        { cvId, total: analysis.total },
        "Worker: CV analysis saved successfully",
      );
      return analysis;
    } catch (err) {
      // --- 429: chờ + để BullMQ retry ---
      if (isRateLimited(err)) {
        logger.warn(
          { cvId, attempt: job.attemptsMade + 1 },
          "Worker: 429 rate limit, waiting",
        );
        await waitForRateLimit();
        logger.warn(
          { cvId },
          "Worker: rate limit wait done — rethrowing for retry",
        );
        throw err;
      }
      // --- Lỗi khác (network, parse, invalid shape): ---
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 3;
      const isLastAttempt = attempt >= maxAttempts;

      logger.error(
        { cvId, attempt, maxAttempts, isLastAttempt, err },
        "Worker: CV parse attempt failed",
      );

      // Chỉ mark 'failed' khi đã hết retry — các attempt trước vẫn để status='parsing'
      // để attempt sau được worker check `status !== 'pending' && !== 'parsing'` pass.
      if (isLastAttempt) {
        await cvService.changeStatus(dbCv.candidateId, dbCv.id, "failed");
      }
      throw err;
    }

  },
  { connection: redis, concurrency: 2 },
);

cvAnalysisWorker.on("failed", (job, err) =>
  logger.error({ jobId: job?.id, err }, "Worker: CV analysis job failed"),
);