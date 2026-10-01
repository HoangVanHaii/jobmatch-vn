<script setup lang="ts">
/**
 * CvThumbnailTemplate2 — bản mini của CVTemplate2 (Mustard Two-Column).
 *
 * Template 2 đã đổi design (vàng mustard #F2B72E, header ngang + 2 cột 35/65)
 * nhưng bản mini thuần không kịp theo → dùng kỹ thuật SCALE giống thumbnail
 * 6/7: render template FULL ở design width 850px rồi `transform: scale(w/850)`
 * xuống đúng width container; `aspect-ratio: 850/1100` giữ khung A4 của card.
 * Toàn bộ px bên trong template giữ nguyên tỉ lệ → thumbnail LUÔN giống hệt
 * template thật, không lo lệch design khi template thay đổi.
 *
 * ResizeObserver theo container — card đổi size (responsive/zoom) là scale
 * tính lại. SSR-safe: không có element → scale 0 → không render phần inside.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import CVTemplate2 from '../templates/CVTemplate2.vue';
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
      <CVTemplate2 :data="data" />
    </div>
  </div>
</template>
