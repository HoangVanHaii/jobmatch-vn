<script setup lang="ts">
/**
 * EmployerSidebar — sidebar cho khu vực `/employer/*`.
 *
 * Pattern mirror hoàn toàn CandidateSidebar:
 *  - 5 nhóm: Tổng quan, Tuyển dụng, Công ty, Hỗ trợ, Gói dịch vụ.
 *  - Mobile overlay + desktop collapse (w-60 / w-16), lưu localStorage.
 *  - Footer: avatar + displayName + roleLabel ("Nhà tuyển dụng") + logout button
 *    + Teleport confirm modal.
 *
 * Nghiệp vụ employer (mirror backend routers):
 *  - Quản lý job: /employer/jobs, /employer/jobs/new
 *  - Đơn ứng tuyển (applications): /employer/applications
 *  - Phỏng vấn (interview): /employer/interviews
 *  - Công ty (company profile + members): /employer/company, /employer/company/members
 *  - Chat: /employer/chat
 *  - Gói dịch vụ / billing: /employer/pricing, /employer/billing/history
 *  - Cài đặt: /employer/settings
 */
import { ref, onMounted, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@stores/auth';
import {
  Briefcase,
  Plus,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  MessageCircle,
  CreditCard,
  History,
  X,
  Building2,
  Users,
  Calendar,
  Settings,
  ClipboardList,
} from 'lucide-vue-next';

interface MenuItem {
  label: string;
  icon: typeof Briefcase;
  to: string;
  /** Match the given path prefixes too (e.g. /employer/jobs/new cũng coi là
   *  active ở "Job đã đăng"). */
  activeOn?: string[];
  /** Nếu true, chỉ match exact path (bỏ activeOn). Dùng cho root path như
   *  /employer để không match nhầm các route con. */
  exact?: boolean;
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
   * trên mobile, sidebar chiếm w-72 (bỏ qua `collapsed` để luôn mở rộng cho dễ đọc).
   * Trên md+ `mobileOpen` bị bỏ qua — sidebar là static col bình thường.
   */
  mobileOpen?: boolean;
}>();

const emit = defineEmits<{
  /** Đóng sidebar overlay trên mobile (user bấm nút X hoặc backdrop). */
  (e: 'close-mobile'): void;
}>();

/**
 * Auto-close overlay khi user navigate sang route khác qua menu link — không
 * cần bấm X/backdrop. Mobile UX chuẩn: bấm menu → trượt đóng → hiện page mới.
 */
watch(
  () => route.path,
  () => {
    if (props.mobileOpen) emit('close-mobile');
  },
);

/** Thu nhỏ / mở rộng sidebar — lưu vào localStorage để giữ qua reload. */
const collapsed = ref<boolean>(false);
const SIDEBAR_KEY = 'employer-sidebar-collapsed';

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
 * Footer: avatar + logout
 * ==========================================================================*/
const auth = useAuthStore();
const { user } = storeToRefs(auth);
const router = useRouter();

const displayName = computed<string>(() => {
  const u = user.value;
  if (!u) return '';
  const meta = u.metadata as Record<string, unknown> | undefined;
  const name = (meta?.fullName as string) ?? u.email.split('@')[0];
  return name.trim();
});

const initials = computed<string>(() => {
  const n = displayName.value;
  return n ? n.charAt(0).toUpperCase() : '?';
});

/** Role label — Employer sidebar luôn hiển thị "Nhà tuyển dụng". */
const roleLabel = computed<string>(() => {
  const role = user.value?.role;
  if (role === 'employer') return 'Nhà tuyển dụng';
  if (role === 'candidate') return 'Ứng viên';
  if (role === 'admin') return 'Quản trị viên';
  return 'Nhà tuyển dụng';
});

/* ============================================================================
 * Confirm modal: bấm "Đăng xuất" → hỏi xác nhận trước khi gọi logout.
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

/**
 * Sidebar scope: CHỈ hiện các menu có route thực sự tồn tại trong router.
 * Mỗi menu item map với 1 endpoint backend tương ứng (xem header nghiệp vụ).
 */
const groups: MenuGroup[] = [
  {
    title: 'Tổng quan',
    items: [
      {
        label: 'Trang chủ',
        icon: Home,
        to: '/employer',
        exact: true,
      },
    ],
  },

  {
    title: 'Tuyển dụng',
    items: [
      {
        label: 'Job đã đăng',
        icon: Briefcase,
        to: '/employer/jobs',
        activeOn: ['/employer/jobs'],
      },
      {
        label: 'Đơn ứng tuyển',
        icon: ClipboardList,
        to: '/employer/applications',
        activeOn: ['/employer/applications'],
      },
      {
        label: 'Lịch phỏng vấn',
        icon: Calendar,
        to: '/employer/interviews',
        activeOn: ['/employer/interviews'],
      },
    ],
  },

  {
    title: 'Công ty',
    items: [
      {
        label: 'Hồ sơ công ty',
        icon: Building2,
        to: '/employer/company',
        activeOn: ['/employer/company'],
      },
      {
        label: 'Thành viên',
        icon: Users,
        to: '/employer/company/members',
        activeOn: ['/employer/company/members'],
      },
    ],
  },

  {
    title: 'Hỗ trợ',
    items: [
      {
        label: 'Trò chuyện',
        icon: MessageCircle,
        to: '/employer/chat',
        activeOn: ['/employer/chat'],
      },
      {
        label: 'Cài đặt',
        icon: Settings,
        to: '/employer/settings',
        activeOn: ['/employer/settings'],
      },
    ],
  },

  {
    title: 'Gói dịch vụ',
    items: [
      {
        label: 'Nâng cấp',
        icon: CreditCard,
        to: '/employer/pricing',
        activeOn: ['/employer/pricing'],
      },
      {
        label: 'Lịch sử thanh toán',
        icon: History,
        to: '/employer/billing/history',
        activeOn: ['/employer/billing/history', '/employer/billing/success', '/employer/billing/cancel'],
      },
    ],
  },
];

/** Tính điểm match cho 1 item — chọn match cụ thể nhất. */
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
      - Mobile: overlay trượt từ trái qua phải (mobileOpen controls visibility).
        Width cố định w-72 (~288px) khi open, dù user có collapsed hay không — buộc
        expand trên mobile để dễ đọc.
      - md+: static col bên trái, w-60 hoặc w-16 tuỳ collapsed.
    Transition: translate-x + width (300ms) cho slide mượt.
  -->
  <aside
    class="bg-white border-r border-gray-200 flex flex-col transition-[transform,width] duration-300 ease-out"
    :class="[
      // Positioning
      'absolute inset-y-0 left-0 z-40 md:sticky md:top-0 md:z-auto',
      // Mobile slide state. `md:transform-none` reset transform trên desktop để
      // KHÔNG tạo transform-stacking-context (làm kẹt toggle button bên trong,
      // khiến nó bị phần tử static ở cột bên cạnh đè lên dù z-index cao hơn).
      props.mobileOpen
        ? 'translate-x-0 shadow-xl md:transform-none md:shadow-none'
        : '-translate-x-full md:transform-none',
      // Width: mobile override (force expanded when open) | desktop collapse state
      props.mobileOpen ? 'w-72' : 'w-0',
      collapsed ? 'md:w-16' : 'md:w-60',
      // Height: full screen on mobile overlay, normal on desktop
      'h-screen md:h-screen',
      // Overflow: clip trên mobile khi w-0 (ẩn content khi sidebar đóng), nhưng
      // md+ cần visible để toggle button ở `-right-3` được stick out qua border.
      'overflow-hidden md:overflow-visible',
    ]"
  >
    <!-- Logo + (X close on mobile | toggle on desktop) -->
    <div
      class="relative border-b border-gray-200 flex items-center transition-all duration-200"
      :class="[
        collapsed && !props.mobileOpen ? 'justify-center px-2 py-5' : 'pl-5 pr-3 py-5',
      ]"
    >
      <router-link v-if="!collapsed || props.mobileOpen" to="/employer" class="block min-w-0">
        <h1 class="text-lg font-bold text-gray-900 tracking-tight truncate">
          JOBMATCH<span class="text-primary-600">VN</span>
        </h1>
        <p v-if="!collapsed" class="text-xs text-gray-500 mt-0.5">Employer Workspace</p>
      </router-link>
      <router-link v-else to="/employer" class="block" title="JOBMATCH VN">
        <h1 class="text-base font-bold text-primary-600 tracking-tight">JM</h1>
      </router-link>

      <!-- Close button (mobile only, chỉ hiện khi overlay mở) -->
      <button
        v-if="props.mobileOpen"
        type="button"
        class="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 md:hidden"
        title="Đóng menu"
        aria-label="Đóng menu"
        @click="emit('close-mobile')"
      >
        <X class="h-4 w-4" />
      </button>

      <!-- Toggle button: absolute, "đậu" trên border-r, có bg trắng + shadow để nổi (desktop only) -->
      <button
        v-if="!props.mobileOpen"
        type="button"
        class="absolute top-1/2 -translate-y-1/2 -right-3 z-20 w-6 h-6 bg-white border border-gray-200 rounded-full shadow-sm items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition hidden md:flex"
        :title="collapsed ? 'Mở rộng' : 'Thu nhỏ'"
        @click="toggleCollapsed"
      >
        <PanelLeftClose v-if="!collapsed" class="w-3.5 h-3.5" />
        <PanelLeftOpen v-else class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Menu (custom thin scrollbar khi nội dung tràn) -->
    <nav
      class="flex-1 overflow-y-auto py-4 [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar]:h-0.5 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-gray-400 [scrollbar-width:thin] [scrollbar-color:rgb(209_213_219)_transparent]"
      :class="collapsed ? 'px-2' : 'px-3'"
    >
      <div v-for="group in groups" :key="group.title" class="mb-5 last:mb-0">
        <p
          v-if="!collapsed"
          class="px-3 mb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider"
        >
          {{ group.title }}
        </p>
        <ul class="space-y-1">
          <li v-for="item in group.items" :key="item.to">
            <router-link
              :to="item.to"
              class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition"
              :class="[
                isActive(item)
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50',
                collapsed ? 'justify-center' : ''
              ]"
              :title="collapsed ? item.label : undefined"
            >
              <component :is="item.icon" class="w-4 h-4 shrink-0" />
              <span v-if="!collapsed">{{ item.label }}</span>
            </router-link>
          </li>
        </ul>
      </div>
    </nav>

    <!-- Footer: account block -->
    <div class="border-t border-gray-200">
      <!-- Expanded: avatar + (name + role) + icon logout (cùng hàng) -->
      <div v-if="!collapsed" class="px-3 py-3">
        <div class="flex items-center gap-2.5">
          <div
            :title="displayName"
            class="w-10 h-10 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-sm font-semibold shrink-0"
          >
            {{ initials }}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 truncate leading-tight">{{ displayName }}</p>
            <p class="text-xs text-gray-500 truncate leading-tight mt-0.5">{{ roleLabel }}</p>
          </div>
          <button
            type="button"
            title="Đăng xuất"
            class="w-8 h-8 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition shrink-0"
            @click="openConfirm"
          >
            <LogOut class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Collapsed: avatar (1 hàng) + icon logout (1 hàng) -->
      <div v-else class="px-2 py-3 flex flex-col items-center gap-2">
        <div
          :title="displayName"
          class="w-10 h-10 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-sm font-semibold hover:bg-gray-300 transition cursor-default"
        >
          {{ initials }}
        </div>
        <button
          type="button"
          title="Đăng xuất"
          class="w-8 h-8 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition"
          @click="openConfirm"
        >
          <LogOut class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Confirm modal: hỏi trước khi logout -->
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
              <p class="text-sm text-gray-600 mt-1">Bạn có chắc muốn đăng xuất khỏi tài khoản?</p>
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