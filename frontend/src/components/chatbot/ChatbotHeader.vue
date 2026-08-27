<script setup lang="ts">
/**
 * ChatbotHeader
 *
 * - Hiển thị title phiên (nếu có, fallback "Phiên mới")
 * - Badge tổng token đã dùng, đổi màu theo ngưỡng (warning 45k, exceeded 50k)
 * - Button Reset để xoá context (jobIds + cvIds)
 */
import { computed } from 'vue';
import { AlertTriangle, RotateCcw, Coins } from 'lucide-vue-next';

const props = defineProps<{
  title?: string | null;
  totalTokens: number;
}>();

const emit = defineEmits<{
  (e: 'reset'): void;
}>();

const formattedTokens = computed(() => props.totalTokens.toLocaleString('vi-VN'));
const isWarning = computed(() => props.totalTokens >= 45_000 && props.totalTokens < 50_000);
const isExceeded = computed(() => props.totalTokens >= 50_000);

const onReset = (): void => {
  if (window.confirm('Xoá hết job/CV đã gắn cho phiên chat này?')) {
    emit('reset');
  }
};
</script>

<template>
  <header
    class="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3"
  >
    <div class="flex min-w-0 items-center gap-3">
      <h1 class="truncate text-base font-semibold text-gray-900">
        {{ title || 'Phiên chat mới' }}
      </h1>
    </div>

    <div class="flex items-center gap-3">
      <div
        class="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
        :class="[
          isExceeded
            ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
            : isWarning
              ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
              : 'bg-gray-100 text-gray-700',
        ]"
        :title="
          isExceeded
            ? 'Đã hết token — vui lòng tạo phiên mới'
            : isWarning
              ? 'Sắp hết token — cân nhắc tạo phiên mới'
              : 'Tổng token đã dùng'
        "
      >
        <AlertTriangle v-if="isWarning || isExceeded" class="h-3.5 w-3.5" />
        <Coins v-else class="h-3.5 w-3.5" />
        <span>{{ formattedTokens }} / 50.000</span>
      </div>

      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        @click="onReset"
      >
        <RotateCcw class="h-4 w-4" />
        Reset
      </button>
    </div>
  </header>
</template>