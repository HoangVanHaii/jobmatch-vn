<script setup lang="ts">
/**
 * ChatbotInputBox
 *
 * Box nhập liệu dùng chung cho ChatbotView — render ở 2 chỗ:
 *   - centered (khi chưa có message): max-w-2xl, nằm giữa dưới greeting.
 *   - bottom (khi đã chat): full-width, border-top, nằm cuối main.
 *
 * Tách ra khỏi ChatbotView để 2 vị trí dùng chung 1 source-of-truth — chỉnh
 * chip / button / placeholder ở 1 chỗ thay vì duplicate. Refs/draft vẫn do
 * parent quản lý (one-way binding qua `draft` + emit `update:draft`), tránh
 * mất state khi v-if/v-else swap DOM.
 */
import { computed } from 'vue';
import { Send, Square, X, Briefcase, FileText } from 'lucide-vue-next';
import { useChatbotStore } from '@stores/chatbot';
import { useAuthStore } from '@stores/auth';
import ChatbotAttachmentMenu from './ChatbotAttachmentMenu.vue';

const props = defineProps<{
  /** Nội dung textarea (one-way). Parent bind qua v-model. */
  draft: string;
  /** Parent quyết định có cho gửi không (còn trim không, đang stream không, ...). */
  canSend: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:draft', value: string): void;
  (e: 'send'): void;
  (e: 'stop'): void;
  /** Phát ra khi user nhấn Enter — parent tự xử lý preventDefault + guard. */
  (e: 'enter', event: KeyboardEvent): void;
}>();

const store = useChatbotStore();
const auth = useAuthStore();

const selectedJobs = computed(() => store.attachedJobs);
const selectedCvs = computed(() => store.attachedCvs);
const hasContext = computed(
  () => selectedJobs.value.length > 0 || selectedCvs.value.length > 0,
);
const totalContext = computed(() => store.jobIds.length + store.cvIds.length);
const removeTooltip = computed(() =>
  store.isStreaming ? 'Đang chờ phản hồi — bấm "Dừng" phía dưới để đổi.' : '',
);

const onInput = (e: Event): void => {
  const target = e.target as HTMLTextAreaElement;
  emit('update:draft', target.value);
};
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-white shadow-sm focus-within:border-gray-900 focus-within:ring-1 focus-within:ring-gray-900/10">
    <!-- Chips row (chỉ hiện khi có context) -->
    <div
      v-if="hasContext"
      class="flex flex-wrap items-center gap-1.5 border-b border-gray-100 px-3 pt-2.5 pb-1.5"
    >
      <span
        v-for="j in selectedJobs"
        :key="`job-${j.id}`"
        class="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800"
        :title="j.title"
      >
        <Briefcase class="h-3 w-3 shrink-0 text-blue-500" />
        <span class="truncate">{{ j.title }}</span>
        <button
          type="button"
          class="shrink-0 text-blue-500 hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="store.isStreaming"
          :title="store.isStreaming ? removeTooltip : 'Bỏ gắn job'"
          aria-label="Bỏ gắn job"
          @click="store.removeJob(j.id)"
        >
          <X class="h-3 w-3" />
        </button>
      </span>
      <span
        v-for="c in selectedCvs"
        :key="`cv-${c.id}`"
        class="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
        :title="c.title || 'CV chính'"
      >
        <FileText class="h-3 w-3 shrink-0 text-emerald-500" />
        <span class="truncate">{{ c.title || 'CV chính' }}</span>
        <button
          type="button"
          class="shrink-0 text-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="store.isStreaming"
          :title="store.isStreaming ? removeTooltip : 'Bỏ gắn CV'"
          aria-label="Bỏ gắn CV"
          @click="store.removeCv(c.id)"
        >
          <X class="h-3 w-3" />
        </button>
      </span>
    </div>

    <!-- Input row -->
    <div class="flex items-end gap-2 p-2">
      <ChatbotAttachmentMenu v-if="auth.isAuthenticated" />
      <textarea
        :value="props.draft"
        rows="1"
        :placeholder="
          hasContext
            ? 'Nhập câu hỏi về job/CV đã đính kèm...'
            : 'Nhập câu hỏi của bạn (Đính kèm JD/CV để tôi hiểu bạn hơn)...'
        "
        class="min-h-[36px] max-h-32 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm focus:outline-none focus:ring-0"
        @input="onInput"
        @keydown="(e) => emit('enter', e as KeyboardEvent)"
      />
      <button
        v-if="!store.isStreaming"
        type="button"
        :disabled="!props.canSend"
        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        title="Gửi"
        @click="emit('send')"
      >
        <Send class="h-4 w-4" />
      </button>
      <button
        v-else
        type="button"
        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white transition hover:bg-red-700"
        title="Dừng"
        @click="emit('stop')"
      >
        <Square class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>