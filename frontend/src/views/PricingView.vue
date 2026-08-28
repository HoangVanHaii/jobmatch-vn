<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { usePlanStore } from '@stores/plan';
import { paymentApi } from '@services/payment.api';
import PaymentQRModal from '@components/payment/PaymentQRModal.vue';
import { Send, FileSearch, Sparkles, Briefcase, Wand2 } from 'lucide-vue-next';
import type { Plan } from '@/types/plan';
import type { CreatePaymentResponse } from '@/types/payment';
import type { CountableQuotaKey } from '@/types/billing';

const router = useRouter();
const auth = useAuthStore();
const planStore = usePlanStore();

const { plans } = storeToRefs(planStore);

const loading = ref(false);
const buying = ref<string | null>(null);
const errorMsg = ref('');

const qrOpen = ref(false);
const qrPlan = ref<Plan | null>(null);
const qrPaymentData = ref<CreatePaymentResponse | null>(null);

/** Code của plan user đang dùng ('free' | 'light' | 'pro' | null). */
const currentPlanCode = computed<string | null>(() => planStore.currentPlan?.code ?? null);

const hasActivePaidPlan = computed<boolean>(() => {
    const p = planStore.currentPlan;
    if (!p) return false;
    return p.code !== 'free' && Number(p.priceVnd) > 0;
});

const remainingDays = computed<number | null>(() => {
    const expires = planStore.currentPlanExpiresAt;
    if (!expires) return null;
    const ms = new Date(expires).getTime() - Date.now();
    if (ms <= 0) return 0;
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
});

/**
 * Map plan code → tên hiển thị (Tiếng Việt).
 * Fallback về plan.name từ BE nếu code không match.
 */
const planNameMap: Record<string, string> = {
    free: 'Free',
    light: 'Light',
    pro: 'Pro',
};

const displayPlanName = (plan: Plan): string =>
    planNameMap[plan.code] || plan.name;

/** Theme classes per plan code (Tailwind utilities). */
const planThemeGradient: Record<string, string> = {
    light: 'border-blue-200 bg-gradient-to-b from-blue-50 to-white',
    pro: 'border-purple-200 bg-gradient-to-b from-purple-50 to-white',
};

const planBadgeMap: Record<string, string> = {
    light: 'PHỔ BIẾN NHẤT',
    pro: 'GIÁ TRỊ TỐT NHẤT',
};

const planBadgeClass: Record<string, string> = {
    light: 'bg-blue-100 text-blue-700',
    pro: 'bg-purple-100 text-purple-700',
    free: 'bg-slate-100 text-slate-700',
};

const planPriceColor: Record<string, string> = {
    free: 'text-slate-900',
    light: 'text-blue-600',
    pro: 'text-purple-600',
};

/** Quota label Tiếng Việt — đồng bộ với BillingHistoryView. */
const quotaLabel: Record<CountableQuotaKey, string> = {
    apply: 'Ứng tuyển',
    job_post: 'Lượt tạo việc làm',
    ai_cv_parsed: 'Phân tích CV',
    ai_cv_analysis: 'Chấm điểm CV bằng AI',
    job_generation: 'Lượt tạo mô tả việc làm (AI)',
};

/** PricingView (candidate) chỉ show features relevant tới ứng viên. */
const CANDIDATE_FEATURE_KEYS: CountableQuotaKey[] = [
    'apply',
    'ai_cv_parsed',
    'ai_cv_analysis',
];

/** Icon tương ứng với từng quota key — semantic, dễ scan nhanh. */
const featureIcon: Record<CountableQuotaKey, typeof Send> = {
    apply: Send,
    ai_cv_parsed: FileSearch,
    ai_cv_analysis: Sparkles,
    job_post: Briefcase,
    job_generation: Wand2,
};

/** Button class theo plan code + disabled state. */
function planButtonClass(code: string, disabled: boolean): string {
    if (disabled) {
        return 'bg-slate-200 text-slate-500 cursor-not-allowed';
    }
    if (code === 'light') {
        return 'bg-blue-600 text-white hover:bg-blue-700';
    }
    if (code === 'pro') {
        return 'bg-purple-600 text-white hover:bg-purple-700';
    }
    return 'bg-slate-200 text-slate-500 cursor-not-allowed';
}

function getCandidateFeatures(features: Plan['features']): Array<[CountableQuotaKey, unknown]> {
    return CANDIDATE_FEATURE_KEYS
        .filter((k) => k in features)
        .map((k) => [k, features[k]]);
}

/** Format quota value: -1 → "Không giới hạn", số → "N lượt". */
function formatQuota(value: unknown): string {
    if (value === -1) return 'Không giới hạn';
    return `${value} lượt`;
}

/** Format price: Free → "Miễn phí", paid → "{price} / {days} ngày". */
function formatPriceLine(plan: Plan): string {
    const num = Number(plan.priceVnd);
    if (num === 0) return 'Miễn phí';
    return `${num.toLocaleString('vi-VN')}đ / ${plan.durationDays} ngày`;
}

/** Text button theo plan + trạng thái user hiện tại. */
function getButtonText(plan: Plan): string {
    const planName = displayPlanName(plan);

    if (plan.code === 'free') {
        return currentPlanCode.value === 'free' ? 'Đang sử dụng' : 'Gói miễn phí';
    }

    if (currentPlanCode.value === plan.code) {
        return `Gia hạn thêm ${plan.durationDays} ngày`;
    }

    if (currentPlanCode.value === 'free' || currentPlanCode.value === null) {
        return `Chọn gói ${planName}`;
    }

    if (plan.code === 'pro') return `Nâng cấp lên ${planName}`;
    return `Chọn gói ${planName}`;
}

/** Button có bị disabled không (Free luôn disabled). */
function isButtonDisabled(plan: Plan): boolean {
    return plan.code === 'free';
}

onMounted(async () => {
    loading.value = true;
    try {
        await Promise.all([
            planStore.fetchPublicPlans(),
            planStore.fetchMyPlan(),
        ]);
    } catch (err: any) {
        errorMsg.value = err?.response?.data?.message || 'Không tải được danh sách gói';
    } finally {
        loading.value = false;
    }
});

/* ============================================================================
 * Confirmation modal trước khi mua/nâng cấp.
 *
 * Business rule (theo banner): mua gói mới sẽ DEACTIVATE subscription hiện tại,
 * thời gian còn lại KHÔNG cộng dồn. → cần confirm rõ trước khi trừ tiền.
 * ==========================================================================*/
const confirmOpen = ref(false);
const confirmPlan = ref<Plan | null>(null);

/** Trigger mua: nếu user đang có paid plan → mở modal; else → mua luôn. */
const tryBuy = (plan: Plan) => {
    errorMsg.value = '';

    if (!auth.isAuthenticated) {
        router.push({ name: 'login', query: { redirect: '/candidate/pricing' } });
        return;
    }

    if (plan.code === 'free' || Number(plan.priceVnd) === 0) return;

    if (hasActivePaidPlan.value) {
        confirmPlan.value = plan;
        confirmOpen.value = true;
        return;
    }

    void buyPlan(plan);
};

const cancelConfirm = () => {
    confirmOpen.value = false;
    confirmPlan.value = null;
};

const proceedConfirm = () => {
    const plan = confirmPlan.value;
    if (!plan) return;
    confirmOpen.value = false;
    confirmPlan.value = null;
    void buyPlan(plan);
};

/** Body text cho confirmation modal — dynamic theo plan đang mua + gói hiện tại. */
const confirmBody = computed<string>(() => {
    const target = confirmPlan.value;
    const current = planStore.currentPlan;
    const days = remainingDays.value;

    if (!target) return '';

    const targetName = displayPlanName(target);
    const currentName = current ? displayPlanName(current) : 'hiện tại';
    const daysText = days !== null ? `còn ${days} ngày` : 'chưa kích hoạt';

    return `Gói ${currentName} hiện tại của bạn ${daysText}. Khi ${target.code === 'pro' ? 'nâng cấp' : 'mua gói mới'}, gói ${currentName} sẽ kết thúc và gói ${targetName} sẽ được kích hoạt ngay hôm nay. Thời gian còn lại của gói ${currentName} không được cộng dồn.`;
});

const confirmTitle = computed<string>(() => {
    const target = confirmPlan.value;
    if (!target) return '';
    const targetName = displayPlanName(target);

    if (currentPlanCode.value === target.code) {
        return `Gia hạn gói ${targetName}?`;
    }
    if (target.code === 'pro') {
        return `Nâng cấp lên ${targetName}?`;
    }
    return `Chọn gói ${targetName}?`;
});

/** Core buy flow — gọi API + mở QR modal (KHÔNG đổi logic, chỉ tách ra để gọi từ 2 nơi). */
const buyPlan = async (plan: Plan): Promise<void> => {
    buying.value = plan.id;
    try {
        const data = await paymentApi.create({ planId: plan.id });
        qrPlan.value = plan;
        qrPaymentData.value = data;
        qrOpen.value = true;
    } catch (err: any) {
        errorMsg.value =
            err?.response?.data?.message || 'Không tạo được payment link. Vui lòng thử lại.';
    } finally {
        buying.value = null;
    }
};

const onPaymentSuccess = async () => {
    const orderCode = qrPaymentData.value?.payment.orderCode;
    qrOpen.value = false;
    await planStore.fetchMyPlan();
    qrPaymentData.value = null;
    qrPlan.value = null;
    await router.push({
        name: 'billing-success',
        query: orderCode ? { orderCode, status: 'PAID' } : undefined,
    });
};

const onPaymentClose = () => {
    qrOpen.value = false;
    qrPaymentData.value = null;
    qrPlan.value = null;
};
</script>

<template>
    <div class="max-w-6xl mx-auto px-4 py-12">
        <!-- Header -->
        <div class="text-center mb-10">
            <h1 class="text-3xl md:text-4xl font-bold text-slate-900 mb-3">
                Chọn gói phù hợp với nhu cầu của bạn
            </h1>
            <p class="text-slate-500 text-base">
                Bắt đầu miễn phí, nâng cấp khi bạn cần nhiều lượt sử dụng hơn.
            </p>
        </div>

        <!-- Error banner -->
        <div
            v-if="errorMsg"
            class="bg-red-50 text-red-700 border border-red-200 rounded-lg p-4 mb-6"
            role="alert"
        >
            {{ errorMsg }}
        </div>

        <!-- Active plan notice -->
        <div
            v-if="hasActivePaidPlan && planStore.currentPlan"
            class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8"
            role="status"
        >
            <p class="font-medium text-slate-900">
                Bạn đang sử dụng gói <strong>{{ displayPlanName(planStore.currentPlan) }}</strong><span v-if="remainingDays !== null"> — còn {{ remainingDays }} ngày</span>.
            </p>
            <p class="text-sm mt-2 text-slate-600">
                Khi mua gói mới, gói hiện tại sẽ kết thúc và gói mới được kích hoạt ngay hôm nay. Thời gian còn lại của gói hiện tại không được cộng dồn.
            </p>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="text-center py-12">
            <p class="text-slate-500">Đang tải...</p>
        </div>

        <!-- Plans grid -->
        <div v-else class="grid md:grid-cols-3 gap-6">
            <div
                v-for="plan in plans"
                :key="plan.id"
                :class="[
                    'relative bg-white rounded-2xl p-6 border border-slate-200 transition-shadow hover:shadow-lg',
                    planThemeGradient[plan.code] ?? '',
                ]"
            >
                <!-- Badge -->
                <span
                    v-if="planBadgeMap[plan.code]"
                    class="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold tracking-wide"
                    :class="planBadgeClass[plan.code] ?? 'bg-slate-100 text-slate-700'"
                >
                    {{ planBadgeMap[plan.code] }}
                </span>

                <!-- Plan name -->
                <h3 class="text-xl font-bold text-slate-900 mb-2">
                    {{ displayPlanName(plan) }}
                </h3>

                <!-- Price -->
                <p
                    class="text-2xl font-bold mb-6"
                    :class="planPriceColor[plan.code] ?? 'text-slate-900'"
                >
                    {{ formatPriceLine(plan) }}
                </p>

                <!-- Features -->
                <ul class="text-sm text-left mb-6 space-y-3">
                    <li
                        v-for="[key, value] in getCandidateFeatures(plan.features)"
                        :key="key"
                        class="flex items-start"
                    >
                        <component
                            :is="featureIcon[key]"
                            class="text-green-600 mr-2 flex-shrink-0 mt-0.5"
                            :size="18"
                        />
                        <span class="text-slate-700 leading-relaxed">
                            <strong>{{ quotaLabel[key] }}:</strong>
                            {{ formatQuota(value) }}
                        </span>
                    </li>
                </ul>

                <!-- Action button -->
                <button
                    class="w-full py-2.5 px-4 rounded-lg font-medium transition disabled:opacity-70 disabled:cursor-not-allowed"
                    :class="planButtonClass(plan.code, isButtonDisabled(plan))"
                    :disabled="isButtonDisabled(plan) || buying === plan.id"
                    @click="tryBuy(plan)"
                >
                    {{ buying === plan.id ? 'Đang xử lý...' : getButtonText(plan) }}
                </button>
            </div>
        </div>

        <!-- Login prompt -->
        <div v-if="!auth.isAuthenticated" class="mt-8 text-center">
            <p class="text-sm text-slate-500">
                Bạn cần <router-link to="/login" class="text-blue-600 underline hover:text-blue-700">đăng nhập</router-link>
                để mua gói.
            </p>
        </div>

        <!-- Confirmation modal -->
        <div
            v-if="confirmOpen"
            class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
            @click.self="cancelConfirm"
        >
            <div
                class="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
                role="dialog"
                aria-modal="true"
            >
                <h3 class="text-lg font-bold text-slate-900 mb-3">{{ confirmTitle }}</h3>
                <p class="text-sm text-slate-600 mb-6 leading-relaxed">{{ confirmBody }}</p>
                <div class="flex gap-3 justify-end">
                    <button
                        class="px-4 py-2 rounded-lg font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition"
                        @click="cancelConfirm"
                    >
                        Hủy
                    </button>
                    <button
                        class="px-4 py-2 rounded-lg font-medium text-white transition"
                        :class="planButtonClass(confirmPlan?.code ?? 'light', false)"
                        @click="proceedConfirm"
                    >
                        Tiếp tục nâng cấp
                    </button>
                </div>
            </div>
        </div>

        <!-- QR Payment Modal -->
        <PaymentQRModal
            :open="qrOpen"
            :plan="qrPlan"
            :payment-data="qrPaymentData"
            @close="onPaymentClose"
            @success="onPaymentSuccess"
        />
    </div>
</template>
