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
import { cvAnalysisQueue } from "../config/queue";
import { isRateLimited, waitForRateLimit } from "../lib/llm/errors";
import { cvService } from "../service/cv.service";


const QUEUE_NAME = 'cvParsing';

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
		const { cvId } = job.data as { cvId: string };
		
		logger.info({
			cvId, jobId: job.id, attempt: job.attemptsMade + 1},
			"Worker: CV parse job started",
		);

		const dbCv = await db.query.cvs.findFirst({ where: eq(cvs.id, cvId) });

		if (!dbCv) {
			logger.warn({ cvId, jobId: job.id }, "Worker: CV not found, skipping job");
			return;
		}
		if (dbCv.status !== 'pending' && dbCv.status !== 'parsing') {
			logger.warn({ cvId, status: dbCv.status }, 'Worker: CV is not pending or parsing, skipping job');
			return;
		}
		if (!dbCv.fileUrl || !dbCv.fileType) {
			logger.error({ cvId }, "Worker: CV file information is missing");
			await cvService.changeStatus(dbCv.candidateId, dbCv.id, "failed");
			return;
		}
		await cvService.changeStatus(dbCv.candidateId, dbCv.id, "parsing")
		
		try {
      const buffer = await fetchFileFromUrl(dbCv.fileUrl);
      const text = await extractText(buffer, dbCv.fileType);

      logger.info({ cvId, textLen: text.length }, "Worker: CV text extracted");

      const parsed = await invokeCvParse(
        CV_PARSE_SYSTEM_PROMPT,
        buildCvParseUserPrompt(text),
      );
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				logger.error({
            cvId,
            sample: JSON.stringify(parsed)?.slice(0, 200), // ← xem thử
          },
          "Worker: LLM returned invalid parse data",
        );
        throw new Error(`LLM returned invalid parsed data: ${typeof parsed}`);

      }

      await db
        .update(cvs)
        .set({
          parsedData: parsed,
          updatedAt: new Date(),
        })
        .where(eq(cvs.id, cvId));

      await cvAnalysisQueue.add("cv-analysis", { cvId: dbCv.id });

      logger.info({ cvId }, "Worker: CV parsed successfully");

      return parsed;
    } catch (err) {
      // --- 429: chờ + để BullMQ retry ---
      if (isRateLimited(err)) {
        logger.warn({ cvId, attempt: job.attemptsMade + 1 },"Worker: 429 rate limit, waiting");
        await waitForRateLimit();
				logger.warn({ cvId }, "Worker: rate limit wait done — rethrowing for retry");
        throw err;
      }
      // --- Lỗi khác (network, parse, invalid shape): ---
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 3;
      const isLastAttempt = attempt >= maxAttempts;

			logger.error({ cvId, attempt, maxAttempts, isLastAttempt, err }, "Worker: CV parse attempt failed");

      // Chỉ mark 'failed' khi đã hết retry — các attempt trước vẫn để status='parsing'
      // để attempt sau được worker check `status !== 'pending' && !== 'parsing'` pass.
      if (isLastAttempt) {
        await cvService.changeStatus(dbCv.candidateId, dbCv.id, "failed");
      }
      throw err;
    }

	},
	{ connection: redis, concurrency: 2 },
)
cvParseWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, "Worker: CV parse job failed");
})


