/**
 * Webhook router — nhận callback từ payment gateway.
 *
 * Mount: apiRouter.use('/webhooks', webhooksRouter)
 *       → full path: POST /api/v1/webhooks/payos
 *
 * Verify signature bằng official SDK @payos/node:
 *   payOS.webhooks.verify(body)  ← handle đúng algorithm
 *
 * Lưu ý quan trọng:
 * - KHÔNG dùng auth middleware (PayOS không có JWT).
 * - LUÔN trả 200 OK để PayOS không retry dù xử lý lỗi.
 * - Trong production: cần check IP whitelist của PayOS.
 */
import { Router, Request, Response } from 'express';
import { PayOS } from '@payos/node';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { paymentService } from '../service/payment.service';

// Singleton client cho verify webhook
const payOS = new PayOS({
    clientId: env.PAYOS_CLIENT_ID,
    apiKey: env.PAYOS_API_KEY,
    checksumKey: env.PAYOS_CHECKSUM_KEY,
});

export const webhooksRouter = Router();

/**
 * POST /webhooks/payos — PayOS gọi khi payment status thay đổi.
 */
webhooksRouter.post('/payos', async (req: Request, res: Response) => {

    let verifiedData: any;

    // 1. Verify signature qua SDK official (handle null→'', sort keys, etc.)
    try {
        verifiedData = await payOS.webhooks.verify(req.body);
    } catch (err) {
        logger.warn(
            {
                err: err instanceof Error ? err.message : String(err),
                ip: req.ip,
            },
            'PayOS webhook signature verification failed',
        );
        // Vẫn trả 200 — nếu 401/4xx PayOS sẽ retry vô tận với payload rác
        return res.status(200).json({ success: false, error: 'INVALID_SIGNATURE' });
    }

    const { code, success } = req.body as any;

    // 2. Nếu webhook-level không thành công → bỏ qua
    if (code !== '00' || success !== true) {
        logger.info({ code, success }, 'PayOS webhook non-success, skipping');
        return res.status(200).json({ success: true });
    }
    logger.info({ verifiedData }, "data");

    // 3. Xử lý business logic (verifiedData đã được verify, an toàn dùng)
    const orderCode = String(verifiedData.orderCode);
    const payosTxnId = String(verifiedData.reference ?? verifiedData.id ?? orderCode);

    try {
        await paymentService.handlePayOSWebhook(orderCode, payosTxnId, verifiedData);
    } catch (err) {
        logger.error(
            {
                err: err instanceof Error ? err.message : String(err),
                orderCode,
            },
            'PayOS webhook handler failed',
        );
    }

    return res.status(200).json({ success: true });
});
/*
verifiedData: {
    "accountNumber": "0867721825",
    "amount": 2100,
    "description": "Mua goi pro",
    "reference": "FT26237330213110",
    "transactionDateTime": "2026-08-25 17:31:13",
    "virtualAccountNumber": "",
    "counterAccountBankId": "970422",
    "counterAccountBankName": "",
    "counterAccountName": null,
    "counterAccountNumber": "2281072020614",
    "virtualAccountName": "",
    "currency": "VND",
    "orderCode": 653857177,
    "paymentLinkId": "c27ad520c5ed4d0c982ae5a0dea833a2",
    "code": "00",
    "desc": "success"
}
*/