<script setup lang="ts">
/**
 * ConversationItem — 1 row trong sidebar chat.
 *
 * Hiển thị avatar (chữ cái đầu nếu không có ảnh), tên peer, preview tin
 * cuối, thời gian, badge unread. Highlight khi active.
 */
import { computed } from 'vue';
import type { ConversationWithPeer } from '@/types/chat';

const props = defineProps<{
  conversation: ConversationWithPeer;
  active: boolean;
}>();

const emit = defineEmits<{
  (e: 'click', id: string): void;
}>();

/** Format thời gian: HH:mm nếu hôm nay, dd/mm nếu cũ hơn. */
const timeLabel = computed(() => {
  if (!props.conversation.lastMessageAt) return '';
  const d = new Date(props.conversation.lastMessageAt);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
});

const onClick = (): void => emit('click', props.conversation.id);
</script>

<template>
  <button
    type="button"
    class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-left"
    :class="active ? 'bg-primary-100' : 'hover:bg-gray-100'"
    @click="onClick"
  >
    <!-- Avatar -->
    <div class="shrink-0 w-12 h-12 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
      <img
        v-if="conversation.peer.avatarUrl"
        :src="conversation.peer.avatarUrl"
        :alt="conversation.peer.fullName ?? ''"
        class="w-full h-full object-cover"
      />
      <img
        v-else
        src="/avatars/peer-default.svg"
        alt=""
        class="w-full h-full object-cover"
      />
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-baseline justify-between gap-2">
        <p
          class="truncate text-sm"
          :class="active ? 'font-semibold text-primary-900' : 'font-medium text-gray-900'"
        >
          {{ conversation.peer.fullName ?? 'Người dùng' }}
        </p>
        <span class="shrink-0 text-[10px] text-gray-400 font-mono">{{ timeLabel }}</span>
      </div>
      <div class="flex items-center justify-between gap-2 mt-0.5">
        <p class="text-xs text-gray-500 truncate flex-1">
          {{ conversation.lastMessagePreview ?? 'Chưa có tin nhắn' }}
        </p>
        <span
          v-if="conversation.unreadCount > 0"
          class="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-primary-500 text-white text-[10px] font-bold flex items-center justify-center"
        >
          {{ conversation.unreadCount > 99 ? '99+' : conversation.unreadCount }}
        </span>
      </div>
    </div>
  </button>
</template>