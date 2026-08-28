<script setup lang="ts">
/**
 * ChatbotHeader
 *
 * - Hiển thị title phiên (nếu có, fallback "Phiên mới")
 * - Badge tổng token đã dùng, đổi màu theo ngưỡng (warning 45k, exceeded 50k)
 * - Button Reset để xoá context (jobIds + cvIds)
 */
import { computed } from 'vue';
import { AlertTriangle, ArrowLeft, Coins } from 'lucide-vue-next';

const props = defineProps<{
  title?: string | null;
  totalTokens: number;
  /**
   * Mobile only: hiển thị nút back để quay về danh sách phiên. Parent tự
   * quyết định — thường bind theo `!isMobileSidebar` (đang ở chat view).
   * Desktop (md+) luôn show sidebar nên nút này không cần.
   */
  showBack?: boolean;
}>();

const emit = defineEmits<{
  (e: 'back'): void;
}>();

const formattedTokens = computed(() => props.totalTokens.toLocaleString('vi-VN'));
const isWarning = computed(() => props.totalTokens >= 45_000 && props.totalTokens < 50_000);
const isExceeded = computed(() => props.totalTokens >= 50_000);
</script>

<template>
  <header
    class="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3 md:px-6"
  >
    <div class="flex min-w-0 items-center gap-2 md:gap-3">
      <!--
        Back button (mobile only) — đưa user về danh sách phiên khi đang ở
        chat view trên màn hẹp. Desktop đã có sidebar cố định nên ẩn.
      -->
      <button
        v-if="props.showBack"
        type="button"
        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-700 transition hover:bg-gray-100 md:hidden"
        title="Quay lại lịch sử"
        aria-label="Quay lại lịch sử"
        @click="emit('back')"
      >
        <ArrowLeft class="h-4 w-4" />
      </button>
      <h1 class="truncate text-base font-semibold text-gray-900">
        {{ title || 'Phiên chat mới' }}
      </h1>
    </div>

    <div class="flex items-center gap-3">
      <div
        class="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium mr-6"
        :class="[
          isExceeded
            ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
            : isWarning
              ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
              : 'bg-gray-100 text-gray-700',
        ]"
        :title="
          isExceeded
            ? 'Đã đạt đến giới hạn trò chuyện — vui lòng tạo phiên mới'
            : isWarning
              ? 'Sắp đến giới hạn trò chuyện — cân nhắc tạo phiên mới'
              : 'Chi phí đã dùng'
        "
      >
        <AlertTriangle v-if="isWarning || isExceeded" class="h-3.5 w-3.5" />
        <Coins v-else class="h-3.5 w-3.5" />
        <span>{{ formattedTokens }} / 50.000</span>
      </div>
    </div>
  </header>
</template>