/**
 * Export worker — tiêu thụ exportQueue (BullMQ), xử lý job 'export-applications'.
 * Cấu trúc copy từ jobEmbedding.worker.ts (worker đơn giản nhất trong dự án):
 *   new Worker(QUEUE_NAME, processorFn, { connection: redis, concurrency }) + .on('failed', ...)
 *
 * Việc worker này làm (KHÔNG nằm trong request/response của POST /jobs/:id/export):
 *   1. Query toàn bộ applications của targetJobId, join users lấy tên/email ứng viên
 *   2. Build CSV thủ công (không cần thêm thư viện — chỉ vài cột, tự escape đủ dùng)
 *   3. Upload lên MinIO (dùng lại y hệt cách upload.service.ts đang làm: s3.putObject)
 *   4. Báo kết quả real-time qua notificationGateway (socket.io) — KHÔNG qua email/DB,
 *      vì đây chỉ là thông báo tạm thời "file đã sẵn sàng", link tải nằm ngay trong payload.
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { db } from '../config/database';
import { applications } from '../db/schema/applications';
import { users, userProfiles } from '../db/schema/users';
import { eq } from 'drizzle-orm';
import { s3, ensureBucket, getPublicUrl } from '../config/minio';
import { env } from '../config/env';
import { notificationGateway } from '../socket/notificationGateway';
import type { ExportApplicationsJobData } from '../interface/job';

const QUEUE_NAME = 'export';

/** Escape 1 giá trị cho đúng chuẩn CSV — bọc "..." nếu có dấu phẩy/xuống dòng/dấu ngoặc kép */
const csvEscape = (value: string): string => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const exportWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name !== 'export-applications') return;
    const { targetJobId, requestedBy } = job.data as ExportApplicationsJobData;

    logger.info({ targetJobId, bullJobId: job.id }, 'Export worker: export started');

    // 1. Query applications + join users (lấy tên/email ứng viên)
    const rows = await db
      .select({
        candidateName: userProfiles.fullName,
        candidateEmail: users.email,
        status: applications.status,
        stage: applications.stage,
        aiMatchScore: applications.aiMatchScore,
        appliedAt: applications.appliedAt,
      })
      .from(applications)
      .innerJoin(users, eq(users.id, applications.candidateId))
      .leftJoin(userProfiles, eq(userProfiles.userId, applications.candidateId))
      .where(eq(applications.jobId, targetJobId));

    // 2. Build CSV thủ công
    const header = ['Họ tên', 'Email', 'Trạng thái', 'Giai đoạn', 'Điểm match AI', 'Ngày apply'];
    const lines = rows.map((r) =>
      [
        r.candidateName ?? '',
        r.candidateEmail,
        r.status,
        r.stage ?? '',
        r.aiMatchScore ?? '',
        r.appliedAt.toISOString(),
      ]
        .map((v) => csvEscape(String(v)))
        .join(','),
    );
    const csvContent = [header.join(','), ...lines].join('\n');
    const buffer = Buffer.from(csvContent, 'utf-8');

    // 3. Upload lên MinIO — pattern giống upload.service.ts:putBuffer
    await ensureBucket();
    const key = `exports/${requestedBy}/${targetJobId}-${Date.now()}.csv`;
    await s3.putObject(env.S3_BUCKET, key, buffer, buffer.length, {
      'Content-Type': 'text/csv',
    });
    const fileUrl = getPublicUrl(key);

    // 4. Báo real-time qua socket cho đúng người đã yêu cầu export
    notificationGateway.emitToUser(requestedBy, 'export:done', {
      targetJobId,
      fileUrl,
      rowCount: rows.length,
    });

    logger.info(
      { targetJobId, bullJobId: job.id, rowCount: rows.length, fileUrl },
      'Export worker: export completed',
    );

    return { fileUrl, rowCount: rows.length };
  },
  { connection: redis, concurrency: 2 }, // sinh file + upload tốn IO, không cần chạy nhiều song song
);

exportWorker.on('failed', (job, err) => {
  logger.error({ bullJobId: job?.id, err }, 'Export worker failed');
});