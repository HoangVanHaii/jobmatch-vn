<script setup lang="ts">
/**
 * UpgradePricing — Component modal / card nâng cấp gói dịch vụ (Upgrade your plan).
 *
 * Thiết kế theo UI mockup chuẩn:
 *  - Cột trái:
 *      + Tiêu đề "Upgrade your plan"
 *      + Switcher chu kỳ: "Yearly (Save 20 %)" vs "Monthly"
 *      + Danh sách 2 gói: Professional (Pro) và Premium với radio chọn tương tác
 *      + Danh sách tính năng "Unlock your productivity" với icon check xanh lục
 *      + Nút "Maybe later" (đóng/bỏ qua) & nút CTA "Continue with [Plan]"
 *  - Cột phải:
 *      + Ảnh mockup chuyên nghiệp (người làm việc với laptop)
 *      + Thẻ trích dẫn nhận xét (Testimonial glassmorphism) ở đáy ảnh
 *  - Tích hợp logic mua hàng tương tự PricingComponent.vue:
 *      + Tự động tải plan từ planStore (gói Professional & Premium)
 *      + Check xác thực (redirect login nếu chưa đăng nhập)
 *      + Cảnh báo chuyển đổi gói nếu đang có gói trả phí
 *      + Khởi tạo payment qua paymentApi.create() và mở PaymentQRModal (PayOS)
 */
import { ref, computed, onMounted, type Component } from "vue";
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
import PaymentQRModal from "@components/payment/PaymentQRModal.vue";
import type { Plan } from "@/types/plan";
import type { CreatePaymentResponse } from "@/types/payment";
import type { CountableQuotaKey } from "@/types/billing";

export type BillingCycle = "yearly" | "monthly";
export type TargetTier = "professional" | "premium";

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
  /** Nội dung nhận xét bên phải */
  quoteText?: string;
  /** Người trích dẫn nhận xét */
  quoteAuthor?: string;
  /** Đơn vị tiền tệ hiển thị: 'VND' | 'USD' | 'auto'. Mặc định 'auto' (dùng theo dữ liệu gói hoặc VND) */
  currencyMode?: "VND" | "USD" | "auto";
}

const props = withDefaults(defineProps<UpgradePricingProps>(), {
  open: true,
  asModal: true,
  title: "Upgrade your plan",
  featuresTitle: "Unlock your productivity",
  maybeLaterText: "Maybe later",
  mockupImage:
    "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=1200&q=80",
  quoteText:
    "It transformed how I approach CV optimization and career growth. The AI analysis and job matching are incredibly accurate, helping me stand out to top recruiters. JobMatch VN has become my go-to platform.",
  quoteAuthor: "Rachel, Professional Specialist",
  currencyMode: "auto",
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

/* ============================================================================
 * Fallback & Plan Mapping
 * ==========================================================================*/
const tierOf = (code: string): "free" | "premium" | "professional" =>
  code.replace("-yearly", "") as "free" | "premium" | "professional";

/** Quota labels theo convention của hệ thống JobMatch VN */
const QUOTA_LABEL: Record<CountableQuotaKey, string> = {
  apply: "Ứng tuyển",
  job_post: "Lượt đăng việc làm",
  job_generation: "Lượt tạo mô tả việc làm (AI)",
  ai_cv_parsed: "Phân tích CV",
  ai_cv_analysis: "Chấm điểm CV bằng AI",
};

/** Dữ liệu mẫu dự phòng khi chưa tải xong API hoặc offline */
const FALLBACK_PLANS: Record<
  TargetTier,
  Record<BillingCycle, Partial<Plan>>
> = {
  professional: {
    monthly: {
      id: "7e4ad1ce-1547-44f1-8840-ca64d4deb0ab",
      code: "professional",
      name: "Pro",
      priceVnd: "399000",
      durationDays: 30,
      features: {
        apply: 100,
        job_post: 30,
        ai_cv_parsed: 30,
        ai_cv_analysis: 60,
        job_generation: 30,
      },
    },
    yearly: {
      id: "5d8e9f0a-1b2c-4d3e-8f4a-7b6c5d4e3f2a",
      code: "professional-yearly",
      name: "Pro",
      priceVnd: "3990000",
      durationDays: 365,
      features: {
        apply: 120,
        job_post: 36,
        ai_cv_parsed: 36,
        ai_cv_analysis: 72,
        job_generation: 36,
      },
    },
  },
  premium: {
    monthly: {
      id: "451e9023-d441-408c-9c8d-4fcc4143f9fd",
      code: "premium",
      name: "Premium",
      priceVnd: "199000",
      durationDays: 30,
      features: {
        apply: 50,
        job_post: 10,
        ai_cv_parsed: 15,
        ai_cv_analysis: 30,
        job_generation: 10,
      },
    },
    yearly: {
      id: "3b7f6a2c-8d41-4e59-9b2a-6c8d0f1e2a3b",
      code: "premium-yearly",
      name: "Premium",
      priceVnd: "1990000",
      durationDays: 365,
      features: {
        apply: 60,
        job_post: 12,
        ai_cv_parsed: 18,
        ai_cv_analysis: 36,
        job_generation: 12,
      },
    },
  },
};

/** Tìm plan từ store phù hợp với tier và period hiện tại */
function getResolvedPlan(tier: TargetTier, cycle: BillingCycle): Plan {
  const all = plans.value ?? [];
  const found = all.find((p) => {
    const pTier = tierOf(p.code);
    if (pTier !== tier) return false;
    return cycle === "monthly" ? p.durationDays <= 31 : p.durationDays >= 365;
  });

  if (found) return found;

  const fallback = FALLBACK_PLANS[tier][cycle];
  return {
    id: fallback.id || `${tier}-${cycle}`,
    code: fallback.code || `${tier}${cycle === "yearly" ? "-yearly" : ""}`,
    name: fallback.name || (tier === "professional" ? "Pro" : "Premium"),
    priceVnd: fallback.priceVnd || "0",
    durationDays: fallback.durationDays || (cycle === "monthly" ? 30 : 365),
    features: fallback.features || {},
    isActive: true,
  } as Plan;
}

/** Gói Pro hiện tại theo toggle chu kỳ */
const proPlan = computed<Plan>(() => getResolvedPlan("professional", period.value));

/** Gói Premium hiện tại theo toggle chu kỳ */
const premiumPlan = computed<Plan>(() => getResolvedPlan("premium", period.value));

/** Gói đang được user chọn (Pro hoặc Premium) */
const currentSelectedPlan = computed<Plan>(() =>
  selectedTier.value === "professional" ? proPlan.value : premiumPlan.value,
);

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

/* ============================================================================
 * Định dạng giá & nhãn hiển thị
 * ==========================================================================*/
function formatDisplayPrice(tier: TargetTier): string {
  if (props.currencyMode === "USD") {
    return tier === "professional" ? "$10 / month" : "$20 / month";
  }

  const plan = tier === "professional" ? proPlan.value : premiumPlan.value;
  const priceNum = Number(plan.priceVnd);

  if (period.value === "yearly") {
    // Hiển thị dạng tương đương trên tháng (tiết kiệm hơn)
    const monthlyEquivalent = Math.round(priceNum / 12);
    return `${monthlyEquivalent.toLocaleString("vi-VN")} ₫ / tháng`;
  }

  return `${priceNum.toLocaleString("vi-VN")} ₫ / tháng`;
}

/** Danh sách tính năng thích ứng theo gói được chọn */
interface FeatureItem {
  text: string;
}

const currentFeatures = computed<FeatureItem[]>(() => {
  const isPro = selectedTier.value === "professional";
  const plan = currentSelectedPlan.value;
  const feat = plan.features || {};

  const applyCount = feat.apply ?? (isPro ? 100 : 50);
  const parsedCount = feat.ai_cv_parsed ?? (isPro ? 30 : 15);
  const analysisCount = feat.ai_cv_analysis ?? (isPro ? 60 : 30);

  if (isPro) {
    return [
      { text: `Lên đến ${applyCount} lượt ứng tuyển việc làm` },
      { text: `Phân tích ${parsedCount} CV với AI chuyên sâu` },
      { text: `Chấm điểm và tối ưu ${analysisCount} CV chuẩn ATS` },
      { text: "Không giới hạn lưu trữ CV và cover letter" },
      { text: "Truy cập mô hình AI nâng cao (GPT-4)" },
      { text: "Ưu tiên hiển thị hồ sơ tới nhà tuyển dụng" },
      { text: "Hỗ trợ khách hàng ưu tiên 24/7" },
      { text: "Trải nghiệm sớm các tính năng AI mới nhất" },
    ];
  }

  return [
    { text: `Lên đến ${applyCount} lượt ứng tuyển việc làm` },
    { text: `Phân tích ${parsedCount} CV với AI cơ bản` },
    { text: `Chấm điểm và gợi ý ${analysisCount} CV` },
    { text: "Lưu trữ tối đa 10 CV chuyên nghiệp" },
    { text: "Đánh giá mức độ phù hợp với JD chuẩn" },
    { text: "Hỗ trợ khách hàng tiêu chuẩn" },
    { text: "Cập nhật các mẫu CV xu hướng mới" },
  ];
});

/* ============================================================================
 * Flow mua & xác nhận (Đồng bộ với PricingComponent.vue)
 * ==========================================================================*/
const handleClose = (): void => {
  emit("close");
  emit("update:open", false);
};

const selectTier = (tier: TargetTier): void => {
  selectedTier.value = tier;
  emit("select", currentSelectedPlan.value);
};

const handleContinue = async (): Promise<void> => {
  const plan = currentSelectedPlan.value;
  if (!plan) return;

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
  } catch (err: any) {
    errorMsg.value =
      err?.response?.data?.message ||
      "Không tạo được link thanh toán. Vui lòng thử lại.";
  } finally {
    buying.value = null;
  }
};

const onPaymentSuccess = async (): Promise<void> => {
  const orderCode = qrPaymentData.value?.payment.orderCode;
  qrOpen.value = false;
  await planStore.fetchMyPlan();
  emit("success", { plan: qrPlan.value!, orderCode });
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
    // Không block UI nếu mạng yếu vì đã có fallback plans
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
      class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-6 bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
      @click.self="handleClose"
    >
      <div
        class="relative w-full max-w-[960px] bg-white rounded-[24px] sm:rounded-[30px] shadow-2xl overflow-hidden border border-gray-100 my-auto animate-fade-in"
      >
        <!-- Nút đóng nhanh ở góc trên phải -->
        <button
          type="button"
          class="absolute top-4 right-4 z-20 md:hidden p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
          aria-label="Close"
          @click="handleClose"
        >
          <X class="w-5 h-5" />
        </button>

        <!-- Khối nội dung 2 cột -->
        <div class="grid grid-cols-1 md:grid-cols-2">
          <!-- Cột Trái: Lựa chọn gói & Tính năng -->
          <div class="p-6 sm:p-8 lg:p-9 flex flex-col justify-between bg-white">
            <div>
              <!-- Tiêu đề chính -->
              <h2
                class="text-[24px] sm:text-[28px] font-bold text-gray-900 tracking-tight leading-snug"
              >
                {{ title }}
              </h2>

              <!-- Switcher chu kỳ thanh toán: Yearly vs Monthly -->
              <div class="mt-4 mb-6 inline-flex p-1 bg-[#f3f4f6] rounded-full">
                <!-- Nút Yearly có nhãn Save 20 % -->
                <button
                  type="button"
                  class="flex items-center gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200"
                  :class="
                    period === 'yearly'
                      ? 'bg-[#044E43] text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  "
                  @click="period = 'yearly'"
                >
                  <span>Yearly</span>
                  <span
                    class="px-2 py-0.5 rounded-full text-[11px] font-bold tracking-tight"
                    :class="
                      period === 'yearly'
                        ? 'bg-[#0b6658] text-[#a7f3d0]'
                        : 'bg-emerald-100 text-emerald-800'
                    "
                  >
                    Save 20 %
                  </span>
                </button>

                <!-- Nút Monthly -->
                <button
                  type="button"
                  class="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200"
                  :class="
                    period === 'monthly'
                      ? 'bg-[#044E43] text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  "
                  @click="period = 'monthly'"
                >
                  Monthly
                </button>
              </div>

              <!-- Lỗi thanh toán / API nếu có -->
              <div
                v-if="errorMsg"
                class="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600"
              >
                <CircleAlert class="w-4 h-4 mt-0.5 shrink-0" />
                <span>{{ errorMsg }}</span>
              </div>

              <!-- Danh sách 2 thẻ lựa chọn gói: Pro & Premium -->
              <div class="space-y-3">
                <!-- Thẻ Pro (Professional) -->
                <div
                  role="radio"
                  :aria-checked="selectedTier === 'professional'"
                  tabindex="0"
                  class="flex items-center justify-between p-4 sm:p-4.5 rounded-xl border cursor-pointer transition-all duration-200 select-none"
                  :class="
                    selectedTier === 'professional'
                      ? 'border-2 border-[#044E43] bg-emerald-50/15 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  "
                  @click="selectTier('professional')"
                  @keydown.space.prevent="selectTier('professional')"
                  @keydown.enter.prevent="selectTier('professional')"
                >
                  <div>
                    <div class="text-[15px] font-semibold text-gray-900 leading-snug">
                      Pro
                    </div>
                    <div class="text-xs sm:text-sm text-gray-500 mt-0.5 font-normal">
                      {{ formatDisplayPrice("professional") }}
                    </div>
                  </div>

                  <!-- Radio Indicator -->
                  <div
                    class="w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                    :class="
                      selectedTier === 'professional'
                        ? 'border-2 border-[#044E43]'
                        : 'border-2 border-gray-300'
                    "
                  >
                    <div
                      v-if="selectedTier === 'professional'"
                      class="w-2.5 h-2.5 rounded-full bg-[#044E43]"
                    ></div>
                  </div>
                </div>

                <!-- Thẻ Premium -->
                <div
                  role="radio"
                  :aria-checked="selectedTier === 'premium'"
                  tabindex="0"
                  class="flex items-center justify-between p-4 sm:p-4.5 rounded-xl border cursor-pointer transition-all duration-200 select-none"
                  :class="
                    selectedTier === 'premium'
                      ? 'border-2 border-[#044E43] bg-emerald-50/15 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  "
                  @click="selectTier('premium')"
                  @keydown.space.prevent="selectTier('premium')"
                  @keydown.enter.prevent="selectTier('premium')"
                >
                  <div>
                    <div class="text-[15px] font-semibold text-gray-900 leading-snug">
                      Premium
                    </div>
                    <div class="text-xs sm:text-sm text-gray-500 mt-0.5 font-normal">
                      {{ formatDisplayPrice("premium") }}
                    </div>
                  </div>

                  <!-- Radio Indicator -->
                  <div
                    class="w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                    :class="
                      selectedTier === 'premium'
                        ? 'border-2 border-[#044E43]'
                        : 'border-2 border-gray-300'
                    "
                  >
                    <div
                      v-if="selectedTier === 'premium'"
                      class="w-2.5 h-2.5 rounded-full bg-[#044E43]"
                    ></div>
                  </div>
                </div>
              </div>

              <!-- Danh sách tính năng (Unlock your productivity) -->
              <div class="mt-6 pt-1">
                <h3 class="text-[14px] sm:text-[15px] font-semibold text-gray-900 mb-3.5">
                  {{ featuresTitle }}
                </h3>

                <ul class="space-y-2.5">
                  <li
                    v-for="(item, idx) in currentFeatures"
                    :key="idx"
                    class="flex items-center gap-2.5 text-xs sm:text-[13.5px] text-gray-700 leading-normal"
                  >
                    <!-- Icon check hình tròn màu xanh đậm chuẩn ảnh -->
                    <div
                      class="w-[18px] h-[18px] rounded-full bg-[#044E43] text-white flex items-center justify-center shrink-0 shadow-xs"
                    >
                      <Check class="w-3 h-3 stroke-[3]" />
                    </div>
                    <span>{{ item.text }}</span>
                  </li>
                </ul>
              </div>
            </div>

            <!-- Footer: Nút Maybe later & Continue with Pro/Premium -->
            <div
              class="flex items-center justify-between pt-6 mt-6 border-t border-gray-100"
            >
              <button
                type="button"
                class="text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-800 transition px-2 py-2 rounded-lg"
                @click="handleClose"
              >
                {{ maybeLaterText }}
              </button>

              <button
                type="button"
                :disabled="buying !== null"
                class="flex items-center justify-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl bg-[#044E43] hover:bg-[#033b33] active:scale-[0.98] text-white text-xs sm:text-sm font-semibold transition shadow-sm disabled:opacity-75 disabled:cursor-not-allowed"
                @click="handleContinue"
              >
                <Loader2 v-if="buying !== null" class="w-4 h-4 animate-spin" />
                <span>
                  {{
                    buying !== null
                      ? "Đang xử lý..."
                      : `Continue with ${selectedTier === "professional" ? "Pro" : "Premium"}`
                  }}
                </span>
              </button>
            </div>
          </div>

          <!-- Cột Phải: Ảnh Mockup & Card Testimonial -->
          <div
            class="relative hidden md:flex flex-col justify-end min-h-[580px] bg-slate-900 overflow-hidden"
          >
            <!-- Ảnh người dùng làm việc chuyên nghiệp -->
            <img
              :src="mockupImage"
              alt="Professional Career Upgrade"
              class="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-700 hover:scale-105"
            />

            <!-- Lớp phủ chuyển sắc tối dần về phía đáy -->
            <div
              class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent pointer-events-none"
            ></div>

            <!-- Testimonial card dạng glassmorphism mờ kính -->
            <div
              class="relative z-10 m-5 p-5 rounded-2xl bg-black/40 backdrop-blur-md border border-white/15 text-white shadow-xl"
            >
              <p
                class="text-xs sm:text-[13px] leading-relaxed text-white/90 font-normal italic"
              >
                "{{ quoteText }}"
              </p>
              <div
                class="mt-3 text-xs font-semibold text-white tracking-wide"
              >
                {{ quoteAuthor }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Render Inline (khi asModal = false) -->
    <div
      v-else
      class="w-full max-w-[960px] mx-auto bg-white rounded-[24px] sm:rounded-[30px] shadow-xl overflow-hidden border border-gray-100"
    >
      <div class="grid grid-cols-1 md:grid-cols-2">
        <div class="p-6 sm:p-8 lg:p-9 flex flex-col justify-between bg-white">
          <div>
            <h2
              class="text-[24px] sm:text-[28px] font-bold text-gray-900 tracking-tight leading-snug"
            >
              {{ title }}
            </h2>

            <div class="mt-4 mb-6 inline-flex p-1 bg-[#f3f4f6] rounded-full">
              <button
                type="button"
                class="flex items-center gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200"
                :class="
                  period === 'yearly'
                    ? 'bg-[#044E43] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                "
                @click="period = 'yearly'"
              >
                <span>Yearly</span>
                <span
                  class="px-2 py-0.5 rounded-full text-[11px] font-bold tracking-tight"
                  :class="
                    period === 'yearly'
                      ? 'bg-[#0b6658] text-[#a7f3d0]'
                      : 'bg-emerald-100 text-emerald-800'
                  "
                >
                  Save 20 %
                </span>
              </button>

              <button
                type="button"
                class="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200"
                :class="
                  period === 'monthly'
                    ? 'bg-[#044E43] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                "
                @click="period = 'monthly'"
              >
                Monthly
              </button>
            </div>

            <div
              v-if="errorMsg"
              class="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600"
            >
              <CircleAlert class="w-4 h-4 mt-0.5 shrink-0" />
              <span>{{ errorMsg }}</span>
            </div>

            <div class="space-y-3">
              <div
                role="radio"
                :aria-checked="selectedTier === 'professional'"
                tabindex="0"
                class="flex items-center justify-between p-4 sm:p-4.5 rounded-xl border cursor-pointer transition-all duration-200 select-none"
                :class="
                  selectedTier === 'professional'
                    ? 'border-2 border-[#044E43] bg-emerald-50/15 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                "
                @click="selectTier('professional')"
                @keydown.space.prevent="selectTier('professional')"
                @keydown.enter.prevent="selectTier('professional')"
              >
                <div>
                  <div class="text-[15px] font-semibold text-gray-900 leading-snug">
                    Pro
                  </div>
                  <div class="text-xs sm:text-sm text-gray-500 mt-0.5 font-normal">
                    {{ formatDisplayPrice("professional") }}
                  </div>
                </div>

                <div
                  class="w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                  :class="
                    selectedTier === 'professional'
                      ? 'border-2 border-[#044E43]'
                      : 'border-2 border-gray-300'
                  "
                >
                  <div
                    v-if="selectedTier === 'professional'"
                    class="w-2.5 h-2.5 rounded-full bg-[#044E43]"
                  ></div>
                </div>
              </div>

              <div
                role="radio"
                :aria-checked="selectedTier === 'premium'"
                tabindex="0"
                class="flex items-center justify-between p-4 sm:p-4.5 rounded-xl border cursor-pointer transition-all duration-200 select-none"
                :class="
                  selectedTier === 'premium'
                    ? 'border-2 border-[#044E43] bg-emerald-50/15 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                "
                @click="selectTier('premium')"
                @keydown.space.prevent="selectTier('premium')"
                @keydown.enter.prevent="selectTier('premium')"
              >
                <div>
                  <div class="text-[15px] font-semibold text-gray-900 leading-snug">
                    Premium
                  </div>
                  <div class="text-xs sm:text-sm text-gray-500 mt-0.5 font-normal">
                    {{ formatDisplayPrice("premium") }}
                  </div>
                </div>

                <div
                  class="w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                  :class="
                    selectedTier === 'premium'
                      ? 'border-2 border-[#044E43]'
                      : 'border-2 border-gray-300'
                  "
                >
                  <div
                    v-if="selectedTier === 'premium'"
                    class="w-2.5 h-2.5 rounded-full bg-[#044E43]"
                  ></div>
                </div>
              </div>
            </div>

            <div class="mt-6 pt-1">
              <h3 class="text-[14px] sm:text-[15px] font-semibold text-gray-900 mb-3.5">
                {{ featuresTitle }}
              </h3>

              <ul class="space-y-2.5">
                <li
                  v-for="(item, idx) in currentFeatures"
                  :key="idx"
                  class="flex items-center gap-2.5 text-xs sm:text-[13.5px] text-gray-700 leading-normal"
                >
                  <div
                    class="w-[18px] h-[18px] rounded-full bg-[#044E43] text-white flex items-center justify-center shrink-0 shadow-xs"
                  >
                    <Check class="w-3 h-3 stroke-[3]" />
                  </div>
                  <span>{{ item.text }}</span>
                </li>
              </ul>
            </div>
          </div>

          <div
            class="flex items-center justify-between pt-6 mt-6 border-t border-gray-100"
          >
            <button
              type="button"
              class="text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-800 transition px-2 py-2 rounded-lg"
              @click="handleClose"
            >
              {{ maybeLaterText }}
            </button>

            <button
              type="button"
              :disabled="buying !== null"
              class="flex items-center justify-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl bg-[#044E43] hover:bg-[#033b33] active:scale-[0.98] text-white text-xs sm:text-sm font-semibold transition shadow-sm disabled:opacity-75 disabled:cursor-not-allowed"
              @click="handleContinue"
            >
              <Loader2 v-if="buying !== null" class="w-4 h-4 animate-spin" />
              <span>
                {{
                  buying !== null
                    ? "Đang xử lý..."
                    : `Continue with ${selectedTier === "professional" ? "Pro" : "Premium"}`
                }}
              </span>
            </button>
          </div>
        </div>

        <div
          class="relative hidden md:flex flex-col justify-end min-h-[580px] bg-slate-900 overflow-hidden"
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
            class="relative z-10 m-5 p-5 rounded-2xl bg-black/40 backdrop-blur-md border border-white/15 text-white shadow-xl"
          >
            <p
              class="text-xs sm:text-[13px] leading-relaxed text-white/90 font-normal italic"
            >
              "{{ quoteText }}"
            </p>
            <div
              class="mt-3 text-xs font-semibold text-white tracking-wide"
            >
              {{ quoteAuthor }}
            </div>
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
        class="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-100"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <TriangleAlert class="h-6 w-6 shrink-0 text-amber-500" />
          <h3 class="text-lg font-bold text-gray-900">
            Xác nhận thay đổi gói dịch vụ
          </h3>
        </div>
        <p class="text-[13.5px] text-gray-600 mb-6 leading-relaxed">
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
            class="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
            @click="cancelConfirm"
          >
            Hủy
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#044E43] hover:bg-[#033b33] transition"
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
