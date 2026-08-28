<script setup lang="ts">
/**
 * BillingSuccessView — Trang xác nhận thanh toán sau khi user quay lại từ PayOS.
 *
 * Realtime flow:
 *   1. URL có `?orderCode=...` → view load.
 *   2. Mount → connectSocket() + subscribe `payment:updated` qua usePaymentUpdates.
 *   3. Nếu WS nhận event cho orderCode này → set status='success' ngay (<1s).
 *   4. **Fallback**: Nếu WS chưa connect / miss → 1 lần GET /payments/by-order/:orderCode
 *      để check DB. Nếu DB đã paid → success. Nếu pending → chờ (không polling liên tục
 *      vì đã có WS làm primary).
 *   5. Khi success → refresh planStore + persist sessionStorage.
 *
 * Lưu ý:
 * - sessionStorage persist success state để chống remount reset (giữ UX cũ).
 * - KHÔNG polling mỗi 2-3s như trước — chỉ 1 lần fallback rồi đợi WS.
 */
import { ref, onMounted, onUnmounted, watch } from 'vue';
import axios from 'axios';
import { useRouter, useRoute } from 'vue-router';
import { paymentApi } from '@services/payment.api';
import { usePlanStore } from '@stores/plan';
import { connectSocket, disconnectSocket } from '@services/socket';
import { usePaymentUpdates } from '@composables/usePaymentUpdates';
import type { Payment } from '@/types/payment';

const router = useRouter();
const route = useRoute();
const planStore = usePlanStore();

type Status = 'loading' | 'success' | 'pending' | 'failed';
const status = ref<Status>('loading');
const payment = ref<Payment | null>(null);
const errorMsg = ref('');

// Track the in-flight fetch so we can abort it on unmount / manualRefresh / WS race.
let fetchController: AbortController | null = null;

const STATUS_KEY = (orderCode: string) => `billing_status:${orderCode}`;
const PAYMENT_KEY = (orderCode: string) => `billing_payment:${orderCode}`;

function persist(orderCode: string) {
    sessionStorage.setItem(STATUS_KEY(orderCode), status.value);
    if (payment.value) {
        sessionStorage.setItem(PAYMENT_KEY(orderCode), JSON.stringify(payment.value));
    }
}

function restore(orderCode: string): boolean {
    const savedStatus = sessionStorage.getItem(STATUS_KEY(orderCode));
    const savedPayment = sessionStorage.getItem(PAYMENT_KEY(orderCode));

    if (savedStatus === 'success') {
        status.value = 'success';
        if (savedPayment) {
            try {
                payment.value = JSON.parse(savedPayment);
            } catch {
                /* ignore */
            }
        }
        return true;
    }
    if (savedStatus === 'failed') {
        status.value = 'failed';
        return true;
    }
    return false;
}

const orderCode = (route.query.orderCode as string) || '';
const payosStatus = (route.query.status as string) || '';

// ===== WebSocket subscription (primary) =====
const { receivedSuccess: wsReceivedSuccess, receivedFailed: wsReceivedFailed } =
    usePaymentUpdates(orderCode, {
        onPaid: async () => {
            // WS đã xác nhận thanh toán thành công → set success, fetch payment detail, refresh plan
            try {
                const found = await paymentApi.getByOrderCode(orderCode);
                if (found) payment.value = found;
            } catch {
                /* không block UI nếu API lỗi — WS đã là source of truth */
            }
            status.value = 'success';
            persist(orderCode);
            planStore.fetchMyPlan();
        },
        onFailed: () => {
            status.value = 'failed';
            errorMsg.value = 'Payment bị từ chối bởi PayOS.';
            persist(orderCode);
        },
    });

// Watch trạng thái WS để persist + UI feedback
watch([wsReceivedSuccess, wsReceivedFailed], ([success, failed]) => {
    if (!success && !failed) return;
    // usePaymentUpdates đã gọi onPaid/onFailed để xử lý
    // Đảm bảo UI ở terminal state
    if (status.value === 'loading') {
        status.value = success ? 'success' : 'failed';
    }
});

async function fetchInitialStatus() {
    // Gọi 1 lần để lấy payment detail + check status nếu WS chưa connect.
    // Không polling liên tục — WS là primary.
    // Abort any previous in-flight request before issuing a new one.
    if (fetchController) fetchController.abort();
    const controller = new AbortController();
    fetchController = controller;
    try {
        const found = await paymentApi.getByOrderCode(orderCode, { signal: controller.signal });
        if (fetchController === controller) fetchController = null;
        if (wsReceivedSuccess.value || wsReceivedFailed.value) return; // WS đã set rồi
        if (!found) {
            // DB chưa có payment — hiếm, có thể user vào trang trước khi POST /payments xong
            status.value = 'pending';
            errorMsg.value =
                'Đang chờ PayOS xác nhận...';
            return;
        }
        if (found.status === 'paid') {
            payment.value = found;
            status.value = 'success';
            persist(orderCode);
            planStore.fetchMyPlan();
            return;
        }
        if (found.status === 'failed') {
            status.value = 'failed';
            errorMsg.value = 'Payment bị từ chối bởi PayOS.';
            persist(orderCode);
            return;
        }
        // pending → chờ WS hoặc user click "Thử lại"
        status.value = 'pending';
        errorMsg.value = 'Đang chờ PayOS xác nhận (realtime)...';
    } catch (err: any) {
        if (fetchController === controller) fetchController = null;
        // Expected when abort() is called from manualRefresh / unmount / WS race.
        if (axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
            return;
        }
        if (wsReceivedSuccess.value || wsReceivedFailed.value) return;
        status.value = 'pending';
        errorMsg.value = err?.response?.data?.message || 'Đang chờ PayOS xác nhận...';
    }
}

async function manualRefresh() {
    // Cancel any pending fetch before clearing sessionStorage and re-fetching.
    if (fetchController) fetchController.abort();
    fetchController = null;
    sessionStorage.removeItem(STATUS_KEY(orderCode));
    sessionStorage.removeItem(PAYMENT_KEY(orderCode));
    status.value = 'loading';
    errorMsg.value = '';
    await fetchInitialStatus();
}

onMounted(async () => {
    connectSocket();

    if (!orderCode) {
        status.value = 'failed';
        errorMsg.value = 'Thiếu orderCode trong URL';
        return;
    }

    // Nếu user cancel trên PayOS → query.status = CANCELLED
    if (payosStatus && payosStatus !== 'PAID') {
        status.value = 'failed';
        errorMsg.value = `PayOS status: ${payosStatus}`;
        return;
    }

    // Nếu đã có trong session → restore + return
    if (restore(orderCode)) return;

    // Fetch 1 lần — WS sẽ pick up nếu webhook đến sau.
    await fetchInitialStatus();
});

onUnmounted(() => {
    // Abort in-flight fetch to avoid setState-after-unmount / memory leak.
    if (fetchController) {
        fetchController.abort();
        fetchController = null;
    }
    // KHÔNG disconnectSocket ở đây — chat socket có thể đang dùng.
    // usePaymentUpdates tự cleanup listener khi unmount.
});
</script>

<template>
    <div class="max-w-md mx-auto px-4 py-12 text-center">
        <!-- Loading -->
        <div v-if="status === 'loading'">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p class="text-gray-600">Đang xác nhận thanh toán với PayOS...</p>
            <p class="text-gray-400 text-xs mt-2">
                Đang chờ WebSocket realtime
            </p>
        </div>

        <!-- Success -->
        <div v-else-if="status === 'success'">
            <div class="text-6xl mb-4">✅</div>
            <h1 class="text-2xl font-bold mb-2">Thanh toán thành công!</h1>
            <p class="text-gray-600 mb-6">Gói của bạn đã được kích hoạt.</p>
            <div v-if="payment" class="bg-gray-50 rounded-lg p-4 text-left mb-6">
                <p>
                    <strong>Mã payment:</strong>
                    <span class="font-mono text-xs ml-1">{{ payment.id }}</span>
                </p>
                <p>
                    <strong>Số tiền:</strong>
                    {{ Number(payment.amountVnd).toLocaleString('vi-VN') }}đ
                </p>
                <p>
                    <strong>Trạng thái:</strong>
                    <span class="text-green-600 font-semibold ml-1">{{ payment.status }}</span>
                </p>
                <p v-if="payment.subscriptionId">
                    <strong>Subscription:</strong>
                    <span class="font-mono text-xs ml-1">{{ payment.subscriptionId }}</span>
                </p>
            </div>
            <button
                @click="router.push('/candidate/pricing')"
                class="bg-primary-600 text-white py-2 px-6 rounded-lg hover:bg-primary-700 transition"
            >
                Quay lại trang gói
            </button>
        </div>

        <!-- Pending -->
        <div v-else-if="status === 'pending'">
            <div class="text-6xl mb-4">⏳</div>
            <h1 class="text-2xl font-bold mb-2">Đang chờ xử lý</h1>
            <p class="text-gray-600 mb-6">{{ errorMsg }}</p>
            <div class="flex gap-2 justify-center">
                <button
                    @click="manualRefresh"
                    class="bg-primary-600 text-white py-2 px-6 rounded-lg hover:bg-primary-700 transition"
                >
                    🔄 Thử lại
                </button>
                <button
                    @click="router.push('/candidate')"
                    class="bg-gray-200 text-gray-700 py-2 px-6 rounded-lg hover:bg-gray-300 transition"
                >
                    Về trang chính
                </button>
            </div>
        </div>

        <!-- Failed -->
        <div v-else>
            <div class="text-6xl mb-4">❌</div>
            <h1 class="text-2xl font-bold mb-2">Thanh toán thất bại</h1>
            <p class="text-red-600 mb-6">{{ errorMsg }}</p>
            <button
                @click="router.push('/candidate/pricing')"
                class="bg-primary-600 text-white py-2 px-6 rounded-lg hover:bg-primary-700 transition"
            >
                Thử lại
            </button>
        </div>
    </div>
</template>

