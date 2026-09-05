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
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import axios from 'axios';
import { useRouter, useRoute } from 'vue-router';
import { paymentApi } from '@services/payment.api';
import { usePlanStore } from '@stores/plan';
import { useAuthStore } from '@stores/auth';
import { connectSocket, disconnectSocket } from '@services/socket';
import { usePaymentUpdates } from '@composables/usePaymentUpdates';
import type { Payment } from '@/types/payment';
import {
  CircleCheck,
  CircleX,
  Loader2,
  Receipt,
  Clock,
  Hash,
  CreditCard,
  ArrowRight,
  RefreshCw,
  Home,
  Sparkles,
} from 'lucide-vue-next';

const router = useRouter();
const route = useRoute();
const planStore = usePlanStore();
const authStore = useAuthStore();

/** Path theo role — tránh hardcode khiến employer bị redirect nhầm về candidate. */
const homePath = computed<string>(() =>
  authStore.user?.role === 'employer' ? '/employer' : '/candidate',
);
const historyPath = computed<string>(() =>
  authStore.user?.role === 'employer' ? '/employer/billing/history' : '/candidate/billing/history',
);
const pricingPath = computed<string>(() =>
  authStore.user?.role === 'employer' ? '/employer/pricing' : '/candidate/pricing',
);

type Status = 'loading' | 'success' | 'pending' | 'failed';
const status = ref<Status>('loading');
const payment = ref<Payment | null>(null);
const errorMsg = ref('');

// Track the in-flight fetch so we can abort it on unmount / manualRefresh / WS race.
let fetchController: AbortController | null = null;

const STATUS_KEY = (orderCode: string) => `billing_status:${orderCode}`;
const PAYMENT_KEY = (orderCode: string) => `billing_payment:${orderCode}`;

function persist(orderCode: string): void {
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
      try {
        const found = await paymentApi.getByOrderCode(orderCode);
        if (found) payment.value = found;
      } catch {
        /* không block UI nếu API lỗi — WS đã là source of truth */
      }
      status.value = 'success';
      persist(orderCode);
      void planStore.fetchMyPlan();
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
  if (status.value === 'loading') {
    status.value = success ? 'success' : 'failed';
  }
});

async function fetchInitialStatus(): Promise<void> {
  if (fetchController) fetchController.abort();
  const controller = new AbortController();
  fetchController = controller;
  try {
    const found = await paymentApi.getByOrderCode(orderCode, { signal: controller.signal });
    if (fetchController === controller) fetchController = null;
    if (wsReceivedSuccess.value || wsReceivedFailed.value) return;
    if (!found) {
      status.value = 'pending';
      errorMsg.value = 'Đang chờ PayOS xác nhận...';
      return;
    }
    if (found.status === 'paid') {
      payment.value = found;
      status.value = 'success';
      persist(orderCode);
      void planStore.fetchMyPlan();
      return;
    }
    if (found.status === 'failed') {
      status.value = 'failed';
      errorMsg.value = 'Payment bị từ chối bởi PayOS.';
      persist(orderCode);
      return;
    }
    status.value = 'pending';
    errorMsg.value = 'Đang chờ PayOS xác nhận (realtime)...';
  } catch (err: any) {
    if (fetchController === controller) fetchController = null;
    if (axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
      return;
    }
    if (wsReceivedSuccess.value || wsReceivedFailed.value) return;
    status.value = 'pending';
    errorMsg.value = err?.response?.data?.message || 'Đang chờ PayOS xác nhận...';
  }
}

async function manualRefresh(): Promise<void> {
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

  if (payosStatus && payosStatus !== 'PAID') {
    status.value = 'failed';
    errorMsg.value = `PayOS status: ${payosStatus}`;
    return;
  }

  if (restore(orderCode)) return;

  await fetchInitialStatus();
});

onUnmounted(() => {
  if (fetchController) {
    fetchController.abort();
    fetchController = null;
  }
});

/* ============================================================================
 * Display helpers
 * ==========================================================================*/
const formattedAmount = computed<string>(() => {
  if (!payment.value) return '';
  return Number(payment.value.amountVnd).toLocaleString('vi-VN') + 'đ';
});

const formattedDate = computed<string>(() => {
  if (!payment.value?.createdAt) return '';
  return new Date(payment.value.createdAt).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
});
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-8 md:py-12">
    <!-- ============ LOADING ============ -->
    <div v-if="status === 'loading'" class="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 mb-5">
        <Loader2 class="w-8 h-8 text-blue-600 animate-spin" />
      </div>
      <h1 class="text-xl font-bold text-slate-900 mb-2">
        Đang xác nhận thanh toán
      </h1>
      <p class="text-sm text-slate-500">
        Đang đồng bộ với PayOS qua WebSocket realtime...
      </p>
      <div class="mt-6 flex items-center justify-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        <span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" style="animation-delay: 0.15s" />
        <span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" style="animation-delay: 0.3s" />
      </div>
    </div>

    <!-- ============ SUCCESS ============ -->
    <div v-else-if="status === 'success'">
      <!-- Hero -->
      <div class="text-center mb-6">
        <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-green-100 to-emerald-50 mb-5 shadow-sm">
          <CircleCheck class="w-12 h-12 text-green-600" :stroke-width="2.5" />
        </div>
        <h1 class="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
          Thanh toán thành công!
        </h1>
        <p class="text-slate-500 text-sm md:text-base">
          Gói dịch vụ của bạn đã được kích hoạt ngay.
        </p>
      </div>

      <!-- Receipt card -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <!-- Header strip -->
        <div class="bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-4 border-b border-green-100 flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-white flex items-center justify-center shadow-sm">
            <Receipt class="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p class="text-sm font-semibold text-slate-900">Biên nhận thanh toán</p>
            <p class="text-xs text-slate-500">Lưu lại để đối chiếu khi cần</p>
          </div>
          <span class="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 ring-1 ring-green-200">
            <CircleCheck class="w-3 h-3" />
            Đã thanh toán
          </span>
        </div>

        <!-- Detail rows -->
        <div v-if="payment" class="divide-y divide-slate-100">
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-6 py-4 items-center">
            <Hash class="w-4 h-4 text-slate-400" />
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs text-slate-500 uppercase tracking-wide">Mã payment</span>
              <span class="font-mono text-xs text-slate-900">{{ payment.id }}</span>
            </div>
          </div>
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-6 py-4 items-center">
            <CreditCard class="w-4 h-4 text-slate-400" />
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs text-slate-500 uppercase tracking-wide">Số tiền</span>
              <span class="text-base font-bold text-slate-900">{{ formattedAmount }}</span>
            </div>
          </div>
          <div v-if="payment.subscriptionId" class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-6 py-4 items-center">
            <Sparkles class="w-4 h-4 text-slate-400" />
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs text-slate-500 uppercase tracking-wide">Subscription</span>
              <span class="font-mono text-xs text-slate-900">{{ payment.subscriptionId }}</span>
            </div>
          </div>
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-6 py-4 items-center">
            <Clock class="w-4 h-4 text-slate-400" />
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs text-slate-500 uppercase tracking-wide">Thời gian</span>
              <span class="text-sm text-slate-700">{{ formattedDate }}</span>
            </div>
          </div>
        </div>

        <!-- CTAs -->
        <div class="px-6 py-5 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            type="button"
            class="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition shadow-sm"
            @click="router.push(historyPath)"
          >
            <Receipt class="w-4 h-4" />
            Xem lịch sử thanh toán
            <ArrowRight class="w-4 h-4" />
          </button>
          <button
            type="button"
            class="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition"
            @click="router.push(homePath)"
          >
            <Home class="w-4 h-4" />
            Về trang chính
          </button>
        </div>
      </div>

      <!-- Hint footer -->
      <p class="text-center text-xs text-slate-400 mt-4">
        Mọi thắc mắc vui lòng liên hệ support kèm mã payment ở trên.
      </p>
    </div>

    <!-- ============ PENDING ============ -->
    <div v-else-if="status === 'pending'" class="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-50 mb-5">
        <Clock class="w-8 h-8 text-amber-600" />
      </div>
      <h1 class="text-xl font-bold text-slate-900 mb-2">Đang chờ xử lý</h1>
      <p class="text-sm text-slate-500 mb-6 max-w-sm mx-auto">
        {{ errorMsg || 'PayOS chưa gửi xác nhận thanh toán. Có thể do mạng chậm — vui lòng thử lại sau vài giây.' }}
      </p>
      <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition shadow-sm"
          @click="manualRefresh"
        >
          <RefreshCw class="w-4 h-4" />
          Thử lại
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition"
          @click="router.push(homePath)"
        >
          <Home class="w-4 h-4" />
          Về trang chính
        </button>
      </div>
    </div>

    <!-- ============ FAILED ============ -->
    <div v-else>
      <div class="text-center mb-6">
        <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-red-100 to-rose-50 mb-5 shadow-sm">
          <CircleX class="w-12 h-12 text-red-600" :stroke-width="2.5" />
        </div>
        <h1 class="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
          Thanh toán thất bại
        </h1>
        <p class="text-slate-500 text-sm md:text-base">
          {{ errorMsg || 'Giao dịch không thành công. Vui lòng thử lại hoặc chọn gói khác.' }}
        </p>
      </div>

      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <p class="text-sm font-semibold text-slate-900 mb-3">Bạn có thể thử:</p>
        <ul class="text-sm text-slate-600 space-y-2 mb-6">
          <li class="flex items-start gap-2">
            <span class="text-slate-400 mt-0.5">•</span>
            Kiểm tra số dư tài khoản / hạn mức thẻ
          </li>
          <li class="flex items-start gap-2">
            <span class="text-slate-400 mt-0.5">•</span>
            Dùng app ngân hàng / QR khác để quét lại
          </li>
          <li class="flex items-start gap-2">
            <span class="text-slate-400 mt-0.5">•</span>
            Liên hệ support nếu đã trừ tiền nhưng chưa kích hoạt gói
          </li>
        </ul>
        <div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            type="button"
            class="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition shadow-sm"
            @click="router.push(pricingPath)"
          >
            <RefreshCw class="w-4 h-4" />
            Thử lại với gói khác
          </button>
          <button
            type="button"
            class="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition"
            @click="router.push(homePath)"
          >
            <Home class="w-4 h-4" />
            Về trang chính
          </button>
        </div>
      </div>
    </div>
  </div>
</template>