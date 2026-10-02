/**
 * Payment reconciliation worker — fix HIGH #1 (2026-10-01).
 *
 * Webhook PayOS KHÔNG còn là đường finalize duy nhất. Job chạy mỗi 10 phút
 * (schedule trong jobs/index.ts), quét payment 'pending' tuổi (10 phút, 7
 * ngày] và hỏi PayOS paymentRequests.get để biết số phận thật:
 *
 *   PAID                      → finalizePayment (cấp gói dù webhook đã fail)
 *   EXPIRED/CANCELLED/FAILED  → sync trạng thái payment
 *   PENDING/PROCESSING/UNDERPAID → giữ nguyên, chỉ log
 *
 * DRY_RUN: env PAYMENT_RECONCILE_DRY_RUN (default 'true') — lần deploy đầu
 * chỉ log kết quả đối chiếu, KHÔNG ghi DB. Chuyển 'false' sau khi review.
 *
 * Concurrency 1 + batch 50/10 phút — tránh đụng rate limit PayOS.
 * Lỗi của 1 payment không làm hỏng batch (try/catch từng item trong service).
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { paymentService } from '../service/payment.service';

export const paymentReconciliationWorker = new Worker(
    'payment-reconcile',
    async (job) => {
        if (job.name !== 'payment-reconcile') return;

        const dryRun = env.PAYMENT_RECONCILE_DRY_RUN === 'true';
        const summary = await paymentService.reconcilePendingPayments({
            dryRun,
        });

        logger.info(
            { summary, dryRun, jobId: job.id },
            'Chu kỳ reconcile payment hoàn tất',
        );
    },
    { connection: redis, concurrency: 1 },
);

paymentReconciliationWorker.on('failed', (job, err) => {
    logger.error(
        { jobId: job?.id, err },
        'Payment reconciliation worker lỗi (BullMQ sẽ retry theo cấu hình queue)',
    );
});
