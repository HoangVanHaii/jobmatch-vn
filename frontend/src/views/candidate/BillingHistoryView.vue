<script setup lang="ts">
/**
 * BillingHistoryView — Trang hiển thị gói hiện tại + quota + lịch sử mua.
 *
 * Layout 4 sections (CandidateLayout đã wrap qua route `/candidate/*`):
 *  1. Current Plan — plan name + expiry + remainingDays + CTA "Nâng cấp"
 *  2. Quota Usage — mini-card grid 3 cột (filter qua CANDIDATE_QUOTA_KEYS,
 *     chỉ show 3 keys relevant tới ứng viên; `job_post`/`job_generation` dành cho NTD)
 *  3. Subscriptions history (DESC theo startedAt, paginated)
 *  4. Payments history (DESC theo createdAt, paginated)
 *
 * State cục bộ 3 nhóm — không cần Pinia store vì data chỉ dùng ở view này.
 * Mỗi section fetch độc lập: 1 endpoint fail → section đó hiển thị error,
 * các section khác vẫn render bình thường.
 *
 * Lưu ý:
 * - `usage.plan === null` → hiển thị "Gói Free" + CTA (chưa mua gói nào).
 * - `remainingDays === 0` → highlight "Sắp hết hạn".
 * - `payments[].planName === null` → hiển thị "—" thay vì crash.
 */
import { computed, onMounted, ref } from 'vue';
import {
    Calendar,
    TrendingUp,
    AlertCircle,
    History,
    Receipt,
    Sparkles,
    Loader2,
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
    XCircle,
    Clock,
    Eye,
    Package,
    Send,
    FileText,
    ArrowRight,
    Filter,
} from 'lucide-vue-next';
import { planApi } from '@services/plan.api';
import { paymentApi } from '@services/payment.api';
import { subscriptionApi } from '@services/subscription.api';
import PaymentDetailModal from '@components/payment/PaymentDetailModal.vue';
import type { PlanUsage, SubscriptionHistoryItem } from '@/types/billing';
import type { CountableQuotaKey } from '@/types/billing';
import type { PaymentWithPlan, PaymentStatus } from '@/types/payment';
import type { SubscriptionStatus } from '@/types/billing';

// ============================================================
// Section 1+2: Plan & Quota
// ============================================================
const usage = ref<PlanUsage | null>(null);
const usageLoading = ref(false);
const usageError = ref('');

async function loadUsage() {
    usageLoading.value = true;
    usageError.value = '';
    try {
        usage.value = await planApi.getMyUsage();
    } catch (err: any) {
        usageError.value =
            err?.response?.data?.error?.message ?? 'Không thể tải thông tin gói';
    } finally {
        usageLoading.value = false;
    }
}

const remainingDaysText = computed(() => {
    const d = usage.value?.remainingDays;
    if (d === null || d === undefined) return '';
    if (d === 0) return 'Hết hạn hôm nay';
    if (d === 1) return 'Còn 1 ngày';
    return `Còn ${d} ngày`;
});

const isExpiringSoon = computed(
    () =>
        usage.value?.remainingDays !== null &&
        usage.value?.remainingDays !== undefined &&
        usage.value.remainingDays <= 3 &&
        usage.value.remainingDays > 0,
);

/**
 * Map plan code → display name tiếng Việt.
 * Backend trả `code` (lowercase) + `name` (lowercase cũng) — FE map sang tên
 * hiển thị đẹp. Tránh hard-code dữ liệu dynamic.
 */
const planNameMap: Record<string, string> = {
    free: 'Miễn phí',
    light: 'Light',
    pro: 'Pro',
};

const displayPlanName = (code: string | undefined, fallback = ''): string =>
    (code && planNameMap[code]) || fallback;

/**
 * Map quota key → label tiếng Việt.
 * Phải đồng bộ với backend CountableQuotaKey (xem frontend/src/types/billing.ts).
 */
const quotaLabel: Record<CountableQuotaKey, string> = {
    apply: 'Ứng tuyển',
    job_post: 'Lượt tạo việc làm',
    ai_cv_parsed: 'Phân tích CV',
    ai_cv_analysis: 'Chấm điểm CV bằng AI',
    job_generation: 'Lượt tạo mô tả việc làm (AI)',
};

/** Icon cho từng quota key — semantic để dễ scan. */
const quotaIcon: Record<CountableQuotaKey, typeof Send> = {
    apply: Send,
    ai_cv_parsed: FileText,
    ai_cv_analysis: Sparkles,
    job_post: Package,
    job_generation: Sparkles,
};

/** Candidate view chỉ show 3 quota relevant tới ứng viên. */
const CANDIDATE_QUOTA_KEYS: CountableQuotaKey[] = [
    'apply',
    'ai_cv_parsed',
    'ai_cv_analysis',
];

const visibleUsage = computed(() =>
    (usage.value?.usage ?? []).filter((q) =>
        CANDIDATE_QUOTA_KEYS.includes(q.key),
    ),
);

/** Phân nhóm quota — AI có token usage + style gradient nhẹ. */
const isAiQuota = (key: CountableQuotaKey): boolean =>
    key === 'ai_cv_parsed' || key === 'ai_cv_analysis' || key === 'job_generation';

function quotaPercent(item: { used: number; limit: number; unlimited: boolean }): number {
    if (item.unlimited) return 0;
    if (item.limit <= 0) return 100;
    return Math.min(100, Math.round((item.used / item.limit) * 100));
}

/** Helper: chọn màu progress bar theo % sử dụng. */
type QuotaLevel = 'low' | 'mid' | 'high' | 'full';

function quotaLevel(percent: number): QuotaLevel {
    if (percent >= 100) return 'full';
    if (percent >= 80) return 'high';
    if (percent >= 50) return 'mid';
    return 'low';
}

const progressBarClass: Record<QuotaLevel, string> = {
    low: 'bg-blue-500',
    mid: 'bg-blue-500',
    high: 'bg-amber-500',
    full: 'bg-amber-500',
};

// ============================================================
// Section 3: Subscriptions history (paginated)
// ============================================================
const subs = ref<SubscriptionHistoryItem[]>([]);
const subsLoading = ref(false);
const subsError = ref('');
const subsPage = ref(1);
const subsTotalPages = ref(0);
const subsTotal = ref(0);
const subsStatusFilter = ref<SubscriptionStatus | ''>('');
const SUBS_PAGE_SIZE = 10;

async function loadSubs(page = 1) {
    subsLoading.value = true;
    subsError.value = '';
    try {
        const { data, pagination } = await subscriptionApi.listMine(
            page,
            SUBS_PAGE_SIZE,
            subsStatusFilter.value || undefined,
        );
        subs.value = data;
        subsTotal.value = pagination.total;
        subsTotalPages.value = pagination.totalPages;
        subsPage.value = pagination.page;
    } catch (err: any) {
        subsError.value =
            err?.response?.data?.error?.message ?? 'Không thể tải lịch sử subscription';
    } finally {
        subsLoading.value = false;
    }
}

function goToSubsPage(p: number) {
    const target = Math.min(Math.max(1, p), subsTotalPages.value);
    if (target === subsPage.value) return;
    loadSubs(target);
}

function onSubsStatusChange() {
    loadSubs(1);
}

// ============================================================
// Section 4: Payments history (paginated)
// ============================================================
const payments = ref<PaymentWithPlan[]>([]);
const paysLoading = ref(false);
const paysError = ref('');
const payPage = ref(1);
const payTotalPages = ref(0);
const payTotal = ref(0);
const PAY_PAGE_SIZE = 10;

async function loadPayments(page = 1) {
    paysLoading.value = true;
    paysError.value = '';
    try {
        const { data, pagination } = await paymentApi.listMine(page, PAY_PAGE_SIZE);
        payments.value = data;
        payTotal.value = pagination.total;
        payTotalPages.value = pagination.totalPages;
        payPage.value = pagination.page;
    } catch (err: any) {
        paysError.value =
            err?.response?.data?.error?.message ?? 'Không thể tải lịch sử thanh toán';
    } finally {
        paysLoading.value = false;
    }
}

function goToPayPage(p: number) {
    const target = Math.min(Math.max(1, p), payTotalPages.value);
    if (target === payPage.value) return;
    loadPayments(target);
}

// Detail modal state
const detailOpen = ref(false);
const detailPaymentId = ref<string | null>(null);

function openPaymentDetail(id: string) {
    detailPaymentId.value = id;
    detailOpen.value = true;
}

function closePaymentDetail() {
    detailOpen.value = false;
}

/**
 * Được gọi từ PaymentDetailModal sau khi user cancel thành công.
 * Refresh lại list để badge + updatedAt ở table update theo status mới.
 */
async function onPaymentCancelled(_paymentId: string) {
    await loadPayments(payPage.value);
}

// ============================================================
// Helpers
// ============================================================
function formatPrice(v: string): string {
    return Number(v).toLocaleString('vi-VN') + 'đ';
}

function formatDate(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

function formatDateTime(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const subStatusBadge: Record<SubscriptionStatus, { label: string; cls: string }> = {
    active: { label: 'Đang dùng', cls: 'bg-green-50 text-green-700 ring-green-200' },
    cancelled: { label: 'Đã huỷ', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
    expired: { label: 'Hết hạn', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
    pending: { label: 'Chờ kích hoạt', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
};

const payStatusBadge: Record<PaymentStatus, { label: string; cls: string }> = {
    paid: { label: 'Thành công', cls: 'bg-green-50 text-green-700 ring-green-200' },
    pending: { label: 'Đang xử lý', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
    failed: { label: 'Thất bại', cls: 'bg-red-50 text-red-700 ring-red-200' },
    cancelled: { label: 'Đã huỷ', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
    refunded: { label: 'Đã hoàn tiền', cls: 'bg-purple-50 text-purple-700 ring-purple-200' },
    expired: { label: 'Hết hạn', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

// ============================================================
// Lifecycle
// ============================================================
onMounted(() => {
    loadUsage();
    loadSubs(1);
    loadPayments(1);
});
</script>

<template>
    <div class="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <!-- ============ HEADER ============ -->
        <div>
            <h1 class="text-[26px] font-bold text-slate-900 leading-tight">
                Gói dịch vụ &amp; thanh toán
            </h1>
            <p class="text-sm text-slate-500 mt-2">
                Quản lý gói dịch vụ, theo dõi lượt sử dụng và lịch sử thanh toán.
            </p>
        </div>

        <!-- ============ SECTION 1: Current Plan ============ -->
        <section class="card-base">
            <div class="flex items-center justify-between mb-5">
                <h2 class="section-title">
                    <Package class="w-5 h-5 text-blue-600" />
                    Gói hiện tại
                </h2>
                <router-link
                    to="/candidate/pricing"
                    class="text-sm font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                >
                    Nâng cấp ngay
                    <ArrowRight class="w-4 h-4" />
                </router-link>
            </div>

            <div v-if="usageLoading" class="flex items-center gap-2 text-slate-500 py-6">
                <Loader2 class="w-4 h-4 animate-spin" />
                <span class="text-sm">Đang tải...</span>
            </div>

            <div v-else-if="usageError" class="flex items-center gap-2 text-red-600 py-6">
                <AlertCircle class="w-4 h-4" />
                <span class="text-sm">{{ usageError }}</span>
            </div>

            <div
                v-else-if="!usage || !usage.plan"
                class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-50 rounded-xl p-5"
            >
                <div>
                    <div class="flex items-center gap-2 mb-1.5">
                        <span class="text-lg font-semibold text-slate-900">Miễn phí</span>
                        <span class="badge-pill bg-slate-200 text-slate-700">
                            Mặc định
                        </span>
                    </div>
                    <p class="text-sm text-slate-600">
                        Bạn chưa mua gói nào. Nâng cấp để mở khóa các tính năng nâng cao.
                    </p>
                </div>
                <router-link
                    to="/candidate/pricing"
                    class="btn-primary whitespace-nowrap"
                >
                    Nâng cấp ngay
                </router-link>
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-5">
                <!-- Cột 1-2: Tên gói + giá -->
                <div class="md:col-span-2">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="text-2xl font-bold text-slate-900">
                            {{ displayPlanName(usage.plan.code, usage.plan.name) }}
                        </span>
                        <span class="badge-pill bg-blue-50 text-blue-700 ring-blue-200">
                            ĐANG SỬ DỤNG
                        </span>
                    </div>
                    <p class="text-sm text-slate-600">
                        {{ formatPrice(usage.plan.priceVnd) }} ·
                        {{ usage.plan.durationDays }} ngày
                    </p>
                </div>
                <!-- Cột 3: Trạng thái + expiry -->
                <div class="md:text-right">
                    <div
                        :class="[
                            'text-base font-semibold flex items-center md:justify-end gap-1.5',
                            isExpiringSoon ? 'text-amber-600' : 'text-green-600',
                        ]"
                    >
                        <CheckCircle2 class="w-4 h-4" />
                        Đang hoạt động
                    </div>
                    <div
                        :class="[
                            'text-sm font-medium mt-1',
                            isExpiringSoon ? 'text-amber-600' : 'text-slate-700',
                        ]"
                    >
                        {{ remainingDaysText }}
                    </div>
                    <p class="text-xs text-slate-500 mt-1 flex items-center md:justify-end gap-1">
                        <Calendar class="w-3 h-3" />
                        Hết hạn: {{ formatDate(usage.expiresAt!) }}
                    </p>
                </div>
            </div>
        </section>

        <!-- ============ SECTION 2: Quota (mini-card grid) ============ -->
        <section class="card-base">
            <h2 class="section-title mb-5">
                <TrendingUp class="w-5 h-5 text-blue-600" />
                Lượt sử dụng
            </h2>

            <div v-if="usageLoading" class="flex items-center gap-2 text-slate-500 py-4">
                <Loader2 class="w-4 h-4 animate-spin" />
                <span class="text-sm">Đang tải...</span>
            </div>

            <div v-else-if="usageError" class="text-sm text-slate-500">
                Không thể hiển thị quota.
            </div>

            <div
                v-else-if="!usage || !usage.plan || visibleUsage.length === 0"
                class="text-sm text-slate-500 italic py-4"
            >
                Chưa có quota để hiển thị. Mua gói để mở khóa các tính năng.
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div
                    v-for="q in visibleUsage"
                    :key="q.key"
                    class="quota-card"
                    :class="{ 'quota-card-ai': isAiQuota(q.key) }"
                >
                    <!-- Header: icon + label -->
                    <div class="flex items-center gap-2 mb-3">
                        <component
                            :is="quotaIcon[q.key]"
                            class="w-4 h-4"
                            :class="isAiQuota(q.key) ? 'text-purple-600' : 'text-blue-600'"
                        />
                        <span class="text-sm font-semibold text-slate-900">
                            {{ quotaLabel[q.key] ?? q.key }}
                        </span>
                    </div>

                    <!-- Main count: used / limit -->
                    <div class="mb-3">
                        <div class="text-2xl font-bold text-slate-900">
                            <template v-if="q.unlimited">
                                {{ q.used }}
                                <span class="text-base font-medium text-slate-500">/ Không giới hạn</span>
                            </template>
                            <template v-else-if="q.limit > 0">
                                {{ q.used }}
                                <span class="text-base font-medium text-slate-500">/ {{ q.limit }} lượt</span>
                            </template>
                            <template v-else>
                                {{ q.used }}
                                <span class="text-base font-medium text-slate-500">lượt</span>
                            </template>
                        </div>
                    </div>

                    <!-- Progress bar (chỉ khi có limit) -->
                    <div
                        v-if="!q.unlimited && q.limit > 0"
                        class="w-full bg-slate-200 rounded-full h-2 overflow-hidden mb-3"
                    >
                        <div
                            class="h-full transition-all"
                            :class="progressBarClass[quotaLevel(quotaPercent(q))]"
                            :style="{ width: `${quotaPercent(q)}%` }"
                        ></div>
                    </div>

                    <!-- Token usage (chỉ AI, khi > 0) -->
                    <div
                        v-if="isAiQuota(q.key) && q.tokens > 0"
                        class="flex items-center gap-1 text-xs text-slate-500 pt-2 border-t border-slate-100"
                    >
                        <Sparkles class="w-3 h-3 text-purple-500" />
                        <span>{{ q.tokens.toLocaleString('vi-VN') }} tokens đã sử dụng</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- ============ SECTION 3: Subscriptions ============ -->
        <section class="card-base">
            <div class="flex items-center justify-between mb-5">
                <h2 class="section-title">
                    <History class="w-5 h-5 text-blue-600" />
                    Lịch sử gói dịch vụ
                </h2>
                <div class="flex items-center gap-3">
                    <label class="flex items-center gap-2 text-sm text-slate-600">
                        <Filter class="w-4 h-4 text-slate-400" />
                        <select
                            v-model="subsStatusFilter"
                            class="select-filter"
                            @change="onSubsStatusChange"
                        >
                            <option value="">Tất cả</option>
                            <option value="active">Đang dùng</option>
                            <option value="expired">Hết hạn</option>
                            <option value="cancelled">Đã huỷ</option>
                            <option value="pending">Chờ kích hoạt</option>
                        </select>
                    </label>
                    <span v-if="subsTotal > 0" class="text-xs text-slate-500">
                        {{ subsTotal }} gói
                    </span>
                </div>
            </div>

            <div v-if="subsLoading" class="flex items-center gap-2 text-slate-500 py-6">
                <Loader2 class="w-4 h-4 animate-spin" />
                <span class="text-sm">Đang tải...</span>
            </div>

            <div v-else-if="subsError" class="text-sm text-red-600 py-2">
                {{ subsError }}
            </div>

            <div v-else-if="subs.length === 0" class="empty-state">
                <Receipt class="empty-icon" />
                <p class="text-sm">Chưa có subscription nào.</p>
            </div>

            <div v-else class="overflow-x-auto">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Gói</th>
                            <th>Trạng thái</th>
                            <th>Bắt đầu</th>
                            <th>Hết hạn</th>
                            <th>Tổng token</th>
                            <th>Mã đơn</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="s in subs" :key="s.id">
                            <td>
                                <div class="font-medium text-slate-900">
                                    {{ displayPlanName(s.planCode, s.planName) }}
                                </div>
                                <div class="text-xs text-slate-500 mt-0.5">
                                    {{ formatPrice(s.priceVnd) }} ·
                                    {{ s.planDurationDays }} ngày
                                </div>
                            </td>
                            <td>
                                <span :class="['badge-pill ring-1', subStatusBadge[s.status]?.cls ?? 'bg-slate-100 text-slate-600 ring-slate-200']">
                                    {{ subStatusBadge[s.status]?.label ?? s.status }}
                                </span>
                            </td>
                            <td class="text-slate-700">{{ formatDate(s.startedAt) }}</td>
                            <td class="text-slate-700">{{ formatDate(s.expiresAt) }}</td>
                            <td class="text-slate-700">
                                <span class="inline-flex items-center gap-1.5 text-sm">
                                    <Sparkles class="w-3.5 h-3.5 text-purple-500" />
                                    <strong>{{ s.totalTokens.toLocaleString('vi-VN') }}</strong>
                                    <span class="text-xs text-slate-500">tokens</span>
                                </span>
                            </td>
                            <td class="font-mono text-xs text-slate-500">
                                {{ s.payosOrderId ?? '—' }}
                            </td>
                        </tr>
                    </tbody>
                </table>

                <!-- Pagination -->
                <div v-if="subsTotalPages > 1" class="pagination">
                    <span class="text-slate-500">
                        Trang {{ subsPage }} / {{ subsTotalPages }}
                    </span>
                    <div class="flex gap-1">
                        <button
                            :disabled="subsPage <= 1"
                            class="page-btn"
                            @click="goToSubsPage(subsPage - 1)"
                        >
                            <ChevronLeft class="w-4 h-4" />
                        </button>
                        <button
                            :disabled="subsPage >= subsTotalPages"
                            class="page-btn"
                            @click="goToSubsPage(subsPage + 1)"
                        >
                            <ChevronRight class="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </section>

        <!-- ============ SECTION 4: Payments ============ -->
        <section class="card-base">
            <div class="flex items-center justify-between mb-5">
                <h2 class="section-title">
                    <Receipt class="w-5 h-5 text-blue-600" />
                    Lịch sử thanh toán
                </h2>
                <span v-if="payTotal > 0" class="text-xs text-slate-500">
                    {{ payTotal }} giao dịch
                </span>
            </div>

            <div v-if="paysLoading" class="flex items-center gap-2 text-slate-500 py-6">
                <Loader2 class="w-4 h-4 animate-spin" />
                <span class="text-sm">Đang tải...</span>
            </div>

            <div v-else-if="paysError" class="text-sm text-red-600 py-2">
                {{ paysError }}
            </div>

            <div v-else-if="payments.length === 0" class="empty-state">
                <Receipt class="empty-icon" />
                <p class="text-sm">Chưa có giao dịch nào.</p>
            </div>

            <div v-else class="overflow-x-auto">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Gói</th>
                            <th>Số tiền</th>
                            <th>Mã đơn</th>
                            <th>Trạng thái</th>
                            <th>Ngày tạo</th>
                            <th>Cập nhật</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="p in payments"
                            :key="p.id"
                            class="cursor-pointer"
                            role="button"
                            tabindex="0"
                            @click="openPaymentDetail(p.id)"
                            @keydown.enter="openPaymentDetail(p.id)"
                            @keydown.space.prevent="openPaymentDetail(p.id)"
                        >
                            <td>
                                <span class="font-medium text-slate-900">
                                    {{ displayPlanName(p.planCode ?? undefined, p.planName ?? undefined) }}
                                </span>
                                <span
                                    v-if="p.planDurationDays"
                                    class="ml-2 text-xs text-slate-500"
                                >
                                    {{ p.planDurationDays }} ngày
                                </span>
                            </td>
                            <td class="font-semibold text-slate-900">
                                {{ formatPrice(p.amountVnd) }}
                            </td>
                            <td class="font-mono text-xs text-slate-500">
                                {{ p.orderCode }}
                            </td>
                            <td>
                                <span :class="['badge-pill ring-1 inline-flex items-center gap-1', payStatusBadge[p.status]?.cls ?? 'bg-slate-100 text-slate-600 ring-slate-200']">
                                    <CheckCircle2 v-if="p.status === 'paid'" class="w-3 h-3" />
                                    <XCircle v-else-if="p.status === 'failed'" class="w-3 h-3" />
                                    <Clock v-else-if="p.status === 'pending'" class="w-3 h-3" />
                                    <XCircle v-else-if="p.status === 'cancelled'" class="w-3 h-3" />
                                    <Clock v-else-if="p.status === 'expired'" class="w-3 h-3" />
                                    {{ payStatusBadge[p.status]?.label ?? p.status }}
                                </span>
                            </td>
                            <td class="text-slate-700">
                                <div class="flex items-center gap-2">
                                    <span>{{ formatDateTime(p.createdAt) }}</span>
                                    <Eye class="w-3.5 h-3.5 text-slate-400" />
                                </div>
                            </td>
                            <td class="text-slate-700">
                                <span v-if="p.updatedAt">{{ formatDateTime(p.updatedAt) }}</span>
                                <span v-else class="text-slate-400">—</span>
                            </td>
                        </tr>
                    </tbody>
                </table>

                <!-- Pagination -->
                <div v-if="payTotalPages > 1" class="pagination">
                    <span class="text-slate-500">
                        Trang {{ payPage }} / {{ payTotalPages }}
                    </span>
                    <div class="flex gap-1">
                        <button
                            :disabled="payPage <= 1"
                            class="page-btn"
                            @click="goToPayPage(payPage - 1)"
                        >
                            <ChevronLeft class="w-4 h-4" />
                        </button>
                        <button
                            :disabled="payPage >= subsTotalPages"
                            class="page-btn"
                            @click="goToPayPage(payPage + 1)"
                        >
                            <ChevronRight class="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </section>

        <!-- ============ PAYMENT DETAIL MODAL ============ -->
        <PaymentDetailModal
            :open="detailOpen"
            :payment-id="detailPaymentId"
            @close="closePaymentDetail"
            @cancelled="onPaymentCancelled"
        />
    </div>
</template>

<style scoped>
/* ============================================================================
 * Design tokens — SaaS dashboard style
 * - Primary blue: #2563EB
 * - Slate text: #0F172A / #64748B
 * - Border: #E2E8F0
 * - Success green: #16A34A
 * - Warning amber: #D97706
 * - Purple: chỉ dùng cho AI premium (tokens / AI quota)
 * ========================================================================== */

/* --- Card base --- */
.card-base {
    @apply bg-white rounded-2xl border border-slate-200 p-6 shadow-sm;
}

/* --- Section title --- */
.section-title {
    @apply text-base font-semibold text-slate-900 flex items-center gap-2;
}

/* --- Buttons --- */
.btn-primary {
    @apply inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition;
}

.btn-secondary {
    @apply inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-slate-700 text-sm font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition;
}

/* --- Badge pill --- */
.badge-pill {
    @apply inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium;
}

/* --- Quota mini-card --- */
.quota-card {
    @apply bg-white rounded-xl border border-slate-200 p-4 transition;
}

.quota-card-ai {
    background: linear-gradient(180deg, rgba(245, 243, 255, 0.5) 0%, #FFFFFF 100%);
    border-color: #DDD6FE;
}

/* --- Empty state --- */
.empty-state {
    @apply text-center py-10 text-slate-500;
}
.empty-icon {
    @apply w-10 h-10 mx-auto mb-2 text-slate-300;
}

/* --- Table --- */
.data-table {
    @apply min-w-full text-sm;
}
.data-table thead tr {
    @apply text-left text-slate-500 border-b border-slate-200;
}
.data-table thead th {
    @apply py-2.5 pr-4 font-medium text-xs uppercase tracking-wide;
}
.data-table tbody tr {
    @apply border-b border-slate-100 last:border-0 hover:bg-slate-50 transition;
}
.data-table tbody td {
    @apply py-3 pr-4;
}

/* --- Pagination --- */
.pagination {
    @apply flex items-center justify-between mt-4 text-sm;
}
.page-btn {
    @apply px-2.5 py-1 rounded-md border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition;
}

/* --- Filter select --- */
.select-filter {
    @apply text-sm border border-slate-200 rounded-md px-2.5 py-1 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500;
}
</style>