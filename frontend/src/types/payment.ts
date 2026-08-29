/**
 * Payment types — mirror với backend (src/interface/payment.ts).
 */
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded' | 'expired';

export interface Payment {
  id: string;
  userId: string;
  subscriptionId: string | null;
  amountVnd: string; // numeric từ Postgres → string
  orderCode: string; // Khóa tra cứu ổn định, set 1 lần lúc tạo, KHÔNG bị webhook ghi đè
  payosTxnId: string | null; // Reference ngân hàng, set sau khi webhook thành công
  status: PaymentStatus;
  rawResponse: Record<string, unknown> | null;
  createdAt: string;
  /**
   * Lần cập nhật status gần nhất (paid/failed/cancelled). NULL khi status='pending'
   * (chưa từng UPDATE sau INSERT). Dùng cho ORDER BY "hoạt động mới nhất".
   */
  updatedAt: string | null;
}

export interface CreatePaymentPayload {
  planId: string;
}

export interface CreatePaymentResponse {
  payment: Payment;
  checkoutUrl: string;
  qrCode: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  description: string;
  paymentLinkId: string;
}

/**
 * Payment kèm plan info (denormalized từ LEFT JOIN plans).
 * Dùng cho list/detail (`GET /payments`, `GET /payments/me`, `GET /payments/:id`).
 *
 * `planName`/`planCode` có thể `null` khi `payments.plan_id` NULL (legacy/seed rows).
 * KHÔNG có `rawResponse` — BE cố ý strip (internal PayOS payload, không cần cho UI).
 */
export interface PaymentWithPlan extends Omit<Payment, "rawResponse"> {
  planCode: string | null;
  planName: string | null;
  planDurationDays: number | null;
  /**
   * PayOS payment link info (extract từ rawResponse — xem PayosLinkInfo).
   * BE trả null khi rawResponse không có data.
   * FE dùng cho QR display khi status='pending'.
   */
  payosInfo: PayosLinkInfo | null;
}

/**
 * PayOS payment link info — mirror với backend (PayosLinkInfo).
 *
 * Extract an toàn từ `payments.rawResponse` — chỉ 6 field cần thiết cho UX.
 * rawResponse gốc KHÔNG bao giờ trả về FE (BE strip trong response).
 *
 * Field nào cũng có thể `null` (defensive):
 *   - rawResponse === null trong DB (không nên xảy ra nhưng vẫn handle)
 *   - Schema PayOS đổi trong tương lai
 *
 * UX rule (PaymentDetailModal):
 *   - Chỉ render QR block khi `data.status === 'pending'` AND `data.payosInfo?.qrCode` truthy
 *   - Các field khác (accountNumber, amount, ...) dùng fallback '—' nếu null
 */
export interface PayosLinkInfo {
    qrCode: string | null;
    checkoutUrl: string | null;
    accountNumber: string | null;
    accountName: string | null;
    amount: number | null;
    description: string | null;
}
