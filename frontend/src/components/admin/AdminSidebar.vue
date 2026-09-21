<script setup lang="ts">
/**
 * AdminSidebar
 *
 * Sidebar thứ 3 trong hệ thống — dùng cho khu vực quản trị (/admin). Khác với
 * CandidateSidebar/EmployerSidebar (theme sáng + primary-600), sidebar admin
 * dùng **dark theme** (nền gần đen #14161c + accent indigo) để phân biệt trực
 * quan với 2 sidebar kia — admin thao tác nhạy cảm (xoá user, khoá tài khoản,
 * duyệt job) nên cần tách bạch rõ ràng.
 *
 * Pattern hành vi mirror CandidateSidebar:
 *   - Collapse/expand + lưu localStorage (`admin-sidebar-collapsed`).
 *   - Active match theo `matchScore` — ưu tiên prefix dài nhất.
 *   - Mobile overlay trượt từ trái, w-72, tự đóng khi navigate.
 *   - Toggle button (PanelLeftClose/Open) nằm trên border-r, nền tối (thay vì
 *     trắng như 2 sidebar kia) để hợp với dark theme.
 *   - Modal confirm logout — modal giữ theme sáng vì overlay ngoài content
 *     page (vẫn nền sáng).
 *
 * Props mới (so với CandidateSidebar):
 *   - `pendingJobsCount` — số job chờ duyệt → bind badge vàng "Duyệt tin".
 *   - `reportsCount` — số báo cáo/khiếu nại mới → bind badge đỏ.
 *
 * Vùng content chính (ngoài sidebar) VẪN giữ nền sáng — chỉ sidebar đổi tông.
 */
import { ref, onMounted, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@stores/auth';
import {
  LayoutDashboard,
  Building,
  Briefcase,
  Megaphone,
  Package,
  RefreshCw,
  Sparkles,
  UserCog,
  Wallet,
  ShieldCheck,
  Flag,
  Settings,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  X,
} from 'lucide-vue-next';

interface MenuItem {
  label: string;
  icon: typeof LayoutDashboard;
  /** Route đích — bắt buộc nếu không có `action`. */
  to?: string;
  /** Match the given path prefixes too (vd /admin/users/candidates/123 active ở "Ứng viên"). */
  activeOn?: string[];
  /** Nếu true, chỉ match exact path. Dùng cho root path `/admin` để không
   *  match nhầm các route con. */
  exact?: boolean;
  /** Nếu có — render thành <button> thay vì <router-link>. */
  action?: () => void;
  /** Nếu có — render badge count pill ở bên phải. */
  badge?: 'count';
  /** Tone của badge: vàng (chờ duyệt) | đỏ (khẩn cấp). */
  badgeTone?: 'yellow' | 'red';
  /** Nếu true — tô danger tone (đỏ nhạt) để cảnh báo mục nhạy cảm. */
  danger?: boolean;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const route = useRoute();

const props = defineProps<{
  /**
   * Trên mobile, sidebar được dùng như 1 overlay trượt từ trái qua phải. Parent
   * quản lý state `mobileOpen` + hamburger button + backdrop. Khi `mobileOpen=true`
   * trên mobile, sidebar chiếm w-72 (bỏ qua `collapsed` để luôn mở rộng).
   * Trên md+ `mobileOpen` bị bỏ qua — sidebar là static col.
   */
  mobileOpen?: boolean;
  /** Số job đang chờ duyệt. Bind từ admin store khi integrate. */
  pendingJobsCount?: number;
  /** Số báo cáo/khiếu nại mới. Bind từ admin store khi integrate. */
  reportsCount?: number;
}>();

const emit = defineEmits<{
  /** Đóng sidebar overlay trên mobile. */
  (e: 'close-mobile'): void;
}>();

/** Auto-close overlay khi user navigate qua menu link. */
watch(
  () => route.path,
  () => {
    if (props.mobileOpen) emit('close-mobile');
  },
);

/** Thu nhỏ / mở rộng sidebar — lưu vào localStorage để giữ qua reload. */
const collapsed = ref<boolean>(false);
const SIDEBAR_KEY = 'admin-sidebar-collapsed';

onMounted(() => {
  const saved = localStorage.getItem(SIDEBAR_KEY);
  if (saved !== null) collapsed.value = saved === 'true';
});
watch(collapsed, (v) => {
  localStorage.setItem(SIDEBAR_KEY, String(v));
});

const toggleCollapsed = (): void => {
  collapsed.value = !collapsed.value;
};

/* ============================================================================
 * Footer: avatar + tên + email + logout
 * - Tên hiển thị: hardcode "Quản trị viên" (per spec — tất cả admin dùng chung
 *   label). Email lấy từ auth store.
 * - Initials: "QT" (per spec).
 * - Logout button: hover chuyển đỏ.
 * ==========================================================================*/
const auth = useAuthStore();
const { user } = storeToRefs(auth);
const router = useRouter();

/** Tên hiển thị ở footer — luôn "Quản trị viên" theo spec. */
const displayName = computed<string>(() => 'Quản trị viên');

/** Email phụ ở footer (dòng dưới tên). */
const displayEmail = computed<string>(() => user.value?.email ?? '');

/** Initials cho avatar — hardcode "QT" theo spec. */
const initials = computed<string>(() => 'QT');

/* ============================================================================
 * Confirm modal: bấm "Đăng xuất" → hỏi xác nhận trước khi logout.
 * ==========================================================================*/
const confirmOpen = ref(false);

const openConfirm = (): void => {
  confirmOpen.value = true;
};
const cancelLogout = (): void => {
  confirmOpen.value = false;
};
const confirmLogout = async (): Promise<void> => {
  confirmOpen.value = false;
  await auth.logout();
  router.push('/login');
};

/* ============================================================================
 * Menu: 5 nhóm, 8 mục (per user spec).
 *   - Tổng quan: Dashboard
 *   - Người dùng: Ứng viên, Nhà tuyển dụng
 *   - Nội dung: Tất cả job, Công ty, Báo cáo & khiếu nại (badge đỏ)
 *   - Kinh doanh: Gói dịch vụ & thanh toán
 *   - Hệ thống: Cấu hình hệ thống, Nhật ký xoá/khoá (danger tint)
 * ==========================================================================*/
const groups: MenuGroup[] = [
  {
    title: 'Tổng quan',
    items: [
      {
        label: 'Dashboard',
        icon: LayoutDashboard,
        to: '/admin',
        exact: true,
      },
    ],
  },

  {
    title: 'Người dùng',
    items: [
      {
        // Master user directory — list mọi role (candidate/employer/admin),
        // search + filter status. Role filter ở trong page nếu cần lọc riêng.
        label: 'Tất cả người dùng',
        icon: UserCog,
        to: '/admin/users',
        activeOn: ['/admin/users'],
      },
    ],
  },

  {
    title: 'Nội dung',
    items: [
      {
        // Tất cả job (mọi status) — drill-down xem scan-result, force re-scan.
        // Match cả /admin/jobs/123 (job detail nếu có).
        label: 'Tất cả job',
        icon: Briefcase,
        to: '/admin/jobs',
        activeOn: ['/admin/jobs'],
      },
      {
        label: 'Công ty',
        icon: Building,
        to: '/admin/companies',
        activeOn: ['/admin/companies'],
      },
      {
        label: 'Báo cáo & khiếu nại',
        icon: Flag,
        to: '/admin/reports',
        activeOn: ['/admin/reports'],
        badge: 'count',
        badgeTone: 'red',
      },
    ],
  },

  {
    title: 'Kinh doanh',
    items: [
      {
        // Plans CRUD — tách riêng khỏi billing vì workflow CRUD plans khác
        // hoàn toàn so với xem payments history hay subscriptions active.
        label: 'Gói dịch vụ',
        icon: Package,
        to: '/admin/plans',
        activeOn: ['/admin/plans'],
      },
      {
        // Subscription list + admin update (extend expires_at, cancel, auto_renew).
        label: 'Subscription',
        icon: RefreshCw,
        to: '/admin/subscriptions',
        activeOn: ['/admin/subscriptions'],
      },
      {
        // Payment history + refund (admin).
        label: 'Thanh toán',
        icon: Wallet,
        to: '/admin/payments',
        activeOn: ['/admin/payments'],
      },
    ],
  },

  {
    title: 'Hệ thống',
    items: [
      {
        label: 'Gửi thông báo',
        icon: Megaphone,
        to: '/admin/notifications',
        activeOn: ['/admin/notifications'],
      },
      {
        label: 'Skills',
        icon: Sparkles,
        to: '/admin/skills',
        activeOn: ['/admin/skills'],
      },
      {
        label: 'Cấu hình hệ thống',
        icon: Settings,
        to: '/admin/settings',
        activeOn: ['/admin/settings'],
      },
      {
        label: 'Nhật ký xoá/khoá',
        icon: History,
        to: '/admin/logs',
        activeOn: ['/admin/logs'],
        danger: true,
      },
    ],
  },
];

/** Lấy count tương ứng cho badge — map theo `to` để không phụ thuộc label. */
const badgeCount = (item: MenuItem): number => {
  if (item.to === '/admin/reports') return props.reportsCount ?? 0;
  return 0;
};

/** Tính điểm match cho 1 item (mirror CandidateSidebar logic). */
const matchScore = (item: MenuItem): number => {
  if (item.exact) {
    return route.path === item.to ? item.to.length : -1;
  }
  if (route.path === item.to) return item.to.length;
  for (const prefix of item.activeOn ?? []) {
    if (route.path === prefix || route.path.startsWith(`${prefix}/`)) {
      return prefix.length;
    }
  }
  return -1;
};

/** Item active = item có matchScore lớn nhất (match cụ thể nhất). */
const allItems = computed<MenuItem[]>(() => groups.flatMap((g) => g.items));
const activeItem = computed<MenuItem | null>(() => {
  let best: MenuItem | null = null;
  let bestScore = -1;
  for (const item of allItems.value) {
    const s = matchScore(item);
    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return bestScore > 0 ? best : null;
});

const isActive = (item: MenuItem): boolean => activeItem.value === item;
</script>

<template>
  <!--
    Responsive:
      - Mobile: overlay trượt từ trái (mobileOpen controls), w-72 (~288px) khi open.
      - md+: static col bên trái, w-64 hoặc w-16 tuỳ collapsed.
    Theme: dark — nền #14161c, border #262a35, accent indigo.
  -->
  <aside
    class="flex flex-col transition-[transform,width] duration-300 ease-out"
    :class="[
      'bg-[var(--admin-bg)]',
      // Positioning
      'absolute inset-y-0 left-0 z-40 md:sticky md:top-0 md:z-auto',
      // Mobile slide state — shadow-xl khi overlay, shadow mềm khi sticky desktop
      props.mobileOpen
        ? 'translate-x-0 shadow-xl md:transform-none md:shadow-none'
        : '-translate-x-full md:transform-none',
      // Width
      props.mobileOpen ? 'w-72' : 'w-0',
      collapsed ? 'md:w-16' : 'md:w-64',
      'h-screen md:h-screen',
      'overflow-hidden md:overflow-visible',
    ]"
    :style="!props.mobileOpen ? 'box-shadow: 4px 0 16px rgba(0, 0, 0, 0.08);' : ''"
  >
    <!-- Header: logo + ADMIN badge -->
    <div
      class="relative border-b border-[var(--admin-border)] flex items-center transition-all duration-200"
      :class="[
        collapsed && !props.mobileOpen ? 'justify-center px-2 py-5' : 'pl-5 pr-3 py-5',
      ]"
    >
      <div v-if="!collapsed || props.mobileOpen" class="min-w-0 flex items-center gap-2">
        <h1 class="text-base font-bold text-[var(--admin-text-bright)] tracking-tight truncate">
          JOBMATCH<span class="text-[var(--admin-accent-light)]">VN</span>
        </h1>
        <span
          class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-white"
          style="background: linear-gradient(135deg, var(--admin-accent) 0%, var(--admin-accent-strong) 100%);"
        >
          Admin
        </span>
      </div>
      <h1
        v-else
        class="text-base font-bold text-[var(--admin-accent-light)] tracking-tight"
        title="JOBMATCH VN Admin"
      >
        JM
      </h1>

      <!-- Close button (mobile only) -->
      <button
        v-if="props.mobileOpen"
        type="button"
        class="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--admin-text-sub)] hover:bg-[var(--admin-bg-soft)] hover:text-[var(--admin-text-bright)] md:hidden"
        title="Đóng menu"
        aria-label="Đóng menu"
        @click="emit('close-mobile')"
      >
        <X class="h-4 w-4" />
      </button>

      <!-- Toggle button — nền tối (thay vì trắng như 2 sidebar kia) để hợp dark theme -->
      <button
        v-if="!props.mobileOpen"
        type="button"
        class="absolute top-1/2 -translate-y-1/2 -right-3 z-20 w-6 h-6 bg-[var(--admin-bg)] border border-[var(--admin-border)] rounded-full shadow-sm items-center justify-center text-[var(--admin-text-sub)] hover:text-[var(--admin-text-bright)] hover:bg-[var(--admin-bg-soft)] transition hidden md:flex"
        :title="collapsed ? 'Mở rộng' : 'Thu nhỏ'"
        @click="toggleCollapsed"
      >
        <PanelLeftClose v-if="!collapsed" class="w-3.5 h-3.5" />
        <PanelLeftOpen v-else class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Menu (custom thin scrollbar cho dark theme) -->
    <nav
      class="flex-1 overflow-y-auto py-4 [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar]:h-0.5 [&::-webkit-scrollbar-thumb]:bg-[var(--admin-border)] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[var(--admin-text-muted)] [scrollbar-width:thin] [scrollbar-color:var(--admin-border)_transparent]"
      :class="collapsed ? 'px-2' : 'px-3'"
    >
      <div v-for="group in groups" :key="group.title" class="mb-5 last:mb-0">
        <p
          v-if="!collapsed"
          class="pl-4 pr-3 mb-2 text-[11px] font-semibold text-[var(--admin-text-muted)] uppercase tracking-wider"
        >
          {{ group.title }}
        </p>
        <ul class="space-y-1">
          <li v-for="item in group.items" :key="item.label">
            <!-- Item dạng action (nếu có) — render button. -->
            <button
              v-if="item.action"
              type="button"
              class="w-full flex items-center gap-3 pl-4 pr-3 py-2 rounded-lg text-sm transition text-left border border-transparent text-[var(--admin-text)] hover:bg-[var(--admin-bg-soft)] hover:text-[var(--admin-text-bright)]"
              :class="collapsed ? 'justify-center' : ''"
              :title="collapsed ? item.label : undefined"
              @click="item.action()"
            >
              <component :is="item.icon" class="w-4 h-4 shrink-0" />
              <span v-if="!collapsed">{{ item.label }}</span>
            </button>

            <router-link
              v-else
              :to="item.to!"
              class="relative flex items-center gap-3 pl-4 pr-3 py-2 rounded-lg text-sm transition border"
              :class="[
                isActive(item)
                  ? 'bg-[var(--admin-accent-bg)] text-[var(--admin-accent-text)] font-medium border-[var(--admin-accent-border)]'
                  : item.danger
                    ? 'text-[var(--admin-danger-light)] border-transparent hover:bg-[var(--admin-danger-soft)] hover:text-[#fca5a5]'
                    : 'text-[var(--admin-text)] border-transparent hover:bg-[var(--admin-bg-soft)] hover:text-[var(--admin-text-bright)]',
                collapsed ? 'justify-center' : '',
              ]"
              :title="collapsed ? item.label : undefined"
            >
              <!-- Viền trái 2px màu accent cho item đang active — điểm neo màu chung
                   giữa sidebar (dark) và content (light). Cùng tone với nút
                   primary trong page content. -->
              <span
                v-if="isActive(item)"
                class="absolute inset-y-1 left-0 w-0.5 rounded-r-full"
                style="background-color: var(--admin-accent);"
              />
              <component :is="item.icon" class="w-4 h-4 shrink-0" />
              <span v-if="!collapsed" class="flex-1 truncate">{{ item.label }}</span>

              <!-- Badge count: ẩn khi collapsed (icon-only) hoặc khi count=0 -->
              <span
                v-if="!collapsed && item.badge && badgeCount(item) > 0"
                class="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md text-[10px] font-bold leading-none"
                :class="item.badgeTone === 'red'
                  ? 'bg-[var(--admin-danger-soft-strong)] text-[var(--admin-danger-light)]'
                  : 'bg-[var(--admin-warn-soft)] text-[var(--admin-warn)]'"
              >
                {{ badgeCount(item) > 99 ? '99+' : badgeCount(item) }}
              </span>
            </router-link>
          </li>
        </ul>
      </div>
    </nav>

    <!-- Footer: account block.
         - Expanded: avatar (40px, QT, indigo) + tên "Quản trị viên" + email + logout icon.
         - Collapsed: avatar 1 hàng, logout icon 1 hàng (xếp dọc). -->
    <div class="border-t border-[var(--admin-border)]">
      <!-- Expanded -->
      <div v-if="!collapsed" class="pl-4 pr-3 py-3">
        <div class="flex items-center gap-2.5">
          <div
            :title="displayName"
            class="w-10 h-10 rounded-full bg-[var(--admin-accent-bg-strong)] text-[var(--admin-accent-text)] border border-[var(--admin-accent-border)] flex items-center justify-center text-sm font-semibold shrink-0"
          >
            {{ initials }}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-[var(--admin-text-bright)] truncate leading-tight">
              {{ displayName }}
            </p>
            <p class="text-xs text-[var(--admin-text-sub)] truncate leading-tight mt-0.5">
              {{ displayEmail }}
            </p>
          </div>
          <button
            type="button"
            title="Đăng xuất"
            class="w-8 h-8 rounded-md text-[var(--admin-text-sub)] hover:text-[var(--admin-danger)] hover:bg-[var(--admin-danger-soft)] flex items-center justify-center transition shrink-0"
            @click="openConfirm"
          >
            <LogOut class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Collapsed -->
      <div v-else class="px-2 py-3 flex flex-col items-center gap-2">
        <div
          :title="displayName"
          class="w-10 h-10 rounded-full bg-[var(--admin-accent-bg-strong)] text-[var(--admin-accent-text)] border border-[var(--admin-accent-border)] flex items-center justify-center text-sm font-semibold"
        >
          {{ initials }}
        </div>
        <button
          type="button"
          title="Đăng xuất"
          class="w-8 h-8 rounded-md text-[var(--admin-text-sub)] hover:text-[var(--admin-danger)] hover:bg-[var(--admin-danger-soft)] flex items-center justify-center transition"
          @click="openConfirm"
        >
          <LogOut class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Confirm modal: theme sáng vì overlay ngoài content page (vẫn nền sáng). -->
    <Teleport to="body">
      <div
        v-if="confirmOpen"
        class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        @click.self="cancelLogout"
      >
        <div class="bg-white rounded-lg shadow-xl max-w-sm w-full p-5">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
              <LogOut class="w-4 h-4 text-red-600" />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-base font-semibold text-gray-900">Đăng xuất</h3>
              <p class="text-sm text-gray-600 mt-1">
                Bạn có chắc muốn đăng xuất khỏi tài khoản quản trị?
              </p>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded-md text-gray-700 hover:bg-gray-100 transition"
              @click="cancelLogout"
            >
              Hủy
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 transition"
              @click="confirmLogout"
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </aside>
</template>

<style>
/* ============================================================================
 * Admin dark theme tokens
 * Đặt ở :root (không scoped) để mọi element con dùng được qua var(--...).
 * Các token này CHỈ dùng cho AdminSidebar — candidate/employer giữ theme sáng
 * riêng nên không xung đột.
 * ==========================================================================*/
:root {
  /* Surfaces */
  --admin-bg: #14161c;             /* nền sidebar */
  --admin-bg-soft: #1b1e26;        /* hover row */
  --admin-border: #262a35;         /* viền */

  /* Text */
  --admin-text-muted: #5b6070;     /* label nhóm */
  --admin-text-sub: #8a8f9c;       /* phụ (email, icon inactive) */
  --admin-text: #c3c7d1;           /* chính */
  --admin-text-bright: #f2f3f5;    /* nổi bật (tên, hover) */

  /* Accent — indigo */
  --admin-accent: #6366f1;
  --admin-accent-light: #818cf8;   /* "VN" + initials */
  --admin-accent-text: #a5b4fc;    /* active text */
  --admin-accent-bg: rgba(99, 102, 241, 0.14);
  --admin-accent-bg-strong: rgba(99, 102, 241, 0.16);  /* avatar nền */
  --admin-accent-border: rgba(99, 102, 241, 0.35);

  /* Danger — đỏ */
  --admin-danger: #f04438;
  --admin-danger-light: #f87171;
  --admin-danger-soft: rgba(240, 68, 56, 0.10);
  --admin-danger-soft-strong: rgba(240, 68, 56, 0.15);  /* badge đỏ */

  /* Warning — vàng */
  --admin-warn: #fbbf24;
  --admin-warn-soft: rgba(251, 191, 36, 0.15);
}
</style>
