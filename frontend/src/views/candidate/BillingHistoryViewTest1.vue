<script setup lang="ts">
/**
 * BillingHistoryViewTest1 — trang "Gói dịch vụ & thanh toán" (bản redesign, GẮN API THẬT).
 *
 * Xem tại: /candidate/test6 (trong CandidateLayout). TẠM THỜI — khi duyệt sẽ
 * thay thế route 'billing/history' (BillingHistoryView.vue) hoặc đổi path.
 *
 * - Gọi API thật cùng pattern production (xem BillingHistoryView.vue):
 *   planApi.getMyUsage() · subscriptionApi.listMine() · paymentApi.listMine().
 * - Chi tiết giao dịch dùng PaymentDetailModal thật (fetch + QR pending + huỷ
 *   đơn); huỷ thành công → refresh lại trang hiện tại của danh sách thanh toán.
 * - Thiết kế giữ nguyên bản đã duyệt: Section 1 vòng tròn đếm ngược (PHẦN A),
 *   Section 2 quota "Stripe bar" (binding qua computed `quotaRows`),
 *   Section 3 lịch sử 2 tab dạng bảng + phân trang nút số.
 * - Đã gỡ thanh chọn trạng thái mockup + toàn bộ dữ liệu mock.
 */
import { computed, onMounted, ref } from 'vue';
import {
    AlertCircle,
    ArrowRight,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Clock,
    History,
    Package,
    Receipt,
    Send,
    FileText,
    Sparkles,
    TrendingUp,
    XCircle,
} from 'lucide-vue-next';
import { planApi } from '@services/plan.api';
import { paymentApi } from '@services/payment.api';
import { subscriptionApi } from '@services/subscription.api';
import PaymentDetailModal from '@components/payment/PaymentDetailModal.vue';
import type {
    PlanUsage,
    SubscriptionHistoryItem,
    CountableQuotaKey,
    SubscriptionStatus,
} from '@/types/billing';
import type { PaymentWithPlan, PaymentStatus } from '@/types/payment';

// ============================================================
// Section 1+2: Plan & Quota (gọi API thật)
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

// Sắp hết hạn: còn 1–3 ngày (match bản gốc BillingHistoryView.vue — chỉ "sắp"
// mới là cảnh báo; còn 0 ngày = "hết hạn hôm nay" → tone xanh).
const isExpiringSoon = computed(() => {
    const d = usage.value?.remainingDays;
    return d !== null && d !== undefined && d > 0 && d <= 3;
});

// Vòng tròn đếm ngược — count-up pattern: ring = % time đã dùng.
// Countdown cũ (left/total) nhìn như full với gói dài (vd 361/365 → 99% time
// remaining → offset ~2px → ring gần như kín, không thấy feedback khi mới dùng
// vài ngày). Count-up đảo lại: vừa mua → ring rỗng, dùng càng nhiều → càng đầy.
const RING_R = 32;
const RING_C = 2 * Math.PI * RING_R;
const ringOffset = computed(() => {
    const total = usage.value?.plan?.durationDays;
    const left = usage.value?.remainingDays;
    if (!total || left === null || left === undefined) return RING_C;
    const ratio = Math.min(1, Math.max(0, (total - left) / total));
    return RING_C * (1 - ratio);
});

/**
 * Map plan code → display name tiếng Việt (giữ nguyên từ bản gốc).
 */
const planNameMap: Record<string, string> = {
    free: 'Miễn phí',
    premium: 'Premium',
    'premium-yearly': 'Premium (Năm)',
    professional: 'Professional',
    'professional-yearly': 'Professional (Năm)',
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

/** Phân nhóm quota — AI có token usage. */
const isAiQuota = (key: CountableQuotaKey): boolean =>
    key === 'ai_cv_parsed' || key === 'ai_cv_analysis' || key === 'job_generation';

function quotaPercent(item: { used: number; limit: number; unlimited: boolean }): number {
    if (item.unlimited) return 0;
    if (item.limit <= 0) return 100;
    return Math.min(100, Math.round((item.used / item.limit) * 100));
}

// ---------- Section Lượt sử dụng (phong cách B — Stripe bar) ----------
type QuotaItem = { used: number; limit: number; unlimited: boolean };

function quotaState(q: QuotaItem): 'ok' | 'warn' | 'full' {
    if (q.unlimited) return 'ok';
    const p = quotaPercent(q);
    return p >= 100 ? 'full' : p >= 80 ? 'warn' : 'ok';
}

// Class viết đầy đủ để Tailwind không purge.
// Màu accent định danh theo TỪNG QUOTA (Ứng tuyển blue · Phân tích CV amber · AI violet) —
// trùng palette Tailwind của project (#3B82F6 / #F59E0B / #8B5CF6).
const QUOTA_ACCENT: Record<CountableQuotaKey, { line: string; chip: string }> = {
    apply: { line: 'bg-blue-500', chip: 'bg-blue-50 text-blue-600' },
    ai_cv_parsed: { line: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600' },
    ai_cv_analysis: { line: 'bg-violet-500', chip: 'bg-violet-50 text-violet-600' },
    job_post: { line: 'bg-slate-500', chip: 'bg-slate-100 text-slate-600' },
    job_generation: { line: 'bg-violet-500', chip: 'bg-violet-50 text-violet-600' },
};

// Màu dòng phụ theo mức tiêu thụ (amber khi ≥80%, đỏ khi hết lượt)
const QUOTA_HINT_TONE = {
    ok: 'text-slate-500',
    warn: 'text-amber-600',
    full: 'text-red-600',
} as const;

function quotaHint(q: QuotaItem): string {
    if (q.unlimited) return 'Không giới hạn';
    if (q.limit <= 0) return 'Gói chưa có lượt';
    const left = q.limit - q.used;
    return left <= 0 ? 'Đã hết lượt' : `Còn ${left} lượt`;
}

/**
 * Dòng quota với mọi giá trị dẫn xuất (percent/offset/state/hint/icon) đã tính
 * sẵn 1 lần — thay vì template gọi quotaState/quotaPercent/quotaOffset lặp lại
 * 6 lần mỗi item trên mỗi lần render.
 */
interface QuotaRow {
    key: CountableQuotaKey;
    label: string;
    icon: typeof Send;
    used: number;
    limit: number;
    unlimited: boolean;
    state: 'ok' | 'warn' | 'full';
    hint: string;
    tokens: number;
}

const quotaRows = computed<QuotaRow[]>(() =>
    visibleUsage.value.map((q) => ({
        key: q.key,
        label: quotaLabel[q.key] ?? q.key,
        icon: quotaIcon[q.key],
        used: q.used,
        limit: q.limit,
        unlimited: q.unlimited,
        state: quotaState(q),
        hint: quotaHint(q),
        tokens: q.tokens,
    })),
);

// ---------- Tabs lịch sử ----------
const activeTab = ref<'subs' | 'pays'>('subs');

const pager = computed(() => ({
    page: activeTab.value === 'subs' ? subsPage.value : payPage.value,
    totalPages: activeTab.value === 'subs' ? subsTotalPages.value : payTotalPages.value,
    totalItems: activeTab.value === 'subs' ? subsTotal.value : payTotal.value,
    go: activeTab.value === 'subs' ? goToSubsPage : goToPayPage,
}));

/** Danh sách nút số trang — rút gọn thành '…' khi số trang nhiều (>7 nút). */
const pagerPages = computed<(number | '…')[]>(() => {
    const total = pager.value.totalPages;
    const cur = pager.value.page;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const picked = new Set<number>([1, 2, cur - 1, cur, cur + 1, total - 1, total]);
    const sorted = [...picked].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
    const out: (number | '…')[] = [];
    let prev = 0;
    for (const p of sorted) {
        if (p - prev > 1) out.push('…');
        out.push(p);
        prev = p;
    }
    return out;
});

/** "Hiển thị 1–10 trên 23 giao dịch" — nhãn theo tab đang mở. */
const pagerRange = computed(() => {
    const { page, totalItems } = pager.value;
    if (totalItems === 0) return '';
    const pageSize = activeTab.value === 'subs' ? SUBS_PAGE_SIZE : PAY_PAGE_SIZE;
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, totalItems);
    const noun = activeTab.value === 'subs' ? 'gói' : 'giao dịch';
    return `Hiển thị ${from}–${to} trên ${totalItems} ${noun}`;
});

// ---------- Màu icon theo trạng thái ----------
const TONE_BOX = {
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-500',
    purple: 'bg-purple-50 text-purple-600',
} as const;

const subTone: Record<SubscriptionStatus, keyof typeof TONE_BOX> = {
    active: 'green', cancelled: 'slate', expired: 'amber', pending: 'blue',
};
const payTone: Record<PaymentStatus, keyof typeof TONE_BOX> = {
    paid: 'green', pending: 'blue', failed: 'red', cancelled: 'slate', refunded: 'purple', expired: 'amber',
};
const payIcon: Record<PaymentStatus, typeof Clock> = {
    paid: CheckCircle2, pending: Clock, failed: XCircle, cancelled: XCircle, refunded: History, expired: Clock,
};

// ============================================================
// Section 3: Lịch sử gói — subscriptionApi.listMine (server-side pagination)
// ============================================================
const subs = ref<SubscriptionHistoryItem[]>([]);
const subsLoading = ref(false);
const subsError = ref('');
const subsPage = ref(1);
const subsTotalPages = ref(0);
const subsTotal = ref(0);
const SUBS_PAGE_SIZE = 5;

async function loadSubs(page = 1) {
    subsLoading.value = true;
    subsError.value = '';
    try {
        const { data, pagination } = await subscriptionApi.listMine(page, SUBS_PAGE_SIZE);
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

// ============================================================
// Section 4: Lịch sử thanh toán — paymentApi.listMine (server-side pagination)
// ============================================================
const payments = ref<PaymentWithPlan[]>([]);
const paysLoading = ref(false);
const paysError = ref('');
const payPage = ref(1);
const payTotalPages = ref(0);
const payTotal = ref(0);
const PAY_PAGE_SIZE = 5;

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
// Chi tiết giao dịch — PaymentDetailModal thật (fetch + QR pending + huỷ đơn)
// ============================================================
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
 * Được gọi từ PaymentDetailModal sau khi user huỷ đơn thành công — refresh lại
 * trang hiện tại của danh sách để badge + updatedAt cập nhật theo status mới.
 */
async function onPaymentCancelled(_paymentId: string) {
    await loadPayments(payPage.value);
}

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
        <section class="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm">
            <!-- Loading (skeleton) -->
            <div v-if="usageLoading" class="flex items-center gap-5 animate-pulse">
                <div class="w-[76px] h-[76px] rounded-full bg-slate-100 shrink-0"></div>
                <div class="flex-1 space-y-2.5">
                    <div class="h-5 w-40 rounded bg-slate-100"></div>
                    <div class="h-4 w-64 max-w-full rounded bg-slate-100"></div>
                </div>
            </div>

            <!-- Error -->
            <div v-else-if="usageError" class="flex items-center justify-between gap-3 text-red-600">
                <div class="flex items-center gap-2">
                    <AlertCircle class="w-4 h-4 shrink-0" />
                    <span class="text-sm">{{ usageError }}</span>
                </div>
                <button
                    class="text-sm font-medium text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    @click="loadUsage"
                >
                    Thử lại
                </button>
            </div>

            <!-- Chưa có gói -->
            <div
                v-else-if="!usage || !usage.plan"
                class="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5"
            >
                <div class="w-[76px] h-[76px] rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    <Package class="w-7 h-7 text-slate-400" />
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-xl font-semibold text-slate-900">Gói Miễn phí</span>
                        <span class="px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600">
                            Mặc định
                        </span>
                    </div>
                    <p class="text-sm text-slate-500">
                        Bạn chưa mua gói nào. Nâng cấp để dùng thêm lượt ứng tuyển và tính năng AI.
                    </p>
                </div>
                <router-link
                    to="/candidate/pricing"
                    class="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                    Nâng cấp ngay
                    <ArrowRight class="w-4 h-4" />
                </router-link>
            </div>

            <!-- Đang có gói -->
            <div v-else class="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
                <!-- Vòng tròn đếm ngược -->
                <div
                    class="relative w-[76px] h-[76px] shrink-0"
                    role="img"
                    :aria-label="`Còn ${usage.remainingDays ?? 0} ngày`"
                >
                    <svg viewBox="0 0 76 76" class="w-full h-full -rotate-90">
                        <circle cx="38" cy="38" :r="RING_R" fill="none" stroke-width="7" class="stroke-slate-100" />
                        <circle
                            cx="38" cy="38" :r="RING_R" fill="none" stroke-width="7" stroke-linecap="round"
                            :stroke-dasharray="RING_C"
                            :stroke-dashoffset="ringOffset"
                            :class="isExpiringSoon ? 'stroke-amber-500' : 'stroke-blue-500'"
                            class="transition-all duration-500"
                        />
                    </svg>
                    <div class="absolute inset-0 flex flex-col items-center justify-center leading-none">
                        <span
                            class="text-xl font-semibold"
                            :class="isExpiringSoon ? 'text-amber-600' : 'text-slate-900'"
                        >
                            {{ usage.remainingDays ?? 0 }}
                        </span>
                        <span class="text-[11px] text-slate-500 mt-1">ngày</span>
                    </div>
                </div>

                <!-- Thông tin gói -->
                <div class="flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-2 mb-1">
                        <span class="text-xl font-semibold text-slate-900">
                            Gói {{ displayPlanName(usage.plan.code, usage.plan.name) }}
                        </span>
                        <span
                            v-if="isExpiringSoon"
                            class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                        >
                            <Clock class="w-3 h-3" />
                            Sắp hết hạn
                        </span>
                        <span
                            v-else-if="usage.remainingDays === 0"
                            class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-green-50 text-green-700 ring-1 ring-green-200"
                        >
                            <Clock class="w-3 h-3" />
                            Hết hạn hôm nay
                        </span>
                        <span
                            v-else
                            class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-green-50 text-green-700 ring-1 ring-green-200"
                        >
                            <CheckCircle2 class="w-3 h-3" />
                            Đang hoạt động
                        </span>
                    </div>
                    <p class="text-sm text-slate-500">
                        {{ formatPrice(usage.plan.priceVnd) }} · {{ usage.plan.durationDays }} ngày ·
                        Hết hạn {{ usage.expiresAt ? formatDate(usage.expiresAt) : '—' }}
                    </p>
                </div>

                <!-- Actions -->
                <div class="shrink-0">
                    <router-link
                        to="/candidate/pricing"
                        class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    >
                        Gia hạn
                        <ArrowRight class="w-4 h-4" />
                    </router-link>
                </div>
            </div>
        </section>

        <!-- ============ SECTION 2: Quota ============ -->
        <section class="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div class="px-5 sm:px-6 pt-5 sm:pt-6 pb-4">
                <h2 class="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <TrendingUp class="w-5 h-5 text-blue-600" />
                    Lượt sử dụng
                </h2>
            </div>

            <!-- Loading (skeleton 3 card, đồng bộ layout mới) -->
            <div v-if="usageLoading" class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 px-4 sm:px-6 pb-5 sm:pb-6">
                <div v-for="i in 3" :key="i" class="relative overflow-hidden rounded-xl border border-slate-200 p-4 sm:p-5 animate-pulse">
                    <span class="absolute inset-x-0 top-0 h-0.5 bg-slate-100" aria-hidden="true"></span>
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-slate-100 shrink-0"></div>
                        <div class="h-4 w-28 rounded bg-slate-100"></div>
                    </div>
                    <div class="mt-3 h-8 w-24 rounded bg-slate-100"></div>
                    <div class="mt-2 h-3 w-24 rounded bg-slate-100"></div>
                </div>
            </div>

            <div
                v-else-if="usageError"
                class="px-5 sm:px-6 pb-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm text-slate-500"
            >
                <p class="min-w-0">Không thể hiển thị lượt sử dụng.</p>
                <button class="font-medium text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" @click="loadUsage">
                    Thử lại
                </button>
            </div>

            <div v-else-if="!usage || !usage.plan || visibleUsage.length === 0" class="px-5 sm:px-6 pb-6 text-sm text-slate-500">
                Mua gói để mở khoá lượt ứng tuyển và tính năng AI.
            </div>

            <!-- 3 card accent-line: màu định danh theo từng quota, không progress bar -->
            <div v-else class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 px-4 sm:px-6 pb-5 sm:pb-6">
                <div
                    v-for="row in quotaRows"
                    :key="row.key"
                    class="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5"
                >
                    <!-- Đường accent ~2px ở cạnh trên — màu định danh của card -->
                    <span
                        class="absolute inset-x-0 top-0 h-0.5"
                        :class="QUOTA_ACCENT[row.key].line"
                        aria-hidden="true"
                    ></span>

                    <div class="flex items-center gap-3">
                        <span
                            class="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                            :class="QUOTA_ACCENT[row.key].chip"
                        >
                            <component :is="row.icon" class="w-5 h-5" aria-hidden="true" />
                        </span>
                        <h3 class="text-sm font-semibold text-slate-900 leading-snug min-w-0">{{ row.label }}</h3>
                    </div>

                    <!-- Số liệu lớn: used đậm, limit xám nhạt hơn -->
                    <div class="mt-3 flex items-baseline gap-1.5">
                        <span class="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{{ row.used }}</span>
                        <span
                            v-if="!row.unlimited && row.limit > 0"
                            class="text-base font-medium text-slate-400 tabular-nums"
                        >/ {{ row.limit }}</span>
                    </div>

                    <!-- Phụ: "Còn X lượt" theo tone trạng thái; tokens nhạt hơn -->
                    <div class="mt-1 text-xs leading-4" :class="QUOTA_HINT_TONE[row.state]">
                        {{ row.hint }}<template
                            v-if="isAiQuota(row.key) && row.tokens > 0"
                        ><span class="text-slate-400"> · {{ row.tokens.toLocaleString('vi-VN') }} tokens</span></template>
                    </div>
                </div>
            </div>
        </section>

        <!-- ============ SECTION 3: Lịch sử (2 tab trong 1 card) ============ -->
        <section class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 border-b border-slate-200">
                <div class="flex gap-6" role="tablist">
                    <button
                        role="tab"
                        :aria-selected="activeTab === 'subs'"
                        class="py-4 -mb-px text-sm font-medium border-b-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-t"
                        :class="activeTab === 'subs' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'"
                        @click="activeTab = 'subs'"
                    >
                        Lịch sử gói
                        <span v-if="subsTotal > 0" class="ml-1 text-xs text-slate-400">{{ subsTotal }}</span>
                    </button>
                    <button
                        role="tab"
                        :aria-selected="activeTab === 'pays'"
                        class="py-4 -mb-px text-sm font-medium border-b-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-t"
                        :class="activeTab === 'pays' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'"
                        @click="activeTab = 'pays'"
                    >
                        Thanh toán
                        <span v-if="payTotal > 0" class="ml-1 text-xs text-slate-400">{{ payTotal }}</span>
                    </button>
                </div>

            </div>

            <!-- ===== Tab: Lịch sử gói ===== -->
            <template v-if="activeTab === 'subs'">
                <div v-if="subsLoading" class="divide-y divide-slate-100 animate-pulse">
                    <div v-for="i in 3" :key="i" class="flex items-center gap-4 px-5 sm:px-6 py-4">
                        <div class="w-10 h-10 rounded-xl bg-slate-100"></div>
                        <div class="flex-1 space-y-2"><div class="h-4 w-32 rounded bg-slate-100"></div><div class="h-3 w-48 rounded bg-slate-100"></div></div>
                    </div>
                </div>

                <div v-else-if="subsError" class="flex items-center justify-between gap-3 px-5 sm:px-6 py-6 text-sm text-red-600">
                    {{ subsError }}
                    <button class="font-medium text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" @click="loadSubs(subsPage)">Thử lại</button>
                </div>

                <div v-else-if="subs.length === 0" class="text-center py-12 text-slate-500">
                    <Receipt class="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p class="text-sm">Chưa có gói nào.</p>
                    <router-link to="/candidate/pricing" class="inline-block mt-3 text-sm font-medium text-blue-600 hover:text-blue-700">Xem các gói</router-link>
                </div>

                <!-- Desktop (sm+): bảng có cột Trạng thái riêng -->
                <div v-else class="hidden sm:block overflow-x-auto">
                    <table class="w-full min-w-[880px] table-fixed text-left text-sm">
                        <thead class="whitespace-nowrap">
                            <tr class="text-left text-slate-500 border-b border-slate-200 bg-slate-50/50 text-xs uppercase tracking-wide font-semibold">
                                <th class="w-[32%] py-2.5 pl-5 sm:pl-6 pr-4">Gói dịch vụ</th>
                                <th class="w-[18%] py-2.5 px-4">Trạng thái</th>
                                <th class="w-[14%] py-2.5 px-4">Bắt đầu</th>
                                <th class="w-[14%] py-2.5 px-4">Hết hạn</th>
                                <th class="w-[22%] py-2.5 pl-4 pr-5 sm:pr-6">Tokens</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            <tr v-for="s in subs" :key="s.id" class="hover:bg-slate-50/70 transition">
                                <td class="py-3.5 pl-5 sm:pl-6 pr-4">
                                    <div class="flex items-center gap-3">
                                        <span class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" :class="TONE_BOX[subTone[s.status] ?? 'slate']">
                                            <Package class="w-4 h-4" />
                                        </span>
                                        <div class="min-w-0">
                                            <div class="font-medium text-slate-900">Gói {{ displayPlanName(s.planCode, s.planName) }}</div>
                                            <div class="text-xs text-slate-500 mt-0.5">{{ formatPrice(s.priceVnd) }} · {{ s.planDurationDays }} ngày</div>
                                        </div>
                                    </div>
                                </td>
                                <td class="py-3.5 px-4">
                                    <span :class="['inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium ring-1 whitespace-nowrap', subStatusBadge[s.status]?.cls ?? 'bg-slate-100 text-slate-600 ring-slate-200']">
                                        {{ subStatusBadge[s.status]?.label ?? s.status }}
                                    </span>
                                </td>
                                <td class="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap">{{ formatDate(s.startedAt) }}</td>
                                <td class="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap">{{ formatDate(s.expiresAt) }}</td>
                                <td class="py-3.5 pl-4 pr-5 sm:pr-6">
                                    <span class="inline-flex items-center gap-1 text-xs font-medium text-slate-700 whitespace-nowrap">
                                        <Sparkles class="w-3 h-3 text-violet-500" aria-hidden="true" />
                                        {{ s.totalTokens.toLocaleString('vi-VN') }}
                                    </span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Mobile (<sm): thẻ dòng gọn -->
                <ul v-if="!subsLoading && !subsError && subs.length > 0" class="divide-y divide-slate-100 sm:hidden">
                    <li v-for="s in subs" :key="s.id" class="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 transition">
                        <span class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" :class="TONE_BOX[subTone[s.status] ?? 'slate']">
                            <Package class="w-5 h-5" />
                        </span>
                        <div class="flex-1 min-w-0">
                            <div class="font-medium text-slate-900">
                                Gói {{ displayPlanName(s.planCode, s.planName) }}
                                <span class="text-sm font-normal text-slate-500">· {{ formatPrice(s.priceVnd) }}</span>
                            </div>
                            <div class="text-xs text-slate-500 mt-0.5">
                                {{ formatDate(s.startedAt) }} → {{ formatDate(s.expiresAt) }}
                                <span class="hidden sm:inline">· {{ s.planDurationDays }} ngày</span>
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            <span :class="['inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium ring-1', subStatusBadge[s.status]?.cls ?? 'bg-slate-100 text-slate-600 ring-slate-200']">
                                {{ subStatusBadge[s.status]?.label ?? s.status }}
                            </span>
                            <div class="text-xs text-slate-500 mt-1 flex items-center justify-end gap-1">
                                <Sparkles class="w-3 h-3 text-violet-500" />
                                {{ s.totalTokens.toLocaleString('vi-VN') }} tokens
                            </div>
                        </div>
                    </li>
                </ul>
            </template>

            <!-- ===== Tab: Thanh toán ===== -->
            <template v-else>
                <div v-if="paysLoading" class="divide-y divide-slate-100 animate-pulse">
                    <div v-for="i in 3" :key="i" class="flex items-center gap-4 px-5 sm:px-6 py-4">
                        <div class="w-10 h-10 rounded-xl bg-slate-100"></div>
                        <div class="flex-1 space-y-2"><div class="h-4 w-32 rounded bg-slate-100"></div><div class="h-3 w-48 rounded bg-slate-100"></div></div>
                    </div>
                </div>

                <div v-else-if="paysError" class="flex items-center justify-between gap-3 px-5 sm:px-6 py-6 text-sm text-red-600">
                    {{ paysError }}
                    <button class="font-medium text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" @click="loadPayments(payPage)">Thử lại</button>
                </div>

                <div v-else-if="payments.length === 0" class="text-center py-12 text-slate-500">
                    <Receipt class="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p class="text-sm">Chưa có giao dịch nào.</p>
                </div>

                <!-- Desktop (sm+): bảng có cột Trạng thái riêng, bấm hàng = mở chi tiết -->
                <div v-else class="hidden sm:block overflow-x-auto">
                    <table class="w-full min-w-[880px] table-fixed text-left text-sm">
                        <thead class="whitespace-nowrap">
                            <tr class="text-left text-slate-500 border-b border-slate-200 bg-slate-50/50 text-xs uppercase tracking-wide font-semibold">
                                <th class="w-[32%] py-2.5 pl-5 sm:pl-6 pr-4">Giao dịch</th>
                                <th class="w-[18%] py-2.5 px-4">Trạng thái</th>
                                <th class="w-[28%] py-2.5 px-4">Thời gian</th>
                                <th class="w-[22%] py-2.5 pl-4 pr-5 sm:pr-6">Số tiền</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            <tr
                                v-for="p in payments"
                                :key="p.id"
                                class="hover:bg-slate-50/70 transition cursor-pointer focus-visible:outline-none focus-visible:bg-slate-50"
                                role="button"
                                tabindex="0"
                                @click="openPaymentDetail(p.id)"
                                @keydown.enter="openPaymentDetail(p.id)"
                                @keydown.space.prevent="openPaymentDetail(p.id)"
                            >
                                <td class="py-3.5 pl-5 sm:pl-6 pr-4">
                                    <div class="flex items-center gap-3">
                                        <span class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" :class="TONE_BOX[payTone[p.status] ?? 'slate']">
                                            <component :is="payIcon[p.status] ?? Clock" class="w-4 h-4" />
                                        </span>
                                        <div class="min-w-0">
                                            <div class="font-medium text-slate-900">
                                                {{ displayPlanName(p.planCode ?? undefined, p.planName ?? undefined) || 'Thanh toán' }}
                                                <span v-if="p.planDurationDays" class="text-xs font-normal text-slate-500">· {{ p.planDurationDays }} ngày</span>
                                            </div>
                                            <div class="text-xs text-slate-500 mt-0.5 font-mono">#{{ p.orderCode }}</div>
                                        </div>
                                    </div>
                                </td>
                                <td class="py-3.5 px-4">
                                    <span :class="['inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium ring-1 whitespace-nowrap', payStatusBadge[p.status]?.cls ?? 'bg-slate-100 text-slate-600 ring-slate-200']">
                                        {{ payStatusBadge[p.status]?.label ?? p.status }}
                                    </span>
                                </td>
                                <td class="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                                    <div>{{ formatDateTime(p.createdAt) }}</div>
                                    <div v-if="p.updatedAt" class="text-[11px] text-slate-400 mt-0.5">Cập nhật {{ formatDateTime(p.updatedAt) }}</div>
                                </td>
                                <td class="py-3.5 pl-4 pr-5 sm:pr-6 font-semibold text-slate-900 whitespace-nowrap">
                                    {{ formatPrice(p.amountVnd) }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Mobile (<sm): thẻ dòng gọn, bấm = mở chi tiết -->
                <ul v-if="!paysLoading && !paysError && payments.length > 0" class="divide-y divide-slate-100 sm:hidden">
                    <li v-for="p in payments" :key="p.id">
                        <button
                            type="button"
                            class="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-50/70 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                            @click="openPaymentDetail(p.id)"
                        >
                            <span class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" :class="TONE_BOX[payTone[p.status] ?? 'slate']">
                                <component :is="payIcon[p.status] ?? Clock" class="w-5 h-5" />
                            </span>
                            <div class="flex-1 min-w-0">
                                <div class="font-medium text-slate-900 truncate">
                                    {{ displayPlanName(p.planCode ?? undefined, p.planName ?? undefined) || 'Thanh toán' }}
                                    <span v-if="p.planDurationDays" class="text-sm font-normal text-slate-500">· {{ p.planDurationDays }} ngày</span>
                                </div>
                                <div class="text-xs text-slate-500 mt-0.5 truncate">
                                    {{ formatDateTime(p.createdAt) }} · <span class="font-mono">#{{ p.orderCode }}</span>
                                </div>
                            </div>
                            <div class="text-right shrink-0">
                                <div class="font-semibold text-slate-900">{{ formatPrice(p.amountVnd) }}</div>
                                <span :class="['inline-flex items-center px-2.5 py-0.5 mt-1 rounded-md text-xs font-medium ring-1', payStatusBadge[p.status]?.cls ?? 'bg-slate-100 text-slate-600 ring-slate-200']">
                                    {{ payStatusBadge[p.status]?.label ?? p.status }}
                                </span>
                            </div>
                            <ChevronRight class="w-4 h-4 text-slate-300 shrink-0 hidden sm:block" />
                        </button>
                    </li>
                </ul>
            </template>

            <!-- Pagination dùng chung cho cả 2 tab: nút số trang + khoảng đang xem -->
            <div
                v-if="pager.totalPages > 1"
                class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 sm:px-6 py-3 border-t border-slate-200 text-sm"
            >
                <span class="text-xs sm:text-sm text-slate-500">{{ pagerRange }}</span>
                <div class="flex items-center gap-1" role="navigation" aria-label="Phân trang">
                    <button
                        aria-label="Trang trước"
                        :disabled="pager.page <= 1"
                        class="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        @click="pager.go(pager.page - 1)"
                    >
                        <ChevronLeft class="w-4 h-4" />
                    </button>
                    <template v-for="(p, i) in pagerPages" :key="`${p}-${i}`">
                        <span v-if="p === '…'" class="px-1 text-slate-400 select-none" aria-hidden="true">…</span>
                        <button
                            v-else
                            type="button"
                            class="min-w-[2rem] h-8 px-1 rounded-lg border text-sm font-medium tabular-nums transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            :class="
                                p === pager.page
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                            "
                            :aria-current="p === pager.page ? 'page' : undefined"
                            @click="pager.go(p)"
                        >
                            {{ p }}
                        </button>
                    </template>
                    <button
                        aria-label="Trang sau"
                        :disabled="pager.page >= pager.totalPages"
                        class="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        @click="pager.go(pager.page + 1)"
                    >
                        <ChevronRight class="w-4 h-4" />
                    </button>
                </div>
            </div>
        </section>

        <!-- ===== Chi tiết giao dịch — PaymentDetailModal thật (fetch + QR + huỷ đơn) ===== -->
        <PaymentDetailModal
            :open="detailOpen"
            :payment-id="detailPaymentId"
            @close="closePaymentDetail"
            @cancelled="onPaymentCancelled"
        />
    </div>
</template>
