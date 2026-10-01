<script setup lang="ts">
/**
 * CvThumbnailTemplate6 — bản mini của CVTemplate6.
 *
 * Template 6 chưa có bản mini thuần như 1-5 → dùng kỹ thuật SCALE: render
 * template FULL ở design width 850px rồi `transform: scale(w/850)` xuống đúng
 * width container; `aspect-ratio: 850/1100` giữ khung A4 của card. Toàn bộ
 * px bên trong template giữ nguyên tỉ lệ → nhìn như ảnh thu nhỏ, không vỡ
 * layout (khác biệt duy nhất: text chọn được ở kích thước scale, chấp nhận
 * được cho thumbnail).
 *
 * ResizeObserver theo container — card đổi size (responsive/zoom) là scale
 * tính lại. SSR-safe: không có element → scale 0 → không render phần inside.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import CVTemplate6 from '../templates/CVTemplate6.vue';
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();

/** Design width gốc của template full (A4 @96dpi chuẩn project). */
const DESIGN_WIDTH = 850;

const el = ref<HTMLElement | null>(null);
const containerWidth = ref(0);
let observer: ResizeObserver | null = null;

onMounted(() => {
  containerWidth.value = el.value?.clientWidth ?? 0;
  if (typeof ResizeObserver !== 'undefined' && el.value) {
    observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) containerWidth.value = entry.contentRect.width;
    });
    observer.observe(el.value);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

const scale = computed(() =>
  containerWidth.value > 0 ? containerWidth.value / DESIGN_WIDTH : 0,
);
</script>

<template>
  <div ref="el" class="relative w-full overflow-hidden" style="aspect-ratio: 850 / 1100">
    <div
      v-if="scale > 0"
      class="absolute left-0 top-0 origin-top-left bg-white"
      :style="{ width: DESIGN_WIDTH + 'px', transform: `scale(${scale})` }"
    >
      <CVTemplate6 :data="data" />
    </div>
  </div>
</template>
