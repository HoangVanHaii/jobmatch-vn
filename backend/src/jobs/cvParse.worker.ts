import { Worker } from "bullmq";
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { db } from '../config/database';
import { cvs } from '../db/schema';
import { eq } from 'drizzle-orm';
import pdfParse from 'pdf-parse';
import mamonth from 'mammoth';
import { invokeCvParse } from "../lib/llm";
import {CV_PARSE_SYSTEM_PROMPT, buildCvParseUserPrompt} from '../prompts/cvParse'
import { isRateLimited, waitForRateLimit } from "../lib/llm/errors";
import { cvService } from "../service/cv.service";
import { usageLogService } from "../service/usageLog.service";

/* ============================================================================
 * LlmParseError — custom error mang theo `reason` (failureReason sẽ ghi DB)
 *
 * Phân biệt 2 loại fail:
 *   - 'parse_error'  : lỗi kỹ thuật — LLM API down, LLM trả JSON không phải
 *                      object (null/primitive/array), PDF/DOCX extract throw.
 *                      → User retry có thể succeed.
 *   - 'not_a_cv'     : LLM trả object hợp lệ nhưng semantic rỗng (`{}` hoặc
 *                      chỉ shell fields rỗng) → input rất có thể không phải
 *                      CV (screenshot, tài liệu ngẫu nhiên, file sai).
 *                      → User retry KHÔNG giúp được; cần upload file khác.
 *
 * Cả 2 đều đi qua retry 3 lần của BullMQ (giữ behavior cũ), chỉ khác
 * failureReason cuối cùng → FE banner khác nhau:
 *   - parse_error  → "Không thể xử lý CV"
 *   - not_a_cv     → "Nội dung không phải CV"
 *
 * `not_a_cv` cũng đã được `cvAnalysis.worker.ts` emit khi parse OK nhưng
 * AI analyze xác định content không phải CV → dùng cùng `reason` để FE
 * xử lý nhất quán (xem cardReason ở MyResumesView line 273-278).
 * ==========================================================================*/
type FailureReason = 'parse_error' | 'not_a_cv';

class LlmParseError extends Error {
    readonly reason: FailureReason;
    constructor(reason: FailureReason, message: string) {
        super(message);
        this.reason = reason;
        this.name = 'LlmParseError';
        // Preserve prototype chain sau khi extend Error (TS target ES5).
        Object.setPrototypeOf(this, LlmParseError.prototype);
    }
}


const QUEUE_NAME = 'cvParsing';

/**
 * Hoàn 1 lượt `ai_cv_parsed` khi job early-exit TRƯỚC khi LLM chạy (lượt đã
 * được service reserve trước khi enqueue — job không chạy thì không được tiêu).
 *
 * `candidateId` lấy từ job payload — job cũ pre-deploy (payload thiếu field)
 * sẽ warn + skip refund (an toàn, chỉ lệch ±1 lượt).
 */
const refundParseQuota = async (
    candidateId: string | undefined,
    why: string,
): Promise<void> => {
    if (!candidateId) {
        logger.warn(
            { why },
            "cvParseWorker: refund skipped — payload thiếu candidateId (job cũ pre-deploy)",
        );
        return;
    }
    await usageLogService.decrementCount(candidateId, "ai_cv_parsed");
};

/**
 * Trích xuất text thuần (plain text) từ file CV đã được tải về dưới dạng Buffer.
 *
 * Input:
 *   - buffer:  binary content của file CV (đã được `fetchFileFromUrl` tải về).
 *   - mimetype: MIME type của file (vd 'application/pdf', 'application/msword').
 *
 * Output: string — text thuần đã được trích xuất, sẵn sàng đưa cho LLM xử lý.
 *
 * Hỗ trợ 3 loại MIME:
 *   - 'application/pdf' → dùng `pdf-parse` (chuyên cho PDF, hỗ trợ text + metadata).
 *   - 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
 *     (.docx — chuỗi `wordprocessingml` xuất hiện trong MIME) → dùng `mammoth`.
 *   - 'application/msword' (.doc đời cũ) → cũng dùng `mammoth`.
 *
 * Throw nếu MIME không thuộc 3 loại trên → worker catch error, retry theo cơ chế BullMQ.
 *
 * Ví dụ:
 *   const pdfText = await extractText(buffer, 'application/pdf');
 *   // pdfText = "Nguyen Van A\nBackend Developer\nSkills: Node.js, TypeScript..."
 *
 *   const docxText = await extractText(buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 *   // docxText = "Tran Thi B\nMarketing Manager..."
 */
const extractText = async (
    buffer: Buffer,
    mimetype: string
): Promise<string> => {
    if (mimetype === 'application/pdf') {
        const data = await pdfParse(buffer);
        return data.text;
    }
    if (mimetype.includes('wordprocessingml') ||
        mimetype === 'application/msword') {
        const result = await mamonth.extractRawText({ buffer });
        return result.value;
    }
    throw new Error(`Unsupported mimetype: ${mimetype}`);
}

/**
 * Tải file CV từ URL (MinIO/S3 pre-signed URL hoặc public URL) về dạng Buffer.
 *
 * Input:  url — đường dẫn tới file đã được user upload (lưu ở `cvs.fileUrl`).
 * Output: Buffer — binary content của file, sẵn sàng đưa cho `extractText()`.
 *
 * Luồng:
 *   1. Native `fetch()` tới URL (Node 18+ có sẵn global fetch).
 *   2. Check `response.ok` — nếu false (404, 403, 500...) → throw ngay.
 *      - 403 thường do URL pre-signed hết hạn (MinIO signed URL có TTL ngắn).
 *      - 404 / 500 do MinIO chết hoặc bucket không tồn tại.
 *   3. Đọc `arrayBuffer()` rồi wrap lại thành Node `Buffer` (Node có sẵn global Buffer,
 *      nhưng `arrayBuffer` trả về `ArrayBuffer` chuẩn Web → cần convert).
 *
 * Throw error nếu request fail → worker catch + retry (BullMQ tự lo backoff).
 *
 * Lưu ý: KHÔNG có timeout ở đây. Nếu MinIO treo (network stuck), `fetch` đợi vô hạn
 * → worker bị block. Có thể cải tiến bằng `AbortSignal.timeout(30_000)` sau.
 *
 * Ví dụ:
 *   const buffer = await fetchFileFromUrl('https://minio.example.com/cvs/abc.pdf?X-Amz-Signature=...');
 *   // buffer = <Buffer 25 50 44 46 2d 31 2e 34 ...> (binary)
 */
const fetchFileFromUrl = async (url: string): Promise<Buffer> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}


export const cvParseWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
        if (job.name !== 'cv-parse') return;
        // `candidateId` từ payload (enqueue site thêm từ refactor
        // reserve-tại-service) — dùng cho refund early-exit. Job cũ
        // pre-deploy thiếu field → refund tự skip (warn).
        const { cvId, candidateId } = job.data as {
            cvId: string;
            candidateId?: string;
        };


        const dbCv = await db.query.cvs.findFirst({ where: eq(cvs.id, cvId) });

        // Early-exit trước LLM → hoàn lượt đã reserve ở service.
        if (!dbCv) {
            await refundParseQuota(candidateId, 'CV deleted after enqueue');
            return;
        }
        if (dbCv.status !== 'pending' && dbCv.status !== 'parsing') {
            await refundParseQuota(dbCv.candidateId, 'status guard skip (duplicate/processed job)');
            return;
        }
        if (!dbCv.fileUrl || !dbCv.fileType) {
            await refundParseQuota(dbCv.candidateId, 'missing fileUrl/fileType');
            await cvService.changeStatus(
                dbCv.candidateId,
                dbCv.id,
                "failed",
                "invalid_file",
            );
            return;
        }
        await cvService.changeStatus(dbCv.candidateId, dbCv.id, "parsing")

        try {
            const buffer = await fetchFileFromUrl(dbCv.fileUrl);
            const text = await extractText(buffer, dbCv.fileType);

            // QUOTA: đã được service reserve (reserveQuota) TRƯỚC khi enqueue —
            // worker KHÔNG reserve/check nữa. Refund early-exit phía trên;
            // lỗi LLM → catch cuối vẫn decrement như cũ.

            const result = await invokeCvParse(
                CV_PARSE_SYSTEM_PROMPT,
                buildCvParseUserPrompt(text),
            );

            // Validate LLM response — 2 layers:
            //   (1) Shape: data phải là object (không phải null/primitive/array).
            //   (2) Semantic: data phải chứa ÍT NHẤT 1 trong các field critical
            //       (name/email/phone/exp/edu/skills) — bắt case LLM trả `{}`
            //       hoặc chỉ shell fields rỗng do prompt không rõ / model
            //       hallucinate. Schema trong `lib/llm/cvParse.ts` có toàn field
            //       `.optional()` → Zod pass → invokeCvParse trả về `{}` →
            //       worker cũng pass → DB lưu `parsedData={}` + status='ready' →
            //       UI render CV trắng + AI analyze fail sau → silent broken.
            //
            // Throw ở đây sẽ rơi vào catch bên dưới → BullMQ retry 3 lần → cuối
            // cùng status='failed' + failureReason='parse_error' → FE banner
            // "Không thể xử lý CV" hiển thị (xem cardReason ở MyResumesView).
            const d = result.data;
            const isNonEmptyString = (v: unknown): boolean =>
                typeof v === "string" && v.trim().length > 0;
            const isNonEmptyArray = (v: unknown): boolean =>
                Array.isArray(v) && v.length > 0;

            const shapeValid = Boolean(d) && typeof d === "object" && !Array.isArray(d);
            const semanticValid =
                isNonEmptyString(d?.name) ||
                isNonEmptyString(d?.email) ||
                isNonEmptyString(d?.phone) ||
                isNonEmptyArray(d?.experience) ||
                isNonEmptyArray(d?.education) ||
                isNonEmptyArray(d?.skills);

            if (!shapeValid) {
                // LLM trả null / primitive / array → lỗi kỹ thuật (LLM format
                // sai hoặc API issue) → 'parse_error'. User retry có thể fix.
                logger.error(
                    {
                        cvId,
                        shapeValid,
                        semanticValid,
                        sample: JSON.stringify(result.data)?.slice(0, 200),
                    },
                    "Worker: LLM returned invalid parse data (shape)",
                );
                throw new LlmParseError(
                    "parse_error",
                    "LLM returned invalid parse data (shape)",
                );
            }
            if (!semanticValid) {
                // LLM trả object hợp lệ nhưng không có field critical nào →
                // input rất có thể không phải CV → 'not_a_cv' → FE banner
                // "Nội dung không phải CV" thay vì "Không thể xử lý CV".
                logger.error(
                    {
                        cvId,
                        shapeValid,
                        semanticValid,
                        sample: JSON.stringify(result.data)?.slice(0, 200),
                    },
                    "Worker: LLM returned empty parse data — input likely not a CV",
                );
                throw new LlmParseError(
                    "not_a_cv",
                    "LLM returned semantically empty parse data — input likely not a CV",
                );
            }

            // Ghi nhận token thực tế sau LLM success — invokeCvParse đã trả về usage.
            const tokenUsed = result.usage.totalTokens ?? 0;
            if (tokenUsed > 0) {
                await usageLogService.insertOrIncrementToken(
                    dbCv.candidateId,
                    "ai_cv_parsed",
                    tokenUsed,
                );
            }

            await db
                .update(cvs)
                .set({
                    parsedData: result.data,
                    updatedAt: new Date(),
                })
                .where(eq(cvs.id, cvId));

            await cvService.changeStatus(
                dbCv.candidateId,
                dbCv.id,
                "ready",
            );

            return result.data;
        } catch (err) {
            // --- 429: chờ + để BullMQ retry ---
            if (isRateLimited(err)) {
                logger.warn({ cvId, attempt: job.attemptsMade + 1 }, "Worker: 429 rate limit, waiting");
                await waitForRateLimit();
                logger.warn({ cvId }, "Worker: rate limit wait done — rethrowing for retry");
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
                await usageLogService.decrementCount(
                    dbCv.candidateId,
                    "ai_cv_parsed",
                );
                // Phân biệt failureReason:
                //   - LlmParseError → lấy `reason` từ error (parse_error hoặc not_a_cv).
                //   - Error khác (PDF parse throw, fetch throw, etc.) → 'parse_error'
                //     mặc định vì là lỗi kỹ thuật, user retry có thể succeed.
                const failureReason: FailureReason =
                    err instanceof LlmParseError ? err.reason : "parse_error";
                await cvService.changeStatus(
                    dbCv.candidateId,
                    dbCv.id,
                    "failed",
                    failureReason,
                );
            }
            throw err;
        }

    },
    { connection: redis, concurrency: 2 },
)

cvParseWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, "Worker: CV parse job failed");
})