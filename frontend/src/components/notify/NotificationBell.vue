<script setup lang="ts">
/**
 * NotificationBell — chuông + dropdown realtime.
 *
 * Hiển thị:
 *   - Badge số chưa đọc
 *   - Dropdown danh sách (mới nhất trên đầu)
 *   - Mỗi dòng có timestamp HH:mm:ss.SSS (đo delay chính xác)
 *   - Banner "vừa nhận X ms trước" tự tick mỗi 200ms
 *   - Item mới nhất highlight nền xanh trong ~1.2s
 *
 * Subscribe socket event `notification:new` qua useSocket composable.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { Bell, Check, CheckCheck, Wifi, WifiOff, X } from 'lucide-vue-next';
import { useNotificationStore } from '@stores/notification';
import { useAuthStore } from '@stores/auth';
import { useSocket } from '@composables/useSocket';
import { getSocket } from '@services/socket';
import type { Notification } from '../../types/notification';

const store = useNotificationStore();
const auth = useAuthStore();
const open = ref(false);

const unread = computed(() => store.unreadCount);

const now = ref(Date.now());
let tickHandle: ReturnType<typeof setInterval> | null = null;

/** Notification mới nhất (top store). Dùng cho banner "vừa nhận". */
const newestReceivedAt = ref<number | null>(null);
const newestId = ref<string | null>(null);
/** ms kể từ khi nhận newest — auto-tick 200ms. */
const msSinceNewest = computed(() =>
  newestReceivedAt.value !== null ? now.value - newestReceivedAt.value : null,
);
/** Item nào đang trong window highlight 1.2s (để tô xanh row trong dropdown). */
const isHighlight = (id: string): boolean =>
  newestId.value === id && msSinceNewest.value !== null && msSinceNewest.value < 1200;

useSocket('notification:new', (n: Notification) => {
  store.pushLocal(n);
  newestId.value = n.id;
  newestReceivedAt.value = Date.now();
});

/** Socket connection status (để hiện Realtime / Mất kết nối). */
const socketConnected = ref(false);
const updateConn = () => (socketConnected.value = getSocket().connected);

onMounted(async () => {
  if (auth.isAuthenticated) await store.fetchFirstPage();
  const s = getSocket();
  s.on('connect', updateConn);
  s.on('disconnect', updateConn);
  updateConn();
  tickHandle = setInterval(() => (now.value = Date.now()), 200);
});

onUnmounted(() => {
  const s = getSocket();
  s.off('connect', updateConn);
  s.off('disconnect', updateConn);
  if (tickHandle) clearInterval(tickHandle);
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

const onClickOutside = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.notif-bell-root')) open.value = false;
};
onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));

const onMarkRead = async (id: string, e: Event) => {
  e.stopPropagation();
  await store.markRead(id);
};

const onMarkAll = async (e: Event) => {
  e.stopPropagation();
  const items = store.items.filter((n) => n.readAt === null);
  await Promise.all(items.map((n) => store.markRead(n.id)));
};

/** Format HH:mm:ss.SSS — đo delay đến millisecond. */
const pad = (n: number, len = 2) => String(n).padStart(len, '0');
const fmtHMSms = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

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

const iconFor = (type: Notification['type']): string => {
  switch (type) {
    case 'company_invite': return '🏢';
    case 'job_match': return '💼';
    case 'message': return '💬';
    case 'system': return '⚙️';
  }
  return '🔔';
};

const isoTime = (ts: number | null): string =>
  ts === null ? '—' : new Date(ts).toISOString().slice(11, 23);
</script>

<template>
  <div v-if="auth.isAuthenticated" class="notif-bell-root fixed top-3 right-2 z-50 select-none">
    <!-- Bell button -->
    <button
      type="button"
      class="relative w-7 h-7 flex items-center justify-center rounded-full bg-white shadow-lg hover:shadow-xl transition ring-2 ring-gray-500"
      aria-label="Notifications"
      @click.stop="onToggle"
    >
      <Bell class="w-4 h-4 text-gray-900" />
      <span
        v-if="unread > 0"
        class="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center"
      >{{ unread > 99 ? '99+' : unread }}</span>
      
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      class="absolute right-0 mt-2 w-[420px] max-h-[80vh] overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-200"
      @click.stop
    >
      <!-- Header -->
      <header class="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
        <div class="flex items-center gap-2">
          <h3 class="font-semibold text-gray-800">Thông báo</h3>
          <span
            v-if="socketConnected"
            class="flex items-center gap-1 text-[10px] text-green-600 font-medium"
          >
            <Wifi class="w-3 h-3" /> Realtime
          </span>
          <span v-else class="flex items-center gap-1 text-[10px] text-red-500 font-medium">
            <WifiOff class="w-3 h-3" /> Offline
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="unread > 0"
            class="text-[11px] text-primary-600 hover:underline flex items-center gap-1"
            @click="onMarkAll"
          >
            <CheckCheck class="w-3 h-3" /> Đọc tất cả
          </button>
          <button class="text-gray-400 hover:text-gray-600" @click="onClose">
            <X class="w-4 h-4" />
          </button>
        </div>
      </header>

      <!-- Banner "vừa nhận N ms trước" -->
      <div
        v-if="msSinceNewest !== null"
        class="px-4 py-2 bg-green-50 border-b border-green-100 text-[11px] text-green-700 flex items-center gap-2"
      >
        <span class="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span>
          Nhận cách đây <strong>{{ msSinceNewest }}ms</strong>
          • clock: <strong class="font-mono">{{ isoTime(newestReceivedAt) }}</strong>
        </span>
      </div>

      <!-- List -->
      <div class="overflow-y-auto max-h-[60vh]">
        <p v-if="store.isEmpty" class="text-center text-gray-400 py-12 text-sm">
          Chưa có thông báo nào
        </p>
        <ul v-else class="divide-y divide-gray-100">
          <li
            v-for="n in store.items"
            :key="n.id"
            class="flex items-start gap-3 px-4 py-3 transition-all"
            :class="[
              n.readAt ? 'hover:bg-gray-50' : 'bg-primary-50/40',
              isHighlight(n.id) ? 'ring-2 ring-green-400 bg-green-50' : '',
            ]"
          >
            <span class="text-2xl mt-0.5">{{ iconFor(n.type) }}</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 truncate">{{ n.title }}</p>
              <p class="text-[11px] text-gray-500 mt-0.5 font-mono">
                {{ fmtHMSms(n.createdAt) }}
                <span class="text-gray-400 font-sans">• {{ elapsedText(n.createdAt) }}</span>
              </p>
            </div>
            <button
              v-if="!n.readAt"
              class="shrink-0 text-[10px] text-primary-600 hover:underline flex items-center gap-0.5"
              @click="onMarkRead(n.id, $event)"
            >
              <Check class="w-3 h-3" /> đã đọc
            </button>
          </li>
        </ul>

        <button
          v-if="store.hasMore"
          class="w-full py-2 text-xs text-gray-500 hover:bg-gray-50 border-t border-gray-100"
          :disabled="store.loading"
          @click="store.fetchNextPage()"
        >
          {{ store.loading ? 'Đang tải...' : 'Tải thêm' }}
        </button>
      </div>
    </div>
  </div>
</template>
