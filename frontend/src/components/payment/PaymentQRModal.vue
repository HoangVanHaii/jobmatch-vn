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
import {
    Check,
    CheckCircle2,
    Copy,
    Download,
    ExternalLink,
    Loader2,
    ShieldCheck,
    X,
    XCircle,
} from 'lucide-vue-next';
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
const copiedField = ref<string | null>(null);
let copyTimeout: number | null = null;

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
            width: 320,
            color: { dark: '#0f172a', light: '#FFFFFF' },
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

async function copyText(text: string, fieldKey: string) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        copiedField.value = fieldKey;
        if (copyTimeout) clearTimeout(copyTimeout);
        copyTimeout = window.setTimeout(() => {
            copiedField.value = null;
        }, 2000);
    } catch {
        /* ignore */
    }
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
    connectSocket();
});

onUnmounted(() => {
    clearPoll();
    if (copyTimeout) clearTimeout(copyTimeout);
});

function openPayOS() {
    if (!props.paymentData) return;
    window.open(props.paymentData.checkoutUrl, '_blank', 'noopener,noreferrer');
}

function downloadQR() {
    if (!qrDataUrl.value) return;
    const a = document.createElement('a');
    a.href = qrDataUrl.value;
    a.download = `vietqr-${currentOrderCode.value || 'payment'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function close() {
    stopPolling();
    state.value = 'waiting';
    errorMsg.value = '';
    copiedField.value = null;
    emit('close');
}

function formatVnd(n: number): string {
    return `${n.toLocaleString('vi-VN')} ₫`;
}
</script>

<template>
    <Teleport to="body">
        <Transition name="modal">
            <div
                v-if="open && paymentData"
                class="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
                role="dialog"
                aria-modal="true"
                aria-labelledby="payment-qr-title"
                @keydown.escape="close"
                @mousedown.self="close"
            >
                <!-- Backdrop with modern blur -->
                <div
                    class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
                    @click.self="close"
                />

                <!-- Dialog container: Dáng vuông vắn, tỉ lệ vàng trên laptop (2 cột), responsive gọn gàng trên mobile (không bị tràn chiều cao) -->
                <div
                    class="relative z-10 w-full max-w-[440px] sm:max-w-[720px] md:max-w-[760px] my-auto max-h-[90dvh] sm:max-h-[88vh] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 transition-all sm:rounded-3xl"
                    @mousedown.stop
                >
                    <!-- Header (shrink-0 để luôn cố định) -->
                    <div class="shrink-0 relative border-b border-slate-100 bg-gradient-to-b from-slate-50/90 to-white px-4 py-2.5 sm:px-6 sm:py-3.5">
                        <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-2 sm:gap-3 min-w-0">
                                <div class="hidden sm:inline-flex h-8 w-8 md:h-9 md:w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-200/60">
                                    <ShieldCheck class="h-4 w-4 md:h-5 md:w-5" />
                                </div>
                                <div class="min-w-0">
                                    <div class="flex items-center gap-1.5 sm:gap-2">
                                        <h2
                                            id="payment-qr-title"
                                            class="text-sm sm:text-base md:text-lg font-bold text-slate-900 tracking-tight truncate"
                                        >
                                            Thanh toán gói {{ plan?.name ?? '' }}
                                        </h2>
                                        <span class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.2 text-[10px] sm:text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200/50 shrink-0">
                                            VietQR PayOS
                                        </span>
                                    </div>
                                    <p class="text-[11px] sm:text-[12px] text-slate-500 truncate hidden sm:block">
                                        Quét mã hoặc chuyển khoản theo thông tin bên dưới để kích hoạt tự động
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                class="inline-flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                aria-label="Đóng"
                                @click="close"
                            >
                                <X class="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <!-- Body: 2 cột cân đối trên laptop, cuộn mượt và gọn trên mobile -->
                    <div class="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 md:p-6">
                        <!-- ===== WAITING STATE ===== -->
                        <div v-if="state === 'waiting'" class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-5 md:gap-6 items-center">
                            <!-- CỘT 1: QR CODE + REALTIME STATUS -->
                            <div class="flex flex-col items-center justify-center rounded-xl sm:rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50/70 via-white to-slate-50/40 p-2.5 sm:p-3.5 md:p-4 text-center">
                                <p class="text-[11px] sm:text-xs font-medium text-slate-500 mb-1.5 sm:mb-2">
                                    Quét QR bằng app ngân hàng / ví điện tử
                                </p>

                                <!-- QR Image Frame: Gọn trên mobile (128px), rõ nét trên laptop -->
                                <div class="rounded-xl sm:rounded-2xl bg-white p-2 sm:p-2.5 shadow-sm sm:shadow-md ring-1 ring-slate-200/80">
                                    <img
                                        v-if="qrDataUrl"
                                        :src="qrDataUrl"
                                        alt="QR thanh toán VietQR PayOS"
                                        class="h-32 w-32 sm:h-44 sm:w-44 md:h-48 md:w-48 object-contain"
                                    />
                                    <div
                                        v-else
                                        class="flex h-32 w-32 sm:h-44 sm:w-44 md:h-48 md:w-48 items-center justify-center rounded-xl bg-slate-50 text-xs text-slate-400"
                                    >
                                        <Loader2 class="h-5 w-5 animate-spin text-slate-400" />
                                        <span class="ml-1.5 text-xs">Đang tạo QR...</span>
                                    </div>
                                </div>

                                <!-- Realtime status pill -->
                                <div class="mt-2 sm:mt-2.5 flex items-center justify-center">
                                    <div class="inline-flex items-center gap-1.5 sm:gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 sm:px-3 sm:py-1 text-[11px] sm:text-xs font-medium text-emerald-700 shadow-sm">
                                        <span class="relative flex h-2 w-2">
                                            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                                            <span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                                        </span>
                                        <span>Đang chờ chuyển khoản</span>
                                    </div>
                                </div>

                                <!-- Nút Tải mã QR -->
                                <button
                                    type="button"
                                    class="mt-2 sm:mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] sm:text-xs font-medium text-slate-700 shadow-2xs hover:border-slate-300 hover:bg-slate-50 hover:text-blue-600 transition active:scale-95"
                                    title="Tải ảnh QR về máy để quét trên app ngân hàng"
                                    @click="downloadQR"
                                >
                                    <Download class="h-3.5 w-3.5 text-slate-500" />
                                    <span>Tải mã QR</span>
                                </button>
                            </div>

                            <!-- CỘT 2: THÔNG TIN CHUYỂN KHOẢN (CÓ NÚT COPY) -->
                            <div class="flex flex-col justify-between space-y-2 sm:space-y-3">
                                <!-- Card thông tin -->
                                <div class="rounded-xl sm:rounded-2xl border border-slate-200/90 bg-slate-50/70 p-2.5 sm:p-3.5 space-y-2 sm:space-y-2.5 text-xs sm:text-sm">
                                    <!-- Số tiền (To, rõ ràng, sạch sẽ — không cần nút copy) -->
                                    <div class="flex items-center justify-between pb-1.5 sm:pb-2 border-b border-slate-200/60">
                                        <span class="text-slate-500 text-[11px] sm:text-xs">Số tiền thanh toán</span>
                                        <span class="text-base sm:text-lg font-bold text-blue-600 font-mono tracking-tight">
                                            {{ formatVnd(paymentData.amount) }}
                                        </span>
                                    </div>

                                    <!-- Số tài khoản (Icon copy tinh gọn) -->
                                    <div class="flex items-center justify-between">
                                        <span class="text-slate-500 text-[11px] sm:text-xs">Số tài khoản</span>
                                        <div class="flex items-center gap-1.5">
                                            <span
                                                class="font-mono font-semibold text-slate-800 text-xs sm:text-sm select-all cursor-pointer hover:text-blue-600 transition"
                                                title="Bấm để sao chép"
                                                @click="copyText(paymentData.accountNumber, 'account')"
                                            >
                                                {{ paymentData.accountNumber }}
                                            </span>
                                            <button
                                                type="button"
                                                class="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition active:scale-90"
                                                :title="copiedField === 'account' ? 'Đã sao chép' : 'Sao chép STK'"
                                                aria-label="Sao chép số tài khoản"
                                                @click="copyText(paymentData.accountNumber, 'account')"
                                            >
                                                <Check v-if="copiedField === 'account'" class="h-3.5 w-3.5 text-emerald-600" />
                                                <Copy v-else class="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    <!-- Chủ tài khoản -->
                                    <div class="flex items-center justify-between">
                                        <span class="text-slate-500 text-[11px] sm:text-xs">Chủ tài khoản</span>
                                        <span class="font-semibold text-slate-800 uppercase tracking-wide text-[11px] sm:text-xs truncate max-w-[170px] sm:max-w-none text-right">
                                            {{ paymentData.accountName }}
                                        </span>
                                    </div>

                                    <!-- Nội dung chuyển khoản (Memo) — Giữ nút sao chép rõ ràng vì cực kỳ quan trọng -->
                                    <div class="rounded-lg sm:rounded-xl border border-amber-200/90 bg-amber-50/80 p-2 sm:p-2.5">
                                        <div class="flex items-center justify-between mb-1">
                                            <span class="text-[10px] sm:text-[11px] font-semibold text-amber-900">
                                                Nội dung chuyển khoản:
                                            </span>
                                            <button
                                                type="button"
                                                class="inline-flex items-center gap-1 rounded bg-amber-200/80 hover:bg-amber-300 px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold text-amber-900 transition active:scale-95 shadow-2xs"
                                                @click="copyText(paymentData.description, 'desc')"
                                            >
                                                <Check v-if="copiedField === 'desc'" class="h-3 w-3 text-emerald-700" />
                                                <Copy v-else class="h-3 w-3" />
                                                <span>{{ copiedField === 'desc' ? 'Đã sao chép' : 'Sao chép' }}</span>
                                            </button>
                                        </div>
                                        <div
                                            class="font-mono text-xs sm:text-sm font-bold text-slate-900 select-all break-all cursor-pointer hover:text-amber-950"
                                            title="Bấm để sao chép"
                                            @click="copyText(paymentData.description, 'desc')"
                                        >
                                            {{ paymentData.description }}
                                        </div>
                                    </div>
                                </div>

                                <!-- Note nhỏ kích hoạt tự động -->
                                <p class="text-[10px] sm:text-[11px] text-slate-500 text-center sm:text-left flex items-center justify-center sm:justify-start gap-1">
                                    <ShieldCheck class="h-3 w-3 sm:h-3.5 sm:w-3.5 text-blue-600 shrink-0" />
                                    <span>Hệ thống tự động kích hoạt gói sau 1-3 giây khi nhận được tiền.</span>
                                </p>
                            </div>
                        </div>

                        <!-- ===== SUCCESS STATE ===== -->
                        <div v-else-if="state === 'success'" class="py-4 sm:py-6 text-center space-y-3 sm:space-y-4">
                            <div class="mx-auto flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-100/70">
                                <CheckCircle2 class="h-8 w-8 sm:h-10 sm:w-10" />
                            </div>
                            <div>
                                <h3 class="text-lg sm:text-xl font-bold text-slate-900">
                                    Thanh toán thành công!
                                </h3>
                                <p class="mt-1 text-xs sm:text-sm text-slate-600">
                                    Gói <strong class="text-slate-900">{{ plan?.name }}</strong> đã được kích hoạt thành công.
                                </p>
                            </div>
                            <div class="rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-xs text-slate-500 max-w-sm mx-auto">
                                Số tiền thanh toán: <span class="font-bold text-slate-800">{{ formatVnd(paymentData.amount) }}</span>
                            </div>
                        </div>

                        <!-- ===== FAILED STATE ===== -->
                        <div v-else class="py-4 sm:py-6 text-center space-y-3 sm:space-y-4">
                            <div class="mx-auto flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-8 ring-rose-100/70">
                                <XCircle class="h-8 w-8 sm:h-10 sm:w-10" />
                            </div>
                            <div>
                                <h3 class="text-lg sm:text-xl font-bold text-slate-900">
                                    Thanh toán chưa hoàn tất
                                </h3>
                                <p class="mt-1 text-xs sm:text-sm text-rose-600">
                                    {{ errorMsg || 'Giao dịch chưa được xác nhận hoặc đã hết thời gian chờ.' }}
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- Footer (shrink-0 để luôn cố định) -->
                    <div class="shrink-0 border-t border-slate-100 bg-slate-50/80 px-4 py-2.5 sm:px-6 sm:py-3">
                        <div v-if="state !== 'success'" class="flex items-center justify-end gap-2.5">
                            <button
                                type="button"
                                class="rounded-xl border border-slate-200 bg-white py-2 px-4 text-xs sm:text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                                @click="close"
                            >
                                Đóng
                            </button>
                            <button
                                type="button"
                                class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2 px-4 sm:px-5 text-xs sm:text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                @click="openPayOS"
                            >
                                <span>Mở trang PayOS</span>
                                <ExternalLink class="h-3.5 w-3.5" />
                            </button>
                        </div>

                        <button
                            v-else
                            type="button"
                            class="w-full rounded-xl bg-emerald-600 py-2.5 px-4 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:bg-emerald-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            @click="close"
                        >
                            Hoàn tất
                        </button>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
/* Modal zoom + fade animation */
.modal-enter-active,
.modal-leave-active {
    transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-enter-active > div:last-child,
.modal-leave-active > div:last-child {
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-enter-from,
.modal-leave-to {
    opacity: 0;
}
.modal-enter-from > div:last-child,
.modal-leave-to > div:last-child {
    transform: scale(0.95);
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .modal-enter-active,
    .modal-leave-active,
    .modal-enter-active > div:last-child,
    .modal-leave-active > div:last-child {
        transition: none;
    }
}
</style>
