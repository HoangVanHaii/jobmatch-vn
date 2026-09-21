<script setup lang="ts">
/**
 * AdminPagination — pagination cho admin tables.
 *
 * Style tối giản:
 *   - "Hiển thị X–Y trong Z" bên trái
 *   - Page numbers + prev/next bên phải
 *   - Current page: bold + indigo, KHÔNG background fill
 *   - Buttons: text only, hover subtle
 *
 * `total` lấy từ BE count (cùng filter với list) → tính chính xác số trang.
 */
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';

const props = defineProps<{
  page: number;
  pageSize: number;
  total: number;
}>();

const emit = defineEmits<{
  (e: 'update:page', value: number): void;
}>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));

const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.page * props.pageSize, props.total));

/**
 * Build danh sách page numbers để hiển thị, kiểu:
 *   [1]  2  3  ...  10
 *   [1]  ...  4  5  [6]  7  8  ...  20
 */
const pageNumbers = computed<(number | 'ellipsis')[]>(() => {
  if (totalPages.value <= 7) {
    return Array.from({ length: totalPages.value }, (_, i) => i + 1);
  }
  const result: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, props.page - 1);
  const end = Math.min(totalPages.value - 1, props.page + 1);
  if (start > 2) result.push('ellipsis');
  for (let i = start; i <= end; i++) result.push(i);
  if (end < totalPages.value - 1) result.push('ellipsis');
  result.push(totalPages.value);
  return result;
});

const hasPrev = computed(() => props.page > 1);
const hasNext = computed(() => props.page < totalPages.value);

const goTo = (p: number) => {
  if (p < 1 || p > totalPages.value) return;
  if (p !== props.page) emit('update:page', p);
};
</script>

<template>
  <div class="flex items-center justify-between px-6 py-4 text-sm">
    <p class="text-gray-500">
      Hiển thị
      <span class="font-medium text-gray-700">{{ from }}–{{ to }}</span>
      trong
      <span class="font-medium text-gray-700">{{ total.toLocaleString('vi-VN') }}</span>
    </p>

    <nav class="flex items-center gap-1" aria-label="Pagination">
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
        :disabled="!hasPrev"
        aria-label="Trang trước"
        @click="goTo(page - 1)"
      >
        <ChevronLeft class="h-4 w-4" />
      </button>

      <template v-for="(p, i) in pageNumbers" :key="i">
        <span
          v-if="p === 'ellipsis'"
          class="inline-flex h-8 w-8 items-center justify-center text-xs text-gray-400"
        >…</span>
        <button
          v-else
          type="button"
          class="inline-flex h-8 min-w-[2rem] items-center justify-center rounded-md px-2 text-sm transition"
          :class="p === page
            ? 'font-semibold text-indigo-600'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'"
          @click="goTo(p)"
        >{{ p }}</button>
      </template>

      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
        :disabled="!hasNext"
        aria-label="Trang sau"
        @click="goTo(page + 1)"
      >
        <ChevronRight class="h-4 w-4" />
      </button>
    </nav>
  </div>
</template>
