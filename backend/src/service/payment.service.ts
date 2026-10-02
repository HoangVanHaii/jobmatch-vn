import axios from "axios";
import crypto from "crypto";
import { PayOS } from "@payos/node";
import { db } from "../config/database";
import { payments, plans, subscriptions } from "../db/schema";
import { eq, and, sql, desc, lt, gt, asc } from "drizzle-orm";
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

// Singleton PayOS client — create/cancel payment link; reconciliation job
// dùng paymentRequests.get để hỏi trạng thái thật (fix HIGH #1);
// webhooks router có client riêng chỉ để verify signature.
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
 * Ngưỡng tuổi tối đa của một payment 'pending' trước khi bị sweep thành
 * 'expired' (last-resort janitor).
 *
 * 7 NGÀY = giới hạn trên của reconcile window: reconcile job (mỗi 10 phút,
 * paymentReconciliation.worker) hỏi TRỰC TIẾP PayOS với mọi payment pending
 * tuổi (10 phút, 7 ngày) và finalize/sync theo status thật từ PayOS. Chỉ row
 * TRƯỢT khỏi window này — tức reconcile đã có ~1000 cơ hội hỏi PayOS mà vẫn
 * pending, gần như chỉ khi job bị tắt cả tuần — mới bị sweep.
 *
 * Lý do giữ sweep thay vì bỏ hẳn (chọn phương án ít rủi ro hơn): nếu reconcile
 * disabled/lỗi kéo dài thì không còn gì chuyển trạng thái → payment 'pending'
 * vĩnh viễn làm bẩn history. 7d an toàn vì PayOS link đã expire từ lâu
 * (default 24h theo docs PayOS — 24h từng là cutoff cũ của hàm này) → không
 * thể phát sinh tiền thật sau thời điểm đó.
 */
const STALE_PENDING_MS = 7 * 24 * 60 * 60 * 1000;

/** Reconcile: chỉ quét payment pending chờ ít nhất 10 phút — đủ thời gian
 *  cho webhook đến + retry đầu tiên, tránh đốt PayOS API cho payment mới tạo. */
const RECONCILE_MIN_AGE_MS = 10 * 60 * 1000;

/** Reconcile: trần tuổi — vượt ngưỡng này do sweep xử lý (xem STALE_PENDING_MS). */
const RECONCILE_MAX_AGE_MS = STALE_PENDING_MS;

/** Reconcile: số payment tối đa mỗi chu kỳ 10 phút — chống đụng rate limit PayOS. */
const RECONCILE_BATCH_SIZE = 50;

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
 *       UPDATE payments SET status='expired' WHERE status='pending' AND created_at < now() - 7d
 *   - Sau update, SELECT sẽ không còn thấy rows stale.
 *
 * fix HIGH #1 (2026-10-01): cutoff 24h → 7 ngày. Sweep 24h cũ từng đánh dấu
 * 'expired' những payment mà user ĐÃ trả tiền nhưng webhook fail — không còn
 * đường nào cứu. Giờ reconcile job hỏi PayOS thật trong window (10 phút, 7
 * ngày); sweep chỉ là last-resort ngoài window (xem STALE_PENDING_MS).
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
        "Tự động chuyển payment pending quá hạn sang expired",
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
      "Lazy cleanup payment pending thất bại — tiếp tục mà không cleanup",
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

/**
 * Nguồn gọi finalize — chỉ dùng cho log/observability, logic như nhau.
 */
export type FinalizeSource = "webhook" | "reconcile" | "admin";

/**
 * Lỗi phân loại cho luồng finalize payment — router/webhooks dựa vào `code`
 * để quyết định HTTP status thay vì catch-all:
 *   - PAYMENT_NOT_FOUND : orderCode không tồn tại trong DB → KHÔNG retry
 *     (request test của webhooks.confirm dùng orderCode giả → phải trả 200).
 *   - AMOUNT_MISMATCH   : số tiền PayOS báo nhận ≠ payment.amountVnd → KHÔNG
 *     retry, KHÔNG cấp gói — admin xử lý tay.
 *   - TRANSIENT         : DB/pool/timeout/deadlock/exception chưa phân loại
 *     → retryable (webhook trả 5xx để PayOS retry; reconcile tự retry chu kỳ).
 */
export class PaymentFinalizeError extends Error {
  constructor(
    public readonly code:
      | "PAYMENT_NOT_FOUND"
      | "AMOUNT_MISMATCH"
      | "TRANSIENT",
    public readonly orderCode: string,
    public readonly stage: string,
    public readonly cause?: unknown,
  ) {
    super(`Finalize payment thất bại [${code}] orderCode=${orderCode} stage=${stage}`);
    this.name = "PaymentFinalizeError";
  }

  get retryable(): boolean {
    return this.code === "TRANSIENT";
  }
}

/**
 * Finalize payment thành 'paid' + cấp subscription — HÀM DUY NHẤT trong
 * codebase thực hiện việc này, dùng chung cho 3 đường:
 *   - webhook   : PayOS callback (amount từ payload đã verify signature)
 *   - reconcile : BullMQ job đối chiếu PayOS (amount từ PaymentLink.amountPaid)
 *   - admin     : POST /payments/:id/finalize (amount từ PaymentLink.amountPaid)
 *
 * Transaction + row lock:
 *   - SELECT ... FOR UPDATE → 2 webhook/reconcile song song cùng orderCode
 *     được serialize tại DB; lần 2 thấy status='paid' → return null (idempotent).
 *
 * Business rules (chốt 2026-10-01):
 *   - Payment đang 'cancelled' / 'expired' / 'failed' mà PayOS báo đã nhận
 *     tiền → VẪN finalize (tiền đã trừ thật), log warn để audit.
 *   - Plan đã inactive → VẪN cấp subscription theo plan của payment
 *     (subscriptionService.create dùng getPlanForFinalizeTx — không check isActive).
 *   - amount ≠ payment.amountVnd → throw AMOUNT_MISMATCH, không đụng DB.
 *
 * @param paidAmount  Số tiền PayOS xác nhận đã nhận (webhook: rawData.amount;
 *                    reconcile/admin: PaymentLink.amountPaid).
 * @param rawResponse Optional — chỉ đường webhook lưu payload PayOS vào DB
 *                    (giữ hành vi cũ); reconcile/admin không đụng rawResponse.
 * @returns PaymentUpdatedEvent nếu finalize mới, null nếu payment đã 'paid' từ trước.
 */
async function finalizePayment(
  orderCode: string,
  payosTxnId: string,
  source: FinalizeSource,
  paidAmount: number,
  rawResponse?: Record<string, unknown>,
): Promise<PaymentUpdatedEvent | null> {
  try {
    return await db.transaction(
      async (tx): Promise<PaymentUpdatedEvent | null> => {
        // FOR UPDATE: serialize các request finalize cùng orderCode.
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.orderCode, orderCode))
          .for("update")
          .limit(1);

        if (!payment || !payment.planId) {
          throw new PaymentFinalizeError(
            "PAYMENT_NOT_FOUND",
            orderCode,
            "lookup",
          );
        }

        // Idempotency: đã finalize từ trước (webhook retry / reconcile trùng)
        // → không update, không tạo sub, không emit.
        if (payment.status === "paid") {
          return null;
        }

        // Business: cancelled/expired/failed vẫn finalize — tiền đã trừ thật.
        if (payment.status !== "pending") {
          logger.warn(
            {
              orderCode,
              paymentId: payment.id,
              source,
              previousStatus: payment.status,
            },
            "Finalize payment ở trạng thái khác pending (PayOS đã nhận tiền)",
          );
        }

        // Amount verification — lệch thì KHÔNG cấp gói, admin xử lý tay.
        const expectedAmount = Number(payment.amountVnd);
        if (paidAmount !== expectedAmount) {
          logger.error(
            {
              orderCode,
              paymentId: payment.id,
              source,
              expectedAmount,
              paidAmount,
            },
            "AMOUNT_MISMATCH — không finalize payment, cần admin xem lại",
          );
          throw new PaymentFinalizeError(
            "AMOUNT_MISMATCH",
            orderCode,
            "amount_verify",
          );
        }

        // Update payment status = paid
        await tx
          .update(payments)
          .set({
            status: "paid",
            payosTxnId,
            updatedAt: new Date(), // stamp lúc finalize → đẩy lên top list (migration 0017)
            ...(rawResponse ? { rawResponse } : {}),
          })
          .where(eq(payments.id, payment.id));

        // Tạo subscription (cancel mọi sub active cũ + insert mới — xem
        // subscription.service.ts). Plan inactive vẫn cấp (business chốt).
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
  } catch (err) {
    // Lỗi nghiệp vụ đã phân loại → giữ nguyên để route quyết HTTP status.
    if (err instanceof PaymentFinalizeError) throw err;
    // Mọi lỗi khác (DB down, pool, deadlock, lỗi code) = transient → retryable.
    throw new PaymentFinalizeError(
      "TRANSIENT",
      orderCode,
      "transaction",
      err instanceof Error ? err : String(err),
    );
  }
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

      // Gói miễn phí KHÔNG đi qua payment: PayOS sẽ reject amount 0 với lỗi
      // 502 mù mờ. Free do hệ thống tự cấp (refreshFreeSubscriptionForUser
      // khi gói trả phí hết hạn) — chặn tường minh ngay từ BE thay vì ỷ lại
      // vào validation của third-party.
      if (Number(plan.priceVnd) === 0) {
        throw new AppError(
          400,
          "FREE_PLAN_NOT_PURCHASABLE",
          "Gói miễn phí không cần thanh toán — hệ thống sẽ tự kích hoạt khi gói trả phí hết hạn.",
        );
      }

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
    // Lazy cleanup: chuyển pending payments > 7 ngày thành 'expired' trư�c khi SELECT.
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
    // Lazy cleanup: chuyển pending payments > 7 ngày thành 'expired' trước khi SELECT.
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
    // Lazy cleanup: chuyển pending payments > 7 ngày thành 'expired' trước khi SELECT.
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
   *
   * Toàn bộ logic finalize nằm ở `finalizePayment()` (dùng chung cho
   * webhook / reconcile / admin) — hàm này chỉ:
   *   1. Verify amount từ payload ĐÃ verify signature (rawData.amount).
   *   2. Gọi finalizePayment(source='webhook').
   *   3. Emit WebSocket SAU KHI commit (không emit trong transaction).
   *
   * @param orderCode   Mã đơn hàng từ PayOS
   * @param payosTxnId  Reference/transaction ID từ PayOS
   * @param rawData     Payload PayOS đã qua verify signature
   */
  handlePayOSWebhook: async (
    orderCode: string,
    payosTxnId: string,
    rawData: Record<string, unknown>,
  ): Promise<void> => {
    const paidAmount = Number((rawData as { amount?: unknown }).amount);
    if (!Number.isFinite(paidAmount)) {
      // Payload đã verify signature nhưng thiếu amount — invariant PayOS broken.
      // Coi là transient để PayOS retry; nếu persistent, reconcile job sẽ xử lý.
      logger.error(
        { orderCode, payosTxnId },
        "Payload webhook thiếu/invalid amount — coi là transient",
      );
      throw new PaymentFinalizeError(
        "TRANSIENT",
        orderCode,
        "webhook_amount_parse",
      );
    }

    // Capture thông tin cần emit SAU KHI transaction commit.
    // Không emit trong transaction — nếu commit fail thì FE đã nhận event sai.
    const emitted: PaymentUpdatedEvent | null = await finalizePayment(
      orderCode,
      payosTxnId,
      "webhook",
      paidAmount,
      rawData,
    );

    // ===== SAU KHI COMMIT → emit WebSocket =====
    // Emit khi finalize thành công (đi kèm navigate /billing/success ở FE).
    // Webhook duplicate/retry -> finalizePayment trả null -> không emit, không log.
    if (emitted) {
      const userId = await getUserIdByOrderCode(orderCode);
      notificationGateway.emitToUser(userId, "payment:updated", emitted);
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

  /**
   * Admin force-finalize 1 payment (CS tool) — fix HIGH #1.
   *
   * Bắt buộc hỏi PayOS TRƯỚC: `paymentRequests.get` — PayOS không báo PAID
   * thì KHÔNG finalize (không tin trạng thái do admin nhập). PAID → verify
   * amountPaid → finalizePayment(source='admin'), dùng chung đường finalize
   * duy nhất với webhook/reconcile.
   *
   * Lỗi: 404 PAYMENT_NOT_FOUND / 409 PAYMENT_ALREADY_PAID /
   *      409 PAYOS_NOT_PAID / 409 PAYMENT_AMOUNT_MISMATCH / 409 NOT_FINALIZABLE.
   */
  finalizeById: async (id: string): Promise<Payment> => {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1);

    if (!payment) {
      throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment không tồn tại");
    }
    if (!payment.planId) {
      throw new AppError(
        409,
        "PAYMENT_NOT_FINALIZABLE",
        "Payment không gắn với plan (legacy row) — không thể cấp subscription",
      );
    }
    if (payment.status === "paid") {
      throw new AppError(
        409,
        "PAYMENT_ALREADY_PAID",
        "Payment đã được thanh toán trước đó",
      );
    }

    // Hỏi PayOS — source of truth. Ưu tiên paymentLinkId (pattern như cancel).
    const raw = payment.rawResponse as Record<string, unknown> | null;
    const paymentLinkId =
      raw && typeof raw.paymentLinkId === "string" ? raw.paymentLinkId : null;
    const link = paymentLinkId
      ? await payOS.paymentRequests.get(paymentLinkId)
      : await payOS.paymentRequests.get(Number(payment.orderCode));

    if (link.status !== "PAID") {
      throw new AppError(
        409,
        "PAYOS_NOT_PAID",
        `PayOS báo status '${link.status}' — chỉ finalize được khi PayOS xác nhận PAID. Nếu chưa, hãy chờ reconcile job.`,
      );
    }

    const txnRef =
      link.transactions && link.transactions.length > 0
        ? String(link.transactions[0].reference)
        : link.id;

    let emitted: PaymentUpdatedEvent | null;
    try {
      emitted = await finalizePayment(
        payment.orderCode,
        txnRef,
        "admin",
        link.amountPaid,
      );
    } catch (err) {
      if (
        err instanceof PaymentFinalizeError &&
        err.code === "AMOUNT_MISMATCH"
      ) {
        throw new AppError(
          409,
          "PAYMENT_AMOUNT_MISMATCH",
          `Số tiền PayOS xác nhận (${link.amountPaid}) khác số tiền payment (${Number(payment.amountVnd)}) — cần review thủ công, không finalize tự động`,
        );
      }
      throw err;
    }

    if (!emitted) {
      throw new AppError(
        409,
        "PAYMENT_ALREADY_PAID",
        "Payment đã được finalize trong lúc xử lý (race với webhook/reconcile)",
      );
    }
    /*
    logger.info(
      { orderCode: payment.orderCode, paymentId: payment.id, subscriptionId: emitted.subscriptionId },
      "Admin đã finalize payment (PayOS xác nhận PAID)",
    );
      
    */

    const [updated] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1);
    return updated;
  },

  /**
   * Reconciliation — đối chiếu payment 'pending' với PayOS (fix HIGH #1).
   *
   * Webhook KHÔNG còn là đường finalize duy nhất: job BullMQ chạy mỗi 10 phút
   * (paymentReconciliation.worker) quét payment 'pending' tuổi (10 phút, 7
   * ngày] và hỏi thẳng PayOS paymentRequests.get. Bảo đảm: user trả tiền mà
   * webhook thất bại (500 bị PayOS không retry, 429 rate limit, lỗi DB…) vẫn
   * được cấp gói trong vòng ~10-20 phút.
   *
   * Mapping PaymentLinkStatus → hành động:
   *   PAID      → verify amountPaid === amountVnd → finalizePayment('reconcile')
   *   EXPIRED   → payment 'expired'   (conditional UPDATE WHERE status='pending')
   *   CANCELLED → payment 'cancelled' (như trên)
   *   FAILED    → payment 'failed'    (như trên)
   *   PENDING / PROCESSING / UNDERPAID → giữ nguyên, chỉ log
   *     (business chốt 2026-10-01: chưa đủ tiền / chưa xử lý xong → KHÔNG cấp gói)
   *
   * An toàn:
   *   - Lỗi 1 payment (PayOS timeout/4xx) KHÔNG làm hỏng batch — try/catch từng item.
   *   - finalizePayment tự FOR UPDATE → an toàn khi webhook cùng lúc finalize.
   *   - Batch giới hạn + xử lý tuần tự → không đụng rate limit PayOS.
   *   - DRY_RUN (env PAYMENT_RECONCILE_DRY_RUN, default 'true'): chỉ log
   *     kết quả sẽ làm, KHÔNG ghi DB — dùng cho lần deploy đầu.
   */
  reconcilePendingPayments: async (opts?: {
    dryRun?: boolean;
    batchSize?: number;
  }): Promise<{
    dryRun: boolean;
    scanned: number;
    finalized: number;
    statusSynced: number;
    keptPending: number;
    amountMismatches: number;
    errors: number;
  }> => {
    const dryRun = opts?.dryRun ?? true;
    const batchSize = opts?.batchSize ?? RECONCILE_BATCH_SIZE;

    const now = Date.now();
    const rows = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.status, "pending"),
          lt(payments.createdAt, new Date(now - RECONCILE_MIN_AGE_MS)),
          gt(payments.createdAt, new Date(now - RECONCILE_MAX_AGE_MS)),
        ),
      )
      .orderBy(asc(payments.createdAt))
      .limit(batchSize);

    const summary = {
      dryRun,
      scanned: rows.length,
      finalized: 0,
      statusSynced: 0,
      keptPending: 0,
      amountMismatches: 0,
      errors: 0,
    };

    for (const payment of rows) {
      const orderCode = payment.orderCode;
      try {
        // Ưu tiên paymentLinkId (unique phía PayOS — pattern như cancel);
        // fallback orderCode cho row legacy thiếu rawResponse.
        const raw = payment.rawResponse as Record<string, unknown> | null;
        const paymentLinkId =
          raw && typeof raw.paymentLinkId === "string"
            ? raw.paymentLinkId
            : null;

        const link = paymentLinkId
          ? await payOS.paymentRequests.get(paymentLinkId)
          : await payOS.paymentRequests.get(Number(orderCode));

        const txnRef =
          link.transactions && link.transactions.length > 0
            ? String(link.transactions[0].reference)
            : link.id;

        if (link.status === "PAID") {
          // Verify amount TRƯỚC khi finalize (finalizePayment verify lại lần
          // nữa trong tx — defense in depth).
          const expectedAmount = Number(payment.amountVnd);
          if (link.amountPaid !== expectedAmount) {
              summary.amountMismatches += 1;
              /*
            logger.error(
              {
                orderCode,
                paymentId: payment.id,
                expectedAmount,
                amountPaid: link.amountPaid,
              },
              "Reconcile: AMOUNT_MISMATCH — không finalize, cần admin xem lại",
            );
            */
            continue;
          }

          if (dryRun) {
              summary.finalized += 1;
              /*
            logger.info(
              {
                orderCode,
                paymentId: payment.id,
                payosStatus: link.status,
                amountPaid: link.amountPaid,
              },
              "[DRY_RUN] Reconcile sẽ finalize payment (PayOS xác nhận PAID)",
            );
            */
            continue;
          }

          // emitted = null khi webhook đã finalize trước trong race — vô hại,
          // không log (noise); payment 'paid' là kết quả đúng rồi.
          const emitted = await finalizePayment(
            orderCode,
            txnRef,
            "reconcile",
            link.amountPaid,
          );
          if (emitted) {
              summary.finalized += 1;
              /*
            logger.info(
              { orderCode, subscriptionId: emitted.subscriptionId },
              "Reconcile đã finalize payment (PayOS xác nhận đã nhận tiền)",
            );
            */
          }
          continue;
        }

        const syncMap: Record<string, "expired" | "cancelled" | "failed"> = {
          EXPIRED: "expired",
          CANCELLED: "cancelled",
          FAILED: "failed",
        };
        const mappedStatus = syncMap[link.status];
        if (mappedStatus) {
          if (dryRun) {
              summary.statusSynced += 1;
              /*
            logger.info(
              { orderCode, payosStatus: link.status, wouldStatus: mappedStatus },
              "[DRY_RUN] Reconcile sẽ đồng bộ trạng thái payment",
            );
              */
            continue;
          }
          // Conditional update — nếu webhook vừa finalize thì 0 row, không ghi đè.
          // Không log per-item: kết quả nằm trong summary (statusSynced) + row DB.
          await db
            .update(payments)
            .set({ status: mappedStatus, updatedAt: new Date() })
            .where(
              and(eq(payments.id, payment.id), eq(payments.status, "pending")),
            );
          summary.statusSynced += 1;
          continue;
        }

        // PENDING / PROCESSING / UNDERPAID — chưa settled, giữ nguyên.
        // Không log từng item (sẽ lặp mỗi chu kỳ) — con số tổng hợp
        // keptPending đã nằm trong log "Payment reconciliation run complete".
        summary.keptPending += 1;
      } catch (err) {
        if (err instanceof PaymentFinalizeError && err.code === "AMOUNT_MISMATCH") {
          summary.amountMismatches += 1;
        } else {
          summary.errors += 1;
        }
        logger.error(
          {
            orderCode,
            err: err instanceof Error ? err.message : String(err),
          },
          "Reconcile: lỗi 1 payment — tiếp tục batch",
        );
      }
    }

    return summary;
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
        "PayOS cancel API lỗi — vẫn cập nhật DB để user không bị kẹt",
      );
    }

    // Guard trạng thái trong WHERE (defense chống race với webhook finalize):
    // nếu payment đã chuyển 'paid' giữa lúc SELECT và UPDATE, statement này
    // impact 0 row → throw 409 thay vì ghi đè trạng thái 'paid' của payment
    // đã được thanh toán.
    const [updated] = await db
      .update(payments)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(
        and(eq(payments.id, payment.id), eq(payments.status, "pending")),
      )
      .returning();

    if (!updated) {
      throw new AppError(
        409,
        "PAYMENT_NOT_CANCELLABLE",
        "Payment không còn ở trạng thái 'pending' (có thể vừa được thanh toán hoặc đã được finalize).",
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
      "cancelPendingPaymentLink: lỗi chưa phân loại",
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
      "Gọi PayOS API tạo payment link thất bại",
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

