<script setup lang="ts">
/**
 * MessageInput — ô nhập tin nhắn + nút gửi.
 *
 * Enter → gửi, Shift+Enter → xuống dòng. Bắn typing indicator khi đang gõ.
 */
import { ref } from 'vue';
import { Send } from 'lucide-vue-next';

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'send', content: string): void;
  (e: 'typing', val: boolean): void;
}>();

const text = ref('');
const textareaEl = ref<HTMLTextAreaElement | null>(null);

const onInput = (): void => {
  emit('typing', text.value.length > 0);
};

const onSend = (): void => {
  const content = text.value.trim();
  if (!content) return;
  emit('send', content);
  text.value = '';
  emit('typing', false);
  textareaEl.value?.focus();
};

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
};
</script>

<template>
  <div class="border-t border-gray-200 bg-white p-3">
    <div class="flex items-end gap-2">
      <textarea
        ref="textareaEl"
        v-model="text"
        rows="1"
        :disabled="disabled"
        placeholder="Nhập tin nhắn..."
        class="flex-1 resize-none px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-primary-400 focus:bg-white max-h-32"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        type="button"
        :disabled="disabled || !text.trim()"
        class="shrink-0 w-10 h-10 rounded-lg bg-primary-500 text-white flex items-center justify-center hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
        @click="onSend"
      >
        <Send class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>