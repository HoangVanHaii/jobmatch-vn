<script setup lang="ts">
/**
 * ChatbotSidebar
 *
 * - Danh sách sessions (sort updatedAt DESC đã làm ở backend)
 * - Highlight active session
 * - Button "Cuộc trò chuyện mới"
 * - Có thể collapse về icon-strip để giải phóng diện tích main panel
 *   (toggle button đặt ở header → emit 'toggle' lên parent).
 */
import { NotebookPen, MessageSquare, PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next';
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
  collapsed: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', sessionId: string): void;
  (e: 'new'): void;
  (e: 'toggle'): void;
}>();

const displayTitle = (s: ChatSession): string => s.title || 'Phiên mới';
const activeSession = (): ChatSession | undefined =>
  props.sessions.find((s) => s.id === props.activeSessionId);
</script>

<template>
  <!--
    Khi collapsed: chỉ còn 1 cột icon hẹp (48px) với toggle + nút tạo nhanh.
    Width responsive:
      - Mobile: full-width (fill wrapper — parent ở ChatbotView đã set w-full)
      - md+: cố định w-72 hoặc w-12 tùy collapsed
  -->
  <aside
    class="flex w-full shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200 md:w-auto"
    :class="props.collapsed ? 'md:w-12' : 'md:w-72'"
  >
    <!-- Toggle button (desktop only — trên mobile dùng nút back trong header) -->
    <div class="hidden items-center justify-end border-b border-gray-200 px-2 py-2 md:flex">
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        :title="props.collapsed ? 'Mở lịch sử' : 'Đóng lịch sử'"
        :aria-label="props.collapsed ? 'Mở lịch sử' : 'Đóng lịch sử'"
        @click="emit('toggle')"
      >
        <PanelLeftOpen v-if="props.collapsed" class="h-4 w-4" />
        <PanelLeftClose v-else class="h-4 w-4" />
      </button>
    </div>

    <!-- ============ Collapsed view ============ -->
    <div v-if="props.collapsed" class="flex flex-1 flex-col items-center gap-1 px-1.5 py-2">
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-900 text-white hover:bg-gray-800"
        title="Cuộc trò chuyện mới"
        aria-label="Cuộc trò chuyện mới"
        @click="emit('new')"
      >
        <NotebookPen class="h-4 w-4" />
      </button>
      <div class="my-1 h-px w-6 bg-gray-200" />
      <button
        v-for="s in props.sessions"
        :key="s.id"
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-md transition"
        :class="
          s.id === props.activeSessionId
            ? 'bg-gray-900 text-white'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
        "
        :title="displayTitle(s)"
        :aria-label="displayTitle(s)"
        @click="emit('select', s.id)"
      >
        <MessageSquare class="h-4 w-4" />
      </button>
    </div>

    <!-- ============ Expanded view ============ -->
    <template v-else>
      <div class="border-b border-gray-200 px-4 py-3">
        <button
          type="button"
          class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
          @click="emit('new')"
        >
          <NotebookPen class="h-4 w-4" />
          Cuộc trò chuyện mới
        </button>
      </div>

      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <div v-if="!props.sessions.length" class="px-4 py-8 text-center text-sm text-gray-500">
          Chưa có phiên nào.
        </div>
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="s in props.sessions" :key="s.id">
            <button
              type="button"
              class="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
              :class="{
                'bg-gray-100 hover:bg-gray-100': s.id === props.activeSessionId,
              }"
              @click="emit('select', s.id)"
            >
              <MessageSquare
                class="mt-0.5 h-4 w-4 shrink-0"
                :class="s.id === props.activeSessionId ? 'text-gray-900' : 'text-gray-400'"
              />
              <div class="min-w-0 flex-1">
                <div
                  class="truncate text-sm font-medium"
                  :class="s.id === props.activeSessionId ? 'text-gray-900' : 'text-gray-700'"
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
    </template>
  </aside>
</template>