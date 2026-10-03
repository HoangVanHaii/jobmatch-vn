<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { Loader2, X, XCircle, Copy, CheckCircle2, CreditCard, Calendar, Clock, Hash, ExternalLink, Receipt, AlertTriangle } from 'lucide-vue-next';
import QRCode from 'qrcode';
import { paymentApi } from '@services/payment.api';
import { connectSocket } from '@services/socket';
import { usePaymentUpdates } from '@composables/usePaymentUpdates';
import type { PaymentWithPlan } from '@/types/payment';
import type { PaymentStatus } from '@/types/payment';

const props = defineProps<{
    open: boolean;
    paymentId: string | null;
}>();

const emit = defineEmits<{
    close: [];
    /**
     * Emit sau khi user cancel payment thành công.
     * Payload: paymentId để parent refresh đúng row trong list.
     */
    cancelled: [paymentId: string];
}>();

const data = ref<PaymentWithPlan | null>(null);
const loading = ref(false);
const errorMsg = ref('');
const copied = ref(false);
const qrDataUrl = ref<string>('');
const cancelling = ref(false);
/** Step 1 của cancel: show inline confirmation UI (thay vì window.confirm). */
const confirmingCancel = ref(false);
/** Card modal — focus vào đây khi mở (a11y: dialog nhận focus). */
const modalCard = ref<HTMLElement | null>(null);
/** Element đã focus trước khi mở modal — trả focus lại khi đóng (a11y). */
let lastFocused: HTMLElement | null = null;

async function fetchDetail(id: string) {
    loading.value = true;
    errorMsg.value = '';
    // Refetch (realtime paid/failed): giữ nội dung cũ trong lúc tải để không flash spinner
    if (!data.value || data.value.id !== id) data.value = null;
    try {
        const result = await paymentApi.getById(id);
        data.value = result;
    } catch (err: any) {
        if (err?.name === 'CanceledError') return;
        errorMsg.value = err?.response?.data?.error?.message ?? 'Không thể tải chi tiết thanh toán';
    } finally {
        loading.value = false;
    }
}

watch(
    () => [props.open, props.paymentId] as const,
    async ([isOpen, id]) => {
        if (isOpen && id) {
            lastFocused = document.activeElement as HTMLElement | null;
            await fetchDetail(id);
            // Focus vào card modal khi mở (a11y)
            nextTick(() => modalCard.value?.focus());
        } else if (!isOpen) {
            data.value = null;
            errorMsg.value = '';
            loading.value = false;
            copied.value = false;
            qrDataUrl.value = '';
            // Trả focus về element đã mở modal (a11y)
            lastFocused?.focus?.();
            lastFocused = null;
        }
    },
);

watch(
    () => [data.value?.status, data.value?.payosInfo?.qrCode] as const,
    async ([status, qrString]) => {
        if (status === 'pending' && qrString) {
            try {
                qrDataUrl.value = await QRCode.toDataURL(qrString, {
                    errorCorrectionLevel: 'M',
                    margin: 1,
                    width: 256,
                    color: { dark: '#000000', light: '#FFFFFF' },
                });
            } catch {
                qrDataUrl.value = '';
            }
        } else {
            qrDataUrl.value = '';
        }
    },
);

// ===== Realtime: subscribe `payment:updated` để auto-refresh khi user thanh toán t� QR trong modal =====
// Tận dụng usePaymentUpdates (cùng pattern PaymentQRModal). Khi nhận event đúng orderCode → refetch detail.
const currentOrderCode = computed<string | null>(() => data.value?.orderCode ?? null);

usePaymentUpdates(currentOrderCode, {
    onPaid: () => {
        // PayOS webhook đã commit DB → refetch để lấy status='paid', subscriptionId, payosTxnId mới nhất.
        if (props.paymentId) fetchDetail(props.paymentId);
    },
    onFailed: () => {
        // Thanh toán fail → refetch để hiển thị status='failed'.
        if (props.paymentId) fetchDetail(props.paymentId);
    },
});

onMounted(() => {
    // Defensive — NotificationBell thường đã connect socket rồi, nhưng gọi lại để idempotent an toàn.
    connectSocket();
    document.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown);
});

/** Tên gói hiển thị NGUYÊN VĂN theo database (plans.name do BE trả về). */
const planDisplayName = computed(() => data.value?.planName || '—');

/** Escape đóng modal — nếu đang ở bước confirm hủy thì chỉ gỡ confirm. */
function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !props.open) return;
    if (confirmingCancel.value) {
        dismissCancel();
        return;
    }
    close();
}

function openPayOS() {
    const url = data.value?.payosInfo?.checkoutUrl;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

function close() {
    // Reset confirm state nếu user đóng modal giữa chừng.
    confirmingCancel.value = false;
    emit('close');
}

/**
 * User chủ động hủy payment link đang 'pending'.
 *
 * Flow:
 *   1. Confirm dialog (destructive action — tránh click nhầm).
 *   2. POST /payments/:id/cancel → BE gọi PayOS cancel + UPDATE status='cancelled'.
 *   3. Refetch detail để UI hiển thị status mới (badge "Đã huỷ", QR block ẩn).
 *
 * Lỗi phổ biến:
 *   - 409 PAYMENT_NOT_CANCELLABLE: webhook vừa paid → không thể cancel nữa.
 *   - 404: payment không tồn tại (race với admin delete, ít gặp).
 *
 * UX: KHÔNG auto-close modal sau cancel thành công — để user thấy status đã đổi
 * sang "Đã huỷ" rồi tự bấm "Đóng". Nếu auto-close thì user tưởng cancel fail.
 */
/** Step 1: user click nút "Hủy thanh toán" → hiện confirm inline. */
function askCancel() {
    confirmingCancel.value = true;
}

/** Step 1b: user đổi ý, đóng confirm. */
function dismissCancel() {
    confirmingCancel.value = false;
}

/** Step 2: user confirm → gọi API. */
async function cancelPayment() {
    if (!props.paymentId) return;

    confirmingCancel.value = false;
    cancelling.value = true;
    errorMsg.value = '';
    try {
        await paymentApi.cancel(props.paymentId);
        // Refetch để badge đổi "Đang xử lý" → "Đã huỷ", QR block ẩn.
        await fetchDetail(props.paymentId);
        // Báo cho parent biết để refresh list (badge + updatedAt ở table).
        emit('cancelled', props.paymentId);
    } catch (err: any) {
        if (err?.name === 'CanceledError') return;
        errorMsg.value =
            err?.response?.data?.error?.message ?? 'Không thể hủy thanh toán. Vui lòng thử lại.';
    } finally {
        cancelling.value = false;
    }
}

async function copyOrderCode(code: string) {
    try {
        await navigator.clipboard.writeText(code);
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 1500);
    } catch {
        /* ignore */
    }
}

function formatPrice(v: string | number): string {
    return Number(v).toLocaleString('vi-VN') + 'đ';
}

function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

// Local copy of payStatusBadge (same shape used in BillingHistoryView).
// Duplicated intentionally to avoid cross-component coupling — giữ cùng palette
// slate + ring với danh sách để 1 trạng thái không có 2 màu tuỳ nơi xem.
const payStatusBadge: Record<PaymentStatus, { label: string; cls: string }> = {
    paid:      { label: 'Thành công',  cls: 'bg-green-50 text-green-700 ring-1 ring-green-200' },
    pending:   { label: 'Đang xử lý', cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
    failed:    { label: 'Thất bại',   cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
    cancelled: { label: 'Đã huỷ',     cls: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' },
    refunded:  { label: 'Đã hoàn tiền', cls: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
    expired:   { label: 'Hết hạn',    cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
};
</script>

<template>
    <Teleport to="body">
        <div
            v-if="open"
            class="fixed inset-0 z-50 bg-black/40 flex justify-center p-4 overflow-y-auto overscroll-contain"
            @click.self="close"
        >
            <div
                ref="modalCard"
                role="dialog"
                aria-modal="true"
                aria-labelledby="payment-detail-title"
                tabindex="-1"
                class="bg-white rounded-xl shadow-2xl w-full max-w-[560px] my-auto outline-none"
            >
                <!-- Header (~56px) -->
                <div class="flex items-center justify-between px-5 py-3 border-b">
                    <h2 id="payment-detail-title" class="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Receipt class="w-5 h-5 text-primary-600" />
                        Chi tiết thanh toán
                    </h2>
                    <button
                        type="button"
                        class="p-1.5 -m-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
                        aria-label="Đóng"
                        @click="close"
                    >
                        <X class="w-5 h-5" />
                    </button>
                </div>

                <!-- Body — compact, không scroll nội bộ -->
                <div class="px-5 py-4 space-y-3">
                    <!-- Loading -->
                    <div v-if="loading" class="flex items-center justify-center gap-2 py-12 text-gray-500">
                        <Loader2 class="w-5 h-5 animate-spin" />
                        Đang tải...
                    </div>

                    <!-- Error -->
                    <div v-else-if="errorMsg" class="flex items-start gap-2 text-red-600 py-4">
                        <XCircle class="w-5 h-5 mt-0.5" />
                        <span>{{ errorMsg }}</span>
                    </div>

                    <!-- Data -->
                    <div v-else-if="data" class="space-y-3">
                        <!-- Thông tin gói + QR bên phải (QR chỉ với đơn pending có qrCode), QR ~96px -->
                        <div class="rounded-xl border border-gray-100 bg-gray-50 p-4 flex gap-4">
                            <div class="flex-1 min-w-0">
                                <p class="text-xs font-medium uppercase tracking-wider text-gray-400">Gói</p>
                                <div class="mt-1 flex items-baseline justify-between gap-3">
                                    <p class="text-base font-semibold text-gray-900 truncate">{{ planDisplayName }}</p>
                                    <span
                                        v-if="data.planDurationDays"
                                        class="shrink-0 text-xs text-gray-500"
                                    >{{ data.planDurationDays }} ngày</span>
                                </div>
                                <p class="mt-1.5 text-2xl font-bold text-primary-700">{{ formatPrice(data.amountVnd) }}</p>
                            </div>

                            <div
                                v-if="data.status === 'pending' && data.payosInfo?.qrCode"
                                class="shrink-0 w-[96px] self-center text-center"
                            >
                                <img
                                    v-if="qrDataUrl"
                                    :src="qrDataUrl"
                                    alt="QR thanh toán PayOS"
                                    class="w-[96px] h-[96px] rounded-lg border border-gray-200 bg-white"
                                />
                                <div
                                    v-else
                                    class="w-[96px] h-[96px] rounded-lg bg-white flex items-center justify-center text-[10px] text-gray-400"
                                >
                                    Tạo QR...
                                </div>
                                <p class="mt-1 text-[10px] text-gray-500">Quét QR</p>
                            </div>
                        </div>

                        <!-- Hướng dẫn thanh toán PayOS — chỉ hiện với đơn pending -->
                        <div
                            v-if="data.status === 'pending'"
                            class="rounded-lg border border-blue-100 bg-blue-50/50 p-2.5 space-y-1.5 text-sm"
                        >
                            <p class="font-medium text-slate-900 flex items-center gap-2">
                                <CreditCard class="w-4 h-4 text-blue-600" />
                                Chuyển khoản theo thông tin sau:
                            </p>
                            <dl class="space-y-1.5 text-gray-700">
                                <div v-if="data.payosInfo?.accountNumber" class="flex justify-between gap-3">
                                    <dt class="text-gray-500">Số tài khoản</dt>
                                    <dd class="font-mono font-medium">{{ data.payosInfo.accountNumber }}</dd>
                                </div>
                                <div v-if="data.payosInfo?.accountName" class="flex justify-between gap-3">
                                    <dt class="text-gray-500">Chủ tài khoản</dt>
                                    <dd class="font-medium">{{ data.payosInfo.accountName }}</dd>
                                </div>
                                <div v-if="data.payosInfo?.description" class="flex justify-between gap-3">
                                    <dt class="text-gray-500">Nội dung CK</dt>
                                    <dd class="font-mono font-medium">{{ data.payosInfo.description }}</dd>
                                </div>
                            </dl>
                            <button
                                v-if="data.payosInfo?.checkoutUrl"
                                type="button"
                                class="w-full inline-flex items-center justify-center gap-2 px-4 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition"
                                @click="openPayOS"
                            >
                                <ExternalLink class="w-4 h-4" />
                                Mở trang thanh toán PayOS
                            </button>
                        </div>

                        <!-- Trạng thái — cùng lưới 2 cột với meta bên dưới: badge bắt đầu
                             tại cột 2 (cùng trục dọc "Tạo lúc"), không đẩy sát mép phải -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 items-center">
                            <span class="text-sm text-gray-600">Trạng thái</span>
                            <span
                                class="justify-self-start inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium"
                                :class="[
                                    payStatusBadge[data.status]?.cls ?? 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
                                ]"
                            >
                                <CheckCircle2 v-if="data.status === 'paid'" class="w-3.5 h-3.5" />
                                <XCircle v-else-if="data.status === 'failed'" class="w-3.5 h-3.5" />
                                <!-- Clock tĩnh — spinner chỉ dành cho action loading, không dùng cho badge trạng thái -->
                                <Clock v-else-if="data.status === 'pending'" class="w-3.5 h-3.5" />
                                {{ payStatusBadge[data.status]?.label ?? data.status }}
                            </span>
                        </div>

                        <!-- (Pending QR đã được đặt trong card Gói+giá ở trên) -->

                        <!-- Meta: lưới 2 cột gọn (nhãn nhỏ + giá trị), không divider mỗi hàng -->
                        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                            <div class="min-w-0">
                                <dt class="text-xs text-gray-500 flex items-center gap-1.5">
                                    <Hash class="w-3.5 h-3.5" />
                                    Mã đơn
                                </dt>
                                <dd class="mt-1 flex items-center gap-2 min-w-0">
                                    <span class="font-mono text-gray-900 truncate">{{ data.orderCode }}</span>
                                    <button
                                        type="button"
                                        class="shrink-0 text-gray-400 hover:text-primary-600 transition"
                                        :title="copied ? 'Đã copy' : 'Copy'"
                                        @click="copyOrderCode(data.orderCode)"
                                    >
                                        <CheckCircle2 v-if="copied" class="w-4 h-4 text-green-600" />
                                        <Copy v-else class="w-4 h-4" />
                                    </button>
                                </dd>
                            </div>
                            <div class="min-w-0">
                                <dt class="text-xs text-gray-500 flex items-center gap-1.5">
                                    <Calendar class="w-3.5 h-3.5" />
                                    Tạo lúc
                                </dt>
                                <dd class="mt-1 text-gray-900">{{ formatDateTime(data.createdAt) }}</dd>
                            </div>
                            <div class="min-w-0">
                                <dt class="text-xs text-gray-500 flex items-center gap-1.5">
                                    <ExternalLink class="w-3.5 h-3.5" />
                                    PayOS ref
                                </dt>
                                <dd class="mt-1 font-mono text-gray-900">{{ data.payosTxnId ?? '—' }}</dd>
                            </div>
                            <div class="min-w-0">
                                <dt class="text-xs text-gray-500 flex items-center gap-1.5">
                                    <Calendar class="w-3.5 h-3.5" />
                                    Cập nhật
                                </dt>
                                <dd class="mt-1 text-gray-900">{{ data.updatedAt ? formatDateTime(data.updatedAt) : '—' }}</dd>
                            </div>
                        </dl>
                    </div>
                </div>

                <!-- Footer -->
                <div class="px-5 py-3 border-t bg-gray-50 rounded-b-xl">
                    <!--
                      Mode 1 (bình thường): 2 buttons — Hủy thanh toán (nếu pending) + Đóng.
                      Mode 2 (đang confirm hủy): thay thế footer bằng confirm card với icon + 2 buttons.
                      Click "Hủy thanh toán" → confirmingCancel = true → re-render → hiện confirm card.
                    -->
                    <div v-if="!confirmingCancel" class="flex gap-3">
                        <button
                            v-if="data?.status === 'pending'"
                            type="button"
                            class="flex-1 px-4 py-2 bg-white border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium flex items-center justify-center gap-2"
                            :disabled="cancelling"
                            @click="askCancel"
                        >
                            <Loader2 v-if="cancelling" class="w-4 h-4 animate-spin" />
                            {{ cancelling ? 'Đang hủy...' : 'Hủy thanh toán' }}
                        </button>
                        <button
                            type="button"
                            class="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition text-sm font-medium"
                            @click="close"
                        >
                            Đóng
                        </button>
                    </div>

                    <!-- Inline confirmation card — thay thế footer khi confirming -->
                    <div
                        v-else
                        class="bg-white rounded-xl border border-red-200 p-4 shadow-sm"
                    >
                        <div class="flex items-start gap-3 mb-4">
                            <div class="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                                <AlertTriangle class="w-5 h-5 text-red-600" />
                            </div>
                            <div class="flex-1">
                                <h3 class="text-base font-semibold text-gray-900">Hủy thanh toán?</h3>
                                <p class="text-sm text-gray-600 mt-1">
                                    Bạn có chắc muốn hủy thanh toán này? Link QR sẽ bị đóng và bạn sẽ không thể thanh toán lại bằng đơn này.
                                </p>
                            </div>
                        </div>
                        <div class="flex gap-2 justify-end">
                            <button
                                type="button"
                                class="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm font-medium"
                                :disabled="cancelling"
                                @click="dismissCancel"
                            >
                                Không
                            </button>
                            <button
                                type="button"
                                class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium flex items-center gap-2"
                                :disabled="cancelling"
                                @click="cancelPayment"
                            >
                                <Loader2 v-if="cancelling" class="w-4 h-4 animate-spin" />
                                {{ cancelling ? 'Đang hủy...' : 'Có, hủy thanh toán' }}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>