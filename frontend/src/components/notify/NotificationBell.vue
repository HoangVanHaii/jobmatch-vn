<script setup lang="ts">
/**
 * NotificationBell — chuông + dropdown thông báo realtime.
 *
 * Hiển thị:
 *   - Badge số chưa đọc
 *   - Dropdown danh sách (mới nhất trên đầu) + thời gian tương đối
 *   - Click vào row → mark-read + navigate đến route tương ứng
 *
 * KHÔNG đăng ký `notification:new` ở đây. Nguồn DUY NHẤT là
 * `stores/notification.ts` (bindSocket), do auth store gọi khi login và khi
 * khôi phục phiên. Đăng ký thêm ở component sẽ tạo listener thứ hai trên cùng
 * socket singleton → mỗi thông báo bị pushLocal 2 lần → list trùng dòng, badge
 * đếm gấp đôi, và markLocal (findIndex) chỉ đánh dấu được bản sao đầu tiên nên
 * badge không bao giờ về 0.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { markRaw, type Component } from 'vue';
import {
  Bell,
  Check,
  CheckCheck,
  X,
  Inbox,
  Building2,
  Briefcase,
  MessageCircle,
  UserPlus,
  UserMinus,
  Sparkles,
  Settings,
} from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { useNotificationStore } from '@stores/notification';
import { useAuthStore } from '@stores/auth';
import type { Notification } from '../../types/notification';

const store = useNotificationStore();
const auth = useAuthStore();
const router = useRouter();
const open = ref(false);

const unread = computed(() => store.unreadCount);

/**
 * Đồng hồ cho `elapsedText`. Chỉ chạy khi dropdown MỞ: `now` là dependency của
 * mọi dòng trong v-for nên tick nền vĩnh viễn sẽ re-render cả list kể cả khi
 * dropdown đóng và khi tab ẩn. Độ phân giải 1s là đủ vì elapsedText chỉ hiển
 * thị tới đơn vị giây.
 */
const now = ref(Date.now());
let tickHandle: ReturnType<typeof setInterval> | null = null;

const stopTick = (): void => {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
};

const startTick = (): void => {
  stopTick();
  now.value = Date.now();
  tickHandle = setInterval(() => (now.value = Date.now()), 1000);
};

watch(open, (isOpen) => (isOpen ? startTick() : stopTick()));

onMounted(async () => {
  if (auth.isAuthenticated) await store.fetchFirstPage();
});

onUnmounted(() => {
  stopTick();
});

watch(
  () => auth.isAuthenticated,
  async (authed) => {
    if (authed) await store.fetchFirstPage();
    else store.reset();
  },
);

const onToggle = () => (open.value = !open.value);
const onClose = () => (open.value = false);

const onClickOutside = (e: MouseEvent): void => {
  const target = e.target as HTMLElement;
  if (!target.closest('.notif-bell-root')) open.value = false;
};
onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));

const onMarkRead = async (id: string, e: Event): Promise<void> => {
  e.stopPropagation();
  await store.markRead(id);
};

const onMarkAll = async (e: Event): Promise<void> => {
  e.stopPropagation();
  // CHỈ đánh dấu những item đã load (giới hạn page hiện tại). User có thể
  // có nhiều hơn — sau lần "Tải thêm" tiếp theo vẫn còn item chưa đọc,
  // giải pháp ngầm: khi fetchNextPage chạy, `totalUnread` được server
  // overwrite về số thật → badge tự điều chỉnh.
  const items = store.items.filter((n) => n.readAt === null);
  await Promise.all(items.map((n) => store.markRead(n.id)));
  // Có thể decrement tổng nếu tất cả items được mark; markRead đã giảm 1/1
  // rồi, không cần làm thêm ở đây (decrement chỉ trigger khi wasUnread=true).
};

/**
 * Click vào 1 row notification.
 *
 *   1. Mark-read (luôn luôn — user đã "thấy" nó).
 *   2. Navigate theo dispatch table:
 *
 *      Company-member notifications (type='company' + kind):
 *        - Nhóm "cá nhân" (user đang ở ngoài company) → /employer/company
 *            company_invite_sent | invite_cancelled | removed_from_company
 *          + Legacy type='company_invite' (rows cũ).
 *        - Nhóm "team" (user đã là active member/owner) → /employer/company/members
 *            company_invite_accepted | company_invite_declined
 *          | company_member_left
 *          | company_owner_transferred
 *          | company_owner_transferred_to_you
 *          | company_owner_transferred_from_you
 *
 *      Application notifications:
 *        - application_new | application_withdrawn → /employer/jobs/:jobId
 *        - application_match_ready              → /candidate/applications
 *      Chat/Job:
 *        - message → /chat/:conversationId
 *        - job_match → /candidate/viec-lam/:jobId
 *
 *   3. Đóng dropdown.
 *
 * Negative cases đã verify:
 *   - KHÔNG để type='company' với kind='company_*' rơi vào default "no
 *     navigate" — đã rơi vào đó trước đây, user phải tự tìm trang thay
 *     vì bell đưa đến. Giờ mỗi kind đều có route đúng.
 *   - `company_invite_sent` KHÔNG navigate đến `employer-company-members`
 *     — đó là trang quản lý members của công ty user đang ACTIVE, không có
 *     nút accept. Trang đúng là `employer-company` (CompanyView), có
 *     section "Lời mời đang chờ" với nút Chấp nhận/Từ chối.
 *
 * Note: chat socket ở App.vue đã listen `chat:new` cho sidebar chat realtime,
 * nhưng `notification:new` (loại 'message') vẫn đến bell và CẦN navigate khi
 * user click. Hai event socket khác nhau, không trùng.
 */
const onClickItem = async (n: Notification, e: Event): Promise<void> => {
  e.stopPropagation();

  // 1. Mark-read ngay (optimistic; backend sẽ sync).
  if (!n.readAt) {
    void store.markRead(n.id);
  }

  const payload = (n.payload ?? {}) as Record<string, unknown>;
  const kind = typeof payload.kind === 'string' ? payload.kind : null;

  // 2. Dispatch.
  if (n.type === 'company' || n.type === 'company_invite') {
    // Nhóm "cá nhân" — user đang ở ngoài company hoặc vừa bị xoá.
    const personalKinds = new Set([
      'company_invite_sent',
      'invite_cancelled',
      'removed_from_company',
    ]);
    if (n.type === 'company_invite' || !kind || personalKinds.has(kind)) {
      await router.push({ name: 'employer-company' });
      open.value = false;
      return;
    }

    // Nhóm "team" — user đã là active member/owner.
    const teamKinds = new Set([
      'company_invite_accepted',
      'company_invite_declined',
      'company_invite_auto_cancelled',
      'company_member_left',
      'company_owner_transferred',
      'company_owner_transferred_to_you',
      'company_owner_transferred_from_you',
    ]);
    if (teamKinds.has(kind)) {
      await router.push({ name: 'employer-company-members' });
      open.value = false;
      return;
    }

    // Kind lạ / không match → fallback nhóm personal (an toàn hơn vì
    // CompanyView có cả empty state + pending invites section, dễ debug).
    await router.push({ name: 'employer-company' });
  } else if (n.type === 'application_new' || n.type === 'application_withdrawn') {
    const jobId = typeof payload.jobId === 'string' ? payload.jobId : null;
    if (jobId) await router.push({ name: 'employer-job-detail', params: { id: jobId } });
  } else if (n.type === 'application_match_ready') {
    await router.push({ name: 'candidate-applications' });
  } else if (n.type === 'message') {
    const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : null;
    if (conversationId) await router.push({ name: 'chat', params: { id: conversationId } });
  } else if (n.type === 'job_match') {
    const jobId = typeof payload.jobId === 'string' ? payload.jobId : null;
    if (jobId) await router.push({ name: 'candidate-job-detail', params: { id: jobId } });
  }
  // type='system' (legacy) → không navigate, chỉ đóng dropdown (default case).

  // 3. Đóng.
  open.value = false;
};

/** "Vừa xong" / "5s trước" / "3m trước" / "2h trước" / "1d trước". */
const elapsedText = (iso: string): string => {
  const diff = Math.max(0, now.value - new Date(iso).getTime());
  if (diff < 1000) return 'vừa xong';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h trước`;
  return `${Math.floor(h / 24)}d trước`;
};

/**
 * Map notification type → icon component + class màu nền cho container.
 *
 * Dùng Lucide (đồng bộ với Bell/Check/X đã dùng trong file) thay cho emoji để
 * tránh hiển thị khác nhau trên từng OS. markRaw() để Vue không làm component
 * reactive (Lucide không có state nội bộ).
 *
 * Class `bg-* / text-*` đặt sẵn cho từng category để dropdown dễ scan bằng
 * màu — không cần đọc text cũng nhận ra đây là loại notification gì.
 */
interface NotifIcon {
  component: Component;
  containerClass: string;
}

const iconFor = (type: Notification['type']): NotifIcon => {
  switch (type) {
    case 'company':
    case 'company_invite':
      return { component: markRaw(Building2), containerClass: 'bg-amber-50 text-amber-600 ring-amber-200' };
    case 'job_match':
      return { component: markRaw(Briefcase), containerClass: 'bg-blue-50 text-blue-600 ring-blue-200' };
    case 'message':
      return { component: markRaw(MessageCircle), containerClass: 'bg-indigo-50 text-indigo-600 ring-indigo-200' };
    case 'application_new':
      return { component: markRaw(UserPlus), containerClass: 'bg-emerald-50 text-emerald-600 ring-emerald-200' };
    case 'application_withdrawn':
      return { component: markRaw(UserMinus), containerClass: 'bg-gray-100 text-gray-500 ring-gray-200' };
    case 'application_match_ready':
      return { component: markRaw(Sparkles), containerClass: 'bg-purple-50 text-purple-600 ring-purple-200' };
    case 'system':
      return { component: markRaw(Settings), containerClass: 'bg-slate-100 text-slate-600 ring-slate-200' };
  }
  return { component: markRaw(Bell), containerClass: 'bg-gray-100 text-gray-500 ring-gray-200' };
};
</script>

<template>
  <div v-if="auth.isAuthenticated" class="notif-bell-root fixed top-3 right-2 z-50 select-none">
    <!-- Bell button -->
    <button
      type="button"
      class="relative w-6 h-6 flex items-center justify-center transition"
      aria-label="Thông báo"
      @click.stop="onToggle"
    >
      <Bell
        :class="unread > 0 ? 'text-primary-600' : 'text-gray-400'"
        class="w-4 h-4 transition-colors duration-200"
      />
      <span
        v-if="unread > 0"
        class="absolute -top-1 -right-1 text-red-600 text-[9px] font-bold leading-none drop-shadow-sm"
      >{{ unread > 99 ? '99+' : unread }}</span>
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      class="absolute right-0 mt-2 w-[400px] max-h-[80vh] overflow-hidden rounded-xl bg-white shadow-2xl border border-gray-200"
      role="dialog"
      aria-label="Danh sách thông báo"
      @click.stop
    >
      <!-- Header -->
      <header class="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 class="font-semibold text-gray-800">Thông báo</h3>
        <div class="flex items-center gap-1">
          <button
            v-if="unread > 0"
            type="button"
            class="text-[11px] text-gray-500 hover:text-primary-600 hover:underline flex items-center gap-1 px-2 py-1 rounded transition"
            @click="onMarkAll"
          >
            <CheckCheck class="w-3 h-3" /> Đọc tất cả
          </button>
          <button
            type="button"
            class="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
            aria-label="Đóng"
            @click="onClose"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </header>

      <!-- List -->
      <div class="overflow-y-auto max-h-[60vh]">
        <!-- Initial loading -->
        <div
          v-if="store.loading && store.items.length === 0"
          class="px-4 py-10 text-center text-sm text-gray-400"
        >
          <Bell class="w-5 h-5 mx-auto mb-2 animate-pulse" />
          Đang tải…
        </div>

        <!-- Empty -->
        <div
          v-else-if="store.items.length === 0"
          class="px-6 py-10 text-center"
        >
          <Inbox class="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p class="text-sm text-gray-500">Chưa có thông báo nào</p>
        </div>

        <ul v-else class="divide-y divide-gray-100">
          <li
            v-for="n in store.items"
            :key="n.id"
            class="flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer"
            :class="!n.readAt ? 'bg-primary-50/40 hover:bg-primary-50/60' : 'hover:bg-gray-50'"
            role="button"
            tabindex="0"
            @click="onClickItem(n, $event)"
            @keyup.enter="onClickItem(n, $event)"
          >
            <div
              class="shrink-0 w-9 h-9 rounded-lg ring-1 flex items-center justify-center"
              :class="iconFor(n.type).containerClass"
            >
              <component
                :is="iconFor(n.type).component"
                class="w-4 h-4"
                :stroke-width="2"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 line-clamp-2">{{ n.title }}</p>
              <p class="text-[11px] text-gray-500 mt-0.5">
                {{ elapsedText(n.createdAt) }}
              </p>
            </div>
            <button
              v-if="!n.readAt"
              type="button"
              class="shrink-0 self-center text-[10px] text-gray-400 hover:text-primary-600 hover:underline flex items-center gap-0.5 px-1 py-0.5 rounded transition"
              aria-label="Đánh dấu đã đọc"
              @click="onMarkRead(n.id, $event)"
            >
              <Check class="w-3 h-3" /> đã đọc
            </button>
          </li>
        </ul>

        <button
          v-if="store.hasMore"
          type="button"
          class="w-full py-2 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 border-t border-gray-100 transition"
          :disabled="store.loading"
          @click="store.fetchNextPage()"
        >
          {{ store.loading ? 'Đang tải...' : 'Tải thêm' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ============================================================================
 * Scrollbar mỏng cho dropdown list — chỉ áp dụng cho phần tử có overflow trong
 * component này (không leak ra toàn app).
 *
 *   - Firefox: `scrollbar-width: thin` + `scrollbar-color` đặt màu thumb/track.
 *   - WebKit (Chrome/Edge/Safari): tùy chỉnh kích thước + màu qua pseudoselector.
 *   - Track trong suốt để dropdown nền trắng hiện rõ.
 * ========================================================================== */
.notif-bell-root .overflow-y-auto {
  scrollbar-width: thin;
  scrollbar-color: rgb(209 213 219) transparent;
}
.notif-bell-root .overflow-y-auto::-webkit-scrollbar {
  width: 2px;
  height: 2px;
}
.notif-bell-root .overflow-y-auto::-webkit-scrollbar-track {
  background: transparent;
}
.notif-bell-root .overflow-y-auto::-webkit-scrollbar-thumb {
  background-color: rgb(107 114 128);
  border-radius: 9999px;
}
.notif-bell-root .overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background-color: rgb(75 85 99);
}
</style>
