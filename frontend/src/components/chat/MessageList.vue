<script setup lang="ts">
/**
 * MessageList — scrollable list of messages với load older (scroll-up).
 *
 * Auto-scroll xuống cuối khi có message mới. Load older khi scroll
 * tới đỉnh (cần chat: còn trang tiếp theo).
 */
import { computed, nextTick, ref, watch } from 'vue';
import { Check, CheckCheck, Loader2 } from 'lucide-vue-next';
import type { ChatMessage } from '@/types/chat';

const props = defineProps<{
  messages: ChatMessage[];
  currentUserId: string;
  /**
   * Avatar của peer — hiển thị nhỏ ở tin cuối cùng của mình đã được đọc (style
   * Messenger). Null nếu peer chưa set avatar → không render img slot.
   */
  peerAvatar: string | null;
  hasMore: boolean;
  loading: boolean;
  peerTyping: boolean;
}>();

const emit = defineEmits<{
  (e: 'loadMore'): void;
}>();

const scrollEl = ref<HTMLElement | null>(null);
const stickToBottom = ref(true);

/** Khi nào append message xuống dưới thì scroll xuống. */
const scrollToBottom = async (smooth = true): Promise<void> => {
  await nextTick();
  if (!scrollEl.value) return;
  scrollEl.value.scrollTo({
    top: scrollEl.value.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  });
};

/** Theo dõi length messages — nếu user đang ở cuối thì scroll xuống. */
watch(
  () => props.messages.length,
  () => {
    if (stickToBottom.value) scrollToBottom(true);
  },
);

/**
 * Watch peerTyping — khi peer bắt đầu/dừng gõ, scroll container thay đổi
 * scrollHeight (typing dots xuất hiện/biến mất ở cuối). Nếu user đang ở cuối
 * (stickToBottom=true), phải scroll lại để dots visible — không thì dots
 * render ở dưới viewport và bị MessageInput che.
 */
watch(
  () => props.peerTyping,
  () => {
    if (stickToBottom.value) scrollToBottom(true);
  },
);

/** Detect user có ở gần đáy không — nếu có thì stick to bottom. */
const onScroll = (): void => {
  const el = scrollEl.value;
  if (!el) return;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  stickToBottom.value = distance < 100;

  // Scroll lên đỉnh → load older
  if (el.scrollTop < 50 && props.hasMore && !props.loading) {
    emit('loadMore');
  }
};

/** Format HH:mm cho message. */
const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Tooltip cho icon "đã xem" — hiển thị giờ peer đọc tới message này (giờ local).
 * Pattern: Messenger/Telegram đều show "Seen HH:mm" khi hover vào ✓✓.
 */
const readTooltip = (readAt: string | null): string => {
  if (!readAt) return '';
  const t = fmtTime(readAt);
  return `Đã xem lúc ${t}`;
};

/**
 * ID của message cuối cùng (mới nhất theo thời gian) của mình đã được peer đọc.
 * Avatar peer chỉ hiện ở message này — Messenger/Telegram đều dùng pattern
 * này: avatar peer đứng ngay dưới/gần message cuối mình gửi mà peer đã seen,
 * tạo cảm giác "seen here" thay vì hiện avatar ở mọi own message đã đọc
 * (gây nhiễu khi user scroll lên đọc lịch sử).
 */
const lastOwnReadId = computed<string | null>(() => {
  const me = props.currentUserId;
  if (!me) return null;
  for (let i = props.messages.length - 1; i >= 0; i--) {
    const m = props.messages[i];
    if (m.senderId === me && m.readAt) return m.id;
  }
  return null;
});

/** Render nội dung an toàn (escape HTML cơ bản). */
const safe = (s: string): string => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\n/g, '<br>');

/** Nhóm messages theo ngày cho header "Hôm nay", "Hôm qua", ... */
const grouped = computed(() => {
  const groups: { date: string; items: ChatMessage[] }[] = [];
  let current = '';
  for (const m of props.messages) {
    const day = new Date(m.createdAt).toDateString();
    if (day !== current) {
      groups.push({ date: day, items: [m] });
      current = day;
    } else {
      groups[groups.length - 1].items.push(m);
    }
  }
  return groups;
});
</script>

<template>
  <div
    ref="scrollEl"
    class="flex-1 overflow-y-auto scrollbar-visible px-4 py-3 space-y-3 bg-gray-50"
    @scroll="onScroll"
  >
    <div v-if="loading && messages.length === 0" class="flex justify-center py-12">
      <Loader2 class="w-6 h-6 animate-spin text-gray-400" />
    </div>

    <p v-else-if="messages.length === 0" class="text-center text-gray-400 py-12 text-sm">
      Chưa có tin nhắn nào. Hãy bắt đầu cuộc trò chuyện!
    </p>

    <div v-if="hasMore && messages.length > 0 && !loading" class="text-center">
      <button class="text-xs text-primary-600 hover:underline" @click="loadMore">
        Tải tin cũ hơn
      </button>
    </div>
    <div v-if="loading && hasMore" class="flex justify-center">
      <Loader2 class="w-4 h-4 animate-spin text-gray-400" />
    </div>

    <template v-for="group in grouped" :key="group.date">
      <div class="flex items-center justify-center my-2">
        <span class="px-2 py-0.5 text-[10px] text-gray-500 bg-white rounded-full border border-gray-200">
          {{ group.date === new Date().toDateString() ? 'Hôm nay' : group.date }}
        </span>
      </div>
      <div
        v-for="m in group.items"
        :key="m.id"
        class="flex"
        :class="m.senderId === currentUserId ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[70%] px-3 py-2 rounded-2xl text-sm shadow-sm"
          :class="m.senderId === currentUserId
            ? 'bg-primary-500 text-white rounded-br-md'
            : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md'"
        >
          <div class="break-words" v-html="safe(m.content)" />
          <div
            class="mt-0.5 flex items-center justify-end gap-1 text-[10px] font-mono"
            :class="m.senderId === currentUserId ? 'text-primary-100' : 'text-gray-400'"
          >
            <span>{{ fmtTime(m.createdAt) }}</span>
            <!--
              Read receipt chỉ hiện trên message của mình (senderId === currentUserId).
              ✓         = đã gửi (chưa đọc)
              ✓✓ xanh    = đã xem (readAt được set bởi peer qua chat:read)
              Tooltip trên ✓✓: "Đã xem lúc HH:mm" — bám theo pattern Messenger/Telegram.
            -->
            <Check
              v-if="m.senderId === currentUserId && !m.readAt"
              class="h-3.5 w-3.5 -mr-0.5 inline-block"
              aria-label="Đã gửi"
            />
            <span
              v-else-if="m.senderId === currentUserId && m.readAt"
              :title="readTooltip(m.readAt)"
              class="inline-flex items-center -mr-0.5 cursor-default"
              :aria-label="readTooltip(m.readAt)"
            >
              <CheckCheck
                class="h-4 w-4 text-primary-700"
                aria-hidden="true"
              />
              <!--
                Avatar peer — chỉ render ở TIN CUỐI CÙNG của mình đã được đọc.
                Style Messenger: avatar 14px, tròn, nằm sau ✓✓ trên cùng hàng
                với time + tick. Nếu peer chưa set avatar → không render
                để tránh ô trống.
              -->
              <img
                v-if="peerAvatar && m.id === lastOwnReadId"
                :src="peerAvatar"
                :alt="readTooltip(m.readAt)"
                class="ml-1 h-3.5 w-3.5 rounded-full object-cover ring-1 ring-white"
              />
            </span>
          </div>
        </div>
      </div>
    </template>

    <div v-if="peerTyping" class="flex justify-start">
      <div class="px-3 py-2 bg-white border border-gray-200 rounded-2xl rounded-bl-md">
        <div class="flex gap-1">
          <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0ms" />
          <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 150ms" />
          <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 300ms" />
        </div>
      </div>
    </div>
  </div>
</template>