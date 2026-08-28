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
 * Tránh hard-code dữ liệu dynamic: nếu code không match, fallback về plan.name từ BE.
 */
const planNameMap: Record<string, string> = {
    free: 'Free',
    light: 'Light',
    pro: 'Pro',
};

const displayPlanName = (plan: Plan): string =>
    planNameMap[plan.code] || plan.name;

/** Theme màu cho từng gói (slate / blue / purple). */
const planThemeMap: Record<string, 'slate' | 'blue' | 'purple'> = {
    free: 'slate',
    light: 'blue',
    pro: 'purple',
};

/** Badge cho từng gói (chỉ hiển thị nếu có). */
const planBadgeMap: Record<string, string> = {
    light: 'PHỔ BIẾN NHẤT',
    pro: 'GIÁ TRỊ TỐT NHẤT',
};

/**
 * Quota label Tiếng Việt — đồng bộ với BillingHistoryView.
 * Mapping key → tên feature dễ hiểu cho candidate.
 */
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

/**
 * Icon tương ứng với từng quota key — semantic, dễ scan nhanh.
 * Component type dùng `typeof Send` để tránh phải import type riêng.
 */
const featureIcon: Record<CountableQuotaKey, typeof Send> = {
    apply: Send,
    ai_cv_parsed: FileSearch,
    ai_cv_analysis: Sparkles,
    job_post: Briefcase,
    job_generation: Wand2,
};

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

    // Đang dùng đúng gói này → gia hạn.
    if (currentPlanCode.value === plan.code) {
        return `Gia hạn thêm ${plan.durationDays} ngày`;
    }

    // Đang dùng gói free → chọn mới.
    if (currentPlanCode.value === 'free' || currentPlanCode.value === null) {
        return `Chọn gói ${planName}`;
    }

    // Đang dùng gói paid khác → upgrade / downgrade.
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

    // Không có paid plan → mua luôn (không cần confirm).
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
        <div v-if="errorMsg" class="alert-error mb-6" role="alert">
            {{ errorMsg }}
        </div>

        <!-- Active plan notice — viết lại ngắn gọn, dynamic theo data -->
        <div
            v-if="hasActivePaidPlan && planStore.currentPlan"
            class="alert-info mb-8"
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
                class="plan-card"
                :class="`theme-${planThemeMap[plan.code] || 'slate'}`"
            >
                <!-- Badge -->
                <span
                    v-if="planBadgeMap[plan.code]"
                    class="plan-badge"
                    :class="`badge-${planThemeMap[plan.code] || 'slate'}`"
                >
                    {{ planBadgeMap[plan.code] }}
                </span>

                <!-- Plan name -->
                <h3 class="plan-name">{{ displayPlanName(plan) }}</h3>

                <!-- Price -->
                <p class="plan-price">
                    {{ formatPriceLine(plan) }}
                </p>

                <!-- Features -->
                <ul class="plan-features">
                    <li
                        v-for="[key, value] in getCandidateFeatures(plan.features)"
                        :key="key"
                        class="plan-feature-item"
                    >
                        <component :is="featureIcon[key]" class="plan-check" :size="18" />
                        <span class="plan-feature-text">
                            <strong>{{ quotaLabel[key] }}:</strong>
                            {{ formatQuota(value) }}
                        </span>
                    </li>
                </ul>

                <!-- Action button -->
                <button
                    class="plan-btn"
                    :class="`btn-${planThemeMap[plan.code] || 'slate'}`"
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
        <div v-if="confirmOpen" class="modal-backdrop" @click.self="cancelConfirm">
            <div class="modal-card" role="dialog" aria-modal="true">
                <h3 class="modal-title">{{ confirmTitle }}</h3>
                <p class="modal-body">{{ confirmBody }}</p>
                <div class="modal-actions">
                    <button class="modal-btn-secondary" @click="cancelConfirm">
                        Hủy
                    </button>
                    <button
                        class="modal-btn-primary"
                        :class="`btn-${planThemeMap[confirmPlan?.code || ''] || 'blue'}`"
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

<style scoped>
/* ============================================================================
 * Color tokens
 * - slate: #0F172A / #64748B / #E2E8F0
 * - blue:  #2563EB (light accent)
 * - purple: #7C3AED (premium accent)
 * - green: #16A34A (feature check)
 * ========================================================================== */

/* --- Plan card base --- */
.plan-card {
    @apply relative bg-white rounded-2xl p-6 border transition-shadow;
    border-color: #E2E8F0;
}

.plan-card:hover {
    @apply shadow-lg;
}

/* --- Theme variants --- */
.theme-slate {
    border-color: #E2E8F0;
}
.theme-blue {
    border-color: #BFDBFE;
    background: linear-gradient(180deg, #EFF6FF 0%, #FFFFFF 60%);
}
.theme-purple {
    border-color: #DDD6FE;
    background: linear-gradient(180deg, #F5F3FF 0%, #FFFFFF 60%);
}

/* --- Badge --- */
.plan-badge {
    @apply absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold tracking-wide;
}
.badge-blue {
    @apply bg-blue-100 text-blue-700;
}
.badge-purple {
    @apply bg-purple-100 text-purple-700;
}
.badge-slate {
    @apply bg-slate-100 text-slate-700;
}

/* --- Plan name + price --- */
.plan-name {
    @apply text-xl font-bold text-slate-900 mb-2;
}

.plan-price {
    @apply text-2xl font-bold mb-6;
}
.theme-slate .plan-price {
    color: #0F172A;
}
.theme-blue .plan-price {
    color: #2563EB;
}
.theme-purple .plan-price {
    color: #7C3AED;
}

/* --- Feature list --- */
.plan-features {
    @apply text-sm text-left mb-6 space-y-3;
}
.plan-feature-item {
    @apply flex items-start;
}
.plan-check {
    color: #16A34A;
    @apply mr-2 flex-shrink-0 mt-0.5;
}
.plan-feature-text {
    @apply text-slate-700 leading-relaxed;
}

/* --- Button --- */
.plan-btn {
    @apply w-full py-2.5 px-4 rounded-lg font-medium transition;
}
.btn-slate {
    @apply bg-slate-200 text-slate-500 cursor-not-allowed;
}
.btn-blue {
    background-color: #2563EB;
    color: white;
}
.btn-blue:hover:not(:disabled) {
    background-color: #1D4ED8;
}
.btn-purple {
    background-color: #7C3AED;
    color: white;
}
.btn-purple:hover:not(:disabled) {
    background-color: #6D28D9;
}
.plan-btn:disabled {
    @apply opacity-70 cursor-not-allowed;
}

/* --- Banners --- */
.alert-error {
    @apply bg-red-50 text-red-700 border border-red-200 rounded-lg p-4;
}
.alert-info {
    @apply bg-blue-50 border border-blue-200 rounded-lg p-4;
}

/* --- Modal --- */
.modal-backdrop {
    @apply fixed inset-0 z-50 flex items-center justify-center p-4;
    background-color: rgba(15, 23, 42, 0.5);
}
.modal-card {
    @apply bg-white rounded-2xl p-6 max-w-md w-full shadow-xl;
}
.modal-title {
    @apply text-lg font-bold text-slate-900 mb-3;
}
.modal-body {
    @apply text-sm text-slate-600 mb-6 leading-relaxed;
}
.modal-actions {
    @apply flex gap-3 justify-end;
}
.modal-btn-secondary {
    @apply px-4 py-2 rounded-lg font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition;
}
.modal-btn-primary {
    @apply px-4 py-2 rounded-lg font-medium text-white transition;
}
.modal-btn-primary:disabled {
    @apply opacity-50 cursor-not-allowed;
}
</style>