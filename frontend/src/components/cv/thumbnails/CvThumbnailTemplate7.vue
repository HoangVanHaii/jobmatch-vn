<script setup lang="ts">
/**
 * CvThumbnailTemplate7 — bản mini của CVTemplate7.
 *
 * Sử dụng kỹ thuật SCALE: render template FULL ở design width 850px rồi
 * `transform: scale(w/850)` xuống đúng width container; `aspect-ratio: 850/1100`
 * giữ khung A4 của card. Giữ nguyên toàn bộ layout, màu sắc và typography.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import CVTemplate7 from '../templates/CVTemplate7.vue';
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
      <CVTemplate7 :data="data" :disable-links="true" />
    </div>
  </div>
</template>

