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
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { paymentApi } from '@services/payment.api';
import { useAuthStore } from '@stores/auth';
import { connectSocket } from '@services/socket';
import { usePaymentUpdates } from '@composables/usePaymentUpdates';
import type { Payment } from '@/types/payment';
import {
  CircleCheck,
  CircleAlert,
  CircleX,
  Loader2,
  Receipt,
  Clock,
  Hash,
  CreditCard,
  ArrowRight,
  RefreshCw,
  Home,
  RotateCcw,
  ShieldAlert,
} from 'lucide-vue-next';

const router = useRouter();
const route = useRoute();
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

type Status = 'loading' | 'success' | 'failed';
const status = ref<Status>('loading');
const payment = ref<Payment | null>(null);
const errorMsg = ref('');

const STATUS_KEY = (orderCode: string) => `cancel_status:${orderCode}`;
const PAYMENT_KEY = (orderCode: string) => `cancel_payment:${orderCode}`;

function persist(orderCode: string): void {
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
function abortInFlight(): void {
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
}

// ===== WebSocket subscription (primary) =====
usePaymentUpdates(orderCodeRef, {
  onPaid: async () => {
    abortInFlight();
    try {
      const found = await paymentApi.getByOrderCode(orderCode);
      if (found) payment.value = found;
    } catch {
      /* không block UI nếu API lỗi — WS đã là source of truth */
    }
    status.value = 'success';
    errorMsg.value = 'PayOS đã xác nhận thanh toán thành công dù bạn bấm Hủy. Bấm "Xem lịch sử" để kiểm tra.';
    persist(orderCode);
  },
  onFailed: () => {
    abortInFlight();
    status.value = 'failed';
    errorMsg.value = 'Bạn đã hủy giao dịch. Không có khoản nào bị trừ.';
    persist(orderCode);
  },
});

async function fetchInitialStatus(): Promise<void> {
  abortInFlight();
  const controller = new AbortController();
  currentController = controller;

  try {
    const found = await paymentApi.getByOrderCode(orderCode, {
      signal: controller.signal,
    });
    if (status.value !== 'loading') return;

    if (!found) return; // DB chưa có payment → giữ loading, đợi WS

    payment.value = found;
    if (found.status === 'paid') {
      status.value = 'success';
      errorMsg.value = 'PayOS đã xác nhận thanh toán thành công dù bạn bấm Hủy. Bấm "Xem lịch sử" để kiểm tra.';
      persist(orderCode);
      return;
    }
    if (found.status === 'failed') {
      status.value = 'failed';
      errorMsg.value = 'Bạn đã hủy giao dịch. Không có khoản nào bị trừ.';
      persist(orderCode);
      return;
    }
    // pending → giữ 'loading', chờ WS hoặc backend webhook
  } catch (err: any) {
    if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
    if (status.value !== 'loading') return;
    status.value = 'failed';
    errorMsg.value = 'Đã hủy thanh toán';
    persist(orderCode);
  } finally {
    if (currentController === controller) {
      currentController = null;
    }
  }
}

async function manualRefresh(): Promise<void> {
  abortInFlight();
  sessionStorage.removeItem(STATUS_KEY(orderCode));
  sessionStorage.removeItem(PAYMENT_KEY(orderCode));
  payment.value = null;
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

  if (restore(orderCode)) return;

  await fetchInitialStatus();
});

onUnmounted(() => {
  abortInFlight();
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
        Đang xác nhận trạng thái
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

    <!-- ============ SUCCESS (race: PayOS confirmed dù user cancel) ============ -->
    <div v-else-if="status === 'success'">
      <div class="text-center mb-6">
        <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-green-100 to-emerald-50 mb-5 shadow-sm">
          <CircleCheck class="w-12 h-12 text-green-600" :stroke-width="2.5" />
        </div>
        <h1 class="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
          Phát hiện thanh toán thành công
        </h1>
        <p class="text-slate-500 text-sm md:text-base max-w-md mx-auto">
          {{ errorMsg }}
        </p>
      </div>

      <!-- Receipt (giống BillingSuccessView) -->
      <div v-if="payment" class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-4 border-b border-green-100 flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-white flex items-center justify-center shadow-sm">
            <Receipt class="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p class="text-sm font-semibold text-slate-900">Biên nhận thanh toán</p>
            <p class="text-xs text-slate-500">Giao dịch đã được PayOS xác nhận</p>
          </div>
          <span class="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 ring-1 ring-green-200">
            <CircleCheck class="w-3 h-3" />
            Đã thanh toán
          </span>
        </div>

        <div class="divide-y divide-slate-100">
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
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-6 py-4 items-center">
            <Clock class="w-4 h-4 text-slate-400" />
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs text-slate-500 uppercase tracking-wide">Thời gian</span>
              <span class="text-sm text-slate-700">{{ formattedDate }}</span>
            </div>
          </div>
        </div>

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

      <p class="text-center text-xs text-slate-400 mt-4">
        Nếu cần hỗ trợ, vui lòng liên hệ support kèm mã payment ở trên.
      </p>
    </div>

    <!-- ============ FAILED / CANCELLED ============ -->
    <div v-else>
      <div class="text-center mb-6">
        <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-amber-100 to-orange-50 mb-5 shadow-sm">
          <CircleAlert class="w-12 h-12 text-amber-600" :stroke-width="2.5" />
        </div>
        <h1 class="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
          Đã hủy thanh toán
        </h1>
        <p class="text-slate-500 text-sm md:text-base max-w-md mx-auto">
          {{ errorMsg || 'Bạn đã hủy giao dịch. Không có khoản nào bị trừ.' }}
        </p>
      </div>

      <!-- Reassurance card -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-slate-100 flex items-start gap-3">
          <div class="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center shrink-0">
            <ShieldAlert class="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p class="text-sm font-semibold text-slate-900 mb-1">Không có khoản phí nào được tính</p>
            <p class="text-xs text-slate-500 leading-relaxed">
              Giao dịch chưa hoàn tất nên tài khoản của bạn không bị trừ tiền. Bạn có thể thử lại bất cứ lúc nào.
            </p>
          </div>
        </div>

        <div class="px-6 py-5">
          <p class="text-sm font-semibold text-slate-900 mb-3">Bạn có thể thử lại bằng cách:</p>
          <ul class="text-sm text-slate-600 space-y-2.5">
            <li class="flex items-start gap-2">
              <RotateCcw class="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <span>Chọn lại gói dịch vụ và tiến hành thanh toán</span>
            </li>
            <li class="flex items-start gap-2">
              <CreditCard class="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <span>Dùng phương thức thanh toán khác (app ngân hàng, QR khác)</span>
            </li>
            <li class="flex items-start gap-2">
              <CircleX class="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <span>Nếu lỗi lặp lại, liên hệ support kèm mã order</span>
            </li>
          </ul>
        </div>

        <div class="px-6 py-5 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            type="button"
            class="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition shadow-sm"
            @click="router.push(pricingPath)"
          >
            <RefreshCw class="w-4 h-4" />
            Quay lại chọn gói
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

      <p class="text-center text-xs text-slate-400 mt-4">
        Mọi thắc mắc vui lòng liên hệ support kèm mã order.
      </p>
    </div>
  </div>
</template>