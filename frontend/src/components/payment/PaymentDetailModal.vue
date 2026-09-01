<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { Loader2, XCircle, Copy, CheckCircle2, CreditCard, Calendar, Hash, ExternalLink, Receipt, AlertTriangle } from 'lucide-vue-next';
import QRCode from 'qrcode';
import { paymentApi } from '@services/payment.api';
import { connectSocket } from '@services/socket';
import { usePaymentUpdates } from '@composables/usePaymentUpdates';
import type { PaymentWithPlan } from '@/types/payment';
import type { PaymentStatus } from '@/types/payment';
import type { PayosLinkInfo } from '@/types/payment';

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

async function fetchDetail(id: string) {
    loading.value = true;
    errorMsg.value = '';
    data.value = null;
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
            await fetchDetail(id);
        } else if (!isOpen) {
            data.value = null;
            errorMsg.value = '';
            loading.value = false;
            copied.value = false;
            qrDataUrl.value = '';
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
});

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

// Local copy of payStatusBadge (same shape used in BillingHistoryView lines ~195-201).
// Duplicated intentionally to avoid cross-component coupling.
const payStatusBadge: Record<PaymentStatus, { label: string; cls: string }> = {
    paid:      { label: 'Thành công',  cls: 'bg-green-100 text-green-700' },
    pending:   { label: 'Đang xử lý', cls: 'bg-blue-100 text-blue-700' },
    failed:    { label: 'Thất bại',   cls: 'bg-red-100 text-red-700' },
    cancelled: { label: 'Đã huỷ',     cls: 'bg-gray-100 text-gray-600' },
    refunded:  { label: 'Đã hoàn tiền', cls: 'bg-purple-100 text-purple-700' },
    expired:   { label: 'Hết hạn',    cls: 'bg-amber-100 text-amber-700' },
};
</script>

<template>
    <Teleport to="body">
        <div
            v-if="open"
            class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto"
            @click.self="close"
        >
            <div class="bg-white rounded-xl shadow-2xl max-w-lg w-full my-8">
                <!-- Header -->
                <div class="flex items-center justify-between p-5 border-b">
                    <h2 class="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Receipt class="w-5 h-5 text-primary-600" />
                        Chi tiết thanh toán
                    </h2>
                    <button
                        type="button"
                        class="text-gray-400 hover:text-gray-600 transition"
                        aria-label="Đóng"
                        @click="close"
                    >
                        ✕
                    </button>
                </div>

                <!-- Body -->
                <div class="p-5 min-h-[200px]">
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
                    <div v-else-if="data" class="space-y-4">
                        <!-- Plan + amount + QR (QR chen vào bên phải khi pending + có qrCode) -->
                        <div class="bg-gray-50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
                            <div class="flex-1 min-w-0">
                                <p class="text-xs text-gray-500 uppercase tracking-wider mb-2">Gói</p>
                                <p class="text-base font-semibold text-gray-900">
                                    {{ data.planName ?? '—' }}
                                    <span
                                        v-if="data.planDurationDays"
                                        class="ml-2 text-xs text-gray-500 font-normal"
                                    >
                                        {{ data.planDurationDays }} ngày
                                    </span>
                                </p>
                                <p class="text-2xl font-bold text-primary-700 mt-2">
                                    {{ formatPrice(data.amountVnd) }}
                                </p>
                            </div>

                            <!-- QR bên phải (chỉ khi pending + có qrCode) -->
                            <div
                                v-if="data.status === 'pending' && data.payosInfo?.qrCode"
                                class="shrink-0 self-center sm:self-start"
                            >
                                <img
                                    v-if="qrDataUrl"
                                    :src="qrDataUrl"
                                    alt="QR thanh toán PayOS"
                                    class="w-24 h-24 border border-gray-200 rounded p-1 bg-white"
                                />
                                <div
                                    v-else
                                    class="w-24 h-24 border border-gray-200 rounded bg-white flex items-center justify-center text-[10px] text-gray-400"
                                >
                                    Tạo QR...
                                </div>
                                <p class="text-[10px] text-gray-500 text-center mt-1">
                                    Quét QR
                                </p>
                            </div>
                        </div>

                        <!-- Status -->
                        <div class="flex items-center justify-between border-t pt-4">
                            <span class="text-sm text-gray-600">Trạng thái</span>
                            <span
                                :class="[
                                    'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium',
                                    payStatusBadge[data.status]?.cls ?? 'bg-gray-100 text-gray-600',
                                ]"
                            >
                                <CheckCircle2 v-if="data.status === 'paid'" class="w-3.5 h-3.5" />
                                <XCircle v-else-if="data.status === 'failed'" class="w-3.5 h-3.5" />
                                <Loader2 v-else-if="data.status === 'pending'" class="w-3.5 h-3.5 animate-spin" />
                                {{ payStatusBadge[data.status]?.label ?? data.status }}
                            </span>
                        </div>

                        <!-- (Pending QR đã được đặt trong card Gói+giá ở trên) -->

                        <!-- Order code with copy -->
                        <div class="flex items-center justify-between border-t pt-4">
                            <span class="text-sm text-gray-600 flex items-center gap-1.5">
                                <Hash class="w-4 h-4" />
                                Mã đơn
                            </span>
                            <div class="flex items-center gap-2">
                                <span class="font-mono text-sm text-gray-900">{{ data.orderCode }}</span>
                                <button
                                    type="button"
                                    class="text-gray-400 hover:text-primary-600 transition"
                                    :title="copied ? 'Đã copy' : 'Copy'"
                                    @click="copyOrderCode(data.orderCode)"
                                >
                                    <CheckCircle2 v-if="copied" class="w-4 h-4 text-green-600" />
                                    <Copy v-else class="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <!-- PayOS ref -->
                        <div class="flex items-center justify-between border-t pt-4">
                            <span class="text-sm text-gray-600 flex items-center gap-1.5">
                                <ExternalLink class="w-4 h-4" />
                                PayOS ref
                            </span>
                            <span class="font-mono text-sm text-gray-900">
                                {{ data.payosTxnId ?? '—' }}
                            </span>
                        </div>

                        <!-- Subscription ID -->
                        <div class="flex items-center justify-between border-t pt-4">
                            <span class="text-sm text-gray-600 flex items-center gap-1.5">
                                <CreditCard class="w-4 h-4" />
                                Subscription
                            </span>
                            <span class="font-mono text-sm text-gray-900">
                                {{ data.subscriptionId ?? '—' }}
                            </span>
                        </div>

                        <!-- Created at -->
                        <div class="flex items-center justify-between border-t pt-4">
                            <span class="text-sm text-gray-600 flex items-center gap-1.5">
                                <Calendar class="w-4 h-4" />
                                Tạo lúc
                            </span>
                            <span class="text-sm text-gray-900">
                                {{ formatDateTime(data.createdAt) }}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="p-5 border-t bg-gray-50 rounded-b-xl">
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