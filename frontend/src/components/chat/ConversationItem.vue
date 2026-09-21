<script setup lang="ts">
/**
 * ConversationItem — 1 row trong sidebar chat.
 *
 * Hiển thị avatar (chữ cái đầu nếu không có ảnh), tên peer, preview tin
 * cuối, thời gian, badge unread. Highlight khi active.
 *
 * Hover state:
 *  - Row bg chuyển `hover:bg-gray-100` (đã có).
 *  - Icon trash xuất hiện bên phải (opacity 0 → 100, không chiếm layout
 *    bình thường — absolute positioned) — click trigger emit 'delete' để
 *    parent mở confirm modal.
 */
import { computed } from 'vue';
import { Trash2 } from 'lucide-vue-next';
import type { ConversationWithPeer } from '@/types/chat';

const props = defineProps<{
  conversation: ConversationWithPeer;
  active: boolean;
}>();

const emit = defineEmits<{
  (e: 'click', id: string): void;
  (e: 'delete', id: string): void;
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

/**
 * Click icon trash — phải `stop` để KHÔNG trigger `onClick` (navigate mở conv).
 * Parent (ConversationList) sẽ mở ConfirmModal trước khi gọi API.
 * Signature union để dùng được cho cả MouseEvent (click) và KeyboardEvent
 * (Enter/Space trên span có role="button").
 */
const onDeleteClick = (e: MouseEvent | KeyboardEvent): void => {
  e.stopPropagation();
  emit('delete', props.conversation.id);
};
</script>

<template>
  <button
    type="button"
    class="group relative w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition text-left"
    :class="active ? 'bg-primary-100' : 'hover:bg-gray-100'"
    @click="onClick"
  >
    <!-- Avatar -->
    <div class="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
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
          class="truncate text-[13px]"
          :class="active ? 'font-semibold text-primary-900' : 'font-medium text-gray-900'"
        >
          {{ conversation.peer.fullName ?? 'Người dùng' }}
        </p>
        <span class="shrink-0 text-[10px] text-gray-400 font-mono">{{ timeLabel }}</span>
      </div>
      <div class="flex items-center justify-between gap-2 mt-0.5">
        <p class="text-[11px] text-gray-500 truncate flex-1">
          {{ conversation.lastMessagePreview || 'Tệp tin đính kèm' }}
        </p>
        <span
          v-if="conversation.unreadCount > 0"
          class="shrink-0 min-w-[18px] h-4 px-1 rounded-full bg-primary-500 text-white text-[10px] font-bold flex items-center justify-center"
        >
          {{ conversation.unreadCount > 99 ? '99+' : conversation.unreadCount }}
        </span>
      </div>
    </div>

    <!--
      Trash icon — absolute right, opacity 0 → 100 khi hover row (`group-hover:`).
      Stop propagation ở onDeleteClick để không trigger navigate-to-conv.
      `aria-label` cho screen reader.
    -->
    <span
      role="button"
      tabindex="0"
      aria-label="Xoá hội thoại"
      class="absolute right-2 top-1/2 -translate-y-1/2 shrink-0 p-1.5 rounded-md text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-300 transition cursor-pointer"
      @click="onDeleteClick"
      @keydown.enter.prevent="onDeleteClick($event)"
      @keydown.space.prevent="onDeleteClick($event)"
    >
      <Trash2 class="w-4 h-4" />
    </span>
  </button>
</template>