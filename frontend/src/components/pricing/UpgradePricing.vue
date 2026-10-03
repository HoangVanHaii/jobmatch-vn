<script setup lang="ts">
/**
 * UpgradePricing — Component modal / card nâng cấp gói dịch vụ (Upgrade your plan).
 *
 * Layout 2 cột:
 *  - Cột trái: tiêu đề, switcher Yearly/Monthly, 2 thẻ chọn gói (radio),
 *    danh sách tính năng của gói đang chọn, footer "Maybe later" + CTA.
 *  - Cột phải: ảnh mockup + thẻ trích nhận xét (glassmorphism).
 *
 * Data lấy giống PricingComponent.vue (API là nguồn truth, không hardcode):
 *  - Fetch plans từ planStore (GET /plans) + gói hiện tại (fetchMyPlan)
 *  - Toggle Yearly/Monthly → lọc plans theo duration_days (30 / 365 ngày)
 *  - Tên/giá/features hiển thị từ plans.name / priceVnd / features
 *  - Flow mua: chưa login → redirect login; đang có gói trả phí → confirm
 *    modal (mua mới sẽ kết thúc gói cũ, không cộng dồn) → PayOS QR modal →
 *    redirect billing-success
 */
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import {
  Check,
  CircleAlert,
  TriangleAlert,
  X,
  Loader2,
} from "lucide-vue-next";
import { useAuthStore } from "@stores/auth";
import { usePlanStore } from "@stores/plan";
import { paymentApi } from "@services/payment.api";
import { extractErrorMessage } from "@services/http";
import PaymentQRModal from "@components/payment/PaymentQRModal.vue";
import type { Plan } from "@/types/plan";
import type { CreatePaymentResponse } from "@/types/payment";
import type { CountableQuotaKey } from "@/types/billing";

export type BillingCycle = "yearly" | "monthly";
export type TargetTier = "professional" | "premium";
/** Tier gốc của plan — code BE: free / premium / professional (+ -yearly). */
type TierCode = "free" | "premium" | "professional";

export interface UpgradePricingProps {
  /** Trạng thái mở modal (v-model:open) */
  open?: boolean;
  /** Cho phép render dạng modal (fixed backdrop) hay inline card. Mặc định true (modal) */
  asModal?: boolean;
  /** Tiêu đề chính */
  title?: string;
  /** Tiêu đề danh sách tính năng */
  featuresTitle?: string;
  /** Text nút đóng / bỏ qua */
  maybeLaterText?: string;
  /** URL ảnh mockup bên phải */
  mockupImage?: string;
}

const props = withDefaults(defineProps<UpgradePricingProps>(), {
  open: true,
  asModal: true,
  title: "Nâng cấp gói dịch vụ của bạn",
  featuresTitle: "Mở khóa năng suất của bạn",
  maybeLaterText: "Để sau",
  mockupImage:
    "https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=1200&q=80",
});

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update:open", value: boolean): void;
  (e: "success", data: { plan: Plan; orderCode?: string | number }): void;
  (e: "select", plan: Plan): void;
}>();

/* ============================================================================
 * State & Stores
 * ==========================================================================*/
const router = useRouter();
const auth = useAuthStore();
const planStore = usePlanStore();
const { plans } = storeToRefs(planStore);

const period = ref<BillingCycle>("yearly");
const selectedTier = ref<TargetTier>("professional");

const loading = ref(false);
const errorMsg = ref("");
const buying = ref<string | null>(null);

const qrOpen = ref(false);
const qrPlan = ref<Plan | null>(null);
const qrPaymentData = ref<CreatePaymentResponse | null>(null);

const confirmOpen = ref(false);
const confirmPlan = ref<Plan | null>(null);

const PERIOD_LABEL: Record<BillingCycle, string> = {
  monthly: "/ tháng",
  yearly: "/ năm",
};

const tierOf = (code: string): TierCode =>
  code.replace("-yearly", "") as TierCode;

/* ============================================================================
 * Plans & features — cùng logic dữ liệu với PricingComponent
 * ==========================================================================*/
/** Nhãn quota + thứ tự feature hiển thị (candidate). */
const QUOTA_LABEL: Record<CountableQuotaKey, string> = {
  job_post: "Lượt đăng việc làm",
  job_generation: "Lượt tạo mô tả việc làm (AI)",
  ai_cv_parsed: "Phân tích CV",
  ai_cv_analysis: "Chấm điểm CV bằng AI",
  ai_cv_match: "AI match hồ sơ",
};

const FEATURE_KEYS: CountableQuotaKey[] = [
  "ai_cv_match",
  "ai_cv_parsed",
  "ai_cv_analysis",
];

/** Format quota value: -1 → "Không giới hạn", số → "N lượt". */
function formatQuota(value: unknown): string {
  if (value === -1) return "Không giới hạn";
  return `${value} lượt`;
}

/** Tìm plan theo tier + chu kỳ trong store (giống bộ lọc PricingComponent). */
function resolvePlan(tier: TargetTier, cycle: BillingCycle): Plan | null {
  return (
    (plans.value ?? []).find((p) => {
      if (tierOf(p.code) !== tier) return false;
      return cycle === "monthly" ? p.durationDays <= 31 : p.durationDays >= 365;
    }) ?? null
  );
}

/** Gói Pro hiện tại theo toggle chu kỳ */
const proPlan = computed<Plan | null>(() =>
  resolvePlan("professional", period.value),
);

/** Gói Premium hiện tại theo toggle chu kỳ */
const premiumPlan = computed<Plan | null>(() =>
  resolvePlan("premium", period.value),
);

/** Gói đang được user chọn (Pro hoặc Premium) */
const currentSelectedPlan = computed<Plan | null>(() =>
  selectedTier.value === "professional" ? proPlan.value : premiumPlan.value,
);

/** Giá hiển thị — format chung 1 nhánh như PricingComponent. */
const priceText = (plan: Plan): string =>
  `${Number(plan.priceVnd).toLocaleString("vi-VN")} ₫`;

const periodText = computed<string>(() => PERIOD_LABEL[period.value]);

/** Features của gói đang chọn — build từ plan.features như PricingComponent. */
const currentFeatures = computed<{ label: string; value: string }[]>(() => {
  const plan = currentSelectedPlan.value;
  if (!plan) return [];
  return FEATURE_KEYS.filter((k) => k in (plan.features ?? {})).map((k) => ({
    label: QUOTA_LABEL[k],
    value: formatQuota(plan.features[k]),
  }));
});

/** Kiểm tra gói đang dùng */
const currentPlanCode = computed<string | null>(
  () => planStore.currentPlan?.code ?? null,
);

const hasActivePaidPlan = computed<boolean>(() => {
  const p = planStore.currentPlan;
  if (!p) return false;
  return p.code !== "free" && Number(p.priceVnd) > 0;
});

const remainingDays = computed<number | null>(() => {
  const expires = planStore.currentPlanExpiresAt;
  if (!expires) return null;
  const ms = new Date(expires).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
});

/** Gói đang chọn là gói user đang dùng (= gia hạn). */
const isSelectedCurrent = computed<boolean>(
  () =>
    !!currentSelectedPlan.value &&
    currentPlanCode.value === currentSelectedPlan.value.code,
);

/** Gói đang chọn miễn phí → không mua được. */
const isSelectedFree = computed<boolean>(
  () =>
    !!currentSelectedPlan.value &&
    Number(currentSelectedPlan.value.priceVnd) === 0,
);

/* ============================================================================
 * Flow mua & xác nhận (Đồng bộ với PricingComponent.vue)
 * ==========================================================================*/
const handleClose = (): void => {
  emit("close");
  emit("update:open", false);
};

const selectTier = (tier: TargetTier): void => {
  selectedTier.value = tier;
  const plan =
    tier === "professional" ? proPlan.value : premiumPlan.value;
  if (plan) emit("select", plan);
};

const handleContinue = async (): Promise<void> => {
  const plan = currentSelectedPlan.value;
  // Guard phòng vệ: nút CTA đã disable khi !currentSelectedPlan / free —
  // chạm được đây chỉ là edge (bấm trong khoảng plans chưa fetch xong).
  if (!plan || isSelectedFree.value) {
    return;
  }
  errorMsg.value = "";

  if (!auth.isAuthenticated) {
    handleClose();
    await router.push({
      name: "login",
      query: { redirect: router.currentRoute.value.fullPath },
    });
    return;
  }

  if (hasActivePaidPlan.value) {
    alert("Bạn đang có gói trả phí. Mua mới sẽ kết thúc gói cũ, không cộng dồn.");
    confirmPlan.value = plan;
    confirmOpen.value = true;
    return;
  }

  await buyPlan(plan);
};

const cancelConfirm = (): void => {
  confirmOpen.value = false;
  confirmPlan.value = null;
};

const proceedConfirm = (): void => {
  const plan = confirmPlan.value;
  if (!plan) return;
  confirmOpen.value = false;
  confirmPlan.value = null;
  void buyPlan(plan);
};

const buyPlan = async (plan: Plan): Promise<void> => {
  buying.value = plan.id;
  try {
    const data = await paymentApi.create({ planId: plan.id });
    qrPlan.value = plan;
    qrPaymentData.value = data;
    qrOpen.value = true;
  } catch (err: unknown) {
    // Interceptor http.ts unwrap lỗi BE thành HttpError (KHÔNG có .response)
    // → dùng extractErrorMessage để đọc đúng message BE (cả 2 shape).
    errorMsg.value = extractErrorMessage(
      err,
      "Không tạo được link thanh toán. Vui lòng thử lại.",
    );
  } finally {
    buying.value = null;
  }
};

const onPaymentSuccess = async (): Promise<void> => {
  const orderCode = qrPaymentData.value?.payment.orderCode;
  qrOpen.value = false;
  await planStore.fetchMyPlan();
  if (qrPlan.value) emit("success", { plan: qrPlan.value, orderCode });
  qrPaymentData.value = null;
  qrPlan.value = null;
  handleClose();
  await router.push({
    name: "billing-success",
    query: orderCode ? { orderCode, status: "PAID" } : undefined,
  });
};

const onPaymentClose = (): void => {
  qrOpen.value = false;
  qrPaymentData.value = null;
  qrPlan.value = null;
};

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([planStore.fetchPublicPlans(), planStore.fetchMyPlan()]);
  } catch {
    // plans rỗng → hiển thị trạng thái trống, không crash UI
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-if="!asModal || open" class="upgrade-pricing-root">
    <!-- Modal Backdrop nếu dùng asModal -->
    <div
      v-if="asModal"
      class="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
      @click.self="handleClose"
    >
      <div
        class="relative w-full max-w-[800px] bg-white rounded-md shadow-2xl overflow-hidden border border-gray-100 my-auto animate-fade-in"
      >
        <!-- Nút đóng nhanh ở góc trên phải -->
        <button
          type="button"
          class="absolute top-3 right-3 z-20 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
          aria-label="Close"
          @click="handleClose"
        >
          <X class="w-4 h-4" />
        </button>

        <!-- Khối nội dung 2 cột -->
        <div class="grid grid-cols-1 md:grid-cols-5">
          <!-- Cột Trái: Lựa chọn gói & Tính năng -->
          <div class="p-4 sm:p-5 md:col-span-3 flex flex-col justify-between bg-white">
            <div>
              <!-- Tiêu đề chính -->
              <h2
                class="text-lg sm:text-xl font-bold text-gray-900 tracking-tight leading-snug"
              >
                {{ title }}
              </h2>

              <!-- Switcher chu kỳ thanh toán: Yearly vs Monthly -->
              <div class="mt-3 mb-4 inline-flex p-0.5 bg-[#f3f4f6] rounded-md">
                <!-- Nút Yearly -->
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200"
                  :class="
                    period === 'yearly'
                      ? 'bg-[#5b4eea] text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  "
                  @click="period = 'yearly'"
                >
                  Năm
                </button>

                <!-- Nút Monthly -->
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200"
                  :class="
                    period === 'monthly'
                      ? 'bg-[#5b4eea] text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  "
                  @click="period = 'monthly'"
                >
                  Tháng
                </button>
              </div>

              <!-- Lỗi thanh toán / API nếu có -->
              <div
                v-if="errorMsg"
                class="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-600"
              >
                <CircleAlert class="w-4 h-4 mt-0.5 shrink-0" />
                <span>{{ errorMsg }}</span>
              </div>

              <!-- Loading skeleton -->
              <div v-if="loading && !proPlan && !premiumPlan" class="space-y-3">
                <div
                  v-for="n in 2"
                  :key="n"
                  class="h-[56px] rounded-md bg-gray-100 animate-pulse"
                ></div>
              </div>

              <!-- Danh sách 2 thẻ lựa chọn gói: Pro & Premium -->
              <div v-else class="space-y-2.5">
                <!-- Thẻ Pro (Professional) -->
                <div
                  role="radio"
                  :aria-checked="selectedTier === 'professional'"
                  tabindex="0"
                  class="flex items-center justify-between p-3 rounded-md border cursor-pointer transition-all duration-200 select-none"
                  :class="
                    selectedTier === 'professional'
                      ? 'border-2 border-[#5b4eea] bg-[#5b4eea]/5 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  "
                  @click="selectTier('professional')"
                  @keydown.space.prevent="selectTier('professional')"
                  @keydown.enter.prevent="selectTier('professional')"
                >
                  <div>
                    <div class="text-[13px] font-semibold text-gray-900 leading-snug">
                      {{ proPlan?.name ?? "Pro" }}
                    </div>
                    <div class="text-[11px] text-gray-500 mt-0.5 font-normal">
                      <template v-if="proPlan">
                        {{ priceText(proPlan) }}
                        <span class="text-gray-400">{{ periodText }}</span>
                      </template>
                      <template v-else>—</template>
                    </div>
                  </div>

                  <!-- Radio Indicator -->
                  <div
                    class="w-4 h-4 rounded-full flex items-center justify-center transition-colors"
                    :class="
                      selectedTier === 'professional'
                        ? 'border-2 border-[#5b4eea]'
                        : 'border-2 border-gray-300'
                    "
                  >
                    <div
                      v-if="selectedTier === 'professional'"
                      class="w-2 h-2 rounded-full bg-[#5b4eea]"
                    ></div>
                  </div>
                </div>

                <!-- Thẻ Premium -->
                <div
                  role="radio"
                  :aria-checked="selectedTier === 'premium'"
                  tabindex="0"
                  class="flex items-center justify-between p-3 rounded-md border cursor-pointer transition-all duration-200 select-none"
                  :class="
                    selectedTier === 'premium'
                      ? 'border-2 border-[#5b4eea] bg-[#5b4eea]/5 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  "
                  @click="selectTier('premium')"
                  @keydown.space.prevent="selectTier('premium')"
                  @keydown.enter.prevent="selectTier('premium')"
                >
                  <div>
                    <div class="text-[13px] font-semibold text-gray-900 leading-snug">
                      {{ premiumPlan?.name ?? "Premium" }}
                    </div>
                    <div class="text-[11px] text-gray-500 mt-0.5 font-normal">
                      <template v-if="premiumPlan">
                        {{ priceText(premiumPlan) }}
                        <span class="text-gray-400">{{ periodText }}</span>
                      </template>
                      <template v-else>—</template>
                    </div>
                  </div>

                  <!-- Radio Indicator -->
                  <div
                    class="w-4 h-4 rounded-full flex items-center justify-center transition-colors"
                    :class="
                      selectedTier === 'premium'
                        ? 'border-2 border-[#5b4eea]'
                        : 'border-2 border-gray-300'
                    "
                  >
                    <div
                      v-if="selectedTier === 'premium'"
                      class="w-2 h-2 rounded-full bg-[#5b4eea]"
                    ></div>
                  </div>
                </div>
              </div>

              <!-- Danh sách tính năng của gói đang chọn -->
              <div v-if="currentFeatures.length" class="mt-4 pt-1">
                <h3 class="text-[13px] font-semibold text-gray-900 mb-2.5">
                  {{ featuresTitle }}
                </h3>

                <ul class="space-y-2">
                  <li
                    v-for="feature in currentFeatures"
                    :key="feature.label"
                    class="flex items-center gap-2 text-[11.5px] sm:text-xs text-gray-700 leading-normal"
                  >
                    <!-- Icon check hình tròn màu tím -->
                    <div
                      class="w-4 h-4 rounded-full bg-[#5b4eea] text-white flex items-center justify-center shrink-0 shadow-xs"
                    >
                      <Check class="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                    <span>
                      {{ feature.label }}:
                      <strong class="font-semibold text-gray-900">
                        {{ feature.value }}
                      </strong>
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Footer: Nút Maybe later & Continue with [Plan] -->
            <div
              class="flex items-center justify-between pt-4 mt-4 border-t border-gray-100"
            >
              <button
                type="button"
                class="text-[11px] sm:text-xs font-medium text-gray-500 hover:text-gray-800 transition px-2 py-1.5 rounded-md"
                @click="handleClose"
              >
                {{ maybeLaterText }}
              </button>

              <button
                type="button"
                :disabled="buying !== null || !currentSelectedPlan || isSelectedFree"
                class="flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-[#5b4eea] hover:bg-[#4a3ed6] active:scale-[0.98] text-white text-[11px] sm:text-xs font-semibold transition shadow-sm disabled:opacity-75 disabled:cursor-not-allowed"
                @click="handleContinue"
              >
                <Loader2 v-if="buying !== null" class="w-3.5 h-3.5 animate-spin" />
                <span>
                  {{
                    buying !== null
                      ? "Đang xử lý..."
                      : `Tiếp tục với ${currentSelectedPlan?.name ?? "..."}`
                  }}
                </span>
              </button>
            </div>
          </div>

          <!-- Cột Phải: Ảnh Mockup & Card Testimonial -->
          <div
            class="relative hidden md:flex flex-col justify-end md:col-span-2 min-h-[360px] bg-slate-900 overflow-hidden"
          >
            <!-- Ảnh người dùng làm việc chuyên nghiệp -->
            <img
              :src="mockupImage"
              alt="Tòa nhà cao tầng nhìn từ dưới lên"
              class="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-700 hover:scale-105"
            />

            <!-- Lớp phủ chuyển sắc tối dần về phía đáy -->
            <div
              class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent pointer-events-none"
            ></div>

            <!-- Testimonial card dạng glassmorphism mờ kính -->
            <div
              class="relative z-10 m-3 p-3 rounded-md bg-black/40 backdrop-blur-md border border-white/15 text-white shadow-xl"
            >
              <!-- Mô tả của gói đang chọn (từ API) -->
              <p class="text-[11px] leading-relaxed text-white/90">
                {{ currentSelectedPlan?.description }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Render Inline (khi asModal = false) -->
    <div
      v-else
      class="w-full max-w-[800px] mx-auto bg-white rounded-md shadow-xl overflow-hidden border border-gray-100"
    >
      <div class="grid grid-cols-1 md:grid-cols-5">
        <div class="p-4 sm:p-5 md:col-span-3 flex flex-col justify-between bg-white">
          <div>
            <h2
              class="text-lg sm:text-xl font-bold text-gray-900 tracking-tight leading-snug"
            >
              {{ title }}
            </h2>

            <div class="mt-3 mb-4 inline-flex p-0.5 bg-[#f3f4f6] rounded-md">
              <button
                type="button"
                class="px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200"
                :class="
                  period === 'yearly'
                    ? 'bg-[#5b4eea] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                "
                @click="period = 'yearly'"
              >
                Yearly
              </button>

              <button
                type="button"
                class="px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200"
                :class="
                  period === 'monthly'
                    ? 'bg-[#5b4eea] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                "
                @click="period = 'monthly'"
              >
                Monthly
              </button>
            </div>

            <div
              v-if="errorMsg"
              class="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-600"
            >
              <CircleAlert class="w-4 h-4 mt-0.5 shrink-0" />
              <span>{{ errorMsg }}</span>
            </div>

            <!-- Loading skeleton -->
            <div v-if="loading && !proPlan && !premiumPlan" class="space-y-2.5">
              <div
                v-for="n in 2"
                :key="n"
                class="h-[56px] rounded-md bg-gray-100 animate-pulse"
              ></div>
            </div>

            <div v-else class="space-y-2.5">
              <div
                role="radio"
                :aria-checked="selectedTier === 'professional'"
                tabindex="0"
                class="flex items-center justify-between p-3 rounded-md border cursor-pointer transition-all duration-200 select-none"
                :class="
                  selectedTier === 'professional'
                    ? 'border-2 border-[#5b4eea] bg-[#5b4eea]/5 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                "
                @click="selectTier('professional')"
                @keydown.space.prevent="selectTier('professional')"
                @keydown.enter.prevent="selectTier('professional')"
              >
                <div>
                  <div class="text-[13px] font-semibold text-gray-900 leading-snug">
                    {{ proPlan?.name ?? "Pro" }}
                  </div>
                  <div class="text-[11px] text-gray-500 mt-0.5 font-normal">
                    <template v-if="proPlan">
                      {{ priceText(proPlan) }}
                      <span class="text-gray-400">{{ periodText }}</span>
                    </template>
                    <template v-else>—</template>
                  </div>
                </div>

                <div
                  class="w-4 h-4 rounded-full flex items-center justify-center transition-colors"
                  :class="
                    selectedTier === 'professional'
                      ? 'border-2 border-[#5b4eea]'
                      : 'border-2 border-gray-300'
                  "
                >
                  <div
                    v-if="selectedTier === 'professional'"
                    class="w-2 h-2 rounded-full bg-[#5b4eea]"
                  ></div>
                </div>
              </div>

              <div
                role="radio"
                :aria-checked="selectedTier === 'premium'"
                tabindex="0"
                class="flex items-center justify-between p-3 rounded-md border cursor-pointer transition-all duration-200 select-none"
                :class="
                  selectedTier === 'premium'
                    ? 'border-2 border-[#5b4eea] bg-[#5b4eea]/5 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                "
                @click="selectTier('premium')"
                @keydown.space.prevent="selectTier('premium')"
                @keydown.enter.prevent="selectTier('premium')"
              >
                <div>
                  <div class="text-[13px] font-semibold text-gray-900 leading-snug">
                    {{ premiumPlan?.name ?? "Premium" }}
                  </div>
                  <div class="text-[11px] text-gray-500 mt-0.5 font-normal">
                    <template v-if="premiumPlan">
                      {{ priceText(premiumPlan) }}
                      <span class="text-gray-400">{{ periodText }}</span>
                    </template>
                    <template v-else>—</template>
                  </div>
                </div>

                <div
                  class="w-4 h-4 rounded-full flex items-center justify-center transition-colors"
                  :class="
                    selectedTier === 'premium'
                      ? 'border-2 border-[#5b4eea]'
                      : 'border-2 border-gray-300'
                  "
                >
                  <div
                    v-if="selectedTier === 'premium'"
                    class="w-2 h-2 rounded-full bg-[#5b4eea]"
                  ></div>
                </div>
              </div>
            </div>

            <div v-if="currentFeatures.length" class="mt-4 pt-1">
              <h3 class="text-[13px] font-semibold text-gray-900 mb-2.5">
                {{ featuresTitle }}
              </h3>

              <ul class="space-y-2">
                <li
                  v-for="feature in currentFeatures"
                  :key="feature.label"
                  class="flex items-center gap-2 text-[11.5px] sm:text-xs text-gray-700 leading-normal"
                >
                  <div
                    class="w-4 h-4 rounded-full bg-[#5b4eea] text-white flex items-center justify-center shrink-0 shadow-xs"
                  >
                    <Check class="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                  <span>
                    {{ feature.label }}:
                    <strong class="font-semibold text-gray-900">
                      {{ feature.value }}
                    </strong>
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div
            class="flex items-center justify-between pt-4 mt-4 border-t border-gray-100"
          >
            <button
              type="button"
              class="text-[11px] sm:text-xs font-medium text-gray-500 hover:text-gray-800 transition px-2 py-1.5 rounded-md"
              @click="handleClose"
            >
              {{ maybeLaterText }}
            </button>

            <button
              type="button"
              :disabled="buying !== null || !currentSelectedPlan || isSelectedFree"
              class="flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-[#5b4eea] hover:bg-[#4a3ed6] active:scale-[0.98] text-white text-[11px] sm:text-xs font-semibold transition shadow-sm disabled:opacity-75 disabled:cursor-not-allowed"
              @click="handleContinue"
            >
              <Loader2 v-if="buying !== null" class="w-3.5 h-3.5 animate-spin" />
              <span>
                {{
                  buying !== null
                    ? "Đang xử lý..."
                    : `Continue with ${currentSelectedPlan?.name ?? "..."}`
                }}
              </span>
            </button>
          </div>
        </div>

        <div
          class="relative hidden md:flex flex-col justify-end md:col-span-2 min-h-[360px] bg-slate-900 overflow-hidden"
        >
          <img
            :src="mockupImage"
            alt="Professional Career Upgrade"
            class="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-700 hover:scale-105"
          />

          <div
            class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent pointer-events-none"
          ></div>

          <div
            class="relative z-10 m-3 p-3 rounded-md bg-black/40 backdrop-blur-md border border-white/15 text-white shadow-xl"
          >
            <!-- Mô tả của gói đang chọn (từ API) -->
            <p class="text-[11px] leading-relaxed text-white/90">
              {{ currentSelectedPlan?.description }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Confirm Modal khi nâng cấp đè gói đang sử dụng -->
    <div
      v-if="confirmOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      @click.self="cancelConfirm"
    >
      <div
        class="bg-white rounded-md p-5 max-w-md w-full shadow-2xl border border-gray-100"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <TriangleAlert class="h-5 w-5 shrink-0 text-amber-500" />
          <h3 class="text-base font-bold text-gray-900">
            Xác nhận thay đổi gói dịch vụ
          </h3>
        </div>
        <p class="text-[13px] text-gray-600 mb-5 leading-relaxed">
          Gói hiện tại của bạn
          {{ remainingDays !== null ? `còn ${remainingDays} ngày` : "" }}. Khi nâng
          cấp lên gói
          <strong>{{ confirmPlan?.name || "mới" }}</strong
          >, gói hiện tại sẽ kết thúc và gói mới sẽ kích hoạt ngay hôm nay. Thời gian
          còn lại không được cộng dồn.
        </p>
        <div class="flex gap-3 justify-end">
          <button
            type="button"
            class="px-4 py-2 rounded-md text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
            @click="cancelConfirm"
          >
            Hủy
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-md text-sm font-semibold text-white bg-[#5b4eea] hover:bg-[#4a3ed6] transition"
            @click="proceedConfirm"
          >
            Tiếp tục
          </button>
        </div>
      </div>
    </div>

    <!-- QR Payment Modal (PayOS QR) -->
    <PaymentQRModal
      :open="qrOpen"
      :plan="qrPlan"
      :payment-data="qrPaymentData"
      @close="onPaymentClose"
      @success="onPaymentSuccess"
    />
  </div>
</template>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(6px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.animate-fade-in {
  animation: fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
</style>
