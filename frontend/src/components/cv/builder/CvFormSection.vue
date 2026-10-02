<script setup lang="ts">
/**
 * CvFormSection — wrapper card cho 1 mục của form builder CV (split-view).
 *
 * Pattern theo trang list CV (MyResumesView): header `text-[15px]
 * font-semibold` + ChevronRight + mô tả `text-[12px] text-slate-500`,
 * card radius 14px border #e6e7e9.
 *
 * - `id`  : anchor để `focusSection()` scroll tới khi validate lỗi
 *           (kèm `scroll-mt-6` tránh dính sát mép viewport).
 * - `highlight`: true → viền flash màu accent (#5b4eea) — CreateResumeView
 *           bật khi validate fail rồi tự tắt sau ~1.6s.
 */
import { ChevronRight } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    /** Anchor id (vd. 'cv-section-personal') — dùng cho scrollIntoView. */
    id: string;
    title: string;
    description?: string;
    highlight?: boolean;
    /** true = không vẽ card (border/bg) — dùng khi section nằm trong 1 card
     *  lớn (builder overlay: preview + form = 2 ô duy nhất trên nền trong suốt). */
    flat?: boolean;
  }>(),
  { description: '', highlight: false, flat: false },
);
</script>

<template>
  <section
    :id="id"
    class="scroll-mt-6 transition-shadow duration-200"
    :class="flat
      ? (highlight ? 'rounded-[14px] ring-2 ring-[#5b4eea]/40' : '')
      : (highlight
        ? 'rounded-[14px] border border-[#5b4eea] bg-white ring-2 ring-[#5b4eea]/40'
        : 'rounded-[14px] border border-[#e6e7e9] bg-white')"
  >
    <header class="flex items-center gap-1.5 px-4 pb-1.5 pt-3">
      <h2 class="m-0 text-[15px] font-semibold text-slate-900">{{ title }}</h2>
      <ChevronRight :size="14" class="text-slate-500" />
      <p v-if="description" class="m-0 ml-2 truncate text-[12px] text-slate-500">
        {{ description }}
      </p>
    </header>
    <div class="px-4 pb-4 pt-1">
      <slot />
    </div>
  </section>
</template>
