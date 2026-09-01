<script setup lang="ts">
/**
 * ChatbotSidebar
 *
 * - Danh sách sessions (sort updatedAt DESC đã làm ở backend)
 * - Highlight active session
 * - Button "Cuộc trò chuyện mới"
 * - Có thể collapse về icon-strip để giải phóng diện tích main panel
 *   (toggle button đặt ở header → emit 'toggle' lên parent).
 * - Mỗi session có 2 nút action (chỉ hiện khi hover row hoặc row là active):
 *     - Bút chì  → bật edit mode inline (input thay cho title)
 *     - Thùng rác → emit 'delete' (caller confirm + gọi API)
 */
import {
  NotebookPen,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
import { nextTick, ref } from 'vue';
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
  (e: 'delete', sessionId: string): void;
  (e: 'rename', sessionId: string, newTitle: string): void;
}>();

const displayTitle = (s: ChatSession): string => s.title || 'Phiên mới';
const activeSession = (): ChatSession | undefined =>
  props.sessions.find((s) => s.id === props.activeSessionId);

/**
 * Edit state cho từng session.
 * - editingId = session đang trong edit mode (chỉ 1 tại 1 thời điểm)
 * - editingDraft = giá trị trong input (2-way binding với <input>)
 *
 * Lưu local component — không đẩy lên store vì state này là UI-only (chỉ
 * biết user đang gõ gì), data thật nằm ở sessions[].title. Sau khi commit
 * (Enter / blur), emit 'rename' lên parent → parent gọi API + update store.
 */
const editingId = ref<string | null>(null);
const editingDraft = ref('');
const editInputEl = ref<HTMLInputElement | null>(null);

const startEdit = async (s: ChatSession): Promise<void> => {
  editingId.value = s.id;
  editingDraft.value = displayTitle(s);
  // Đợi DOM update xong rồi focus + select để user gõ đè ngay.
  await nextTick();
  editInputEl.value?.focus();
  editInputEl.value?.select();
};

const cancelEdit = (): void => {
  editingId.value = null;
  editingDraft.value = '';
};

/**
 * Commit edit. Validate cơ bản ở đây (trim + non-empty) để tránh emit title
 * rác lên parent. Max length check thực hiện ở parent (mirror backend rule).
 */
const commitEdit = (): void => {
  const id = editingId.value;
  if (!id) return;
  const trimmed = editingDraft.value.trim();
  if (!trimmed) {
    // Title rỗng → cancel thay vì save (tránh gọi API vô ích).
    cancelEdit();
    return;
  }
  const original = props.sessions.find((s) => s.id === id);
  if (original && displayTitle(original) === trimmed) {
    // Không đổi → cancel, không gọi API.
    cancelEdit();
    return;
  }
  emit('rename', id, trimmed);
  cancelEdit();
};

const onEditKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
  }
};
</script>

<template>
  <!--
    Khi collapsed: chỉ còn 1 cột icon hẹp (48px) với toggle + nút tạo nhanh.
    Width responsive:
      - Mobile: full-width (fill wrapper — parent ở ChatbotView đã set w-full)
      - md+: cố định w-72 hoặc w-12 tùy collapsed
  -->
  <aside
    class="flex h-full min-h-0 w-full flex-col border-r border-gray-200 bg-white transition-[width] duration-200 md:w-auto"
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
    <div v-if="props.collapsed" class="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-1.5 py-2 scrollbar-visible">
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

      <div class="flex-1 min-h-0 overflow-y-auto scrollbar-visible">
        <div v-if="!props.sessions.length" class="px-4 py-8 text-center text-sm text-gray-500">
          Chưa có phiên nào.
        </div>
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="s in props.sessions" :key="s.id" class="group relative">
            <!--
              Khi đang edit session này → render <input> thay cho title block.
              - Row vẫn giữ padding giống button để layout không nhảy khi switch
                view/edit mode.
              - pr-20 chừa chỗ cho 2 nút action ở góc phải.
              - @click.stop trên wrapper để click vào input không trigger select.
            -->
            <div
              v-if="editingId === s.id"
              class="flex items-start gap-3 px-4 py-3 pr-20"
              :class="{ 'bg-gray-100': s.id === props.activeSessionId }"
              @click.stop
            >
              <MessageSquare
                class="mt-1 h-4 w-4 shrink-0 text-gray-900"
              />
              <input
                ref="editInputEl"
                v-model="editingDraft"
                type="text"
                maxlength="200"
                class="min-w-0 flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-sm font-medium text-gray-900 outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                :aria-label="`Đổi tiêu đề phiên ${displayTitle(s)}`"
                @keydown="onEditKeydown"
                @blur="commitEdit"
              />
            </div>
            <button
              v-else
              type="button"
              class="flex w-full items-start gap-3 px-4 py-3 pr-20 text-left transition hover:bg-gray-50"
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

            <!--
              Action cluster (nút bút + nút thùng rác) — absolute bên phải.
              - Mặc định ẩn (opacity-0)
              - Hiện khi hover li (group-hover) HOẶC row là active session
              - Nếu đang edit → hiện luôn cả 2 (parent edit mode intent rõ ràng)
              - @click.stop để không bubble lên button select
              - Hide cluster trên collapsed view (đã có icon-strip riêng).
            -->
            <div
              v-if="editingId !== s.id"
              class="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition group-hover:opacity-100"
              :class="{ 'opacity-100': s.id === props.activeSessionId }"
            >
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 focus:opacity-100"
                title="Đổi tiêu đề"
                aria-label="Đổi tiêu đề cuộc hội thoại"
                @click.stop="startEdit(s)"
              >
                <Pencil class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100"
                title="Xóa cuộc hội thoại này"
                aria-label="Xóa cuộc hội thoại"
                @click.stop="emit('delete', s.id)"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </div>
          </li>
        </ul>
      </div>
    </template>
  </aside>
</template>