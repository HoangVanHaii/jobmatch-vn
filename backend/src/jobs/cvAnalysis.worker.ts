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
import { cvService } from "../service/cv.service";
import { notificationGateway } from "../socket/notificationGateway";
import type { CvStatus } from "../interface/cv";

const QUEUE_NAME = "cvAnalysis";
import { isRateLimited, waitForRateLimit } from "../lib/llm/errors";
import { usageLogService } from "../service/usageLog.service";


export const cvAnalysisWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
        if (job.name !== "cv-analysis") return;

        const { cvId } = job.data as { cvId: string };

        const dbCv = await db.query.cvs.findFirst({ where: eq(cvs.id, cvId) });

        if (!dbCv) {
            return;
        }

        if (dbCv.status !== 'pending' && dbCv.status !== 'parsing') {
            return;
        }

        if (dbCv.status === 'pending') {
            await cvService.changeStatus(dbCv.candidateId, dbCv.id, "parsing");
        }

        if (!dbCv?.parsedData) {
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
            await cvService.changeAnalysisAsNotCv(dbCv.candidateId, cvId);
            return;
        }
        try {
            const reservedThisAttempt = job.attemptsMade === 0; // ⬅️ chỉ attempt đầu reserve

            if (reservedThisAttempt) {
                const reserved = await usageLogService.createOrIncrementUsage(
                    dbCv.candidateId,
                    "ai_cv_analysis",
                );
                if (!reserved) {
                    // Hết lượt AI.
                    //   - CV đã có parsedData (parse xong, content OK) → KHÔNG
                    //     downgrade về 'failed'. CV vẫn dùng được, status cuối
                    //     cùng vẫn 'ready' (ai_analysis cũ được giữ nếu có).
                    //     Lý do 'quota_exceeded' sẽ bị changeStatus bỏ qua vì
                    //     status không phải 'failed'. Emit socket 'cv:quota-warning'
                    //     RIÊNG để FE biết hiển thị toast (vì status='ready' trông
                    //     như thành công — user không biết quota fail).
                    //   - CV chưa có parsedData → mark 'failed'/'quota_exceeded'.
                    let status: CvStatus = "failed";
                    if (dbCv.parsedData) status = "ready";
                    await cvService.changeStatus(
                        dbCv.candidateId,
                        dbCv.id,
                        status,
                        "quota_exceeded",
                    );
                    if (status === "ready") {
                        notificationGateway.emitToUser(
                            dbCv.candidateId,
                            "cv:quota-warning",
                            {
                                cvId: dbCv.id,
                                context: "analyze",
                                reason: "quota_exceeded",
                                message:
                                    "Đã hết lượt AI. Điểm phân tích trước đó được giữ nguyên.",
                            },
                        );
                    }
                    return;
                }
            }
            const result = await invokeCvAnalysis(
                CV_ANALYSIS_SYSTEM_PROMPT,
                buildCvAnalysisUserPrompt(dbCv.parsedData),
            );
            if (!result.data.isCv) {
                await cvService.changeAnalysisAsNotCv(dbCv.candidateId, cvId);
                const tokenUsed = result.usage.totalTokens ?? 0;
                if (tokenUsed > 0) {
                    await usageLogService.insertOrIncrementToken(
                        dbCv.candidateId,
                        "ai_cv_analysis",
                        tokenUsed,
                    );
                }
                return;
            }
            result.data.verificationWarnings =
                await cvService.buildVerificationWarnings(dbCv.parsedData);

            await cvService.changeAnalysisAsReady(dbCv.candidateId, cvId, result.data);

            const tokenUsed = result.usage.totalTokens ?? 0;
            if (tokenUsed > 0) {
                await usageLogService.insertOrIncrementToken(
                    dbCv.candidateId,
                    "ai_cv_analysis",
                    tokenUsed,
                );
            }

            return result.data;
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
                await usageLogService.decrementCount(dbCv.candidateId, "ai_cv_analysis");

                await cvService.changeStatus(
                    dbCv.candidateId,
                    dbCv.id,
                    "failed",
                    "analysis_error",
                );
            }
            throw err;
        }

    },
    { connection: redis, concurrency: 2 },
);

cvAnalysisWorker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, err }, "Worker: CV analysis job failed"),
);