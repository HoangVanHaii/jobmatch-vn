/**
 * Webhook router — nhận callback từ payment gateway.
 *
 * Mount: apiRouter.use('/webhooks', webhooksRouter)
 *       → full path: POST /api/v1/webhooks/payos
 *
 * Verify signature bằng official SDK @payos/node:
 *   payOS.webhooks.verify(body)  ← handle đúng algorithm
 *
 * HTTP STATUS SEMANTICS (fix HIGH #1, 2026-10-01 — thay cho "always 200" cũ):
 *
 *   | Case                                   | Status | Lý do |
 *   |----------------------------------------|--------|-------|
 *   | invalid signature                      | 200    | payload rác — trả 4xx/5xx sẽ khiến PayOS retry vô tận với thứ không bao giờ hợp lệ |
 *   | non-'00' (thanh toán thất bại thật)    | 200    | không cấp gói; payment 'pending' sẽ do reconcile job hỏi lại PayOS |
 *   | PAYMENT_NOT_FOUND (orderCode lạ)       | 200    | request test của webhooks.confirm dùng orderCode không có trong DB — phải trả 200 để confirm pass |
 *   | AMOUNT_MISMATCH                        | 200    | lỗi nghiệp vụ KHÔNG retry được (tiền lệch) — retry chỉ lặp lại cùng kết quả; admin xử lý tay |
 *   | transient (DB/pool/timeout/deadlock)   | 500    | PayOS retry; reconcile job cũng tự quét lại mỗi 5 phút (2 lớp) |
 *
 * GIẢ ĐỊNH CHƯA XÁC MINH với docs chính thức của PayOS: non-2xx sẽ được
 * retry. Assumption này cũng là assumption của code cũ (comment "nếu
 * 401/4xx PayOS sẽ retry vô tận"). Chỉ ảnh hưởng hiệu quả của nhánh 500,
 * không ảnh hưởng tính đúng đắn: reconcile job là lưới an toàn độc lập
 * với HTTP status.
 *
 * KHÔNG dùng auth middleware (PayOS không có JWT).
 * KHÔNG log payload đầy đủ — verifiedData chứa accountNumber /
 * counterAccountNumber (dữ liệu ngân hàng bên trả tiền). Chỉ log orderCode,
 * stage, code, stack.
 */
import { Router, Request, Response } from 'express';
import { PayOS } from '@payos/node';
import { logger } from '../config/logger';
import { env } from '../config/env';
import {
    paymentService,
    PaymentFinalizeError,
} from '../service/payment.service';

// Singleton client cho verify webhook
const payOS = new PayOS({
    clientId: env.PAYOS_CLIENT_ID,
    apiKey: env.PAYOS_API_KEY,
    checksumKey: env.PAYOS_CHECKSUM_KEY,
});

export const webhooksRouter = Router();

/**
 * Handler export để unit test được (jest gọi trực tiếp với req/res mock).
 */
export async function payosWebhookHandler(req: Request, res: Response): Promise<void> {
    let verifiedData: Record<string, unknown>;

    // 1. Verify signature qua SDK official (handle null→'', sort keys, etc.)
    try {
        verifiedData = await payOS.webhooks.verify(req.body);
    } catch (err) {
        logger.warn(
            {
                err: err instanceof Error ? err.message : String(err),
                ip: req.ip,
            },
            'Verify chữ ký PayOS webhook thất bại',
        );
        // Trả 200 — payload rác không bao giờ trở nên hợp lệ, retry vô nghĩa.
        return void res.status(200).json({ success: false, error: 'INVALID_SIGNATURE' });
    }

    const { code, success } = req.body as { code?: string; success?: boolean };

    // 2. Webhook-level non-success → không phải giao dịch thành công.
    //    KHÔNG cấp gói, KHÔNG đụng DB. Payment 'pending' tương ứng sẽ do
    //    reconcile job hỏi PayOS trực tiếp để biết số phận cuối.
    if (code !== '00' || success !== true) {
        const bodyOrderCode = (req.body as { data?: { orderCode?: unknown } })
            ?.data?.orderCode;
        logger.warn(
            { orderCode: bodyOrderCode, code, success },
            'PayOS webhook non-success — bỏ qua, không cấp gói (trạng thái payment do reconcile job phụ trách)',
        );
        return void res.status(200).json({ success: true });
    }

    // 3. Payload đã verify signature — an toàn để dùng.
    const orderCode = String(verifiedData.orderCode);
    const payosTxnId = String(
        verifiedData.reference ?? verifiedData.id ?? orderCode,
    );

    try {
        await paymentService.handlePayOSWebhook(orderCode, payosTxnId, verifiedData);
    } catch (err) {
        if (err instanceof PaymentFinalizeError) {
            if (err.code === 'PAYMENT_NOT_FOUND') {
                // Confirm-test của PayOS / orderCode lạ → permanent, không retry.
                logger.warn(
                    { orderCode, stage: err.stage },
                    'PayOS webhook: không tìm thấy payment (confirm-test hoặc orderCode lạ) — trả 200, không retry',
                );
                return void res.status(200).json({ success: true });
            }
            if (err.code === 'AMOUNT_MISMATCH') {
                // Đã log error có orderCode trong finalizePayment. Không retry —
                // admin xử lý tay; reconcile cũng sẽ log lại mỗi chu kỳ.
                logger.error(
                    { orderCode, stage: err.stage },
                    'PayOS webhook: AMOUNT_MISMATCH — trả 200, không retry; cần admin xem lại',
                );
                return void res.status(200).json({ success: true });
            }
            // TRANSIENT — DB/pool/timeout/deadlock → trả 5xx để PayOS retry.
            /*
            logger.error(
                {
                    orderCode,
                    stage: err.stage,
                    code: err.code,
                    cause:
                        err.cause instanceof Error
                            ? err.cause.message
                            : String(err.cause ?? ''),
                    stack: err.stack,
                },
                'PayOS webhook lỗi tạm thời — trả 500 (chờ PayOS retry)',
            );
            */
            return void res.status(500).json({ success: false, error: 'TRANSIENT_FAILURE' });
        }

        // Exception chưa phân loại — coi như transient (an toàn hơn: nếu thực
        // ra là permanent, PayOS retry vài lần rồi thôi; ngược lại nếu nuốt
        // thành 200 thì mất gói — bias về phía retry).
        /*
        
        logger.error(
            {
                orderCode,
                stage: 'unhandled',
                err: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
            },
            'PayOS webhook lỗi chưa phân loại — trả 500 (chờ retry)',
        );
        */
        return void res.status(500).json({ success: false, error: 'TRANSIENT_FAILURE' });
    }

    return void res.status(200).json({ success: true });
}

webhooksRouter.post('/payos', payosWebhookHandler);
