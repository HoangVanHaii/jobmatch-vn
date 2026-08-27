<script setup lang="ts">
/**
 * ChatbotSidebar
 *
 * - Danh sách sessions (sort updatedAt DESC đã làm ở backend)
 * - Highlight active session
 * - Button "Tạo phiên mới"
 */
import { Plus, MessageSquare } from 'lucide-vue-next';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { ChatSession } from '@/types/chatbot';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const formatRelative = (iso: string): string => dayjs(iso).fromNow();

const props = defineProps<{
  sessions: ChatSession[];
  activeSessionId: string | null;
}>();

const emit = defineEmits<{
  (e: 'select', sessionId: string): void;
  (e: 'new'): void;
}>();

const displayTitle = (s: ChatSession): string => s.title || 'Phiên mới';
</script>

<template>
  <aside class="flex w-72 flex-col border-r border-gray-200 bg-white">
    <div class="border-b border-gray-200 px-4 py-3">
      <button
        type="button"
        class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        @click="emit('new')"
      >
        <Plus class="h-4 w-4" />
        Tạo phiên mới
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="!props.sessions.length" class="px-4 py-8 text-center text-sm text-gray-500">
        Chưa có phiên nào.
      </div>
      <ul v-else class="divide-y divide-gray-100">
        <li v-for="s in props.sessions" :key="s.id">
          <button
            type="button"
            class="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
            :class="{
              'bg-blue-50 hover:bg-blue-50': s.id === props.activeSessionId,
            }"
            @click="emit('select', s.id)"
          >
            <MessageSquare
              class="mt-0.5 h-4 w-4 shrink-0"
              :class="s.id === props.activeSessionId ? 'text-blue-600' : 'text-gray-400'"
            />
            <div class="min-w-0 flex-1">
              <div
                class="truncate text-sm font-medium"
                :class="s.id === props.activeSessionId ? 'text-blue-900' : 'text-gray-900'"
              >
                {{ displayTitle(s) }}
              </div>
              <div class="mt-0.5 text-xs text-gray-500">
                {{ formatRelative(s.updatedAt) }}
              </div>
            </div>
          </button>
        </li>
      </ul>
    </div>
  </aside>
</template>