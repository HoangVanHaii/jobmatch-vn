<script setup lang="ts">
/**
 * PaymentQRModal — Hiển thị QR code PayOS ngay trên trang JobMatch (không redirect).
 *
 * LƯU Ý QUAN TRỌNG về `qrCode`:
 *   PayOS API (v2/payment-requests) trả về `qrCode` là chuỗi EMVCo VietQR
 *   (bắt đầu bằng "000201010212..."), KHÔNG phải base64 PNG.
 *   Modal dùng `qrcode` lib để encode chuỗi này thành ảnh PNG hiển thị.
 *
 * Realtime flow:
 *   1. Parent (PricingView) gọi paymentApi.create() → nhận CreatePaymentResponse
 *      chứa qrCode, checkoutUrl, accountNumber, accountName, amount, description.
 *   2. Modal mount → connectSocket() + subscribe `payment:updated` qua usePaymentUpdates.
 *   3. Modal encode chuỗi EMV → ảnh QR, hiển thị kèm thông tin CK.
 *   4. **Primary**: Khi PayOS webhook commit DB, backend emit `payment:updated`
 *      qua notificationGateway → modal nhận trong <1s → set state='success'.
 *   5. **Fallback**: Polling mỗi 10s gọi paymentApi.getByOrderCode() — chỉ chạy
 *      khi WS chưa nhận được event (disconnect, network).
 *   6. Khi nhận được paid (dù WS hay polling) → stopPolling() + emit 'success'
 *      → parent refresh planStore + navigate /billing/success.
 *   7. Nút "Mở trang thanh toán PayOS" → window.open(checkoutUrl, '_blank')
 *      KHÔNG tạo payment mới — checkoutUrl thuộc payment hiện tại.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import QRCode from 'qrcode';
import { paymentApi } from '@services/payment.api';
import { connectSocket } from '@services/socket';
import { usePaymentUpdates } from '@composables/usePaymentUpdates';
import type { CreatePaymentResponse, PaymentStatus } from '@/types/payment';
import type { Plan } from '@/types/plan';

type ViewState = 'waiting' | 'success' | 'failed';

const props = defineProps<{
    open: boolean;
    plan: Plan | null;
    paymentData: CreatePaymentResponse | null;
}>();

const emit = defineEmits<{
    close: [];
    success: [];
}>();

const state = ref<ViewState>('waiting');
const errorMsg = ref('');
const qrDataUrl = ref<string>('');

let pollTimer: number | null = null;
let pollStartedAt = 0;
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Ref orderCode hiện tại — pass cho usePaymentUpdates để filter event.
const currentOrderCode = computed<string | null>(
    () => props.paymentData?.payment.orderCode ?? null,
);

// ===== WebSocket subscription (primary) =====
const { receivedSuccess: wsReceivedSuccess, receivedFailed: wsReceivedFailed } =
    usePaymentUpdates(currentOrderCode, {
        onPaid: () => {
            if (state.value === 'waiting') {
                state.value = 'success';
                stopPolling();
            }
        },
        onFailed: () => {
            if (state.value === 'waiting') {
                state.value = 'failed';
                errorMsg.value = 'Thanh toán bị từ chối hoặc đã hết hạn.';
                stopPolling();
            }
        },
    });

async function generateQR(emvString: string) {
    if (!emvString) {
        qrDataUrl.value = '';
        return;
    }
    try {
        qrDataUrl.value = await QRCode.toDataURL(emvString, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 256,
            color: { dark: '#000000', light: '#FFFFFF' },
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[PaymentQRModal] QRCode.toDataURL failed:', err);
        qrDataUrl.value = '';
    }
}

function clearPoll() {
    if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}

async function checkPayment() {
    if (wsReceivedSuccess.value || wsReceivedFailed.value) return;
    if (!props.paymentData) return;
    if (state.value !== 'waiting') return;

    const orderCode = props.paymentData.payment.orderCode;

    if (Date.now() - pollStartedAt > POLL_TIMEOUT_MS) {
        state.value = 'failed';
        errorMsg.value =
            'Hết thời gian chờ PayOS phản hồi (5 phút). Vui lòng kiểm tra lại hoặc liên hệ admin.';
        return;
    }

    try {
        const found = await paymentApi.getByOrderCode(orderCode);
        if (!props.open) return;
        if (state.value !== 'waiting') return;
        if (wsReceivedSuccess.value || wsReceivedFailed.value) return;

        if (!found) {
            scheduleNext();
            return;
        }

        const dbStatus = found.status as PaymentStatus;
        if (dbStatus === 'paid') {
            state.value = 'success';
            return;
        }
        if (dbStatus === 'failed') {
            state.value = 'failed';
            errorMsg.value = 'Thanh toán bị từ chối hoặc đã hết hạn.';
            return;
        }
        scheduleNext();
    } catch {
        scheduleNext();
    }
}

function scheduleNext() {
    pollTimer = window.setTimeout(checkPayment, POLL_INTERVAL_MS);
}

function startPolling() {
    clearPoll();
    state.value = 'waiting';
    errorMsg.value = '';
    pollStartedAt = Date.now();
    checkPayment();
}

function stopPolling() {
    clearPoll();
}

watch(
    () => props.paymentData?.qrCode,
    (emv) => {
        if (emv) generateQR(emv);
    },
    { immediate: true },
);

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen && props.paymentData) {
            if (!qrDataUrl.value && props.paymentData.qrCode) {
                generateQR(props.paymentData.qrCode);
            }
            startPolling();
        } else {
            stopPolling();
        }
    },
);

watch(state, (newState) => {
    if (newState === 'success') {
        emit('success');
    }
});

onMounted(() => {
    // Đảm bảo socket connect khi modal mount.
    // connectSocket() idempotent (ch� connect nếu chưa connected).
    connectSocket();
});

onUnmounted(() => {
    clearPoll();
    // Listener cleanup tự động trong usePaymentUpdates (onUnmounted).
});

function openPayOS() {
    if (!props.paymentData) return;
    window.open(props.paymentData.checkoutUrl, '_blank', 'noopener,noreferrer');
}

function close() {
    stopPolling();
    state.value = 'waiting';
    errorMsg.value = '';
    emit('close');
}

function formatVnd(n: number): string {
    return `${n.toLocaleString('vi-VN')}đ`;
}
</script>

<template>
    <Teleport to="body">
        <div
            v-if="open && paymentData"
            class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto"
            @click.self="close"
        >
            <div class="bg-white rounded-xl shadow-2xl max-w-md w-full my-8">
                <!-- Header -->
                <div class="flex items-center justify-between p-5 border-b">
                    <h2 class="text-lg font-semibold text-gray-900">
                        Thanh toán gói {{ plan?.name ?? '' }}
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
                <div class="p-5">
                    <!-- ===== WAITING ===== -->
                    <div v-if="state === 'waiting'">
                        <p class="text-sm text-gray-600 mb-3 text-center">
                            Quét QR bằng app ngân hàng để thanh toán
                        </p>

                        <div class="flex justify-center mb-4">
                            <img
                                v-if="qrDataUrl"
                                :src="qrDataUrl"
                                alt="QR thanh toán PayOS"
                                class="w-64 h-64 border border-gray-200 rounded-lg p-2 bg-white"
                            />
                            <div
                                v-else
                                class="w-64 h-64 border border-gray-200 rounded-lg p-2 bg-gray-50 flex items-center justify-center text-xs text-gray-400"
                            >
                                Đang tạo QR...
                            </div>
                        </div>

                        <div class="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                            <div class="flex justify-between">
                                <span class="text-gray-600">Số tiền:</span>
                                <span class="font-semibold text-primary-700">
                                    {{ formatVnd(paymentData.amount) }}
                                </span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-600">Số tài khoản:</span>
                                <span class="font-mono font-medium">
                                    {{ paymentData.accountNumber }}
                                </span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-600">Chủ tài khoản:</span>
                                <span class="font-medium">
                                    {{ paymentData.accountName }}
                                </span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-600">Nội dung CK:</span>
                                <span class="font-medium text-right">
                                    {{ paymentData.description }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- ===== SUCCESS ===== -->
                    <div v-else-if="state === 'success'" class="text-center py-4">
                        <div class="text-6xl mb-3">✅</div>
                        <h3 class="text-xl font-bold text-gray-900 mb-2">
                            Thanh toán thành công!
                        </h3>
                        <p class="text-gray-600 mb-1">
                            Gói <strong>{{ plan?.name }}</strong> đã được kích hoạt.
                        </p>
                        <p class="text-xs text-gray-500 mb-5">
                            Số tiền: {{ formatVnd(paymentData.amount) }}
                        </p>
                    </div>

                    <!-- ===== FAILED ===== -->
                    <div v-else class="text-center py-4">
                        <div class="text-6xl mb-3">❌</div>
                        <h3 class="text-xl font-bold text-gray-900 mb-2">
                            Thanh toán thất bại
                        </h3>
                        <p class="text-red-600 text-sm mb-5">
                            {{ errorMsg || 'Vui lòng thử lại hoặc liên hệ admin.' }}
                        </p>
                    </div>
                </div>

                <!-- Footer -->
                <div class="p-5 border-t bg-gray-50 rounded-b-xl">
                    <div v-if="state === 'waiting'" class="flex gap-2">
                        <button
                            type="button"
                            class="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
                            @click="close"
                        >
                            Đóng
                        </button>
                        <button
                            type="button"
                            class="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition text-sm"
                            @click="openPayOS"
                        >
                            Mở trang PayOS ↗
                        </button>
                    </div>

                    <button
                        v-else-if="state === 'success'"
                        type="button"
                        class="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm"
                        @click="close"
                    >
                        Hoàn tất
                    </button>

                    <div v-else class="flex gap-2">
                        <button
                            type="button"
                            class="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
                            @click="close"
                        >
                            Đóng
                        </button>
                        <button
                            type="button"
                            class="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition text-sm"
                            @click="openPayOS"
                        >
                            Mở trang PayOS ↗
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
