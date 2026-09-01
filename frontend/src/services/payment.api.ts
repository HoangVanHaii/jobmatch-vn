/**
 * Payment API client — wrapper quanh http axios instance.
 * Theo convention `*.api.ts` của project (xem services/plan.api.ts).
 */
import { http } from './http';
import type {
  Payment,
  PaymentStatus,
  PaymentWithPlan,
  CreatePaymentPayload,
  CreatePaymentResponse,
} from '@/types/payment';
import type { ApiResponse, Pagination } from '@/types/plan';

export const paymentApi = {
  /**
   * POST /payments — User tạo payment intent mua gói.
   * Backend trả về checkoutUrl để redirect sang PayOS.
   */
  create: async (payload: CreatePaymentPayload): Promise<CreatePaymentResponse> => {
    const { data } = await http.post<ApiResponse<CreatePaymentResponse>>(
      '/payments',
      payload,
    );
    return data.data;
  },

  /**
   * GET /payments/me — User xem payments của mình.
   *
   * Trả `PaymentWithPlan` (kèm `planCode`, `planName`, `planDurationDays`
   * từ LEFT JOIN plans) — dùng cho BillingHistoryView section "Lịch sử thanh toán".
   *
   * `status` filter optional — dùng để hiển thị tab "Đang chờ" / "Đã hủy" / ...
   */
  listMine: async (
    page = 1,
    limit = 20,
    status?: PaymentStatus,
  ): Promise<{ data: PaymentWithPlan[]; pagination: Pagination }> => {
    const { data } = await http.get<ApiResponse<PaymentWithPlan[]>>(
      '/payments/me',
      { params: { page, limit, ...(status ? { status } : {}) } },
    );
    return {
      data: data.data,
      pagination: data.pagination!,
    };
  },

  /**
   * GET /payments/by-order/:orderCode — Tìm payment theo orderCode.
   * Dùng cho BillingSuccessView/CancelView poll status.
   * Tra cứu theo cột `order_code` (không dùng `payos_txn_id` vì cột đó bị
   * webhook ghi đè bằng reference ngân hàng).
   * Trả null nếu chưa tìm thấy (không throw).
   *
   * `opts.signal` (AbortSignal) cho phép caller abort request khi unmount
   * hoặc khi race với WS realtime event.
   */
  getByOrderCode: async (
    orderCode: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Payment | null> => {
    const { data } = await http.get<ApiResponse<Payment | null>>(
      `/payments/by-order/${encodeURIComponent(orderCode)}`,
      { signal: opts?.signal },
    );
    return data.data;
  },

  /**
   * GET /payments/:id — User xem chi tiết 1 payment của mình.
   *
   * BE trả `PaymentWithPlan` (kèm `planCode`/`planName`/`planDurationDays`
   * từ LEFT JOIN plans) — dùng cho BillingHistoryView / PaymentDetail.
   */
  getById: async (id: string): Promise<PaymentWithPlan> => {
    const { data } = await http.get<ApiResponse<PaymentWithPlan>>(`/payments/${id}`);
    return data.data;
  },

  /**
   * GET /payments — Admin list tất cả payments (filter + pagination).
   *
   * BE trả `PaymentWithPlan[]` (cùng shape với listMine).
   */
  list: async (
    params: { page?: number; limit?: number; userId?: string; status?: PaymentStatus } = {},
  ): Promise<{ data: PaymentWithPlan[]; pagination: Pagination }> => {
    const { data } = await http.get<ApiResponse<PaymentWithPlan[]>>(
      '/payments',
      { params },
    );
    return {
      data: data.data,
      pagination: data.pagination!,
    };
  },

  /**
   * POST /payments/:id/cancel — User chủ động hủy payment link đang 'pending'.
   *
   * Flow:
   *   - BE gọi PayOS `cancel` API để đóng link ở PayOS (soft fail nếu PayOS lỗi).
   *   - BE UPDATE DB status='cancelled'.
   *   - Sau khi reload, listMine sẽ hiển thị row với badge "Đã huỷ".
   *
   * 409 PAYMENT_NOT_CANCELLABLE nếu status !== 'pending'
   * (vd: user click "Hủy" sau khi thanh toán thành công — PayOS đã paid).
   */
  cancel: async (id: string): Promise<Payment> => {
    const { data } = await http.post<ApiResponse<Payment>>(
      `/payments/${id}/cancel`,
    );
    return data.data;
  },
};
