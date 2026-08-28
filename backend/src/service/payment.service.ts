import axios from "axios";
import crypto from "crypto";
import { PayOS } from "@payos/node";
import { db } from "../config/database";
import { payments, plans, subscriptions } from "../db/schema";
import { eq, and, sql, desc, lt } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler";
import { env } from "../config/env";
import type { PaymentListQuery } from "../middleware/payment";
import type {
  Payment,
  PaymentWithPlan,
  PaymentUpdatedEvent,
  PayosLinkInfo,
} from "../interface/payment";
import { logger } from "../config/logger";
import { planService } from "./plan.service";
import { subscriptionService } from "./subscription.service";
import { notificationGateway } from "../socket/notificationGateway";

const PAYOS_API = "https://api-merchant.payos.vn/v2";

// Singleton PayOS client (dùng cho reconciliation + verify webhook)
const payOS = new PayOS({
  clientId: env.PAYOS_CLIENT_ID,
  apiKey: env.PAYOS_API_KEY,
  checksumKey: env.PAYOS_CHECKSUM_KEY,
});

function createPayOSSignature(data: Record<string, string | number>): string {
  const sortedData = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("&");
  return crypto
    .createHmac("sha256", env.PAYOS_CHECKSUM_KEY)
    .update(sortedData)
    .digest("hex");
}
function generateOrderCode(): number {
  return Date.now() % 1_000_000_000;
}

/**
 * Ngưỡng tuổi tối đa của một payment 'pending' trước khi bị coi là "bỏ rơi"
 * và tự động cleanup thành 'expired'.
 *
 * 24h khớp với PayOS default expiration window cho payment link.
 * Sau thời gian này, dù user có quét QR lại thì PayOS cũng trả fail
 * (webhook hoặc GET status đều về 'failed' / không tồn tại).
 *
 * Có thể điều chỉnh nếu PayOS config khác — xem docs PayOS.
 */
const STALE_PENDING_MS = 24 * 60 * 60 * 1000;

/**
 * Lazy cleanup pending payments quá hạn.
 *
 * Vấn đề giải quyết:
 *   - User tạo QR xong không quét thanh toán và cũng không bấm "Hủy" →
 *     row treo 'pending' mãi mãi trong DB.
 *   - PayOS tự expire link sau 24h nhưng DB không biết → history view hiển thị
 *     đống "Đang xử lý" gây hiểu nhầm.
 *
 * Cách fix:
 *   - Trước MỌI GET (getByOrderCode / getById / list), chạy bulk UPDATE:
 *       UPDATE payments SET status='expired' WHERE status='pending' AND created_at < now() - 24h
 *   - Sau update, SELECT sẽ không còn thấy rows stale.
 *
 * Phân biệt với 'cancelled':
 *   - 'cancelled' = user CHỦ ĐỘNG bấm "Hủy" qua POST /payments/:id/cancel.
 *   - 'expired'   = hệ thống T� ĐỘNG đánh dấu vì quá hạn PayOS.
 *   → User xem history sẽ hiểu vì sao đơn bị đóng (timeout vs. user-cancel).
 *
 * Soft fail: nếu UPDATE lỗi (network/DB issue) → log error, caller vẫn chạy SELECT.
 * Không throw để không block user request — eventual consistency acceptable.
 *
 * Lưu ý quan trọng: function này phụ thuộc vào DB enum đã có value 'expired'
 * (xem migration 0018_payment_add_expired_status.sql). Nếu chưa chạy migration,
 * Postgres sẽ trả lỗi 22P02 (invalid_text_representation) → function log error
 * với `pgCode: '22P02'` để dễ debug.
 *
 * Cost: 1 bulk UPDATE per request. Với index `idx_subs_user_active` thì đủ nhanh.
 * Nếu scale lớn (>1000 stale rows/request), nên chuyển sang cron job (xem cleanup-stale endpoint plan).
 */
async function cleanupStalePendingPayments(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_PENDING_MS);
  try {
    const expired = await db
      .update(payments)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(payments.status, "pending"),
          lt(payments.createdAt, cutoff),
        ),
      )
      .returning({ id: payments.id });

    if (expired.length > 0) {
      logger.info(
        { expiredCount: expired.length, cutoff: cutoff.toISOString() },
        "Auto-expired stale pending payments",
      );
    }
  } catch (err) {
    // pgCode 22P02 = invalid_text_representation — thường là enum chưa có value mới
    // (ALTER TYPE payment_status ADD VALUE 'expired' chưa chạy trên DB này).
    const pgCode = (err as { code?: string } | null)?.code;
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        pgCode,
      },
      "Lazy cleanup stale pending payments failed — proceeding without cleanup",
    );
  }
}

/**
 * Extract an toàn các field PayOS cần thiết từ `rawResponse` (JSONB).
 *
 * Lý do tách ra:
 *   - `rawResponse` chứa nhiều field internal (signature, bin, accountNumber, v.v.)
 *     mà FE không cần → không leak toàn bộ.
 *   - Chỉ trả đúng 6 field cần cho UX (xem `PayosLinkInfo` trong interface/payment.ts).
 *
 * Defensive coding:
 *   - Mỗi field đều check `typeof` trước khi cast → null nếu shape sai.
 *   - `amount` đặc biệt: PayOS trả number nhưng nếu schema đổi (string) → null.
 *   - Nếu raw === null/undefined → return null (FE render: "không có QR").
 *
 * @param raw  rawResponse từ DB (JSONB → Record<string, unknown> | null)
 * @returns    PayosLinkInfo | null
 */
function extractPayosLinkInfo(
    raw: Record<string, unknown> | null,
): PayosLinkInfo | null {
    if (!raw) return null;
    return {
        qrCode: typeof raw.qrCode === "string" ? raw.qrCode : null,
        checkoutUrl: typeof raw.checkoutUrl === "string" ? raw.checkoutUrl : null,
        accountNumber: typeof raw.accountNumber === "string" ? raw.accountNumber : null,
        accountName: typeof raw.accountName === "string" ? raw.accountName : null,
        amount: typeof raw.amount === "number" ? raw.amount : null,
        description: typeof raw.description === "string" ? raw.description : null,
    };
}

export const paymentService = {
  create: async (
    userId: string,
    planId: string,
  ): Promise<{
    payment: Payment;
    checkoutUrl: string;
    qrCode: string;
    accountNumber: string;
    accountName: string;
    amount: number;
    description: string;
    paymentLinkId: string;
  }> => {
    return await db.transaction(async (tx) => {
      const plan = await planService.checkPlanTx(tx, planId);

      // 1. INSERT payment row ở trạng thái 'pending' (orderCode uniqueness — xem helper doc).
      const { payment, orderCode } = await createPendingPaymentRow(
        tx,
        userId,
        planId,
        plan,
      );

      // 2. Gọi PayOS create payment link — xem helper doc.
      const payosData = await createPayOSPaymentLink(orderCode, plan);

      // 3. UPDATE rawResponse trong cùng tx (commit cùng payment row).
      await tx
        .update(payments)
        .set({ rawResponse: payosData as Record<string, unknown> })
        .where(eq(payments.id, payment.id));

      return {
        payment,
        checkoutUrl: payosData.checkoutUrl,
        qrCode: payosData.qrCode,
        accountNumber: payosData.accountNumber,
        accountName: payosData.accountName,
        amount: payosData.amount,
        description: payosData.description,
        paymentLinkId: payosData.paymentLinkId,
      };
    });
  },

  getByOrderCode: async (
    orderCode: string,
    userId: string,
  ): Promise<Payment | null> => {
    // Lazy cleanup: chuyển pending payments > 24h thành 'expired' trư�c khi SELECT.
    await cleanupStalePendingPayments();

    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderCode, orderCode))
      .limit(1);

    if (!row) return null;

    if (row.userId !== userId) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Bạn không có quyền xem payment này",
      );
    }

    // GET chỉ đọc trạng thái từ DB.
    // Không gọi PayOS API, không update payment,
    // không tạo subscription ở đây.
    return row;
  },
  getById: async (
    id: string,
    userId?: string,
    isAdmin = false,
  ): Promise<PaymentWithPlan> => {
    // Lazy cleanup: chuyển pending payments > 24h thành 'expired' trước khi SELECT.
    await cleanupStalePendingPayments();

    const [row] = await db
      .select({
        id: payments.id,
        planId: payments.planId,
        userId: payments.userId,
        subscriptionId: payments.subscriptionId,
        amountVnd: payments.amountVnd,
        orderCode: payments.orderCode,
        payosTxnId: payments.payosTxnId,
        status: payments.status,
        createdAt: payments.createdAt,
        updatedAt: payments.updatedAt,
        rawResponse: payments.rawResponse, // cần cho detail modal QR (extract → payosInfo)
        planCode: plans.code,
        planName: plans.name,
        planDurationDays: plans.durationDays,
        // rawResponse CỐ Ý KHÔNG select — chỉ dùng nội bộ (audit/debug).
        // Không leak ra response → tránh lộ internal PayOS payload.
      })
      .from(payments)
      .leftJoin(subscriptions, eq(payments.subscriptionId, subscriptions.id))
      .leftJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(payments.id, id))
      .limit(1);

    if (!row) {
      throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment không tồn tại");
    }
    if (!isAdmin && row.userId !== userId) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Bạn không có quyền xem payment này",
      );
    }

    return {
        ...row,
        payosInfo: extractPayosLinkInfo(
            (row as { rawResponse: Record<string, unknown> | null }).rawResponse,
        ),
    } as PaymentWithPlan;
  },
  list: async (filters: {
    offset: number;
    limit: number;
    userId?: string;
    status?: PaymentListQuery["status"];
  }): Promise<{ data: PaymentWithPlan[]; total: number }> => {
    // Lazy cleanup: chuyển pending payments > 24h thành 'expired' trước khi SELECT.
    // Áp dụng cho cả listMine (controller) và admin list vì cùng gọi service này.
    await cleanupStalePendingPayments();

    const conditions = [];
    if (filters.userId) conditions.push(eq(payments.userId, filters.userId));
    if (filters.status) conditions.push(eq(payments.status, filters.status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, [{ total }]] = await Promise.all([
      db
        .select({
          id: payments.id,
          userId: payments.userId,
          subscriptionId: payments.subscriptionId,
          amountVnd: payments.amountVnd,
          orderCode: payments.orderCode,
          payosTxnId: payments.payosTxnId,
          status: payments.status,
          createdAt: payments.createdAt,
          updatedAt: payments.updatedAt,
          planCode: plans.code,
          planName: plans.name,
          planDurationDays: plans.durationDays,
          // rawResponse CỐ Ý KHÔNG select — chứa full PayOS payload,
          // không cần cho list view (chiếm bandwidth + leak internal fields).
          // Admin xem raw → GET /payments/:id (chỉ admin có quyền raw field qua param ?raw=1).
          // Hiện tại GET /:id cũng không trả raw — bỏ hẳn cho đơn giản.
          // Nếu sau cần audit raw → expose riêng endpoint internal `/payments/:id/audit` (adminOnly).
        })
        .from(payments)
        // LEFT JOIN (không INNER) vì `payments.plan_id` là nullable FK —
        // một số row có thể không có plan (legacy/seed) → vẫn phải hiển thị.
        .leftJoin(plans, eq(payments.planId, plans.id))
        .where(whereClause)
        .orderBy(
          sql`CASE WHEN ${payments.status} = 'paid' THEN ${payments.updatedAt} END DESC NULLS LAST`,
          desc(payments.createdAt),
        )
        .limit(filters.limit)
        .offset(filters.offset),

      db
        .select({ total: sql<number>`count(*)::int` })
        .from(payments)
        .where(whereClause),
    ]);

    return { data: data as PaymentWithPlan[], total };
  },
  /**
   * Webhook handler — PayOS gọi khi payment status thay đổi.
   * Đặt trong transaction để đảm bảo atomic: nếu tạo sub fail → rollback cả payment update.
   *
   * @param orderCode   Mã đơn hàng từ PayOS
   * @param payosTxnId  Reference/transaction ID từ PayOS
   * @param rawData     Toàn bộ payload từ PayOS
   */
  handlePayOSWebhook: async (
    orderCode: string,
    payosTxnId: string,
    rawData: Record<string, unknown>,
  ): Promise<void> => {
    // Capture thông tin cần emit SAU KHI transaction commit.
    // Không emit trong transaction — nếu commit fail thì FE đã nhận event sai.
    const emitted: PaymentUpdatedEvent | null = await db.transaction(
      async (tx): Promise<PaymentUpdatedEvent | null> => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.orderCode, orderCode))
          .limit(1);

        if (!payment || !payment.planId) {
          throw new AppError(
            404,
            "PAYMENT_NOT_FOUND",
            `Payment với orderCode ${orderCode} không tồn tại`,
          );
        }

        // Idempotency: webhook retry sau commit → early-return, không update, không tạo sub, không emit.
        if (payment.status === "paid") {
          return null;
        }

        // PayOS sandbox trả "00" = success, các code khác = failed/cancelled.
        // (docs cũ nói "00000" nhưng payload thực tế dùng "00")
        const paymentCode = String((rawData as any).code ?? "");
        const isSuccess = paymentCode === "00";

        if (!isSuccess) {
          await tx
            .update(payments)
            .set({
              status: "failed",
              payosTxnId,
              updatedAt: new Date(), // stamp lúc finalize status → đẩy lên top list
              rawResponse: rawData,
            })
            .where(eq(payments.id, payment.id));

          // Trả event 'failed' để FE cập nhật UI nếu đang ngóng
          return {
            orderCode,
            status: "failed",
            subscriptionId: payment.subscriptionId ?? null,
            planId: payment.planId,
          };
        }

        // SUCCESS → Update payment status = paid
        await tx
          .update(payments)
          .set({
            status: "paid",
            payosTxnId,
            updatedAt: new Date(), // stamp lúc finalize status → đẩy lên top list (xem migration 0017)
            rawResponse: rawData,
          })
          .where(eq(payments.id, payment.id));

        // Tạo subscription (cancel mọi sub active cũ + insert mới — xem subscription.service.ts)
        const newSub = await subscriptionService.create(
          tx,
          payment.userId,
          payment.planId,
          orderCode,
        );

        // Link subscription vào payment
        await tx
          .update(payments)
          .set({ subscriptionId: newSub.id })
          .where(eq(payments.id, payment.id));

        return {
          orderCode,
          status: "paid",
          subscriptionId: newSub.id,
          planId: payment.planId,
        };
      },
    );

    // ===== SAU KHI COMMIT → emit WebSocket =====
    // Emit cho CẢ 2 trường hợp:
    //   - status='paid'  → modal/success view set state='success', navigate /billing/success
    //   - status='failed' → modal set state='failed', hiện thông báo "Thanh toán bị từ chối"
    // Chỉ skip emit khi webhook retry (early-return null do payment đã paid từ trước).
    if (emitted) {
      const userId = await getUserIdByOrderCode(orderCode);
      notificationGateway.emitToUser(userId, "payment:updated", emitted);
    } else {
      logger.info(
        { orderCode },
        "Skipped emit — payment already paid (webhook retry)",
      );
    }
  },
  
  /**
   * Hủy payment — endpoint POST /payments/:id/cancel.
   *
   * Chỉ cho phép khi status='pending' (user hủy payment link chưa thanh toán).
   * Status khác ('paid', 'failed', 'cancelled', 'expired', 'refunded') → 409 PAYMENT_NOT_CANCELLABLE.
   *
   * Flow:
   *   1. SELECT payment — check tồn tại + ownership (admin bypass).
   *   2. status='pending' → gọi `cancelPendingPaymentLink` (PayOS cancel + DB UPDATE).
   *
   * Lưu ý: KHÔNG cancel payment đã 'paid' (refund flow thuộc admin endpoint
   * riêng — user endpoint chỉ dừng ở cancel pending).
   *
   * Idempotency: gọi 2 lần → lần 2 fail 409 (status đã 'cancelled' != 'pending').
   */
  cancel: async (
    id: string,
    userId: string,
    isAdmin = false,
  ): Promise<Payment> => {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1);

    if (!payment) {
      throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment không tồn tại");
    }
    if (!isAdmin && payment.userId !== userId) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Bạn không có quyền hủy payment này",
      );
    }
    if (payment.status !== "pending") {
      throw new AppError(
        409,
        "PAYMENT_NOT_CANCELLABLE",
        `Chỉ hủy được payment đang ở trạng thái 'pending' (hiện tại: '${payment.status}')`,
      );
    }

    return await cancelPendingPaymentLink(payment);
  },
};

/**
 * Helper: lookup userId từ orderCode. Tách ra để không block transaction body
 * (chỉ chạy sau commit, cost negligible).
 */
async function getUserIdByOrderCode(orderCode: string): Promise<string> {
  const [row] = await db
    .select({ userId: payments.userId })
    .from(payments)
    .where(eq(payments.orderCode, orderCode))
    .limit(1);
  if (!row) {
    throw new AppError(
      404,
      "PAYMENT_NOT_FOUND",
      `Payment với orderCode ${orderCode} không tồn tại`,
    );
  }
  return row.userId;
}

/**
 * Cancel payment link đang 'pending':
 *   1. Gọi PayOS `cancel` để đóng link phía PayOS (soft fail — log warn + tiếp tục DB update).
 *   2. UPDATE DB status='cancelled'.
 *
 * KHÔNG touch subscription — chưa có (subscription chỉ tạo khi webhook 'paid').
 *
 * Trả về row payment đã update (để controller pass lại cho FE).
 *
 * Ưu tiên dùng `paymentLinkId` thay vì `orderCode`:
 *   - orderCode = Date.now() % 1e9 → có thể trùng (đặc biệt khi nhiều request cùng tick).
 *     Nếu trùng, PayOS cancel theo orderCode có thể cancel SAI link.
 *   - paymentLinkId là unique từ PayOS → cancel đúng link.
 *   - Fallback về orderCode nếu rawResponse không có paymentLinkId (legacy/seed rows).
 */
async function cancelPendingPaymentLink(payment: Payment): Promise<Payment> {
  // Top-level defensive try/catch — log TOÀN BỘ context để user debug 500.
  // Trước đây nếu DB UPDATE throw (vd: column missing, enum mismatch) thì
  // controller catch `next(err)` → 500 với log "Unhandled error" không có detail.
  try {
    const raw = payment.rawResponse as Record<string, unknown> | null;
    const paymentLinkId =
      raw && typeof raw.paymentLinkId === "string" ? raw.paymentLinkId : null;

    try {
      if (paymentLinkId) {
        await payOS.paymentRequests.cancel(paymentLinkId, "User cancelled");
      } else {
        await payOS.paymentRequests.cancel(
          Number(payment.orderCode),
          "User cancelled",
        );
      }
    } catch (err) {
      // PayOS cancel fail → KHÔNG throw, vẫn phải UPDATE DB để user không bị stuck.
      const payosError = err as {
        message?: string;
        code?: string;
        response?: { status?: number; data?: unknown };
      };
      logger.error(
        {
          err: payosError.message ?? String(err),
          payosStatus: payosError.response?.status,
          payosBody: payosError.response?.data,
          orderCode: payment.orderCode,
          paymentLinkId,
          paymentId: payment.id,
        },
        "PayOS cancel API failed — proceeding DB update anyway",
      );
    }

    const [updated] = await db
      .update(payments)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning();

    if (!updated) { 
      throw new AppError(
        404,
        "PAYMENT_NOT_FOUND",
        "Payment không tồn tại hoặc đã bị xóa",
      );
    }

    return updated;
  } catch (err) {
    // Catch-all: log full context + re-throw để errorHandler convert → HTTP response.
    // Nếu là AppError thì rethrow as-is (đã có statusCode đúng).
    if (err instanceof AppError) throw err;
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        errStack: err instanceof Error ? err.stack : undefined,
        errName: err instanceof Error ? err.name : undefined,
        // Postgres-specific fields nếu có (pg driver gắn vào Error object)
        pgCode: (err as { code?: string } | null)?.code,
        pgDetail: (err as { detail?: string } | null)?.detail,
        pgHint: (err as { hint?: string } | null)?.hint,
        paymentId: payment.id,
        orderCode: payment.orderCode,
      },
      "cancelPendingPaymentLink: unhandled error",
    );
    throw err;
  }
}

async function generateUniqueOrderCode(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<{ orderCode: number; orderCodeStr: string }> {
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const orderCode = generateOrderCode();
    const orderCodeStr = String(orderCode);

    const [existing] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.orderCode, orderCodeStr))
      .limit(1);

    if (!existing) return { orderCode, orderCodeStr };
  }

  throw new AppError(
    500,
    "ORDER_CODE_GENERATION_FAILED",
    "Không thể tạo mã đơn hàng sau nhiều lần thử. Vui lòng thử lại sau.",
  );
}

/**
 * Tạo payment row ở trạng thái 'pending' với orderCode unique (xem `generateUniqueOrderCode`).
 *
 * DB unique constraint `uniq_payments_order_code` vẫn là defense in depth
 * cho TOCTOU race (2 request cùng SELECT miss, cùng INSERT) — lúc đó 1
 * request fail 23505 và bubble lên caller dưới dạng 500.
 */
async function createPendingPaymentRow(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  planId: string,
  plan: { priceVnd: string },
): Promise<{ payment: Payment; orderCode: number }> {
  const { orderCode, orderCodeStr } = await generateUniqueOrderCode(tx);

  const [payment] = await tx
    .insert(payments)
    .values({
      userId,
      planId,
      subscriptionId: null,
      amountVnd: plan.priceVnd,
      orderCode: orderCodeStr,
      payosTxnId: null,
      status: "pending",
      rawResponse: null,
    })
    .returning();

  return { payment, orderCode };
}

/**
 * Shape của PayOS response data sau khi create payment link thành công.
 * Lấy từ docs @payos/node → CreatePaymentLinkResponse.data.
 */
interface PayOSPaymentLinkData {
  checkoutUrl: string;
  qrCode: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  description: string;
  paymentLinkId: string;
  // PayOS trả thêm nhiều fields khác (bin, accountNumber...) nhưng ta không dùng.
  [key: string]: unknown;
}

/**
 * Gọi PayOS API tạo payment link.
 *
 * Flow:
 *   1. Build payload (orderCode, amount, description, returnUrl, cancelUrl).
 *   2. Build HMAC-SHA256 signature (PayOS yêu cầu, đúng thứ tự field).
 *   3. POST /v2/payment-requests với headers `x-client-id` + `x-api-key`.
 *   4. Validate response code ("00" = success — sandbox docs dùng "00", docs cũ "00000").
 *   5. Trả về data (checkoutUrl, qrCode, ...) — caller save vào payment.rawResponse.
 *
 * Error handling: mọi lỗi từ PayOS (network, timeout, code != "00") → log
 * error + throw AppError(502, PAYOS_API_ERROR) với message chi tiết.
 */
async function createPayOSPaymentLink(
  orderCode: number,
  plan: { name: string; priceVnd: string },
): Promise<PayOSPaymentLinkData> {
  const amount = Number(plan.priceVnd);
  const description = `Mua goi ${plan.name}`;
  const returnUrl = env.PAYOS_RETURN_URL;
  const cancelUrl = env.PAYOS_CANCEL_URL;

  const signature = createPayOSSignature({
    orderCode,
    amount,
    description,
    returnUrl,
    cancelUrl,
  });

  try {
    const { data: payosResponse } = await axios.post(
      `${PAYOS_API}/payment-requests`,
      { orderCode, amount, description, returnUrl, cancelUrl, signature },
      {
        headers: {
          "x-client-id": env.PAYOS_CLIENT_ID,
          "x-api-key": env.PAYOS_API_KEY,
          "Content-Type": "application/json",
        },
      },
    );
    if (payosResponse.code != "00" && payosResponse.code != 0) {
      throw new AppError(
        502,
        "PAYOS_API_ERROR",
        `PayOS error [${payosResponse.code}]: ${payosResponse.desc || "Unknown"}`,
      );
    }
    return payosResponse.data as PayOSPaymentLinkData;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error(
      {
        axiosError: axios.isAxiosError(err)
          ? {
              status: err.response?.status,
              payosCode: (err.response?.data as any)?.code,
              payosDesc: (err.response?.data as any)?.desc,
              payosSignature: (err.response?.data as any)?.signature,
              fullResponse: err.response?.data,
            }
          : null,
        requestPayload: { orderCode, amount, description, returnUrl, cancelUrl },
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      "PAYOS_API_FAILED",
    );
    throw new AppError(
      502,
      "PAYOS_API_ERROR",
      axios.isAxiosError(err)
        ? `PayOS ${err.response?.status}: ${(err.response?.data as any)?.desc || err.message}`
        : "Không thể tạo payment link với PayOS",
    );
  }
}

