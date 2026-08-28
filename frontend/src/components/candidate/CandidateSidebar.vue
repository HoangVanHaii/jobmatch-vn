<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '@stores/auth';
import {
  Briefcase,
  FileText,
  Plus,
  Home,
  Bookmark,
  Send,
  User,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  MessageCircle,
  Bot,
  CreditCard,
  History
} from 'lucide-vue-next';

interface MenuItem {
  label: string;
  icon: typeof Briefcase;
  to: string;
  /** Match the given path prefixes too (e.g. /candidate/resumes/new cũng coi là active ở "CV của tôi"). */
  activeOn?: string[];
  /** Nếu true, chỉ match exact path (bỏ activeOn). Dùng cho root path như /candidate
   *  để không match nhầm các route con (/candidate/resumes, /candidate/...). */
  exact?: boolean;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const route = useRoute();

/** Thu nhỏ / m� rộng sidebar — lưu vào localStorage để giữ qua reload. */
const collapsed = ref<boolean>(false);
const SIDEBAR_KEY = 'candidate-sidebar-collapsed';

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
 * - Auth store đã có sẵn user (email + metadata?.fullName) + logout() action.
 * - Expanded: avatar + name/email + nút logout (icon) cùng row.
 * - Collapsed: chỉ avatar, click → popover (email + "Đăng xuất").
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

/** Role label — Candidate sidebar luôn hiển thị "Ứng viên".
 *  (Map theo `user.role` để khớp thực tế, fallback nếu backend trả role khác.) */
const roleLabel = computed<string>(() => {
  const role = user.value?.role;
  if (role === 'candidate') return 'Ứng viên';
  if (role === 'employer') return 'Nhà tuyển dụng';
  if (role === 'admin') return 'Quản trị viên';
  return 'Ứng viên';
});

/* ============================================================================
 * Confirm modal: bấm "Đăng xuất" → hỏi xác nhận trước khi gọi logout.
 * - confirmOpen: bật/tắt modal.
 * - openConfirm(): mở modal (gắn vào 2 button logout).
 * - confirmLogout(): thực sự logout + đóng modal.
 * - cancelLogout(): đóng modal, không logout.
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
 * Sidebar scope: CHỈ hiện các menu có route + view thực sự tồn tại.
 * Các menu đã có trong spec nhưng chưa implement (Saved, CV Scoring,
 * Applications, Settings) đã được ẩn — không tạo view placeholder.
 */
const groups: MenuGroup[] = [
  {
    title: 'Tổng quan',
    items: [
      {
        label: 'Trang chủ',
        icon: Home,
        to: '/candidate',
        exact: true,
      },
    ],
  },

  {
    title: 'Việc làm',
    items: [
      {
        label: 'Việc làm',
        icon: Briefcase,
        to: '/jobs',
        activeOn: ['/jobs'],
      },
      {
        label: 'Việc làm đã lưu',
        icon: Bookmark,
        to: '/candidate/saved-jobs',
        activeOn: ['/candidate/saved-jobs'],
      },
      {
        label: 'Đơn ứng tuyển',
        icon: Send,
        to: '/candidate/applications',
        activeOn: ['/candidate/applications'],
      },
    ],
  },

  {
    title: 'Hồ sơ & CV',
    items: [
      {
        label: 'Hồ sơ của tôi',
        icon: User,
        to: '/candidate/profile',
        activeOn: ['/candidate/profile'],
      },
      {
        label: 'CV của tôi',
        icon: FileText,
        to: '/candidate/resumes',
        activeOn: ['/candidate/resumes'],
      },
      {
        label: 'Tạo CV',
        icon: Plus,
        to: '/candidate/resumes/new',
        activeOn: ['/candidate/resumes/new'],
      },
    ],
  },
  {
    title: 'Hỗ trợ',
    items: [
      {
        label: 'Trò chuyện',
        icon: MessageCircle,
        to: '/chat',
        activeOn: ['/chat'],
      },
      {
        label: 'Chatbot AI',
        icon: Bot,
        to: '/candidate/chatbot',
        activeOn: ['/candidate/chatbot'],
      },
    ],
  },

  {
    title: 'Gói dịch vụ',
    items: [
      {
        label: 'Nâng cấp',
        icon: CreditCard,
        to: '/candidate/pricing',
        activeOn: ['/candidate/pricing'],
    },
      {
        label: 'Gói của tôi',
        icon: History,
        to: '/candidate/billing/history',
        activeOn: ['/candidate/billing/history', '/candidate/billing/success', '/candidate/billing/cancel'],
      }
    ],
  },
];

/** Tính điểm match cho 1 item:
 *  - exact=true: chỉ match khi path === to (điểm = độ dài `to`, -1 nếu không match).
 *  - exact=false: match exact `to` hoặc path nằm trong `activeOn` ở biên segment.
 *
 *  Trả về -1 nếu không match, ngược lại trả độ dài của path match được
 *  (dùng để so sánh "match nào cụ thể hơn"). */
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

/** Item active = item có matchScore lớn nhất.
 *  Ví dụ: ở `/candidate/resumes/new` thì "CV của tôi" (prefix `/candidate/resumes`, độ dài 19)
 *  và "Tạo CV" (prefix `/candidate/resumes/new`, độ dài 23) đều match — nhưng "Tạo CV"
 *  dài hơn nên thắng → chỉ 1 item active tại 1 thời điểm, không bị "highlight kép". */
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
  <aside
    class="shrink-0 h-screen sticky top-0 bg-white border-r border-gray-200 flex flex-col transition-all duration-200"
    :class="collapsed ? 'w-16' : 'w-60'"
  >
    <!-- Logo + toggle (icon absolute, tràn qua border-r của aside) -->
    <div
      class="relative border-b border-gray-200 flex items-center transition-all duration-200"
      :class="collapsed ? 'justify-center px-2 py-5' : 'pl-5 pr-8 py-5'"
    >
      <router-link v-if="!collapsed" to="/candidate/resumes" class="block">
        <h1 class="text-lg font-bold text-gray-900 tracking-tight">JOBMATCH<span class="text-primary-600">VN</span></h1>
        <p class="text-xs text-gray-500 mt-0.5">Candidate Workspace</p>
      </router-link>
      <router-link v-else to="/candidate/resumes" class="block" title="JOBMATCH VN">
        <h1 class="text-base font-bold text-primary-600 tracking-tight">JM</h1>
      </router-link>

      <!-- Toggle button: absolute, "đậu" trên border-r, có bg trắng + shadow để nổi -->
      <button
        type="button"
        class="absolute top-1/2 -translate-y-1/2 -right-3 w-6 h-6 bg-white border border-gray-200 rounded-full shadow-sm flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition"
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

    <!-- Footer: account block.
         - Expanded: avatar (40px) + name/role + logout icon CÙNG 1 HÀNG NGANG.
         - Collapsed: avatar 1 hàng, logout icon 1 hàng (xếp dọc). -->
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
