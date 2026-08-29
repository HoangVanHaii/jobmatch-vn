<script setup lang="ts">
/**
 * BillingCancelView — Trang xác nhận hủy thanh toán sau khi user quay lại từ PayOS.
 *
 * Realtime flow (mirror BillingSuccessView):
 *   1. URL có `?orderCode=...` → view load.
 *   2. Mount → connectSocket() + subscribe `payment:updated` qua usePaymentUpdates.
 *   3. Nếu WS nhận 'paid' event cho orderCode này → set status='success' ngay
 *      (user clicked Cancel nhưng PayOS confirmed anyway → show "Phát hiện thanh toán").
 *   4. Nếu WS nhận 'failed' event → set status='failed' (user actually cancelled).
 *   5. **Fallback**: 1 lần GET /payments/by-order/:orderCode để check DB nếu WS
 *      miss. Nếu DB paid → success; failed → failed; pending → loading (chờ WS).
 *   6. KHÔNG polling liên tục như trước — WS là primary, fetch là 1 lần fallback.
 *
 * Lưu ý:
 * - sessionStorage persist terminal state để chống remount reset.
 * - Dùng AbortController để abort in-flight fetch khi unmount hoặc khi user
 *   thử lại nhiều lần.
 * - KHÔNG disconnectSocket ở onUnmounted — chat socket có thể đang dùng.
 *   usePaymentUpdates tự cleanup listener.
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { paymentApi } from '@services/payment.api';
import { connectSocket } from '@services/socket';
import { usePaymentUpdates } from '@composables/usePaymentUpdates';
import type { Payment } from '@/types/payment';

const router = useRouter();
const route = useRoute();

type Status = 'loading' | 'success' | 'failed';
const status = ref<Status>('loading');
const payment = ref<Payment | null>(null);
const errorMsg = ref('');

const STATUS_KEY = (orderCode: string) => `cancel_status:${orderCode}`;
const PAYMENT_KEY = (orderCode: string) => `cancel_payment:${orderCode}`;

function persist(orderCode: string) {
    sessionStorage.setItem(STATUS_KEY(orderCode), status.value);
    if (payment.value) {
        sessionStorage.setItem(PAYMENT_KEY(orderCode), JSON.stringify(payment.value));
    }
}

function restore(orderCode: string): boolean {
    const savedStatus = sessionStorage.getItem(STATUS_KEY(orderCode));
    const savedPayment = sessionStorage.getItem(PAYMENT_KEY(orderCode));

    if (savedStatus === 'success' || savedStatus === 'failed') {
        status.value = savedStatus;
        if (savedPayment) {
            try {
                payment.value = JSON.parse(savedPayment);
            } catch {
                /* ignore */
            }
        }
        return true;
    }
    return false;
}

const orderCode = (route.query.orderCode as string) || '';
const orderCodeRef = ref<string | null>(orderCode || null);

let currentController: AbortController | null = null;
function abortInFlight() {
    if (currentController) {
        currentController.abort();
        currentController = null;
    }
}

// ===== WebSocket subscription (primary) =====
usePaymentUpdates(orderCodeRef, {
    onPaid: async () => {
        // Race: user clicked Cancel nhưng PayOS confirmed anyway.
        // Phải show "Phát hiện thanh toán" thay vì "Đã hủy".
        abortInFlight();
        try {
            const found = await paymentApi.getByOrderCode(orderCode);
            if (found) payment.value = found;
        } catch {
            /* không block UI nếu API lỗi — WS đã là source of truth */
        }
        status.value = 'success';
        errorMsg.value = 'Bạn đã thanh toán thành công — bấm Quay lại gói để xem.';
        persist(orderCode);
    },
    onFailed: () => {
        abortInFlight();
        status.value = 'failed';
        errorMsg.value = 'Đã hủy thanh toán.';
        persist(orderCode);
    },
});

async function fetchInitialStatus() {
    abortInFlight();
    const controller = new AbortController();
    currentController = controller;

    try {
        const found = await paymentApi.getByOrderCode(orderCode, {
            signal: controller.signal,
        });
        // WS đã set rồi thì không override
        if (status.value !== 'loading') return;

        if (!found) {
            // DB chưa có payment — hiếm, có thể user vào trang trước khi POST /payments xong.
            // Giữ 'loading' và tiếp tục chờ WS.
            return;
        }
        payment.value = found;
        if (found.status === 'paid') {
            status.value = 'success';
            errorMsg.value = 'Bạn đã thanh toán thành công — bấm Quay lại gói để xem.';
            persist(orderCode);
            return;
        }
        if (found.status === 'failed') {
            status.value = 'failed';
            errorMsg.value = 'Đã hủy thanh toán.';
            persist(orderCode);
            return;
        }
        // pending → giữ 'loading', chờ WS hoặc backend webhook
    } catch (err: any) {
        // Bỏ qua lỗi do abort (user unmount hoặc retry)
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        if (status.value !== 'loading') return;
        // Fetch failed nhưng WS chưa nói gì → assume cancelled
        status.value = 'failed';
        errorMsg.value = 'Đã hủy thanh toán';
        persist(orderCode);
    } finally {
        if (currentController === controller) {
            currentController = null;
        }
    }
}

onMounted(async () => {
    connectSocket();

    if (!orderCode) {
        status.value = 'failed';
        errorMsg.value = 'Thiếu orderCode trong URL';
        return;
    }

    // Nếu đã có terminal state trong session → restore + return
    if (restore(orderCode)) return;

    // Fetch 1 lần — WS sẽ pick up nếu webhook đến sau.
    await fetchInitialStatus();
});

onUnmounted(() => {
    // Abort in-flight fetch để tránh set state sau khi unmount.
    abortInFlight();
    // KHÔNG disconnectSocket ở đây — chat socket có thể đang dùng.
    // usePaymentUpdates tự cleanup listener khi unmount.
});
</script>

<template>
    <div class="max-w-md mx-auto px-4 py-12 text-center">
        <!-- Loading -->
        <div v-if="status === 'loading'">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p class="text-gray-600">Đang xác nhận hủy thanh toán...</p>
            <p class="text-gray-400 text-xs mt-2">
                Đang chờ WebSocket realtime
            </p>
        </div>

        <!-- Success (race: PayOS confirmed dù user đã cancel) -->
        <div v-else-if="status === 'success'">
            <div class="text-6xl mb-4">✅</div>
            <h1 class="text-2xl font-bold mb-2">Phát hiện thanh toán</h1>
            <p class="text-gray-600 mb-6">{{ errorMsg }}</p>
            <button
                @click="router.push('/candidate/pricing')"
                class="bg-primary-600 text-white py-2 px-6 rounded-lg hover:bg-primary-700 transition"
            >
                Quay lại trang gói
            </button>
        </div>

        <!-- Failed / Cancelled -->
        <div v-else>
            <div class="text-6xl mb-4">⚠️</div>
            <h1 class="text-2xl font-bold mb-2">Đã hủy thanh toán</h1>
            <p class="text-gray-600 mb-6">{{ errorMsg }}</p>
            <button
                @click="router.push('/candidate/pricing')"
                class="bg-primary-600 text-white py-2 px-6 rounded-lg hover:bg-primary-700 transition"
            >
                Quay lại chọn gói
            </button>
        </div>
    </div>
</template>

