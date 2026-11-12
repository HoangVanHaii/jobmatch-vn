<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import {
    AlertTriangle,
    Calendar,
    Check,
    CheckCircle2,
    Clock,
    Copy,
    CreditCard,
    Download,
    ExternalLink,
    Hash,
    Loader2,
    Receipt,
    ShieldCheck,
    X,
    XCircle,
} from 'lucide-vue-next';
import QRCode from 'qrcode';
import { paymentApi } from '@services/payment.api';
import { connectSocket } from '@services/socket';
import { extractErrorMessage } from '@services/http';
import { usePaymentUpdates } from '@composables/usePaymentUpdates';
import type { PaymentWithPlan, PaymentStatus } from '@/types/payment';
import { formatDateTime } from '@/utils/format';

const props = defineProps<{
    open: boolean;
    paymentId: string | null;
}>();

const emit = defineEmits<{
    close: [];
    cancelled: [paymentId: string];
    statusChanged: [paymentId: string];
}>();

const data = ref<PaymentWithPlan | null>(null);
const loading = ref(false);
const errorMsg = ref('');
const copiedField = ref<string | null>(null);
let copyTimeout: number | null = null;
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
    if (!data.value || data.value.id !== id) data.value = null;
    try {
        const result = await paymentApi.getById(id);
        data.value = result;
    } catch (err: any) {
        if (err?.name === 'CanceledError') return;
        errorMsg.value = extractErrorMessage(err, 'Không thể tải chi tiết thanh toán');
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
            nextTick(() => modalCard.value?.focus());
        } else if (!isOpen) {
            data.value = null;
            errorMsg.value = '';
            loading.value = false;
            copiedField.value = null;
            qrDataUrl.value = '';
            confirmingCancel.value = false;
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
                    width: 320,
                    color: { dark: '#0f172a', light: '#FFFFFF' },
                });
            } catch {
                qrDataUrl.value = '';
            }
        } else {
            qrDataUrl.value = '';
        }
    },
);

// ===== Realtime: subscribe `payment:updated` để auto-refresh khi user thanh toán từ QR trong modal =====
const currentOrderCode = computed<string | null>(() => data.value?.orderCode ?? null);

usePaymentUpdates(currentOrderCode, {
    onPaid: () => {
        if (props.paymentId) {
            fetchDetail(props.paymentId);
            emit('statusChanged', props.paymentId);
        }
    },
    onFailed: () => {
        if (props.paymentId) {
            fetchDetail(props.paymentId);
            emit('statusChanged', props.paymentId);
        }
    },
});

onMounted(() => {
    connectSocket();
    document.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown);
    if (copyTimeout) clearTimeout(copyTimeout);
});

/** Tên gói hiển thị NGUYÊN VĂN theo database (plans.name do BE trả về). */
const planDisplayName = computed(() => data.value?.planName || '—');

/** Xác định modal đang hiển thị flow chờ thanh toán QR (2 cột) hay phiếu biên lai đã hoàn tất (1 cột gọn gàng) */
const isPending = computed(
    () => data.value?.status === 'pending' && !!data.value?.payosInfo?.qrCode,
);

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

function downloadQR() {
    if (!qrDataUrl.value) return;
    const a = document.createElement('a');
    a.href = qrDataUrl.value;
    a.download = `vietqr-${data.value?.orderCode || 'payment'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function close() {
    confirmingCancel.value = false;
    emit('close');
}

function askCancel() {
    confirmingCancel.value = true;
}

function dismissCancel() {
    confirmingCancel.value = false;
}

async function cancelPayment() {
    if (!props.paymentId) return;

    confirmingCancel.value = false;
    cancelling.value = true;
    errorMsg.value = '';
    try {
        await paymentApi.cancel(props.paymentId);
        await fetchDetail(props.paymentId);
        emit('cancelled', props.paymentId);
    } catch (err: any) {
        if (err?.name === 'CanceledError') return;
        errorMsg.value = extractErrorMessage(err, 'Không thể hủy thanh toán. Vui lòng thử lại.');
    } finally {
        cancelling.value = false;
    }
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

function formatPrice(v: string | number): string {
    return Number(v).toLocaleString('vi-VN') + ' ₫';
}

const payStatusBadge: Record<PaymentStatus, { label: string; cls: string }> = {
    paid:      { label: 'Thành công',  cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80' },
    pending:   { label: 'Đang xử lý',  cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/80' },
    failed:    { label: 'Thất bại',    cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/80' },
    cancelled: { label: 'Đã huỷ',      cls: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' },
    refunded:  { label: 'Đã hoàn tiền', cls: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200/80' },
    expired:   { label: 'Hết hạn',     cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80' },
};
</script>

<template>
    <Teleport to="body">
        <Transition name="modal">
            <div
                v-if="open"
                class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
                role="dialog"
                aria-modal="true"
                aria-labelledby="payment-detail-title"
                @mousedown.self="close"
            >
                <!-- Backdrop with modern blur -->
                <div
                    class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
                    @click.self="close"
                />

                <!-- Loading State (nếu chưa tải xong data) -->
                <div
                    v-if="loading && !data"
                    class="relative z-10 w-full max-w-[360px] my-auto rounded-2xl bg-white p-8 text-center shadow-2xl ring-1 ring-slate-900/10"
                    @mousedown.stop
                >
                    <Loader2 class="mx-auto w-8 h-8 animate-spin text-blue-600 mb-3" />
                    <p class="text-sm font-medium text-slate-600">Đang tải thông tin giao dịch...</p>
                </div>

                <!-- Error State -->
                <div
                    v-else-if="errorMsg && !data"
                    class="relative z-10 w-full max-w-[400px] my-auto rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/10"
                    @mousedown.stop
                >
                    <div class="flex items-start gap-3 text-rose-600 mb-4">
                        <XCircle class="w-6 h-6 shrink-0 mt-0.5" />
                        <div>
                            <h3 class="font-bold text-slate-900 text-base">Không thể tải dữ liệu</h3>
                            <p class="text-xs text-rose-600 mt-1">{{ errorMsg }}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        class="w-full rounded-md bg-slate-100 hover:bg-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition"
                        @click="close"
                    >
                        Đóng
                    </button>
                </div>

                <!-- ========================================================================= -->
                <!-- GIAO DIỆN 1: ĐƠN ĐANG CHỜ THANH TOÁN QR (2 cột chuẩn Fintech như đã ưng ý) -->
                <!-- ========================================================================= -->
                <div
                    v-else-if="isPending && data"
                    ref="modalCard"
                    tabindex="-1"
                    class="relative z-10 w-full max-w-[480px] sm:max-w-[720px] md:max-w-[760px] my-auto max-h-[90dvh] sm:max-h-[88vh] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 outline-none transition-all"
                    @mousedown.stop
                >
                    <!-- Header -->
                    <div class="shrink-0 relative border-b border-slate-100 bg-gradient-to-b from-slate-50/90 to-white px-4 py-3 sm:px-6 sm:py-3.5">
                        <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                                <div class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-200/60">
                                    <Receipt class="h-5 w-5" />
                                </div>
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                        <h2 id="payment-detail-title" class="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
                                            Chi tiết thanh toán
                                        </h2>
                                        <!-- Status Badge -->
                                        <span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200/80 shrink-0">
                                            <Clock class="w-3.5 h-3.5" />
                                            Đang xử lý
                                        </span>
                                    </div>
                                    <p class="text-[12px] text-slate-500 font-mono truncate">
                                        Mã đơn: #{{ data.orderCode }}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                aria-label="Đóng"
                                @click="close"
                            >
                                <X class="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <!-- Body: 2 cột -->
                    <div class="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 items-center">
                            <!-- Cột 1: Mã QR VietQR (div to bo góc rounded-xl) -->
                            <div class="flex flex-col items-center justify-center rounded-xl border border-slate-100 bg-gradient-to-b from-slate-50/70 via-white to-slate-50/40 p-3.5 sm:p-4 text-center">
                                <p class="text-[11px] sm:text-xs font-medium text-slate-500 mb-2">
                                    Quét QR bằng app ngân hàng / ví điện tử
                                </p>

                                <div class="rounded-xl bg-white p-2.5 shadow-sm ring-1 ring-slate-200/80">
                                    <img
                                        v-if="qrDataUrl"
                                        :src="qrDataUrl"
                                        alt="QR thanh toán PayOS"
                                        class="h-36 w-36 sm:h-44 sm:w-44 md:h-48 md:w-48 object-contain"
                                    />
                                    <div
                                        v-else
                                        class="flex h-36 w-36 sm:h-44 sm:w-44 md:h-48 md:w-48 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-400"
                                    >
                                        <Loader2 class="h-6 w-6 animate-spin text-slate-400" />
                                        <span class="ml-2">Đang tạo mã QR...</span>
                                    </div>
                                </div>

                                <div class="mt-2.5 flex items-center justify-center">
                                    <div class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 shadow-xs">
                                        <span class="relative flex h-2 w-2">
                                            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
                                            <span class="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
                                        </span>
                                        <span>Đang chờ chuyển khoản</span>
                                    </div>
                                </div>

                                <!-- Nút Tải mã QR -->
                                <button
                                    type="button"
                                    class="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] sm:text-xs font-medium text-slate-700 shadow-2xs hover:border-slate-300 hover:bg-slate-50 hover:text-blue-600 transition active:scale-95"
                                    title="Tải ảnh QR về máy để quét trên app ngân hàng"
                                    @click="downloadQR"
                                >
                                    <Download class="h-3.5 w-3.5 text-slate-500" />
                                    <span>Tải mã QR</span>
                                </button>
                            </div>

                            <!-- Cột 2: Thông tin chuyển khoản (div to bo góc rounded-xl) -->
                            <div class="flex flex-col justify-between space-y-3">
                                <div class="rounded-xl border border-slate-200/90 bg-slate-50/70 p-3 sm:p-4 space-y-2.5 text-xs sm:text-sm">
                                    <!-- Gói & Giá -->
                                    <div class="flex items-center justify-between pb-2 border-b border-slate-200/60">
                                        <div>
                                            <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Gói đăng ký</p>
                                            <p class="font-bold text-slate-900 text-sm sm:text-base">{{ planDisplayName }}</p>
                                        </div>
                                        <div class="text-right">
                                            <span class="text-base sm:text-lg font-bold text-blue-600 font-mono">
                                                {{ formatPrice(data.amountVnd) }}
                                            </span>
                                            <p v-if="data.planDurationDays" class="text-[11px] text-slate-500">
                                                {{ data.planDurationDays }} ngày
                                            </p>
                                        </div>
                                    </div>

                                    <!-- Số tài khoản -->
                                    <div v-if="data.payosInfo?.accountNumber" class="flex items-center justify-between">
                                        <span class="text-slate-500 text-[11px] sm:text-xs">Số tài khoản</span>
                                        <div class="flex items-center gap-1.5">
                                            <span
                                                class="font-mono font-semibold text-slate-800 cursor-pointer hover:text-blue-600 transition"
                                                title="Bấm để sao chép"
                                                @click="copyText(data.payosInfo!.accountNumber, 'account')"
                                            >
                                                {{ data.payosInfo.accountNumber }}
                                            </span>
                                            <button
                                                type="button"
                                                class="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition active:scale-90"
                                                :title="copiedField === 'account' ? 'Đã sao chép' : 'Sao chép STK'"
                                                aria-label="Sao chép số tài khoản"
                                                @click="copyText(data.payosInfo!.accountNumber, 'account')"
                                            >
                                                <Check v-if="copiedField === 'account'" class="h-3.5 w-3.5 text-emerald-600" />
                                                <Copy v-else class="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    <!-- Chủ tài khoản -->
                                    <div v-if="data.payosInfo?.accountName" class="flex items-center justify-between">
                                        <span class="text-slate-500 text-[11px] sm:text-xs">Chủ tài khoản</span>
                                        <span class="font-semibold text-slate-800 uppercase tracking-wide text-[11px] sm:text-xs truncate max-w-[170px] sm:max-w-none text-right">
                                            {{ data.payosInfo.accountName }}
                                        </span>
                                    </div>

                                    <!-- Memo -->
                                    <div v-if="data.payosInfo?.description" class="rounded-lg border border-amber-200/90 bg-amber-50/80 p-2.5">
                                        <div class="flex items-center justify-between mb-1">
                                            <span class="text-[11px] font-semibold text-amber-900">
                                                Nội dung chuyển khoản:
                                            </span>
                                            <button
                                                type="button"
                                                class="inline-flex items-center gap-1 rounded-md bg-amber-200/80 hover:bg-amber-300 px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold text-amber-900 transition active:scale-95 shadow-2xs"
                                                @click="copyText(data.payosInfo!.description, 'desc')"
                                            >
                                                <Check v-if="copiedField === 'desc'" class="h-3 w-3 text-emerald-700" />
                                                <Copy v-else class="h-3 w-3" />
                                                <span>{{ copiedField === 'desc' ? 'Đã sao chép' : 'Sao chép' }}</span>
                                            </button>
                                        </div>
                                        <div
                                            class="font-mono text-xs sm:text-sm font-bold text-slate-900 select-all break-all cursor-pointer hover:text-amber-950"
                                            title="Bấm để sao chép"
                                            @click="copyText(data.payosInfo!.description, 'desc')"
                                        >
                                            {{ data.payosInfo.description }}
                                        </div>
                                    </div>
                                </div>

                                <!-- Button Mở PayOS: rounded-md -->
                                <button
                                    v-if="data.payosInfo?.checkoutUrl"
                                    type="button"
                                    class="w-full inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-sm transition hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98]"
                                    @click="openPayOS"
                                >
                                    <ExternalLink class="w-4 h-4" />
                                    <span>Mở trang thanh toán PayOS</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Footer cho đơn pending (button rounded-md) -->
                    <div class="shrink-0 border-t border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-6">
                        <div v-if="!confirmingCancel" class="flex items-center justify-end gap-2.5">
                            <button
                                type="button"
                                class="rounded-md border border-rose-200 bg-white py-2 px-4 text-xs sm:text-sm font-medium text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 active:scale-[0.98] disabled:opacity-50"
                                :disabled="cancelling"
                                @click="askCancel"
                            >
                                <Loader2 v-if="cancelling" class="w-4 h-4 animate-spin inline-block mr-1" />
                                {{ cancelling ? 'Đang hủy...' : 'Hủy thanh toán' }}
                            </button>
                            <button
                                type="button"
                                class="rounded-md border border-slate-200 bg-white py-2 px-5 text-xs sm:text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]"
                                @click="close"
                            >
                                Đóng
                            </button>
                        </div>

                        <!-- Confirm Cancel inline (div to rounded-xl, button rounded-md) -->
                        <div
                            v-else
                            class="rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 sm:p-4"
                        >
                            <div class="flex items-start gap-3">
                                <div class="shrink-0 h-9 w-9 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
                                    <AlertTriangle class="w-5 h-5" />
                                </div>
                                <div class="flex-1">
                                    <h4 class="text-sm font-bold text-slate-900">Xác nhận hủy thanh toán?</h4>
                                    <p class="text-xs text-slate-600 mt-0.5 leading-relaxed">
                                        Mã QR và link thanh toán này sẽ bị đóng vĩnh viễn. Bạn sẽ không thể tiếp tục thanh toán cho đơn này.
                                    </p>
                                    <div class="mt-3 flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            class="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition"
                                            :disabled="cancelling"
                                            @click="dismissCancel"
                                        >
                                            Giữ lại
                                        </button>
                                        <button
                                            type="button"
                                            class="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 active:scale-[0.98] transition shadow-xs"
                                            :disabled="cancelling"
                                            @click="cancelPayment"
                                        >
                                            <Loader2 v-if="cancelling" class="w-3.5 h-3.5 animate-spin" />
                                            {{ cancelling ? 'Đang hủy...' : 'Đồng ý hủy' }}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ========================================================================= -->
                <!-- GIAO DIỆN 2: BIÊN LAI ĐIỆN TỬ (Thành công / Thất bại / Đã hủy)              -->
                <!-- Container to rounded-2xl, div thông tin rounded-xl, button rounded-md         -->
                <!-- ========================================================================= -->
                <div
                    v-else-if="data"
                    ref="modalCard"
                    tabindex="-1"
                    class="relative z-10 w-full max-w-[420px] sm:max-w-[450px] my-auto overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 outline-none p-6 sm:p-7 transition-all text-slate-900"
                    @mousedown.stop
                >
                    <!-- Nút đóng X ở góc trên bên phải -->
                    <button
                        type="button"
                        class="absolute top-4 right-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        aria-label="Đóng"
                        @click="close"
                    >
                        <X class="h-4 w-4" />
                    </button>

                    <!-- Hero Section: Icon + Tình trạng + Số tiền + Tên gói -->
                    <div class="text-center pt-1">
                        <!-- Icon tròn đa lớp phát sáng mềm -->
                        <div
                            class="mx-auto flex h-14 w-14 items-center justify-center rounded-full mb-3 transition"
                            :class="[
                                data.status === 'paid'
                                    ? 'bg-emerald-50 text-emerald-600 ring-8 ring-emerald-100/70'
                                    : data.status === 'failed'
                                    ? 'bg-rose-50 text-rose-600 ring-8 ring-rose-100/70'
                                    : 'bg-slate-100 text-slate-500 ring-8 ring-slate-200/60'
                            ]"
                        >
                            <CheckCircle2 v-if="data.status === 'paid'" class="h-8 w-8" />
                            <XCircle v-else-if="data.status === 'failed'" class="h-8 w-8" />
                            <Clock v-else class="h-8 w-8" />
                        </div>

                        <!-- Trạng thái chữ -->
                        <h3 class="text-base font-bold text-slate-900">
                            {{ data.status === 'paid' ? 'Thanh toán thành công!' : payStatusBadge[data.status]?.label ?? 'Chi tiết giao dịch' }}
                        </h3>

                        <!-- Số tiền to bản, sắc sảo -->
                        <div class="mt-1 text-3xl font-extrabold text-slate-900 font-mono tracking-tight">
                            {{ formatPrice(data.amountVnd) }}
                        </div>

                        <!-- Pill gói dịch vụ -->
                        <div class="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200/60">
                            <CreditCard class="h-3.5 w-3.5 text-blue-600" />
                            <span>Gói {{ planDisplayName }}</span>
                            <span v-if="data.planDurationDays" class="text-blue-500 font-normal">· {{ data.planDurationDays }} ngày</span>
                        </div>
                    </div>

                    <!-- Vạch nét đứt đặc trưng của phiếu biên lai điện tử -->
                    <div class="relative my-5">
                        <div class="border-t border-dashed border-slate-200"></div>
                    </div>

                    <!-- Bảng thông tin giao dịch (div to bo góc rounded-xl mềm mại) -->
                    <div class="rounded-xl bg-slate-50/80 p-4 space-y-3 text-xs sm:text-sm">
                        <!-- Mã đơn hàng -->
                        <div class="flex items-center justify-between">
                            <span class="text-slate-500">Mã đơn hàng</span>
                            <div class="flex items-center gap-1.5">
                                <span class="font-mono font-semibold text-slate-900">#{{ data.orderCode }}</span>
                                <button
                                    type="button"
                                    class="inline-flex h-5 w-5 items-center justify-center rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition active:scale-90"
                                    :title="copiedField === 'order' ? 'Đã sao chép' : 'Sao chép mã đơn'"
                                    @click="copyText(data.orderCode, 'order')"
                                >
                                    <Check v-if="copiedField === 'order'" class="h-3.5 w-3.5 text-emerald-600" />
                                    <Copy v-else class="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>

                        <!-- Thời gian giao dịch -->
                        <div class="flex items-center justify-between">
                            <span class="text-slate-500">Thời gian</span>
                            <span class="font-medium text-slate-800">
                                {{ data.updatedAt ? formatDateTime(data.updatedAt) : formatDateTime(data.createdAt) }}
                            </span>
                        </div>

                        <!-- Mã tham chiếu PayOS Ref (nếu có) -->
                        <div v-if="data.payosTxnId" class="flex items-center justify-between">
                            <span class="text-slate-500">Mã GD ngân hàng</span>
                            <div class="flex items-center gap-1.5">
                                <span class="font-mono font-medium text-slate-800 text-[11px] sm:text-xs">{{ data.payosTxnId }}</span>
                                <button
                                    type="button"
                                    class="inline-flex h-5 w-5 items-center justify-center rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition active:scale-90"
                                    :title="copiedField === 'ref' ? 'Đã sao chép' : 'Sao chép mã GD'"
                                    @click="copyText(data.payosTxnId!, 'ref')"
                                >
                                    <Check v-if="copiedField === 'ref'" class="h-3.5 w-3.5 text-emerald-600" />
                                    <Copy v-else class="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>

                        <!-- Phương thức thanh toán -->
                        <div class="flex items-center justify-between">
                            <span class="text-slate-500">Phương thức</span>
                            <span class="font-medium text-slate-800">VietQR · PayOS</span>
                        </div>

                        <!-- Trạng thái -->
                        <div class="flex items-center justify-between pt-2 border-t border-slate-200/60">
                            <span class="text-slate-500">Trạng thái</span>
                            <span
                                class="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full"
                                :class="payStatusBadge[data.status]?.cls ?? 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'"
                            >
                                <CheckCircle2 v-if="data.status === 'paid'" class="w-3.5 h-3.5" />
                                <XCircle v-else-if="data.status === 'failed'" class="w-3.5 h-3.5" />
                                <Clock v-else class="w-3.5 h-3.5" />
                                {{ payStatusBadge[data.status]?.label ?? data.status }}
                            </span>
                        </div>
                    </div>

                    <!-- Nút hành động chính: Đóng biên lai (button rounded-md) -->
                    <div class="mt-6">
                        <button
                            type="button"
                            class="w-full rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-2.5 px-4 text-sm shadow-sm transition active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            @click="close"
                        >
                            Đóng biên lai
                        </button>
                    </div>

                    <!-- Note bảo mật cam kết phía dưới -->
                    <p class="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1 mt-3">
                        <ShieldCheck class="w-3.5 h-3.5 text-emerald-600" />
                        <span>Giao dịch bảo mật và gói đã được kích hoạt thành công</span>
                    </p>
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
