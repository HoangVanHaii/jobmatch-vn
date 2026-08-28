import type { InferSelectModel } from "drizzle-orm";
import { payments } from "../db/schema";

export type Payment = InferSelectModel<typeof payments>;

export type PaymentStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded" | "expired";

/**
 * Payment + flat plan fields — dùng cho list/detail endpoints
 * (GET /payments, GET /payments/me, GET /payments/:id).
 *
 * Khác với `Payment` thuần:
 *   - join từ bảng `plans` qua `payments.plan_id` (LEFT JOIN để handle
 *     row có planId=null) → thêm `planCode`/`planName`/`planDurationDays`.
 *   - KHÔNG có `rawResponse` (internal PayOS payload, không leak ra FE).
 *     Nếu cần audit → tạo endpoint riêng `/payments/:id/audit` (admin only).
 *
 * Dùng ở:
 *   - paymentService.list() → controller.list / controller.listMine
 *   - paymentService.getById() → controller.getById
 *   - frontend BillingHistoryView section "Lịch sử payments"
 */
export interface PaymentWithPlan extends Omit<Payment, "rawResponse"> {
  planCode: string | null;
  planName: string | null;
  planDurationDays: number | null;
  /**
   * PayOS payment link info (extracted an toàn từ rawResponse).
   * `null` khi:
   *   - rawResponse === null (defensive — không nên xảy ra cho payment tạo qua service)
   *   - rawResponse thiếu cả 6 field cần thiết (corrupt data)
   *
   * FE chỉ render QR block khi `data.payosInfo?.qrCode` truthy AND `data.status === 'pending'`.
   */
  payosInfo: PayosLinkInfo | null;
}

/**
 * Thông tin PayOS payment link — extract từ `payments.rawResponse` (an toàn, không leak
 * toàn bộ raw payload ra FE).
 *
 * 6 field cần thiết cho UX:
 *   - qrCode         : chuỗi EMVCo VietQR → encode thành PNG để hiển thị QR scan
 *   - checkoutUrl    : link mở PayOS web (alternative nếu user không scan được)
 *   - accountNumber  : STK nhận tiền (cho user CK thủ công)
 *   - accountName    : chủ tài khoản
 *   - amount         : số tiền (VND)
 *   - description    : nội dung CK (memo)
 *
 * Lý do tách ra thay vì trả nguyên rawResponse:
 *   - rawResponse chứa nhiều field internal của PayOS (signature, bin, ...)
 *   - FE ch� cần 6 field trên cho UX
 *   - Tách riêng → dễ audit + không leak payload gốc
 *
 * Các field đều `| null` (defensive): rawResponse có thể null hoặc thiếu field
 * nếu schema PayOS đổi trong tương lai.
 *
 * Được return bởi paymentService.getById() và nhúng vào `PaymentWithPlan.payosInfo`.
 */
export interface PayosLinkInfo {
    qrCode: string | null;
    checkoutUrl: string | null;
    accountNumber: string | null;
    accountName: string | null;
    amount: number | null;
    description: string | null;
}

/**
 * Response trả về t� POST /payments.
 * Bao gồm PayOS checkoutUrl + qrCode để frontend hiển thị QR trực tiếp.
 * (xem @payos/node → CreatePaymentLinkResponse)
 */
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
 * WebSocket event emit cho user sau khi webhook PayOS commit thành công.
 *
 * Emit qua notificationGateway.emitToUser(userId, 'payment:updated', payload)
 * → frontend subscribe trong usePaymentUpdates composable.
 *
 * Chỉ emit SAU KHI DB transaction commit — không emit trước (tránh FE
 * đọc được status chưa được persist).
 */
export interface PaymentUpdatedEvent {
  orderCode: string;
  status: PaymentStatus;
  subscriptionId: string | null;
  planId: string;
}
