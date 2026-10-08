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
 * - Bố cục: header + grid 2 cột. Trái: Lịch sử & thanh toán. Phải: gói hiện
 *   tại (panel blue/amber) + lượt sử dụng. Hai khu vực hiển thị đồng thời.
 * - Phong cách fintech/SaaS: nền slate-50, card trắng rounded-lg border
 *   slate-200 shadow-sm, blue-600 làm nhấn (nút, thanh, link, nút phân trang).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
    AlertCircle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Clock,
    FileText,
    History,
    Info,
    Loader2,
    Package,
    Receipt,
    Send,
    Sparkles,
    Target,
    XCircle,
} from 'lucide-vue-next';
import { planApi } from '@services/plan.api';
import { paymentApi } from '@services/payment.api';
import { subscriptionApi } from '@services/subscription.api';
import PaymentDetailModal from '@components/payment/PaymentDetailModal.vue';
import { extractErrorMessage } from '@services/http';
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
        usageError.value = extractErrorMessage(err, 'Không thể tải thông tin gói');
    } finally {
        usageLoading.value = false;
    }
}

// Sắp hết hạn: còn 1–3 ngày. Còn 0 = "hết hạn hôm nay" → tone xanh bình thường.
const isExpiringSoon = computed(() => {
    const d = usage.value?.remainingDays;
    return d !== null && d !== undefined && d > 0 && d <= 3;
});

/**
 * Phần trăm thời gian gói CÒN LẠI (remaining/total) — thanh trong panel gói
 * hiển thị phần remaining để khớp với con số "ngày còn lại": mới mua = bar đầy,
 * càng dùng = bar càng vơi.
 *
 * Tính an toàn với null / durationDays = 0 (không ra NaN).
 */
const remainingPercent = computed(() => {
    const total = usage.value?.plan?.durationDays;
    const left = usage.value?.remainingDays;
    if (!total || total <= 0) return 0;
    if (left === null || left === undefined) return 0;
    const ratio = left / total;
    return Math.min(100, Math.max(0, Math.round(ratio * 100)));
});

const usedDays = computed(() => {
    const total = usage.value?.plan?.durationDays ?? 0;
    const left = usage.value?.remainingDays ?? 0;
    return Math.max(0, total - left);
});

// Count-up "ngày còn lại" 0 → giá trị thật trong 500ms khi usage về (khớp
// dải duration 150–500ms của CSS motion trên trang). Giá trị
// hiển thị cuối giống hệt usage.remainingDays ?? 0; aria (progressbar) vẫn
// dùng giá trị thật để screen reader không đọc số đang chạy.
const shownDays = ref(0);
let daysRafId = 0;

function animateDays(target: number) {
    cancelAnimationFrame(daysRafId);
    if (target <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        shownDays.value = target;
        return;
    }
    const start = performance.now();
    const step = (now: number) => {
        const t = Math.min(1, (now - start) / 500);
        shownDays.value = Math.round(target * (1 - Math.pow(1 - t, 3)));
        if (t < 1) daysRafId = requestAnimationFrame(step);
    };
    daysRafId = requestAnimationFrame(step);
}

watch(() => usage.value?.remainingDays, (d) => animateDays(d ?? 0), { immediate: true });

onBeforeUnmount(() => cancelAnimationFrame(daysRafId));

/**
 * Tên gói hiển thị — trim và bỏ tiền tố "Gói " nếu có. Sau đó nếu không
 * chứa "Plan" thì prepend "Gói " để có "Gói Premium" — tránh "Gói Premium Plan"
 * nhưng vẫn thêm tiền tố khi thiếu.
 */
function displayPlanName(name: string | null | undefined): string {
    let n = (name ?? '').trim();
    if (!n) return '';
    if (n.toLowerCase().startsWith('gói ')) n = n.slice(4);
    return /plan/i.test(n) ? n : `Gói ${n}`;
}

/** Map quota key → label tiếng Việt — đồng bộ với backend CountableQuotaKey. */
const quotaLabel: Record<CountableQuotaKey, string> = {
    ai_cv_match: 'AI match hồ sơ',
    job_post: 'Lượt tạo việc làm',
    ai_cv_parsed: 'Phân tích CV',
    ai_cv_analysis: 'Chấm điểm CV bằng AI',
    job_generation: 'Lượt tạo mô tả việc làm (AI)',
};

/** Icon cho từng quota key — semantic để dễ scan. */
const quotaIcon: Record<CountableQuotaKey, typeof Send> = {
    ai_cv_match: Target,
    ai_cv_parsed: FileText,
    ai_cv_analysis: Sparkles,
    job_post: Package,
    job_generation: Sparkles,
};

/** Candidate view chỉ show 3 quota relevant tới ứng viên. */
const CANDIDATE_QUOTA_KEYS: CountableQuotaKey[] = [
    'ai_cv_match',
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
    key === 'ai_cv_match' || key === 'ai_cv_parsed' || key === 'ai_cv_analysis' || key === 'job_generation';

function quotaPercent(item: { used: number; limit: number; unlimited: boolean }): number {
    if (item.unlimited) return 0;
    if (item.limit <= 0) return 100;
    return Math.min(100, Math.round((item.used / item.limit) * 100));
}

type QuotaItem = { used: number; limit: number; unlimited: boolean };

function quotaState(q: QuotaItem): 'ok' | 'warn' | 'full' {
    if (q.unlimited) return 'ok';
    const p = quotaPercent(q);
    return p >= 100 ? 'full' : p >= 80 ? 'warn' : 'ok';
}

/** Màu thanh tiến độ quota theo state. */
const QUOTA_BAR = {
    ok: 'bg-blue-600',
    warn: 'bg-amber-500',
    full: 'bg-red-500',
} as const;

interface QuotaRow {
    key: CountableQuotaKey;
    label: string;
    icon: typeof Send;
    used: number;
    limit: number;
    unlimited: boolean;
    state: 'ok' | 'warn' | 'full';
    percent: number;
    tokens: number;
    leftLabel: string;
    leftClass: string;
}

const quotaRows = computed<QuotaRow[]>(() =>
    visibleUsage.value.map((q) => {
        const state = quotaState(q);
        const left = q.unlimited ? Infinity : Math.max(0, q.limit - q.used);
        let leftLabel: string;
        let leftClass: string;
        if (q.unlimited) {
            leftLabel = 'Không giới hạn';
            leftClass = 'text-slate-900';
        } else if (state === 'full') {
            leftLabel = 'Hết lượt';
            leftClass = 'text-red-600';
        } else if (state === 'warn') {
            leftLabel = `${left} lượt còn lại`;
            leftClass = 'text-amber-600';
        } else {
            leftLabel = `${left} lượt còn lại`;
            leftClass = 'text-slate-900';
        }
        return {
            key: q.key,
            label: quotaLabel[q.key] ?? q.key,
            icon: quotaIcon[q.key],
            used: q.used,
            limit: q.limit,
            unlimited: q.unlimited,
            state,
            percent: quotaPercent(q),
            tokens: q.tokens,
            leftLabel,
            leftClass,
        };
    }),
);

// ---------- Tabs lịch sử (sub-tab bên trái) ----------
// Mặc định mở 'pays' vì đây là tab hành động nhiều hơn (đơn đang chờ, QR).
const activeTab = ref<'subs' | 'pays'>('pays');

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

/** "1–8 trên 48 giao dịch" — nhãn theo tab đang mở. */
const pagerRange = computed(() => {
    const { page, totalItems } = pager.value;
    if (totalItems === 0) return '';
    const pageSize = activeTab.value === 'subs' ? SUBS_PAGE_SIZE : PAY_PAGE_SIZE;
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, totalItems);
    const noun = activeTab.value === 'subs' ? 'gói' : 'giao dịch';
    return `${from}–${to} trên ${totalItems} ${noun}`;
});

// ---------- Tone trạng thái ----------
type Tone = 'green' | 'red' | 'blue' | 'amber' | 'slate' | 'purple';

/** Tone cho ô icon trạng thái (nền nhạt + icon cùng tông). */
const TONE_BOX: Record<Tone, string> = {
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-500',
    purple: 'bg-purple-50 text-purple-600',
};

const subTone: Record<SubscriptionStatus, Tone> = {
    active: 'green', cancelled: 'slate', expired: 'amber', pending: 'blue',
};
const payTone: Record<PaymentStatus, Tone> = {
    paid: 'green', pending: 'blue', failed: 'red', cancelled: 'slate', refunded: 'purple', expired: 'amber',
};

/** Icon trạng thái thanh toán. */
const payIcon: Record<PaymentStatus, typeof Clock> = {
    paid: CheckCircle2, pending: Clock, failed: XCircle, cancelled: XCircle, refunded: History, expired: Clock,
};

/** Badge trạng thái kiểu banking: nền nhạt + viền cùng tông, bo góc nhỏ. */
interface Pill { cls: string; dot: string; label: string }
const subPill: Record<SubscriptionStatus, Pill> = {
    active: { cls: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500', label: 'Đang dùng' },
    cancelled: { cls: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400', label: 'Đã huỷ' },
    expired: { cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', label: 'Hết hạn' },
    pending: { cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500', label: 'Chờ kích hoạt' },
};
const payPill: Record<PaymentStatus, Pill> = {
    paid: { cls: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500', label: 'Thành công' },
    pending: { cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500', label: 'Đang xử lý' },
    failed: { cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', label: 'Thất bại' },
    cancelled: { cls: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400', label: 'Đã huỷ' },
    refunded: { cls: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-500', label: 'Đã hoàn tiền' },
    expired: { cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', label: 'Hết hạn' },
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
        subsError.value = extractErrorMessage(err, 'Không thể tải lịch sử gói');
    } finally {
        subsLoading.value = false;
    }
}

function goToSubsPage(p: number) {
    const target = Math.min(Math.max(1, p), Math.max(1, subsTotalPages.value));
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
        paysError.value = extractErrorMessage(err, 'Không thể tải lịch sử thanh toán');
    } finally {
        paysLoading.value = false;
    }
}

function goToPayPage(p: number) {
    const target = Math.min(Math.max(1, p), Math.max(1, payTotalPages.value));
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

function formatTime(iso: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
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

/**
 * Cờ đang tải trang MỚI trong khi đã có data trang hiện tại — dùng để áp
 * opacity mờ cho `<tbody>`/`<ul>` thay vì thay toàn bộ table bằng skeleton.
 */
const isSubsPaging = computed(() => subsLoading.value && subs.value.length > 0);
const isPaysPaging = computed(() => paysLoading.value && payments.value.length > 0);

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
 * trang hiện tại của danh sách để pill + updatedAt cập nhật theo status mới.
 */
async function onPaymentCancelled(_paymentId: string) {
    await loadPayments(payPage.value);
}

/**
 * Được gọi từ PaymentDetailModal khi đơn TỰ ĐỔI trạng thái qua socket realtime
 * (paid/failed sau khi user quét QR ở tab khác) — refresh danh sách + panel gói
 * để row/pill/usage không hiển thị stale sau khi user đóng modal.
 */
async function onPaymentStatusChanged(_paymentId: string) {
    // Paid tạo subscription mới (BE trả subscriptionId) → loadSubs để tab
    // "Lịch sử gói" + badge subsTotal không stale.
    await Promise.all([loadPayments(payPage.value), loadUsage(), loadSubs(subsPage.value)]);
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
    <!-- KHÔNG đặt overflow-x-hidden ở root: biến div này thành scroll container
        và vô hiệu xl:sticky của cột phải (card con đã có overflow-hidden riêng). -->
    <div class="max-w-6xl mx-auto px-4 py-5 space-y-6 bg-slate-50 min-h-screen">
        <!-- ============ HEADER ============ -->
        <!-- Header flat trên nền trang, KHÔNG card nền (user chối card nền/hero
            gradient) — kiểu banking: chỉ chip viền + title + mô tả. -->
        <header class="mb-6 bm-rise">
            <h1 class="text-xl font-semibold tracking-tight text-slate-900">
                Gói dịch vụ &amp; thanh toán
            </h1>
            <p class="mt-1 text-sm text-slate-500">
                Quản lý gói dịch vụ, lượt sử dụng và lịch sử thanh toán.
            </p>
        </header>

        <!-- ============ LAYOUT 2 CỘT (tỷ lệ 1.55:1 ≈ 62/38) ============ -->
        <!-- Mobile (<lg): stack 1 cột, đảo order để cột phải (Gói & tính năng)
            hiển thị trước. Cột phải có lg:sticky lg:top-6 để card không bị lệch
            khi bảng bên trái dài. -->
        <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">

            <!-- ============ CỘT TRÁI: Lịch sử & thanh toán ============ -->
            <!-- order-2 lg:order-1: mobile để cột phải lên trước. -->
            <section class="order-2 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:order-1 bm-rise bm-delay-1">

                <!-- Header card — tiêu đề trái + segmented tabs phải CÙNG HÀNG -->
                <div class="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 pt-4 sm:pt-5 pb-3">
                    <h2 class="text-base font-semibold text-slate-900">
                        Lịch sử &amp; thanh toán
                    </h2>
                    <div
                        class="inline-flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5"
                        role="tablist"
                    >
                        <button
                            role="tab"
                            :aria-selected="activeTab === 'pays'"
                            class="px-3 py-1.5 rounded-md text-sm font-medium transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-[0.97]"
                            :class="activeTab === 'pays' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
                            @click="activeTab = 'pays'"
                        >
                            Thanh toán
                            <span v-if="payTotal > 0" class="ml-1 text-xs text-slate-500">{{ payTotal }}</span>
                        </button>
                        <button
                            role="tab"
                            :aria-selected="activeTab === 'subs'"
                            class="px-3 py-1.5 rounded-md text-sm font-medium transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-[0.97]"
                            :class="activeTab === 'subs' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
                            @click="activeTab = 'subs'"
                        >
                            Lịch sử gói
                            <span v-if="subsTotal > 0" class="ml-1 text-xs text-slate-500">{{ subsTotal }}</span>
                        </button>
                    </div>
                </div>

                <!-- ===== Tab: Thanh toán ===== -->
                <!-- Bảng desktop và UL mobile LUÔN được render — chỉ nội dung
                <tbody>/<ul> thay đổi theo state. Khi đang chuyển trang
                (loading && có data), tbody/ul được opacity-60. -->
                <template v-if="activeTab === 'pays'">
                    <!-- Desktop (sm+): table ổn định, chỉ tbody swap nội dung -->
                    <div class="hidden sm:block overflow-hidden bm-panel">
                        <table class="w-full table-fixed text-left text-sm">
                            <thead class="whitespace-nowrap">
                                <tr class="text-left text-slate-500 border-b border-slate-100 bg-slate-50/60 text-xs font-medium">
                                    <th class="w-[38%] py-3 pl-5 sm:pl-6 pr-3">Giao dịch</th>
                                    <th class="w-[20%] py-3 px-3">Trạng thái</th>
                                    <th class="w-[24%] py-3 px-3 hidden xl:table-cell">Thời gian</th>
                                    <th class="w-[18%] py-3 pl-3 pr-5 sm:pr-6 text-right">Số tiền</th>
                                </tr>
                            </thead>
                            <tbody
                                class="divide-y divide-slate-100 transition-opacity duration-150"
                                :class="{ 'opacity-60': isPaysPaging }"
                            >
                                <!-- Lần đầu load — skeleton rows -->
                                <template v-if="paysLoading && payments.length === 0">
                                    <tr v-for="i in PAY_PAGE_SIZE" :key="`skel-${i}`">
                                        <td colspan="4" class="py-3 px-5">
                                            <div class="animate-pulse flex items-center gap-3">
                                                <div class="w-9 h-9 rounded-lg bg-slate-100 shrink-0"></div>
                                                <div class="flex-1 space-y-2">
                                                    <div class="h-3.5 w-32 rounded bg-slate-100"></div>
                                                    <div class="h-3 w-48 rounded bg-slate-100"></div>
                                                </div>
                                                <div class="hidden md:flex items-center gap-3">
                                                    <div class="h-3 w-20 rounded bg-slate-100"></div>
                                                    <div class="h-3 w-24 rounded bg-slate-100"></div>
                                                    <div class="h-3 w-16 rounded bg-slate-100"></div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </template>

                                <!-- Error -->
                                <!-- Guard: đang có data (fail khi chuyển trang) thì giữ list, không thay bằng dòng lỗi -->
                                <tr v-else-if="paysError && payments.length === 0" class="hover:bg-transparent">
                                    <td colspan="4" class="px-5 sm:px-6 py-6">
                                        <div class="flex items-center justify-center gap-3 text-sm text-red-600">
                                            <span>{{ paysError }}</span>
                                            <button
                                                class="font-medium text-slate-700 px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-[0.97]"
                                                @click="loadPayments(payPage)"
                                            >
                                                Thử lại
                                            </button>
                                        </div>
                                    </td>
                                </tr>

                                <!-- Empty -->
                                <tr v-else-if="payments.length === 0" class="hover:bg-transparent">
                                    <td colspan="4" class="text-center py-12 px-5 bm-row">
                                        <Receipt class="w-10 h-10 mx-auto mb-3 text-slate-300" aria-hidden="true" />
                                        <p class="text-sm font-medium text-slate-700">Bạn chưa có giao dịch nào</p>
                                        <p class="mt-1 text-xs text-slate-500">Mua gói để mở khóa lượt AI và tính năng premium.</p>
                                        <router-link
                                            to="/candidate/pricing"
                                            class="mt-4 inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 motion-safe:active:scale-[0.97]"
                                        >
                                            Xem các gói
                                        </router-link>
                                    </td>
                                </tr>

                                <!-- Data rows — giữ nguyên khi đang tải trang khác (opacity-60) -->
                                <template v-else>
                                    <tr
                                        v-for="(p, i) in payments"
                                        :key="p.id"
                                        class="hover:bg-slate-50 transition duration-150 cursor-pointer focus-visible:outline-none focus-visible:bg-slate-50 border-l-2 border-transparent group bm-row"
                                        :style="{ animationDelay: `${i * 40}ms` }"
                                        role="button"
                                        tabindex="0"
                                        :aria-label="`Xem chi tiết giao dịch ${p.orderCode}`"
                                        @click="openPaymentDetail(p.id)"
                                        @keydown.enter="openPaymentDetail(p.id)"
                                        @keydown.space.prevent="openPaymentDetail(p.id)"
                                    >
                                        <td class="py-3 pl-5 sm:pl-6 pr-3 align-middle">
                                            <div class="flex items-center gap-3 min-w-0 transition-transform duration-150 motion-safe:group-hover:translate-x-0.5">
                                                <span
                                                    class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                                                    :class="TONE_BOX[payTone[p.status] ?? 'slate']"
                                                    aria-hidden="true"
                                                >
                                                    <component :is="payIcon[p.status] ?? Clock" class="w-4 h-4" />
                                                </span>
                                                <div class="min-w-0">
                                                    <div class="font-medium text-slate-900 truncate">
                                                        {{ displayPlanName(p.planName) || 'Thanh toán' }}
                                                        <span v-if="p.planDurationDays" class="font-normal text-slate-500"> · {{ p.planDurationDays }} ngày</span>
                                                    </div>
                                                    <div class="text-xs text-slate-500 mt-0.5 tabular-nums">#{{ p.orderCode }} · {{ formatTime(p.createdAt) }} {{ formatDate(p.createdAt) }}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td class="py-3 px-3 align-middle">
                                            <span
                                                class="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium whitespace-nowrap"
                                                :class="payPill[p.status]?.cls ?? 'bg-slate-100 text-slate-700 border-slate-200'"
                                                :title="p.status === 'pending' ? 'Đang chờ xác nhận từ cổng thanh toán' : undefined"
                                            >
                                                {{ payPill[p.status]?.label ?? p.status }}
                                            </span>
                                        </td>
                                        <td class="py-3 px-3 align-middle hidden xl:table-cell">
                                            <div class="text-sm text-slate-800" :title="p.updatedAt ? `Cập nhật ${formatDateTime(p.updatedAt)}` : undefined">
                                                {{ formatDate(p.createdAt) }}
                                            </div>
                                            <div class="text-xs text-slate-500 mt-0.5">{{ formatTime(p.createdAt) }}</div>
                                        </td>
                                        <td class="py-3 pl-3 pr-5 sm:pr-6 font-semibold text-slate-900 whitespace-nowrap text-right tabular-nums align-middle">
                                            {{ formatPrice(p.amountVnd) }}
                                        </td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>

                    <!-- Mobile (<sm): UL luôn render, chỉ swap nội dung -->
                    <ul
                        class="divide-y divide-slate-100 sm:hidden transition-opacity duration-150 bm-panel"
                        :class="{ 'opacity-60': isPaysPaging }"
                    >
                        <!-- Lần đầu load — skeleton items -->
                        <template v-if="paysLoading && payments.length === 0">
                            <li v-for="i in PAY_PAGE_SIZE" :key="`skel-${i}`" class="flex items-center gap-3 px-5 py-3 animate-pulse">
                                <div class="w-9 h-9 rounded-lg bg-slate-100 shrink-0"></div>
                                <div class="flex-1 space-y-2">
                                    <div class="h-3.5 w-32 rounded bg-slate-100"></div>
                                    <div class="h-3 w-48 rounded bg-slate-100"></div>
                                </div>
                            </li>
                        </template>

                        <!-- Error -->
                        <li v-else-if="paysError && payments.length === 0" class="flex items-center justify-between gap-3 px-5 py-6 text-sm text-red-600">
                            <span>{{ paysError }}</span>
                            <button
                                class="font-medium text-slate-700 px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-[0.97]"
                                @click="loadPayments(payPage)"
                            >
                                Thử lại
                            </button>
                        </li>

                        <!-- Empty -->
                        <li v-else-if="payments.length === 0" class="text-center py-12 px-5 bm-row-m">
                            <Receipt class="w-10 h-10 mx-auto mb-3 text-slate-300" aria-hidden="true" />
                            <p class="text-sm font-medium text-slate-700">Bạn chưa có giao dịch nào</p>
                            <p class="mt-1 text-xs text-slate-500">Mua gói để mở khóa lượt AI và tính năng premium.</p>
                            <router-link
                                to="/candidate/pricing"
                                class="mt-4 inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                            >
                                Xem các gói
                            </router-link>
                        </li>

                        <!-- Data rows -->
                        <template v-else>
                            <li v-for="(p, i) in payments" :key="p.id" class="bm-row-m" :style="{ animationDelay: `${i * 40}ms` }">
                                <button
                                    type="button"
                                    class="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 transition duration-150 border-l-2 border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 group"
                                    :aria-label="`Xem chi tiết giao dịch ${p.orderCode}`"
                                    @click="openPaymentDetail(p.id)"
                                >
                                    <span
                                        class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                                        :class="TONE_BOX[payTone[p.status] ?? 'slate']"
                                        aria-hidden="true"
                                    >
                                        <component :is="payIcon[p.status] ?? Clock" class="w-4 h-4" />
                                    </span>
                                    <div class="flex-1 min-w-0">
                                        <div class="font-medium text-slate-900 truncate">
                                            {{ displayPlanName(p.planName) || 'Thanh toán' }}
                                            <span v-if="p.planDurationDays" class="font-normal text-slate-500"> · {{ p.planDurationDays }} ngày</span>
                                        </div>
                                        <div class="text-xs text-slate-500 mt-0.5 tabular-nums">#{{ p.orderCode }} · {{ formatDate(p.createdAt) }}</div>
                                        <div class="mt-1">
                                            <span
                                                class="inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium"
                                                :class="payPill[p.status]?.cls ?? 'bg-slate-100 text-slate-700 border-slate-200'"
                                            >
                                                {{ payPill[p.status]?.label ?? p.status }}
                                            </span>
                                        </div>
                                    </div>
                                    <div class="text-right shrink-0">
                                        <div class="font-semibold text-slate-900 tabular-nums">{{ formatPrice(p.amountVnd) }}</div>
                                    </div>
                                    <ChevronRight class="w-4 h-4 text-slate-300 shrink-0 transition duration-150 motion-safe:group-hover:translate-x-0.5 group-hover:text-slate-400" aria-hidden="true" />
                                </button>
                            </li>
                        </template>
                    </ul>
                </template>

                <!-- ===== Tab: Lịch sử gói ===== -->
                <template v-else>
                    <!-- Desktop (sm+): table ổn định -->
                    <div class="hidden sm:block overflow-hidden bm-panel">
                        <table class="w-full table-fixed text-left text-sm">
                            <thead class="whitespace-nowrap">
                                <tr class="text-left text-slate-500 border-b border-slate-100 bg-slate-50/60 text-xs font-medium">
                                    <th class="w-[36%] py-3 pl-5 sm:pl-6 pr-3">Gói dịch vụ</th>
                                    <th class="w-[20%] py-3 px-3">Trạng thái</th>
                                    <th class="w-[28%] py-3 px-3">Thời hạn</th>
                                    <th class="w-[16%] py-3 pl-3 pr-5 sm:pr-6 text-right">Tokens</th>
                                </tr>
                            </thead>
                            <tbody
                                class="divide-y divide-slate-100 transition-opacity duration-150"
                                :class="{ 'opacity-60': isSubsPaging }"
                            >
                                <!-- Lần đầu load — skeleton -->
                                <template v-if="subsLoading && subs.length === 0">
                                    <tr v-for="i in SUBS_PAGE_SIZE" :key="`skel-${i}`">
                                        <td colspan="4" class="py-3 px-5">
                                            <div class="animate-pulse flex items-center gap-3">
                                                <div class="w-9 h-9 rounded-lg bg-slate-100 shrink-0"></div>
                                                <div class="flex-1 space-y-2">
                                                    <div class="h-3.5 w-32 rounded bg-slate-100"></div>
                                                    <div class="h-3 w-48 rounded bg-slate-100"></div>
                                                </div>
                                                <div class="hidden md:flex items-center gap-3">
                                                    <div class="h-3 w-20 rounded bg-slate-100"></div>
                                                    <div class="h-3 w-16 rounded bg-slate-100"></div>
                                                    <div class="h-3 w-12 rounded bg-slate-100"></div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </template>

                                <!-- Error -->
                                <!-- Guard: đang có data (fail khi chuyển trang) thì giữ list, không thay bằng dòng lỗi -->
                                <tr v-else-if="subsError && subs.length === 0" class="hover:bg-transparent">
                                    <td colspan="4" class="px-5 sm:px-6 py-6">
                                        <div class="flex items-center justify-center gap-3 text-sm text-red-600">
                                            <span>{{ subsError }}</span>
                                            <button
                                                class="font-medium text-slate-700 px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-[0.97]"
                                                @click="loadSubs(subsPage)"
                                            >
                                                Thử lại
                                            </button>
                                        </div>
                                    </td>
                                </tr>

                                <!-- Empty -->
                                <tr v-else-if="subs.length === 0" class="hover:bg-transparent">
                                    <td colspan="4" class="text-center py-12 px-5 bm-row">
                                        <Receipt class="w-10 h-10 mx-auto mb-3 text-slate-300" aria-hidden="true" />
                                        <p class="text-sm text-slate-600">Chưa có gói nào.</p>
                                        <router-link to="/candidate/pricing" class="inline-block mt-3 text-sm font-medium text-blue-600 hover:text-blue-700">Xem các gói</router-link>
                                    </td>
                                </tr>

                                <!-- Data rows -->
                                <template v-else>
                                    <tr
                                        v-for="(s, i) in subs"
                                        :key="s.id"
                                        class="hover:bg-slate-50 transition duration-150 focus-visible:outline-none focus-visible:bg-slate-50 bm-row"
                                        :style="{ animationDelay: `${i * 40}ms` }"
                                        :class="s.status === 'active' ? 'bg-green-50/40 border-l-2 border-green-500' : 'border-l-2 border-transparent'"
                                    >
                                        <td class="py-3 pl-5 sm:pl-6 pr-3 align-middle">
                                            <div class="flex items-center gap-3 min-w-0">
                                                <span
                                                    class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                                                    :class="TONE_BOX[subTone[s.status] ?? 'slate']"
                                                    aria-hidden="true"
                                                >
                                                    <Package class="w-4 h-4" />
                                                </span>
                                                <div class="min-w-0">
                                                    <div class="font-medium text-slate-900 truncate">{{ displayPlanName(s.planName) }}</div>
                                                    <div class="text-xs text-slate-500 mt-0.5 truncate tabular-nums">{{ formatPrice(s.priceVnd) }} · {{ s.planDurationDays }} ngày</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td class="py-3 px-3 align-middle">
                                            <span class="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium whitespace-nowrap" :class="subPill[s.status]?.cls ?? 'bg-slate-100 text-slate-700 border-slate-200'">
                                                {{ subPill[s.status]?.label ?? s.status }}
                                            </span>
                                        </td>
                                        <td class="py-3 px-3 align-middle">
                                            <div class="text-sm text-slate-600 tabular-nums">{{ formatDate(s.startedAt) }}</div>
                                            <div class="text-xs text-slate-500 mt-0.5 tabular-nums">{{ formatDate(s.expiresAt) }}</div>
                                        </td>
                                        <td class="py-3 pl-3 pr-5 sm:pr-6 text-right align-middle">
                                            <span v-if="s.totalTokens > 0" class="text-sm font-medium text-slate-700 tabular-nums">
                                                {{ s.totalTokens.toLocaleString('vi-VN') }}
                                            </span>
                                            <span v-else class="text-slate-300" aria-hidden="true">—</span>
                                        </td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>

                    <!-- Mobile (<sm): UL luôn render -->
                    <ul
                        class="divide-y divide-slate-100 sm:hidden transition-opacity duration-150 bm-panel"
                        :class="{ 'opacity-60': isSubsPaging }"
                    >
                        <!-- Lần đầu load — skeleton -->
                        <template v-if="subsLoading && subs.length === 0">
                            <li v-for="i in SUBS_PAGE_SIZE" :key="`skel-${i}`" class="flex items-center gap-3 px-5 py-3 animate-pulse">
                                <div class="w-9 h-9 rounded-lg bg-slate-100 shrink-0"></div>
                                <div class="flex-1 space-y-2">
                                    <div class="h-3.5 w-32 rounded bg-slate-100"></div>
                                    <div class="h-3 w-48 rounded bg-slate-100"></div>
                                </div>
                            </li>
                        </template>

                        <!-- Error -->
                        <li v-else-if="subsError && subs.length === 0" class="flex items-center justify-between gap-3 px-5 py-6 text-sm text-red-600">
                            <span>{{ subsError }}</span>
                            <button
                                class="font-medium text-slate-700 px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-[0.97]"
                                @click="loadSubs(subsPage)"
                            >
                                Thử lại
                            </button>
                        </li>

                        <!-- Empty -->
                        <li v-else-if="subs.length === 0" class="text-center py-12 px-5 bm-row-m">
                            <Receipt class="w-10 h-10 mx-auto mb-3 text-slate-300" aria-hidden="true" />
                            <p class="text-sm text-slate-600">Chưa có gói nào.</p>
                            <router-link to="/candidate/pricing" class="inline-block mt-3 text-sm font-medium text-blue-600 hover:text-blue-700">Xem các gói</router-link>
                        </li>

                        <!-- Data -->
                        <template v-else>
                            <li
                                v-for="(s, i) in subs"
                                :key="s.id"
                                class="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition duration-150 bm-row-m"
                                :style="{ animationDelay: `${i * 40}ms` }"
                                :class="s.status === 'active' ? 'bg-green-50/40 border-l-2 border-green-500' : 'border-l-2 border-transparent'"
                            >
                                <span
                                    class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                                    :class="TONE_BOX[subTone[s.status] ?? 'slate']"
                                    aria-hidden="true"
                                >
                                    <Package class="w-4 h-4" />
                                </span>
                                <div class="flex-1 min-w-0">
                                    <div class="font-medium text-slate-900 truncate">{{ displayPlanName(s.planName) }}</div>
                                    <div class="text-xs text-slate-500 mt-0.5 tabular-nums">
                                        {{ formatDate(s.startedAt) }} → {{ formatDate(s.expiresAt) }}
                                        <span> · {{ s.planDurationDays }} ngày</span>
                                    </div>
                                </div>
                                <div class="text-right shrink-0">
                                    <span class="inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium" :class="subPill[s.status]?.cls ?? 'bg-slate-100 text-slate-700 border-slate-200'">
                                        {{ subPill[s.status]?.label ?? s.status }}
                                    </span>
                                    <div class="text-xs text-slate-500 mt-1 tabular-nums">
                                        {{ formatPrice(s.priceVnd) }}
                                        <span> · {{ s.totalTokens > 0 ? `${s.totalTokens.toLocaleString('vi-VN')} tokens` : '—' }}</span>
                                    </div>
                                </div>
                            </li>
                        </template>
                    </ul>
                </template>

                <!-- Pagination dùng chung cho cả 2 sub-tab: khoảng đang xem + nút số trang.
                    Nút trang active: nền blue-600, chữ trắng. -->
                <div
                    v-if="pager.totalPages > 1"
                    class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 sm:px-6 py-3 border-t border-slate-100 text-sm"
                >
                    <span class="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        {{ pagerRange }}
                        <Loader2
                            v-if="(activeTab === 'subs' && subsLoading) || (activeTab === 'pays' && paysLoading)"
                            class="w-3.5 h-3.5 animate-spin text-slate-400"
                            aria-label="Đang tải trang"
                        />
                    </span>
                    <div class="flex items-center gap-1" role="navigation" aria-label="Phân trang">
                        <button
                            aria-label="Trang trước"
                            :disabled="pager.page <= 1"
                            :aria-disabled="pager.page <= 1"
                            class="h-7 min-w-[1.75rem] px-1.5 rounded-md border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-95"
                            @click="pager.go(pager.page - 1)"
                        >
                            <ChevronLeft class="w-3.5 h-3.5" />
                        </button>
                        <template v-for="(p, i) in pagerPages" :key="`${p}-${i}`">
                            <span v-if="p === '…'" class="px-1 text-slate-400 select-none text-xs" aria-hidden="true">…</span>
                            <button
                                v-else
                                type="button"
                                :aria-label="`Trang ${p}`"
                                class="h-7 min-w-[1.75rem] px-1.5 rounded-md border text-xs font-medium tabular-nums transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-95"
                                :class="
                                    p === pager.page
                                        ? 'bg-blue-600 text-white border-blue-600'
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
                            :aria-disabled="pager.page >= pager.totalPages"
                            class="h-7 min-w-[1.75rem] px-1.5 rounded-md border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-95"
                            @click="pager.go(pager.page + 1)"
                        >
                            <ChevronRight class="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </section>

            <!-- ============ CỘT PHẢI: Gói & tính năng ============ -->
            <!-- Không có header riêng; mở đầu bằng panel gói hiện tại.
                order-1 lg:order-2: mobile hiển thị trước (gói + usage quan trọng nhất).
                lg:sticky lg:top-6 để card không bị lệch khi bảng bên trái dài. -->
            <section class="order-1 lg:order-2 xl:sticky xl:top-6">
                <div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm bm-rise bm-delay-2">

                    <!-- ===== PANEL GÓI HIỆN TẠI — điểm nhấn duy nhất của trang ===== -->
                    <div class="p-4 sm:p-5">
                        <!-- Loading (skeleton) -->
                        <div v-if="usageLoading" class="animate-pulse space-y-3">
                            <div class="flex items-center justify-between gap-3">
                                <div class="flex-1 space-y-2">
                                    <div class="h-6 w-32 rounded bg-slate-100"></div>
                                    <div class="h-3.5 w-24 rounded bg-slate-100"></div>
                                </div>
                                <div class="h-9 w-24 rounded-lg bg-slate-100 shrink-0"></div>
                            </div>
                            <div class="h-4 w-24 rounded bg-slate-100"></div>
                            <div class="h-2 w-full rounded bg-slate-100"></div>
                            <div class="flex justify-between gap-3">
                                <div class="h-3 w-24 rounded bg-slate-100"></div>
                                <div class="h-3 w-32 rounded bg-slate-100"></div>
                            </div>
                        </div>

                        <!-- Error -->
                        <div v-else-if="usageError" class="flex items-center justify-between gap-3 text-red-600">
                            <div class="flex items-center gap-2">
                                <AlertCircle class="w-4 h-4 shrink-0" />
                                <span class="text-sm">{{ usageError }}</span>
                            </div>
                            <button
                                class="text-sm font-medium text-slate-700 px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-[0.97]"
                                @click="loadUsage"
                            >
                                Thử lại
                            </button>
                        </div>

                        <!-- Chưa có gói — panel slate-50 -->
                        <div
                            v-else-if="!usage || !usage.plan"
                            class="rounded-lg border border-slate-200 bg-slate-50 p-3.5"
                        >
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <h3 class="text-lg font-semibold text-slate-900">Gói Miễn phí</h3>
                                    <div class="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                                        <span class="w-2 h-2 rounded-full bg-slate-400" aria-hidden="true"></span>
                                        Mặc định
                                    </div>
                                </div>
                                <router-link
                                    to="/candidate/pricing"
                                    class="shrink-0 inline-flex items-center px-3.5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 motion-safe:active:scale-[0.97]"
                                >
                                    Nâng cấp
                                </router-link>
                            </div>
                            <p class="mt-2 text-xs text-slate-600 leading-relaxed">
                                Bạn chưa mua gói nào. Nâng cấp để dùng thêm lượt ứng tuyển và tính năng AI.
                            </p>
                        </div>

                        <!-- Đang có gói — panel blue/amber -->
                        <div
                            v-else
                            class="rounded-lg border p-3.5"
                            :class="isExpiringSoon ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'"
                        >
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <h3 class="text-lg font-semibold text-slate-900 truncate">
                                        {{ displayPlanName(usage.plan.name) }}
                                    </h3>
                                    <div class="mt-1 flex items-center gap-1.5 text-xs">
                                        <span
                                            class="w-2 h-2 rounded-full"
                                            :class="isExpiringSoon ? 'bg-amber-500' : (usage.remainingDays === 0 ? 'bg-green-500' : 'bg-green-500')"
                                            aria-hidden="true"
                                        ></span>
                                        <span
                                            :class="isExpiringSoon ? 'text-amber-700' : 'text-slate-600'"
                                        >
                                            {{ isExpiringSoon
                                                ? 'Sắp hết hạn'
                                                : (usage.remainingDays === 0 ? 'Hết hạn hôm nay' : 'Đang hoạt động') }}
                                        </span>
                                    </div>
                                </div>
                                <router-link
                                    to="/candidate/pricing"
                                    class="shrink-0 inline-flex items-center px-3.5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 motion-safe:active:scale-[0.97]"
                                >
                                    Gia hạn
                                </router-link>
                            </div>

                            <!-- Số ngày còn lại + thanh tiến độ (REMAINING) -->
                            <div class="mt-3">
                                <div class="flex items-baseline gap-2">
                                    <span
                                        class="text-2xl font-bold tabular-nums leading-none"
                                        :class="isExpiringSoon ? 'text-amber-700' : 'text-slate-900'"
                                    >{{ shownDays }}</span>
                                    <span class="text-sm text-slate-600">ngày còn lại</span>
                                </div>
                                <div
                                    class="mt-2.5 h-2 w-full rounded-full overflow-hidden"
                                    :class="isExpiringSoon ? 'bg-amber-100' : 'bg-blue-100'"
                                    role="progressbar"
                                    :aria-valuenow="remainingPercent"
                                    aria-valuemin="0"
                                    aria-valuemax="100"
                                    :aria-label="`Còn ${usage.remainingDays ?? 0}/${usage.plan.durationDays ?? 0} ngày`"
                                >
                                    <div
                                        class="h-full rounded-full transition-all duration-500 bm-bar"
                                        :class="isExpiringSoon ? 'bg-amber-500' : 'bg-blue-600'"
                                        :style="{ width: `${remainingPercent}%` }"
                                    ></div>
                                </div>
                                <div class="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-600">
                                    <span class="tabular-nums">Hết hạn {{ usage.expiresAt ? formatDate(usage.expiresAt) : '—' }}</span>
                                    <span class="tabular-nums">{{ formatPrice(usage.plan.priceVnd) }} / {{ usage.plan.durationDays }} ngày</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- ===== DIVIDER giữa 2 phần ===== -->
                    <div class="border-t border-slate-100"></div>

                    <!-- ===== LƯỢT SỬ DỤNG ===== -->
                    <div class="px-4 sm:px-5 py-4 sm:pb-5">
                        <h3 class="text-sm font-semibold text-slate-900 mb-0.5">
                            Lượt sử dụng
                        </h3>

                        <!-- Loading (3 row skeleton) -->
                        <div v-if="usageLoading" class="animate-pulse">
                            <div
                                v-for="i in 3"
                                :key="i"
                                class="py-3 first:pt-0 last:pb-0 border-t border-slate-100 first:border-t-0 space-y-2"
                            >
                                <div class="flex items-center justify-between gap-3">
                                    <div class="h-3.5 w-32 rounded bg-slate-100"></div>
                                    <div class="h-3 w-20 rounded bg-slate-100"></div>
                                </div>
                                <div class="h-1.5 w-full rounded bg-slate-100"></div>
                            </div>
                        </div>

                        <!-- Error -->
                        <div
                            v-else-if="usageError"
                            class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm text-slate-600"
                        >
                            <p class="min-w-0">Không thể hiển thị lượt sử dụng.</p>
                            <button class="font-medium text-slate-700 px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-safe:active:scale-[0.97]" @click="loadUsage">
                                Thử lại
                            </button>
                        </div>

                        <!-- Empty (chưa có gói) -->
                        <div v-else-if="!usage || !usage.plan || visibleUsage.length === 0" class="text-sm text-slate-600">
                            Mua gói để có thêm lượt AI và tính năng premium.
                        </div>

                        <!-- Quota rows — 3 tầng mỗi quota -->
                        <div v-else class="divide-y divide-slate-100">
                            <div
                                v-for="(row, i) in quotaRows"
                                :key="row.key"
                                class="py-3 first:pt-0 last:pb-0"
                            >
                                <!-- Tầng 1: icon + tên | "X lượt còn lại" / "Hết lượt" / "Không giới hạn" -->
                                <div class="flex items-center justify-between gap-3">
                                    <div class="flex items-center gap-2 min-w-0">
                                        <component :is="row.icon" class="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                                        <span class="text-sm font-medium text-slate-900 truncate">{{ row.label }}</span>
                                    </div>
                                    <div class="text-sm shrink-0">
                                        <span class="font-semibold tabular-nums" :class="row.leftClass">{{ row.leftLabel }}</span>
                                    </div>
                                </div>

                                <!-- Tầng 2: thanh tiến độ (không vẽ nếu unlimited) -->
                                <div
                                    v-if="!row.unlimited"
                                    class="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden"
                                    role="progressbar"
                                    :aria-valuenow="row.percent"
                                    aria-valuemin="0"
                                    aria-valuemax="100"
                                    :aria-label="`${row.label}: đã dùng ${row.percent}%`"
                                >
                                    <div
                                        class="h-full rounded-full transition-all duration-500 bm-bar"
                                        :class="QUOTA_BAR[row.state]"
                                        :style="{ width: `${row.percent}%`, animationDelay: `${i * 80}ms` }"
                                    ></div>
                                </div>

                                <!-- Tầng 3: "Đã dùng X/Y" + "Mua thêm lượt" | tokens -->
                                <div class="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-600">
                                    <div class="flex items-center gap-3 min-w-0">
                                        <span v-if="!row.unlimited" class="tabular-nums">
                                            Đã dùng <span class="font-medium text-slate-800">{{ row.used }}</span> / {{ row.limit }}
                                        </span>
                                        <router-link
                                            v-if="row.state === 'warn' || row.state === 'full'"
                                            to="/candidate/pricing"
                                            class="font-medium text-blue-600 hover:text-blue-700 shrink-0"
                                        >
                                            Mua thêm lượt
                                        </router-link>
                                    </div>
                                    <span
                                        v-if="isAiQuota(row.key) && row.tokens > 0"
                                        class="inline-flex items-center gap-1 text-slate-500 tabular-nums shrink-0"
                                    >
                                        <span>{{ row.tokens.toLocaleString('vi-VN') }} tokens</span>
                                        <Info
                                            class="w-3 h-3 text-slate-400 cursor-help"
                                            aria-hidden="true"
                                            tabindex="0"
                                            role="img"
                                            title="Token là đơn vị đo lượng xử lý của AI. Bạn không cần quan tâm nếu chỉ dùng số lượt."
                                        />
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <!-- ===== Chi tiết giao dịch — PaymentDetailModal thật (fetch + QR + huỷ đơn) =====
            Đặt NGOÀI layout 2 cột để modal không bị ảnh hưởng bởi grid. -->
        <PaymentDetailModal
            :open="detailOpen"
            :payment-id="detailPaymentId"
            @close="closePaymentDetail"
            @cancelled="onPaymentCancelled"
            @status-changed="onPaymentStatusChanged"
        />
    </div>
</template>

<style scoped>
/* Motion trang billing — chỉ transform/opacity. Toàn bộ class animation
   nằm trong no-preference: user bật prefers-reduced-motion: reduce thấy
   trang tĩnh hoàn toàn, không cần xử lý gì ở template. */
@media (prefers-reduced-motion: no-preference) {
    .bm-rise {
        animation: bm-rise 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    .bm-delay-1 { animation-delay: 70ms; }
    .bm-delay-2 { animation-delay: 140ms; }

    .bm-panel {
        animation: bm-rise-sm 0.2s ease-out both;
    }

    /* tr desktop: CHỈ opacity — Safari không render transform trên table-row */
    .bm-row {
        animation: bm-fade 0.25s ease-out both;
    }

    /* li mobile / empty-state li: opacity + rise 4px */
    .bm-row-m {
        animation: bm-rise-sm 0.25s ease-out both;
    }

    /* fill bar từ trái qua; fill-mode both giữ scaleX(0) trong lúc animation-delay */
    .bm-bar {
        animation: bm-bar 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
        transform-origin: left;
    }
}

@keyframes bm-rise {
    from { opacity: 0; transform: translateY(8px); }
}
@keyframes bm-rise-sm {
    from { opacity: 0; transform: translateY(4px); }
}
@keyframes bm-fade {
    from { opacity: 0; }
}
@keyframes bm-bar {
    from { transform: scaleX(0); }
}
</style>
