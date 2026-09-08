<script setup lang="ts">
/**
 * UsersListView — master user directory cho admin (/admin/users).
 *
 * Layout (horizontal card list — KHÁC với AllJobsView card grid 2 cột):
 *   1. Hero header: gradient indigo + title + 3 stats (Tổng / Đang hoạt động / Cần chú ý)
 *      + Refresh + Export CSV
 *   2. Status filter pills: 5 pills (Tất cả + 4 statuses), click filter
 *   3. Toolbar: search + 3 filters (Role / Ngày tham gia / Sắp xếp) + Xoá bộ lọc
 *   4. User cards list: 1 cột full-width. Mỗi card có avatar (gradient từ email),
 *      name + email + meta trái, role + status badge giữa, action menu phải
 *   5. Pagination
 *
 * Theme: indigo (khác Jobs = emerald) để phân biệt 2 trang.
 */
import { onMounted, ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAdminUsersStore } from '@stores/adminUsers';
import { adminUserApi } from '@/services/adminUser.api';
import { useToastStore } from '@stores/toast';
import UserStatusBadge from '@components/admin/UserStatusBadge.vue';
import RoleBadge from '@components/admin/RoleBadge.vue';
import AdminPagination from '@components/admin/AdminPagination.vue';
import AdminActionMenu from '@components/admin/AdminActionMenu.vue';
import UserViewModal from '@components/admin/UserViewModal.vue';
import UserEditModal from '@components/admin/UserEditModal.vue';
import ConfirmModal from '@components/common/ConfirmModal.vue';
import {
  Search, Inbox, RefreshCw, ChevronDown, X, Users, Download, Loader2,
  Sparkles, Mail, Activity, UserCheck,
} from 'lucide-vue-next';
import {
  formatDate, relativeTime, initialsFromName, roleLabel, userStatusLabel,
  type UserRole, type UserStatus,
} from '@/utils/format';
import type { User } from '@stores/auth';

const store = useAdminUsersStore();
const toast = useToastStore();
const { paged, loading, error, page, pageSize, total, counts, filters } = storeToRefs(store);

onMounted(() => {
  if (store.users.length === 0) store.fetchUsers();
  store.fetchCounts();
});

/* ============================================================================
 * Counts fallback
 * ==========================================================================*/
const EMPTY_COUNTS = {
  total: 0,
  byRole: { candidate: 0, employer: 0, admin: 0 } as Record<string, number>,
  byStatus: { active: 0, suspended: 0, pending: 0, banned: 0 } as Record<string, number>,
};
const safeCounts = computed(() => counts.value ?? EMPTY_COUNTS);

/* ============================================================================
 * Search debounce
 * ==========================================================================*/
const SEARCH_DEBOUNCE_MS = 400;
const searchInput = ref<string>(filters.value.q);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

watch(searchInput, (newQ) => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchTimeout = null;
    store.setFilter('q', newQ);
  }, SEARCH_DEBOUNCE_MS);
});
watch(() => filters.value.q, (newQ) => {
  if (searchInput.value !== newQ) searchInput.value = newQ;
});

/* ============================================================================
 * Date range filter (client-side, vì BE chưa hỗ trợ)
 * ==========================================================================*/
type DateRange = 'all' | 'today' | '7d' | '30d';
const dateRange = ref<DateRange>('all');

function inDateRange(iso: string | Date | null | undefined, range: DateRange): boolean {
  if (range === 'all') return true;
  if (!iso) return false;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return false;
  const now = Date.now();
  const days = range === 'today' ? 1 : range === '7d' ? 7 : 30;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return d.getTime() >= cutoff;
}

/* ============================================================================
 * Toolbar dropdowns
 * ==========================================================================*/
const roleOptions: { value: UserRole | 'all'; label: string }[] = [
  { value: 'all', label: 'Tất cả vai trò' },
  { value: 'candidate', label: 'Ứng viên' },
  { value: 'employer', label: 'Nhà tuyển dụng' },
  { value: 'admin', label: 'Quản trị viên' },
];
const dateRangeOptions: { value: DateRange; label: string }[] = [
  { value: 'all', label: 'Tất cả thời gian' },
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày qua' },
  { value: '30d', label: '30 ngày qua' },
];
const sortOptions: { value: 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'recently-active'; label: string }[] = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'oldest', label: 'Cũ nhất' },
  { value: 'name-asc', label: 'Tên A → Z' },
  { value: 'name-desc', label: 'Tên Z → A' },
  { value: 'recently-active', label: 'Hoạt động gần nhất' },
];

const openDropdown = ref<'role' | 'date' | 'sort' | null>(null);
function toggleDropdown(name: 'role' | 'date' | 'sort'): void {
  openDropdown.value = openDropdown.value === name ? null : name;
}
function closeDropdowns(): void { openDropdown.value = null; }
function selectRole(value: string): void {
  store.setFilter('role', value as UserRole | 'all');
  closeDropdowns();
}
function selectDate(value: DateRange): void {
  dateRange.value = value;
  closeDropdowns();
}
function selectSort(value: string): void {
  store.setFilter('sort', value as 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'recently-active');
  closeDropdowns();
}
function currentLabel(name: 'role' | 'date' | 'sort'): string {
  if (name === 'role') return roleOptions.find(o => o.value === filters.value.role)?.label ?? '';
  if (name === 'date') return dateRangeOptions.find(o => o.value === dateRange.value)?.label ?? '';
  return sortOptions.find(o => o.value === filters.value.sort)?.label ?? '';
}
function hasActiveFilter(): boolean {
  return filters.value.q !== '' || filters.value.role !== 'all' || filters.value.status !== 'all'
    || dateRange.value !== 'all' || filters.value.sort !== 'newest';
}

/* ============================================================================
 * Status filter pills (5 status: all + 4 statuses)
 * ==========================================================================*/
const statusTabs: { value: UserStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'active', label: 'Đang hoạt động' },
  { value: 'pending', label: 'Chờ kích hoạt' },
  { value: 'suspended', label: 'Tạm khoá' },
  { value: 'banned', label: 'Đã cấm' },
];
const statusTabCount = (status: UserStatus | 'all'): number => {
  if (status === 'all') return safeCounts.value.total;
  return safeCounts.value.byStatus[status] ?? 0;
};

/* ============================================================================
 * Card visual helpers
 * ==========================================================================*/

/** Hash email → gradient color (khác Jobs dùng company name). 8 tone hài hoà. */
function userGradient(email: string | null | undefined): string {
  if (!email) return 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)';
  const palette: [string, string][] = [
    ['#6366f1', '#4f46e5'], // indigo
    ['#3b82f6', '#2563eb'], // blue
    ['#8b5cf6', '#7c3aed'], // violet
    ['#ec4899', '#db2777'], // pink
    ['#f59e0b', '#d97706'], // amber
    ['#06b6d4', '#0891b2'], // cyan
    ['#10b981', '#059669'], // emerald
    ['#f43f5e', '#e11d48'], // rose
  ];
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const [c1, c2] = palette[Math.abs(hash) % palette.length];
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

/** Dot color cho status filter pill. */
function statusDotColor(status: UserStatus | 'all'): string {
  switch (status) {
    case 'all':       return 'bg-slate-400';
    case 'active':    return 'bg-emerald-500';
    case 'pending':   return 'bg-slate-400';
    case 'suspended': return 'bg-amber-500';
    case 'banned':    return 'bg-red-500';
  }
}

/** Summary stats cho hero header (toàn cục, không phụ thuộc filter/page). */
const summary = computed(() => ({
  total: safeCounts.value.total,
  active: safeCounts.value.byStatus.active,
  /** "Cần chú ý" = suspended + banned — admin cần xử lý. */
  needsAttention: safeCounts.value.byStatus.suspended + safeCounts.value.byStatus.banned,
}));

/* ============================================================================
 * Display data — apply client-side date filter on top of server-filtered page.
 * ==========================================================================*/
const displayedUsers = computed(() => {
  if (dateRange.value === 'all') return paged.value;
  return paged.value.filter(u => inDateRange(u.createdAt, dateRange.value));
});

/* ============================================================================
 * Action menu + status change
 * ==========================================================================*/
type ActionItem = { label?: string; onClick?: () => void; tone?: 'default' | 'danger'; disabled?: boolean; separator?: boolean };
type PendingAction = { user: User; targetStatus: UserStatus } | null;
const pendingAction = ref<PendingAction>(null);

function askStatusChange(u: User, targetStatus: UserStatus): void {
  pendingAction.value = { user: u, targetStatus };
}

const viewUserId = ref<string | null>(null);
const editUserId = ref<string | null>(null);
function openViewModal(userId: string): void { viewUserId.value = userId; }
function openEditModal(userId: string): void { editUserId.value = userId; }
function onUserSaved(): void {
  store.refetch();
  store.fetchCounts();
}

/* ============================================================================
 * Export CSV
 * ==========================================================================*/
const exporting = ref(false);

async function exportToExcel(): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const res = await adminUserApi.list({
      page: 1,
      limit: 1000,
      q: filters.value.q || undefined,
      role: filters.value.role !== 'all' ? filters.value.role : undefined,
      status: filters.value.status !== 'all' ? filters.value.status : undefined,
      sort: filters.value.sort,
    });
    downloadCSV(res.data);
    toast.success(`Đã xuất ${res.data.length} người dùng ra file CSV`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    toast.error(`Xuất thất bại: ${msg}`);
  } finally {
    exporting.value = false;
  }
}

function downloadCSV(users: User[]): void {
  if (users.length === 0) {
    toast.info('Không có dữ liệu để xuất');
    return;
  }
  const headers = ['Email', 'Họ tên', 'Vai trò', 'Trạng thái', 'Ngày tham gia', 'Hoạt động gần nhất'];
  const rows = users.map((u) => [
    u.email,
    u.fullName ?? '',
    roleLabel(u.role as UserRole),
    userStatusLabel(u.status),
    formatDate(u.createdAt),
    relativeTime(u.updatedAt),
  ]);
  const escape = (val: string): string => {
    if (/[",\n\r]/.test(val)) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const bom = '﻿';
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => escape(String(v))).join(','))
    .join('\r\n');
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildActions(u: User): ActionItem[] {
  const items: ActionItem[] = [];
  items.push({ label: 'Xem người dùng', onClick: () => openViewModal(u.id) });
  items.push({ label: 'Chỉnh sửa', onClick: () => openEditModal(u.id) });
  items.push({ separator: true });
  const statusItems: { status: UserStatus; label: string }[] = [
    { status: 'active', label: 'Kích hoạt' },
    { status: 'suspended', label: 'Tạm khóa' },
    { status: 'pending', label: 'Chờ kích hoạt' },
    { status: 'banned', label: 'Cấm' },
  ];
  for (const s of statusItems) {
    const isCurrent = u.status === s.status;
    items.push({
      label: isCurrent ? `${s.label} (hiện tại)` : s.label,
      onClick: () => askStatusChange(u, s.status),
      disabled: isCurrent,
      tone: s.status === 'banned' ? 'danger' : 'default',
    });
  }
  return items;
}

const STATUS_META: Record<UserStatus, { title: string; verb: string; msg: string }> = {
  active: { title: 'Kích hoạt tài khoản', verb: 'Kích hoạt', msg: 'Tài khoản sẽ hoạt động trở lại và có thể đăng nhập.' },
  suspended: { title: 'Tạm khoá tài khoản', verb: 'Tạm khoá', msg: 'Người dùng sẽ không thể đăng nhập cho đến khi được kích hoạt lại.' },
  pending: { title: 'Chuyển về chờ kích hoạt', verb: 'Chờ kích hoạt', msg: 'Tài khoản sẽ về trạng thái chờ xác minh.' },
  banned: { title: 'Cấm tài khoản', verb: 'Cấm', msg: 'Người dùng sẽ bị cấm đăng nhập vĩnh viễn cho đến khi admin kích hoạt lại.' },
};

const confirmTitle = computed<string>(() => pendingAction.value ? STATUS_META[pendingAction.value.targetStatus].title : '');
const confirmMessage = computed<string>(() => {
  const a = pendingAction.value;
  return a ? `${STATUS_META[a.targetStatus].msg} — Tài khoản: ${a.user.email}` : '';
});
const confirmButtonText = computed<string>(() => pendingAction.value ? STATUS_META[pendingAction.value.targetStatus].verb : 'Xác nhận');
const confirmVariant = computed<'default' | 'danger'>(() => {
  const a = pendingAction.value;
  return a && (a.targetStatus === 'suspended' || a.targetStatus === 'banned') ? 'danger' : 'default';
});

async function performConfirm(): Promise<void> {
  const a = pendingAction.value;
  if (!a) return;
  await store.changeStatus(a.user.id, a.targetStatus);
  pendingAction.value = null;
}
function closeConfirm(): void { pendingAction.value = null; }

/* ============================================================================
 * Empty state — resetFilters
 * ==========================================================================*/
function clearAllFilters(): void {
  store.resetFilters();
  dateRange.value = 'all';
  searchInput.value = '';
}

const isEmpty = computed(() => !loading.value && displayedUsers.value.length === 0);
</script>

<template>
  <div class="min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:px-8" style="background-color: var(--admin-page-bg);">
    <div v-if="openDropdown" class="fixed inset-0 z-10" @click="closeDropdowns" />

    <div class="mx-auto max-w-7xl space-y-6">
      <!-- ===== 1. HERO HEADER ===== -->
      <div
        class="relative overflow-hidden rounded-2xl border p-6 sm:p-8"
        style="background: linear-gradient(135deg, #eef2ff 0%, #ffffff 60%, #ffffff 100%); border-color: var(--admin-border-subtle); box-shadow: var(--admin-shadow-sm);"
      >
        <div
          class="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full opacity-40"
          style="background: radial-gradient(circle, #6366f1 0%, transparent 70%);"
        />

        <div class="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex items-start gap-4">
            <div
              class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-indigo-500/25"
              style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);"
            >
              <Users class="h-7 w-7 text-white" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-2xl font-bold tracking-tight sm:text-3xl" style="color: var(--admin-text);">
                  Tất cả người dùng
                </h1>
                <span class="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                  <Sparkles class="h-3 w-3" />
                  User Directory
                </span>
              </div>
              <p class="mt-1 text-sm" style="color: var(--admin-text-muted);">
                Quản lý toàn bộ tài khoản — lọc, xuất CSV, thay đổi trạng thái.
              </p>
            </div>
          </div>

          <!-- Stats + actions -->
          <div class="flex flex-wrap items-center gap-3 sm:gap-6">
            <div class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold tabular-nums" style="color: var(--admin-text);">{{ summary.total }}</span>
              <span class="text-xs font-medium" style="color: var(--admin-text-muted);">Tổng</span>
            </div>
            <div class="hidden h-8 w-px bg-gray-200 sm:block" />
            <div class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold tabular-nums text-emerald-600">{{ summary.active }}</span>
              <span class="text-xs font-medium" style="color: var(--admin-text-muted);">Đang hoạt động</span>
            </div>
            <div class="hidden h-8 w-px bg-gray-200 sm:block" />
            <div class="flex items-baseline gap-1.5">
              <span
                class="text-2xl font-bold tabular-nums"
                :class="summary.needsAttention > 0 ? 'text-amber-600' : ''"
                :style="summary.needsAttention === 0 ? { color: 'var(--admin-text)' } : {}"
              >{{ summary.needsAttention }}</span>
              <span class="text-xs font-medium" style="color: var(--admin-text-muted);">Cần chú ý</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
                style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface); color: var(--admin-text);"
                :disabled="loading"
                @click="store.refetch()"
              >
                <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
                Làm mới
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
                :disabled="exporting"
                @click="exportToExcel"
              >
                <Loader2 v-if="exporting" class="h-3.5 w-3.5 animate-spin" />
                <Download v-else class="h-3.5 w-3.5" />
                {{ exporting ? 'Đang xuất...' : 'Xuất CSV' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== 2. STATUS FILTER PILLS ===== -->
      <div class="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div class="flex items-center gap-2 pb-1 min-w-max sm:flex-wrap sm:min-w-0 sm:pb-0">
          <button
            v-for="t in statusTabs"
            :key="t.value"
            type="button"
            class="group inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition"
            :class="filters.status === t.value
              ? 'border-indigo-500 bg-indigo-500 text-white shadow-sm shadow-indigo-500/30'
              : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/50'"
            @click="store.setFilter('status', t.value)"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="filters.status === t.value ? 'bg-white' : statusDotColor(t.value)"
            />
            <span>{{ t.label }}</span>
            <span
              class="rounded-md px-1.5 py-0.5 text-xs tabular-nums"
              :class="filters.status === t.value
                ? 'bg-white/20 text-white'
                : 'bg-gray-100 text-gray-600 group-hover:bg-indigo-100 group-hover:text-indigo-700'"
            >
              {{ statusTabCount(t.value) }}
            </span>
          </button>
        </div>
      </div>

      <!-- ===== 3. TOOLBAR ===== -->
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <!-- Search -->
          <div class="relative sm:max-w-xs sm:flex-1">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style="color: var(--admin-text-subtle);" />
            <input
              v-model="searchInput"
              type="search"
              placeholder="Tìm kiếm theo tên hoặc email..."
              class="w-full rounded-full border py-2 pl-9 pr-3 text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface); color: var(--admin-text);"
            />
          </div>
          <!-- Role filter -->
          <div class="relative">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition"
              :class="filters.role !== 'all'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 bg-white'"
              style="color: var(--admin-text);"
              @click="toggleDropdown('role')"
            >
              {{ currentLabel('role') }}
              <ChevronDown class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
            </button>
            <div
              v-if="openDropdown === 'role'"
              class="absolute left-0 z-20 mt-1 w-44 rounded-lg border py-1 shadow-lg"
              style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface);"
            >
              <button
                v-for="o in roleOptions"
                :key="o.value"
                type="button"
                class="block w-full px-3 py-1.5 text-left text-sm transition hover:bg-indigo-50"
                :class="filters.role === o.value ? 'font-medium text-indigo-700' : 'text-gray-700'"
                @click="selectRole(o.value)"
              >{{ o.label }}</button>
            </div>
          </div>
          <!-- Date range filter -->
          <div class="relative">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition"
              :class="dateRange !== 'all'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 bg-white'"
              style="color: var(--admin-text);"
              @click="toggleDropdown('date')"
            >
              {{ currentLabel('date') }}
              <ChevronDown class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
            </button>
            <div
              v-if="openDropdown === 'date'"
              class="absolute left-0 z-20 mt-1 w-44 rounded-lg border py-1 shadow-lg"
              style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface);"
            >
              <button
                v-for="o in dateRangeOptions"
                :key="o.value"
                type="button"
                class="block w-full px-3 py-1.5 text-left text-sm transition hover:bg-indigo-50"
                :class="dateRange === o.value ? 'font-medium text-indigo-700' : 'text-gray-700'"
                @click="selectDate(o.value)"
              >{{ o.label }}</button>
            </div>
          </div>
          <!-- Sort -->
          <div class="relative">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm transition hover:border-indigo-300"
              style="color: var(--admin-text);"
              @click="toggleDropdown('sort')"
            >
              {{ currentLabel('sort') }}
              <ChevronDown class="h-3.5 w-3.5" style="color: var(--admin-text-subtle);" />
            </button>
            <div
              v-if="openDropdown === 'sort'"
              class="absolute right-0 z-20 mt-1 w-44 rounded-lg border py-1 shadow-lg"
              style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface);"
            >
              <button
                v-for="o in sortOptions"
                :key="o.value"
                type="button"
                class="block w-full px-3 py-1.5 text-left text-sm transition hover:bg-indigo-50"
                :class="filters.sort === o.value ? 'font-medium text-indigo-700' : 'text-gray-700'"
                @click="selectSort(o.value)"
              >{{ o.label }}</button>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-50"
          :class="hasActiveFilter()
            ? 'opacity-100 pointer-events-auto'
            : 'pointer-events-none opacity-0 select-none'"
          :aria-hidden="!hasActiveFilter()"
          :tabindex="hasActiveFilter() ? 0 : -1"
          @click="clearAllFilters()"
        >
          <X class="h-3 w-3" />
          Xoá bộ lọc
        </button>
      </div>

      <!-- ===== 4. USER CARDS LIST (1 cột, horizontal) ===== -->
      <!-- Loading skeleton -->
      <div v-if="loading && displayedUsers.length === 0" class="space-y-3">
        <div
          v-for="i in 6"
          :key="i"
          class="rounded-2xl border bg-white p-4"
          style="border-color: var(--admin-border-subtle);"
        >
          <div class="flex items-center gap-4">
            <div class="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-gray-100 sm:h-14 sm:w-14" />
            <div class="flex-1 space-y-2">
              <div class="h-4 w-44 animate-pulse rounded bg-gray-100" />
              <div class="h-3 w-64 animate-pulse rounded bg-gray-100" />
            </div>
            <div class="hidden gap-2 sm:flex">
              <div class="h-5 w-16 animate-pulse rounded-full bg-gray-100" />
              <div class="h-5 w-20 animate-pulse rounded-full bg-gray-100" />
            </div>
            <div class="h-7 w-7 animate-pulse rounded-full bg-gray-100" />
          </div>
        </div>
      </div>

      <!-- Error -->
      <div
        v-else-if="error"
        class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-100 bg-red-50/50 px-6 py-16 text-center"
      >
        <p class="text-sm font-medium text-red-600">{{ error }}</p>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-full bg-red-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-red-700"
          @click="store.refetch()"
        >Thử lại</button>
      </div>

      <!-- Empty -->
      <div
        v-else-if="isEmpty"
        class="flex flex-col items-center justify-center gap-3 rounded-2xl border bg-white px-6 py-20 text-center"
        style="border-color: var(--admin-border-subtle); border-style: dashed;"
      >
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50">
          <Inbox class="h-7 w-7 text-indigo-500" />
        </div>
        <p class="text-base font-semibold" style="color: var(--admin-text);">Không tìm thấy người dùng</p>
        <p class="text-sm" style="color: var(--admin-text-muted);">Thử thay đổi bộ lọc hoặc từ khoá tìm kiếm.</p>
        <button
          type="button"
          class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition-all duration-150 hover:bg-indigo-100"
          :class="hasActiveFilter()
            ? 'opacity-100 pointer-events-auto'
            : 'pointer-events-none opacity-0 select-none'"
          :aria-hidden="!hasActiveFilter()"
          :tabindex="hasActiveFilter() ? 0 : -1"
          @click="clearAllFilters()"
        >
          <X class="h-3.5 w-3.5" />
          Xoá bộ lọc
        </button>
      </div>

      <!-- User cards -->
      <div v-else class="space-y-3">
        <article
          v-for="u in displayedUsers"
          :key="u.id"
          class="group relative flex items-center gap-3 rounded-2xl border bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-500/5 sm:gap-4 sm:p-5"
          style="border-color: var(--admin-border-subtle);"
        >
          <!-- Avatar -->
          <div
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm sm:h-14 sm:w-14"
            :style="{ background: userGradient(u.email) }"
          >
            {{ initialsFromName(u.fullName, u.email) }}
          </div>

          <!-- User info (trái) -->
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold sm:text-base" style="color: var(--admin-text);">
              {{ u.fullName || u.email.split('@')[0] }}
            </p>
            <p class="mt-0.5 flex items-center gap-1 truncate text-xs" style="color: var(--admin-text-muted);">
              <Mail class="h-3 w-3 shrink-0" />
              <span class="truncate">{{ u.email }}</span>
            </p>
            <div class="mt-1.5 hidden items-center gap-3 text-[11px] sm:flex" style="color: var(--admin-text-subtle);">
              <span class="flex items-center gap-1">
                <UserCheck class="h-3 w-3" />
                Tham gia {{ formatDate(u.createdAt) }}
              </span>
              <span class="flex items-center gap-1">
                <Activity class="h-3 w-3" />
                {{ relativeTime(u.updatedAt) }}
              </span>
            </div>
          </div>

          <!-- Role + Status (phải, chỉ trên sm+) -->
          <div class="hidden shrink-0 items-center gap-1.5 sm:flex">
            <RoleBadge :role="u.role" />
            <UserStatusBadge :status="u.status" />
          </div>

          <!-- Mobile: status badge dưới tên (absolute top-right) -->
          <div class="absolute right-14 top-3 flex shrink-0 items-center gap-1 sm:hidden">
            <UserStatusBadge :status="u.status" />
          </div>

          <!-- Action menu -->
          <div class="shrink-0">
            <AdminActionMenu :actions="buildActions(u)" />
          </div>
        </article>
      </div>

      <!-- ===== 5. PAGINATION ===== -->
      <div
        v-if="!loading && !error && total > 0"
        class="rounded-2xl border bg-white px-2 py-1"
        style="border-color: var(--admin-border-subtle);"
      >
        <AdminPagination
          :page="page"
          :page-size="pageSize"
          :total="total"
          @update:page="store.goToPage($event)"
        />
      </div>
    </div>

    <!-- Confirm modal -->
    <ConfirmModal
      :open="pendingAction !== null"
      :variant="confirmVariant"
      :title="confirmTitle"
      :message="confirmMessage"
      :confirm-text="confirmButtonText"
      cancel-text="Huỷ"
      @update:open="(v) => { if (!v) closeConfirm() }"
      @confirm="performConfirm"
    />

    <!-- View modal -->
    <UserViewModal
      :open="viewUserId !== null"
      :user-id="viewUserId"
      @update:open="(v) => { if (!v) viewUserId = null }"
    />

    <!-- Edit modal -->
    <UserEditModal
      :open="editUserId !== null"
      :user-id="editUserId"
      @update:open="(v) => { if (!v) editUserId = null }"
      @saved="onUserSaved"
    />
  </div>
</template>
