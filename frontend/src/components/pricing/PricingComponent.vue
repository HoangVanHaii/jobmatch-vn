<script setup lang="ts">
/**
 * PricingComponent — implementation pricing dùng chung (UI mockup: hero
 * gradient xanh, toggle Hàng tháng/Hàng năm, card 333px — tab năm 2 thẻ
 * justify-evenly):
 *
 *  - Fetch plans từ planStore (GET /plans) + gói hiện tại (fetchMyPlan)
 *  - Toggle tháng/năm → lọc plans theo duration_days (30 / 365 ngày)
 *  - Trạng thái nút: Gói hiện tại / Gói miễn phí / Bắt đầu ngay
 *  - Flow mua: chưa login → redirect login; đang có gói trả phí → confirm
 *    modal (mua mới sẽ kết thúc gói cũ, không cộng dồn) → PayOS QR modal →
 *    redirect billing-success
 *
 * Tái sử dụng: import PricingComponent from
 * "@components/pricing/PricingComponent.vue" → <PricingComponent />.
 * Route /candidate/pricing render qua PricingView (wrapper, giữ nguyên path
 * router @views/candidate/PricingView.vue trong CandidateLayout).
 *
 * Styling: Tailwind utility + 1 khối scoped style nhỏ chỉ chứa keyframes
 * (fade-up, float), transition giá và prefers-reduced-motion.
 * Responsive mobile-first:
 *   base = ≤480px · min-[481px] = 481–800 · min-[801px] = 801–1050 ·
 *   min-[1051px] = desktop
 */
import { ref, computed, onMounted, type Component } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import {
  CircleAlert,
  CircleCheck,
  Crown,
  Gem,
  Gift,
  TriangleAlert,
} from "lucide-vue-next";
import { useAuthStore } from "@stores/auth";
import { usePlanStore } from "@stores/plan";
import { paymentApi } from "@services/payment.api";
import PaymentQRModal from "@components/payment/PaymentQRModal.vue";
import type { Plan } from "@/types/plan";
import type { CreatePaymentResponse } from "@/types/payment";
import type { CountableQuotaKey } from "@/types/billing";

type BillingPeriod = "monthly" | "yearly";
/** Tier gốc của plan — code BE: free / premium / professional (+ -yearly). */
type TierCode = "free" | "premium" | "professional";

const PERIOD_LABEL: Record<BillingPeriod, string> = {
  monthly: "/ tháng",
  yearly: "/ năm",
};

const period = ref<BillingPeriod>("monthly");

/* ============================================================================
 * Stores + payment flow state (port từ PricingView)
 * ==========================================================================*/
const router = useRouter();
const auth = useAuthStore();
const planStore = usePlanStore();
const { plans } = storeToRefs(planStore);

const loading = ref(false);
const errorMsg = ref("");
const buying = ref<string | null>(null);

const qrOpen = ref(false);
const qrPlan = ref<Plan | null>(null);
const qrPaymentData = ref<CreatePaymentResponse | null>(null);

const confirmOpen = ref(false);
const confirmPlan = ref<Plan | null>(null);

/** Code của plan user đang dùng (vd 'premium', 'professional-yearly'). */
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
 * Metadata UI theo tier — name/description lấy từ API (cột plans.name /
 * plans.description, admin sửa được); chỉ icon + featured là UI thuần ở FE.
 * ==========================================================================*/
const TIER_META: Record<TierCode, { icon: Component; featured: boolean }> = {
  free: { icon: Gift, featured: false },
  premium: { icon: Gem, featured: true },
  professional: { icon: Crown, featured: false },
};

/** Nhãn quota + thứ tự feature hiển thị trên card (candidate). */
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

/** Nền icon theo tier (mockup: mỗi gói 1 màu). */
const ICON_CLASS: Record<TierCode, string> = {
  free: "bg-[#eff6ff] shadow-[0_3px_8px_rgba(23,104,204,0.10)]",
  premium: "bg-[#e0f2fe] shadow-[0_3px_8px_rgba(23,104,204,0.12)]",
  professional: "bg-[#eef2ff] shadow-[0_3px_8px_rgba(23,104,204,0.10)]",
};

/**
 * Style nút CTA theo variant — card Premium (primary) nổi hơn các card bên.
 * Màu/shadow hover + cursor đặt ở đây (không để static class) để tránh 2 rule
 * cùng property trên 1 element (thứ tự stylesheet JIT có thể đảo → class bị đè).
 */
const BUTTON_CLASS = {
  outline:
    "cursor-pointer bg-white border-[1.5px] border-[#0d6ee8] text-[#075bc9] hover:bg-[#f5f9ff]",
  primary:
    "cursor-pointer bg-blue-700 from-[#0d6ee8] to-[#075bc9] border-[1.5px] border-[#075bc9] text-white shadow-[0_4px_10px_rgba(7,91,201,0.16)] hover:shadow-[0_6px_14px_rgba(7,91,201,0.22)]",
} as const;

/** State nút khi gói đang sử dụng — xanh nhạt brand (chuẩn SaaS).
 * Gói hiện tại vẫn BẤM ĐƯỢC để gia hạn (port logic root) → cursor-pointer,
 * riêng Free (không mua được) khóa qua attr disabled + disabled:cursor. */
const CURRENT_CLASS =
  "cursor-pointer border-[1.5px] border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]";

/** Text nút CTA — port getButtonText từ PricingView:
 *  gói hiện tại (trả phí) → "Gia hạn thêm N ngày", free → "Gói miễn phí". */
function buttonText(card: PlanCard): string {
  if (card.isCurrent) return `Gia hạn thêm ${card.plan.durationDays} ngày`;
  if (card.isFree) return "Gói miễn phí";
  if (buying.value === card.plan.id) return "Đang xử lý...";
  return "Bắt đầu ngay";
}

/* ============================================================================
 * View-model — plans từ API → dữ liệu card theo chu kỳ toggle
 * ==========================================================================*/
interface PlanCard {
  plan: Plan;
  tier: TierCode;
  icon: Component;
  name: string;
  description: string;
  featured: boolean;
  isFree: boolean;
  isCurrent: boolean;
  priceText: string;
  periodText: string;
  features: { label: string; value: string }[];
  buttonVariant: "outline" | "primary";
}

const tierOf = (code: string): TierCode =>
  code.replace("-yearly", "") as TierCode;

/** Thứ bậc tier để nhận diện nâng cấp (target rank > current rank). */
const TIER_RANK: Record<TierCode, number> = {
  free: 0,
  premium: 1,
  professional: 2,
};

/** Nâng cấp khi gói đích ở tier CAO hơn gói hiện tại (cover cả yearly). */
function isUpgradePair(target: Plan, current: Plan | null): boolean {
  if (!current) return false;
  return TIER_RANK[tierOf(target.code)] > TIER_RANK[tierOf(current.code)];
}

/** Format quota value: -1 → "Không giới hạn", số → "N lượt". */
function formatQuota(value: unknown): string {
  if (value === -1) return "Không giới hạn";
  return `${value} lượt`;
}

/** Toggle tháng → plans 30 ngày (kèm Free) — 3 thẻ; năm → plans 365 ngày,
 *  ẩn Free — đúng 2 thẻ gói năm. Card 333px, tab năm justify-evenly: khoảng
 *  cách mép↔card = card↔card = card↔mép (~124.7px). */
const displayPlans = computed<PlanCard[]>(() => {
  const all = plans.value ?? [];
  const inPeriod = all.filter((p) =>
    period.value === "monthly"
      ? p.durationDays <= 31
      : p.durationDays >= 365 && tierOf(p.code) !== "free",
  );

  return inPeriod.map((p) => {
    const tier = tierOf(p.code);
    const meta = TIER_META[tier] ?? TIER_META.free;
    const isFree = p.code === "free" || Number(p.priceVnd) === 0;

    const features = FEATURE_KEYS.filter((k) => k in p.features).map((k) => ({
      label: QUOTA_LABEL[k],
      value: formatQuota(p.features[k]),
    }));

    return {
      plan: p,
      tier,
      icon: meta.icon,
      name: p.name,
      description: p.description ?? "",
      featured: meta.featured,
      isFree,
      isCurrent: currentPlanCode.value === p.code,
      // Free cũng hiển thị "0 ₫" theo yêu cầu — format chung 1 nhánh.
      priceText: `${Number(p.priceVnd).toLocaleString("vi-VN")} ₫`,
      periodText: isFree ? "" : PERIOD_LABEL[period.value],
      features,
      buttonVariant: tier === "premium" ? "primary" : "outline",
    };
  });
});

/** Tên plan cho confirm modal — API là nguồn truth. */
const displayPlanName = (p: Plan): string => p.name;

/* ============================================================================
 * Flow mua (port từ PricingView) — confirm → paymentApi.create → QR modal
 * ==========================================================================*/
/** Trigger mua: chưa login → login; có gói trả phí → confirm; else mua luôn.
 *  Gói hiện tại (trả phí) VẪN cho bấm = gia hạn (root: mua lại cùng code
 *  được phép, qua confirm). */
const tryBuy = (card: PlanCard): void => {
  errorMsg.value = "";
  const plan = card.plan;

  if (!auth.isAuthenticated) {
    router.push({
      name: "login",
      query: { redirect: "/candidate/pricing" },
    });
    return;
  }

  if (card.isFree) return;

  if (hasActivePaidPlan.value) {
    confirmPlan.value = plan;
    confirmOpen.value = true;
    return;
  }

  void buyPlan(plan);
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

const confirmBody = computed<string>(() => {
  const target = confirmPlan.value;
  const current = planStore.currentPlan;
  const days = remainingDays.value;

  if (!target) return "";

  const targetName = displayPlanName(target);
  const currentName = current ? displayPlanName(current) : "hiện tại";
  const daysText = days !== null ? `còn ${days} ngày` : "chưa kích hoạt";
  const isUpgrade = isUpgradePair(target, current);

  return `Gói ${currentName} hiện tại của bạn ${daysText}. Khi ${isUpgrade ? "nâng cấp" : "mua gói mới"}, gói ${currentName} sẽ kết thúc và gói ${targetName} sẽ được kích hoạt ngay hôm nay. Thời gian còn lại của gói ${currentName} không được cộng dồn.`;
});

const confirmTitle = computed<string>(() => {
  const target = confirmPlan.value;
  if (!target) return "";

  const targetName = displayPlanName(target);
  // Port từ root: mua đúng gói đang dùng = gia hạn; lên tier cao hơn = nâng cấp.
  if (currentPlanCode.value === target.code) {
    return `Gia hạn gói ${targetName}?`;
  }
  if (isUpgradePair(target, planStore.currentPlan)) {
    return `Nâng cấp lên ${targetName}?`;
  }
  return `Chọn gói ${targetName}?`;
});

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
      "Không tạo được payment link. Vui lòng thử lại.";
  } finally {
    buying.value = null;
  }
};

const onPaymentSuccess = async (): Promise<void> => {
  const orderCode = qrPaymentData.value?.payment.orderCode;
  qrOpen.value = false;
  await planStore.fetchMyPlan();
  qrPaymentData.value = null;
  qrPlan.value = null;
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
  } catch (err: any) {
    errorMsg.value =
      err?.response?.data?.message || "Không tải được danh sách gói";
  } finally {
    loading.value = false;
  }
});

/**
 * Decorative panels 2 bên vùng blue — 3 lớp mỗi bên, càng sâu càng mờ.
 * Class giữ dạng literal để Tailwind JIT scan được.
 */
const DECOR_LEFT = [
  "left-0 top-[150px] w-[138px] h-[306px] rounded-r-[22px] [animation-delay:-1.2s]",
  "left-0 top-[190px] w-[205px] h-[270px] rounded-r-[22px] opacity-[0.82] [animation-delay:-2.6s]",
  "left-0 top-[230px] w-[270px] h-[235px] rounded-r-[22px] opacity-[0.65] [animation-delay:-4s]",
] as const;

const DECOR_RIGHT = [
  "right-0 top-[150px] w-[138px] h-[306px] rounded-l-[22px] [animation-delay:-1.9s]",
  "right-0 top-[190px] w-[205px] h-[270px] rounded-l-[22px] opacity-[0.82] [animation-delay:-3.3s]",
  "right-0 top-[230px] w-[270px] h-[235px] rounded-l-[22px] opacity-[0.65] [animation-delay:-4.7s]",
] as const;
</script>

<template>
  <!-- Gốc là style của <body> trong mockup — ẩn scrollbar, trang vẫn cuộn được -->
  <div
    class="font-poppins h-auto min-h-screen overflow-visible flex items-start justify-center p-3 bg-white text-[#17243a] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden min-[801px]:p-5 min-[1051px]:h-screen min-[1051px]:overflow-hidden min-[1051px]:items-center min-[1051px]:p-[clamp(16px,4vh,40px)]"
  >
    <!-- Hero: nền trắng, ::before tạo dải blue chỉ chiếm phần trên -->
    <section
      class="anim-fade-up relative h-auto max-h-none flex flex-col bg-white rounded-[14px] overflow-hidden p-[36px_16px_24px] before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[42%] before:bg-[linear-gradient(180deg,#0758c8_0%,#1768d2_55%,#4b83cf_100%)] before:rounded-t-[20px] min-[801px]:p-[40px_24px_30px] min-[1051px]:h-full min-[1051px]:w-full min-[1051px]:max-w-[1140px] min-[1051px]:max-h-[1000px] min-[1051px]:rounded-[20px] min-[1051px]:p-[clamp(22px,4.6vh,44px)_clamp(24px,5vh,50px)_clamp(18px,3.5vh,34px)] min-[1051px]:before:h-[58%]"
    >
      <!-- Decorative background — chỉ nằm trong vùng blue phía trên -->
      <div
        class="absolute inset-x-0 top-0 h-[42%] overflow-hidden pointer-events-none z-[1] min-[1051px]:h-[58%]"
      >
        <div
          v-for="(cls, i) in DECOR_LEFT"
          :key="`l-${i}`"
          class="anim-float absolute bg-white/20 border border-white/[0.08] backdrop-blur-[1px]"
          :class="cls"
        ></div>

        <div
          v-for="(cls, i) in DECOR_RIGHT"
          :key="`r-${i}`"
          class="anim-float absolute bg-white/20 border border-white/[0.08] backdrop-blur-[1px]"
          :class="cls"
        ></div>
      </div>

      <div class="relative z-[5] flex-1 min-h-0 flex flex-col">
        <!-- Heading -->
        <div class="text-center text-white max-w-[850px] mx-auto">
          <h1
            class="text-[22px] leading-[1.2] font-semibold tracking-[-1px] mb-3 min-[481px]:text-[26px] min-[801px]:text-[30px] min-[1051px]:text-[clamp(23px,3.6vh,32px)]"
          >
            Bảng giá đơn giản, phù hợp với bạn
          </h1>

          <p
            class="max-w-[720px] mx-auto text-[13px] leading-[1.55] text-white/90 min-[481px]:text-sm min-[1051px]:text-[clamp(13px,1.8vh,16px)]"
          >
            Lựa chọn gói phù hợp với nhu cầu tìm việc của bạn. Tận dụng các công
            cụ hỗ trợ ứng tuyển và tối ưu CV để nâng cao hiệu quả tìm kiếm việc
            làm.
          </p>
        </div>

        <!-- Billing toggle -->
        <div
          class="w-full max-w-[280px] h-[54px] mx-auto mt-[clamp(16px,3vh,28px)] p-[5px] flex items-center bg-white rounded-2xl shadow-[0_5px_20px_rgba(0,0,0,0.08)] min-[481px]:w-[280px] min-[1051px]:w-[320px]"
        >
          <!-- Màu nền/chữ/shadow đặt 100% trong ternary — KHÔNG để class màu
               ở static class, tránh 2 rule cùng specificity nhau mà thứ tự
               stylesheet quyết định (JIT append có thể đảo thứ tự → class
               bị đè, đã gặp thực tế trên dev server chạy dài). -->
          <button
            type="button"
            class="flex-1 h-[44px] border-0 rounded-2xl text-sm font-medium cursor-pointer transition-[background,color,transform] duration-200 active:scale-[0.97]"
            :class="
              period === 'monthly'
                ? 'bg-[#075bc9] text-white shadow-[0_3px_10px_rgba(7,90,201,0.25)]'
                : 'bg-transparent text-[#17243a]'
            "
            @click="period = 'monthly'"
          >
            Hàng tháng
          </button>

          <button
            type="button"
            class="flex-1 h-[44px] border-0 rounded-2xl text-sm font-medium cursor-pointer transition-[background,color,transform] duration-200 active:scale-[0.97]"
            :class="
              period === 'yearly'
                ? 'bg-[#075bc9] text-white shadow-[0_3px_10px_rgba(7,90,201,0.25)]'
                : 'bg-transparent text-[#17243a]'
            "
            @click="period = 'yearly'"
          >
            Hàng năm
          </button>
        </div>

        <!-- Loading -->
        <div
          v-if="loading"
          class="relative z-10 grid grid-cols-1 gap-4 max-w-[480px] mx-auto mt-12 min-[1051px]:flex min-[1051px]:w-full min-[1051px]:max-w-[1040px] min-[1051px]:mt-[clamp(24px,5vh,48px)]"
          :class="
            period === 'yearly'
              ? 'min-[1051px]:justify-evenly min-[1051px]:gap-0'
              : 'min-[1051px]:justify-between min-[1051px]:gap-5'
          "
        >
          <div
            v-for="n in period === 'yearly' ? 2 : 3"
            :key="n"
            class="h-[380px] rounded-xl bg-white/60 animate-pulse min-[1051px]:w-[333px]"
          ></div>
        </div>

        <!-- Lỗi tải plans / tạo payment link — banner đỏ nhẹ nổi trên khu card;
             fetch fail lúc mount → displayPlans rỗng → banner thay vùng card;
             buy fail → banner nằm trên card vẫn hiển thị. w-fit cho gọn. -->
        <div
          v-if="errorMsg"
          class="anim-fade-up relative z-10 mx-auto mt-12 mb-4 flex w-fit max-w-[480px] items-start gap-2.5 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13.5px] leading-[1.5] text-[#b91c1c] min-[1051px]:mt-[clamp(24px,5vh,48px)] min-[1051px]:max-w-[640px]"
          role="alert"
        >
          <CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ errorMsg }}</span>
        </div>

        <!-- Pricing cards. min-[1051px]:w-full — container là flex item của khối
             flex-col cha, mx-auto tắt stretch → container co về đúng tổng width
             card (666px ở yearly) → justify-evenly hết free space, 2 thẻ dính
             nhau. w-full ép container chiếm đủ 1040px để chia đều 3 khoảng. -->
        <div
          v-else
          class="relative z-10 grid grid-cols-1 gap-4 max-w-[480px] flex-none mx-auto mt-12 min-[1051px]:flex min-[1051px]:w-full min-[1051px]:max-w-[1040px] min-[1051px]:mt-[clamp(24px,5vh,48px)]"
          :class="
            period === 'yearly'
              ? 'min-[1051px]:justify-evenly min-[1051px]:gap-0'
              : 'min-[1051px]:justify-between min-[1051px]:gap-5'
          "
        >
          <article
            v-for="(card, i) in displayPlans"
            :key="card.plan.id"
            class="anim-fade-up relative flex flex-col bg-white rounded-xl border border-[#1e4678]/[0.07] p-[20px_18px] transition-shadow duration-300 min-[481px]:p-[22px_20px] min-[1051px]:w-[333px] min-[1051px]:p-[clamp(18px,2.4vh,24px)_clamp(18px,2.4vh,24px)_clamp(14px,2vh,20px)]"
            :style="{ animationDelay: `${120 + i * 90}ms` }"
            :class="
              card.featured
                ? 'shadow-[0_10px_28px_rgba(25,65,110,0.16)] hover:shadow-[0_16px_40px_rgba(25,65,110,0.24)]'
                : 'shadow-[0_8px_24px_rgba(30,60,100,0.10)] hover:shadow-[0_14px_36px_rgba(30,60,100,0.20)]'
            "
          >
            <div class="flex items-center gap-3 mb-5">
              <div
                class="w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-[#075bc9]"
                :class="ICON_CLASS[card.tier]"
              >
                <component :is="card.icon" class="h-5 w-5" />
              </div>

              <h2
                class="text-[17px] leading-[1.2] font-semibold text-[#17243a] min-[481px]:text-[19px]"
              >
                {{ card.name }}
              </h2>
            </div>

            <div class="flex items-baseline gap-2 mb-2.5">
              <span
                class="text-[23px] leading-none font-[650] tracking-[-0.6px] text-[#17243a] min-[481px]:text-[26px]"
              >
                <Transition name="price" mode="out-in">
                  <span :key="period" class="block">
                    {{ card.priceText }}
                  </span>
                </Transition>
              </span>

              <Transition name="price" mode="out-in">
                <span
                  v-if="card.periodText"
                  :key="period"
                  class="text-xs text-[#536a8d] font-medium"
                >
                  {{ card.periodText }}
                </span>
              </Transition>
            </div>

            <p
              class="min-h-[clamp(48px,9vh,82px)] text-[13.5px] leading-[1.55] text-[#536a8d] mb-[18px]"
            >
              {{ card.description }}
            </p>

            <ul
              class="list-none flex flex-col gap-[13px] mb-[clamp(14px,2.6vh,24px)]"
            >
              <li
                v-for="feature in card.features"
                :key="feature.label"
                class="flex items-center gap-2.5 text-[13.5px] leading-[1.35] text-[#3d5578]"
              >
                <span
                  class="w-[17px] h-[17px] shrink-0 flex items-center justify-center rounded-full bg-[#1268dc] text-white text-[10px] font-bold"
                >
                  ✓
                </span>

                <span>
                  {{ feature.label }}:
                  <strong class="font-semibold text-[#263a5b]">
                    {{ feature.value }}
                  </strong>
                </span>
              </li>
            </ul>

            <button
              type="button"
              :disabled="card.isFree || buying === card.plan.id"
              class="w-full h-[46px] mt-auto rounded-2xl text-[13.5px] font-semibold transition-[background-color,box-shadow] duration-200 disabled:cursor-not-allowed"
              :class="
                card.isCurrent
                  ? CURRENT_CLASS
                  : BUTTON_CLASS[card.buttonVariant]
              "
              @click="tryBuy(card)"
            >
              <span
                v-if="card.isCurrent"
                class="inline-flex items-center gap-1.5"
              >
                <CircleCheck class="h-4 w-4" />
                {{ buttonText(card) }}
              </span>
              <template v-else>{{ buttonText(card) }}</template>
            </button>
          </article>
        </div>
      </div>
    </section>

    <!-- Confirmation modal — mua gói khi đang có gói trả phí (port từ
         PricingView; mua mới KẾT THÚC gói cũ, thời gian không cộng dồn). -->
    <div
      v-if="confirmOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
      @click.self="cancelConfirm"
    >
      <div
        class="anim-fade-up bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <TriangleAlert class="h-6 w-6 shrink-0 text-amber-500" />
          <h3 class="text-lg font-bold text-[#17243a]">{{ confirmTitle }}</h3>
        </div>
        <p class="text-[13.5px] text-[#536a8d] mb-6 leading-relaxed">
          {{ confirmBody }}
        </p>
        <div class="flex gap-3 justify-end">
          <button
            type="button"
            class="px-4 py-2 rounded-xl font-medium border-[1.5px] border-slate-200 text-slate-700 hover:bg-slate-50 transition"
            @click="cancelConfirm"
          >
            Hủy
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-xl font-semibold text-white bg-gradient-to-br from-[#0d6ee8] to-[#075bc9] shadow-[0_4px_10px_rgba(7,91,201,0.16)] hover:shadow-[0_6px_14px_rgba(7,91,201,0.22)] transition"
            @click="proceedConfirm"
          >
            Tiếp tục
          </button>
        </div>
      </div>
    </div>

    <!-- QR Payment Modal (PayOS) -->
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
/* Hiệu ứng trang — keyframes + transition (phần còn lại là Tailwind utility).
   fill-mode: backwards — giữ state "from" trong khoảng delay (tránh flash),
   chạy xong trả style tự nhiên. */
@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-12px);
  }
}

.anim-fade-up {
  animation: fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) backwards;
}

.anim-float {
  animation: float 8s ease-in-out infinite;
}

/* Chuyển cảnh giá khi đổi monthly/yearly */
.price-enter-active,
.price-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.price-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.price-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

/* Tôn trọng cài đặt giảm chuyển động của người dùng */
@media (prefers-reduced-motion: reduce) {
  .anim-fade-up,
  .anim-float {
    animation: none;
  }

  .price-enter-active,
  .price-leave-active {
    transition: none;
  }
}
</style>
