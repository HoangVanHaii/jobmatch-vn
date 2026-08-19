<script setup lang="ts">
/**
 * CVTemplateMockup — thumbnail minh họa cấu trúc template CV.
 *
 * MỤC TIÊU DENSITY:
 *   Content phủ 88-92% chiều cao tờ A4 (chừa 8-12% trắng cuối trang).
 *
 * RÀNG BUỘC:
 *   - KHÔNG scale mockup.
 *   - KHÔNG tăng kích thước card / thumbnail.
 *   - KHÔNG dùng data CV thật.
 *   - KHÔNG gọi detail API.
 *   - Chỉ dùng templateId để chọn layout + màu accent.
 *
 * Mọi "text" là các thanh ngang mờ (h-px / h-0.5) — không đọc được.
 */
import { computed } from 'vue';

const props = defineProps<{
  templateId: number | null;
}>();

const resolvedId = computed<number>(() => {
  const id = props.templateId;
  return id !== null && id >= 1 && id <= 5 ? id : 1;
});
</script>

<template>
  <div class="w-full h-full overflow-hidden">
    <!-- ============ Template 1 — sidebar stone-700 trái, accent amber ============ -->
    <div
      v-if="resolvedId === 1"
      class="w-full h-full grid grid-cols-[30%_1fr] leading-none"
    >
      <!-- SIDEBAR — kéo dài hết chiều cao A4 -->
      <div class="bg-stone-700 p-1 flex flex-col gap-0.5">
        <!-- Avatar + name -->
        <div class="w-4 h-4 rounded-full bg-stone-300 mx-auto mt-0.5" />
        <div class="h-0.5 bg-stone-300 rounded w-3/4 mx-auto mt-0.5" />
        <div class="h-0.5 bg-stone-400 rounded w-1/2 mx-auto mb-0.5" />

        <!-- Contact -->
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 bg-stone-400 rounded-full" /><div class="h-0.5 bg-stone-400 rounded flex-1" /></div>
          <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 bg-stone-400 rounded-full" /><div class="h-0.5 bg-stone-400 rounded flex-1" /></div>
          <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 bg-stone-400 rounded-full" /><div class="h-0.5 bg-stone-400 rounded w-3/4" /></div>
        </div>

        <!-- Section: Mục tiêu -->
        <div class="h-px bg-stone-500/50 w-full mt-1" />
        <div class="h-0.5 bg-amber-500 rounded w-2/3 mb-0.5" />
        <div class="h-0.5 bg-stone-400 rounded w-full" />
        <div class="h-0.5 bg-stone-400 rounded w-5/6" />
        <div class="h-0.5 bg-stone-400 rounded w-3/4" />

        <!-- Section: Kỹ năng (progress bars) -->
        <div class="h-px bg-stone-500/50 w-full mt-1" />
        <div class="h-0.5 bg-amber-500 rounded w-1/2 mb-0.5" />
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center gap-0.5"><div class="h-0.5 bg-stone-300 rounded w-1/2" /><div class="h-0.5 bg-amber-500 rounded flex-1" /></div>
          <div class="flex items-center gap-0.5"><div class="h-0.5 bg-stone-300 rounded w-2/5" /><div class="h-0.5 bg-amber-500 rounded flex-1" /></div>
          <div class="flex items-center gap-0.5"><div class="h-0.5 bg-stone-300 rounded w-3/5" /><div class="h-0.5 bg-amber-500 rounded flex-1" /></div>
          <div class="flex items-center gap-0.5"><div class="h-0.5 bg-stone-300 rounded w-1/2" /><div class="h-0.5 bg-amber-500 rounded flex-1" /></div>
          <div class="flex items-center gap-0.5"><div class="h-0.5 bg-stone-300 rounded w-2/5" /><div class="h-0.5 bg-amber-500 rounded flex-1" /></div>
        </div>

        <!-- Section: Sở thích (bullets cam) -->
        <div class="h-px bg-stone-500/50 w-full mt-1" />
        <div class="h-0.5 bg-amber-500 rounded w-1/2 mb-0.5" />
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-amber-500" /><div class="h-0.5 bg-stone-400 rounded flex-1" /></div>
          <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-amber-500" /><div class="h-0.5 bg-stone-400 rounded w-4/5" /></div>
          <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-amber-500" /><div class="h-0.5 bg-stone-400 rounded flex-1" /></div>
        </div>

        <!-- Section: Ngôn ngữ -->
        <div class="h-px bg-stone-500/50 w-full mt-1" />
        <div class="h-0.5 bg-amber-500 rounded w-1/2 mb-0.5" />
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center justify-between gap-0.5"><div class="h-0.5 bg-stone-300 rounded w-1/2" /><div class="flex gap-px"><div class="w-0.5 h-0.5 rounded-full bg-amber-500" /><div class="w-0.5 h-0.5 rounded-full bg-amber-500" /><div class="w-0.5 h-0.5 rounded-full bg-amber-500" /><div class="w-0.5 h-0.5 rounded-full bg-stone-500" /><div class="w-0.5 h-0.5 rounded-full bg-stone-500" /></div></div>
          <div class="flex items-center justify-between gap-0.5"><div class="h-0.5 bg-stone-300 rounded w-2/5" /><div class="flex gap-px"><div class="w-0.5 h-0.5 rounded-full bg-amber-500" /><div class="w-0.5 h-0.5 rounded-full bg-amber-500" /><div class="w-0.5 h-0.5 rounded-full bg-stone-500" /><div class="w-0.5 h-0.5 rounded-full bg-stone-500" /><div class="w-0.5 h-0.5 rounded-full bg-stone-500" /></div></div>
        </div>
      </div>

      <!-- MAIN — timeline dày -->
      <div class="bg-white p-1 flex flex-col gap-1">
        <!-- Học vấn -->
        <div class="flex items-center gap-0.5">
          <div class="w-0.5 h-0.5 rounded-full bg-amber-700" />
          <div class="h-0.5 bg-stone-700 rounded w-1/3" />
        </div>
        <div class="h-px bg-amber-700 w-full" />
        <div class="flex gap-0.5 items-start pl-1">
          <div class="w-0.5 h-0.5 rounded-full bg-amber-700 mt-0.5 shrink-0" />
          <div class="flex-1 flex flex-col gap-0.5">
            <div class="flex items-center justify-between gap-0.5">
              <div class="h-0.5 bg-stone-700 rounded w-2/5" />
              <div class="h-0.5 bg-amber-700 rounded w-1/4" />
            </div>
            <div class="h-0.5 bg-neutral-400 rounded w-1/2" />
            <div class="h-0.5 bg-neutral-300 rounded w-full" />
            <div class="h-0.5 bg-neutral-300 rounded w-4/5" />
          </div>
        </div>

        <!-- Kinh nghiệm -->
        <div class="flex items-center gap-0.5 mt-0.5">
          <div class="w-0.5 h-0.5 rounded-full bg-amber-700" />
          <div class="h-0.5 bg-stone-700 rounded w-2/5" />
        </div>
        <div class="h-px bg-amber-700 w-full" />
        <div class="flex gap-0.5 items-start pl-1">
          <div class="w-0.5 h-0.5 rounded-full bg-amber-700 mt-0.5 shrink-0" />
          <div class="flex-1 flex flex-col gap-0.5">
            <div class="flex items-center justify-between gap-0.5">
              <div class="h-0.5 bg-stone-700 rounded w-1/2" />
              <div class="h-0.5 bg-amber-700 rounded w-1/4" />
            </div>
            <div class="h-0.5 bg-neutral-400 rounded w-2/5" />
            <div class="h-0.5 bg-neutral-300 rounded w-full" />
            <div class="h-0.5 bg-neutral-300 rounded w-5/6" />
          </div>
        </div>
        <div class="flex gap-0.5 items-start pl-1">
          <div class="w-0.5 h-0.5 rounded-full bg-amber-700 mt-0.5 shrink-0" />
          <div class="flex-1 flex flex-col gap-0.5">
            <div class="flex items-center justify-between gap-0.5">
              <div class="h-0.5 bg-stone-700 rounded w-2/5" />
              <div class="h-0.5 bg-amber-700 rounded w-1/4" />
            </div>
            <div class="h-0.5 bg-neutral-400 rounded w-1/3" />
            <div class="h-0.5 bg-neutral-300 rounded w-4/5" />
            <div class="h-0.5 bg-neutral-300 rounded w-full" />
          </div>
        </div>

        <!-- Dự án -->
        <div class="flex items-center gap-0.5 mt-0.5">
          <div class="w-0.5 h-0.5 rounded-full bg-amber-700" />
          <div class="h-0.5 bg-stone-700 rounded w-1/4" />
        </div>
        <div class="h-px bg-amber-700 w-full" />
        <div class="border border-neutral-200 rounded-sm p-0.5 flex flex-col gap-0.5 bg-neutral-50/50">
          <div class="h-0.5 bg-stone-700 rounded w-2/5" />
          <div class="h-0.5 bg-amber-700 rounded w-1/4" />
          <div class="h-0.5 bg-neutral-300 rounded w-full" />
          <div class="h-0.5 bg-neutral-300 rounded w-5/6" />
        </div>
        <div class="border border-neutral-200 rounded-sm p-0.5 flex flex-col gap-0.5 bg-neutral-50/50">
          <div class="h-0.5 bg-stone-700 rounded w-1/2" />
          <div class="h-0.5 bg-amber-700 rounded w-1/5" />
          <div class="h-0.5 bg-neutral-300 rounded w-full" />
          <div class="h-0.5 bg-neutral-300 rounded w-3/4" />
        </div>
      </div>
    </div>

    <!-- ============ Template 2 — header gradient + 2-cột ============ -->
    <div
      v-else-if="resolvedId === 2"
      class="w-full h-full flex flex-col overflow-hidden"
    >
      <!-- Header 35% -->
      <div class="relative h-[35%] bg-[#a8b3c0] flex items-center gap-1 px-1 overflow-hidden">
        <div class="absolute w-3 h-3 rounded-full bg-[rgba(184,108,59,0.35)] -top-1 right-[28%]" />
        <div class="w-3.5 h-3.5 rounded-full bg-white p-px shrink-0">
          <div class="w-full h-full rounded-full bg-neutral-300" />
        </div>
        <div class="flex-1 flex flex-col gap-0.5">
          <div class="h-1 bg-neutral-700/70 rounded w-3/4" />
          <div class="h-0.5 bg-amber-700 rounded w-1/2" />
          <div class="h-0.5 bg-neutral-600/60 rounded w-2/3" />
          <div class="h-0.5 bg-neutral-600/60 rounded w-1/2" />
        </div>
      </div>
      <!-- Body 2 cột — cả 2 đều dày -->
      <div class="flex-1 grid grid-cols-2 gap-1 p-1 bg-white overflow-hidden">
        <!-- Cột trái -->
        <div class="flex flex-col gap-0.5">
          <!-- Thông tin -->
          <div class="h-0.5 bg-amber-700 rounded w-2/3 mb-0.5" />
          <div class="h-px bg-amber-700 w-full" />
          <div class="flex flex-col gap-0.5 mb-0.5">
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 bg-amber-700 rounded-full" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 bg-amber-700 rounded-full" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 bg-amber-700 rounded-full" /><div class="h-0.5 bg-neutral-300 rounded w-3/4" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 bg-amber-700 rounded-full" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
          </div>
          <!-- Học vấn -->
          <div class="h-0.5 bg-amber-700 rounded w-1/2 mb-0.5" />
          <div class="h-px bg-amber-700 w-full" />
          <div class="flex flex-col gap-0.5">
            <div class="h-0.5 bg-neutral-400 rounded w-3/4" />
            <div class="h-0.5 bg-neutral-300 rounded w-2/3" />
            <div class="h-0.5 bg-neutral-400 rounded w-4/5" />
            <div class="h-0.5 bg-neutral-300 rounded w-1/2" />
          </div>
          <!-- K� năng -->
          <div class="h-0.5 bg-amber-700 rounded w-1/3 mt-0.5 mb-0.5" />
          <div class="h-px bg-amber-700 w-full" />
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-amber-700" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-amber-700" /><div class="h-0.5 bg-neutral-300 rounded w-5/6" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-amber-700" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-amber-700" /><div class="h-0.5 bg-neutral-300 rounded w-3/4" /></div>
          </div>
          <!-- Chứng chỉ -->
          <div class="h-0.5 bg-amber-700 rounded w-1/2 mt-0.5 mb-0.5" />
          <div class="h-px bg-amber-700 w-full" />
          <div class="flex flex-col gap-0.5">
            <div class="h-0.5 bg-neutral-400 rounded w-1/2" />
            <div class="h-0.5 bg-neutral-300 rounded w-full" />
            <div class="h-0.5 bg-neutral-400 rounded w-3/5" />
            <div class="h-0.5 bg-neutral-300 rounded w-4/5" />
          </div>
        </div>
        <!-- Cột phải -->
        <div class="flex flex-col gap-0.5">
          <!-- Kinh nghiệm -->
          <div class="h-0.5 bg-amber-700 rounded w-3/4 mb-0.5" />
          <div class="h-px bg-amber-700 w-full" />
          <div class="flex flex-col gap-0.5">
            <div class="h-0.5 bg-neutral-400 rounded w-4/5" />
            <div class="h-0.5 bg-amber-700 rounded w-1/2" />
            <div class="h-0.5 bg-neutral-300 rounded w-full" />
            <div class="h-0.5 bg-neutral-300 rounded w-5/6" />
          </div>
          <div class="flex flex-col gap-0.5 mt-0.5">
            <div class="h-0.5 bg-neutral-400 rounded w-3/4" />
            <div class="h-0.5 bg-amber-700 rounded w-2/5" />
            <div class="h-0.5 bg-neutral-300 rounded w-full" />
            <div class="h-0.5 bg-neutral-300 rounded w-4/5" />
          </div>
          <div class="flex flex-col gap-0.5 mt-0.5">
            <div class="h-0.5 bg-neutral-400 rounded w-2/3" />
            <div class="h-0.5 bg-amber-700 rounded w-1/3" />
            <div class="h-0.5 bg-neutral-300 rounded w-full" />
            <div class="h-0.5 bg-neutral-300 rounded w-3/4" />
          </div>
          <!-- Hoạt động -->
          <div class="h-0.5 bg-amber-700 rounded w-1/2 mt-0.5 mb-0.5" />
          <div class="h-px bg-amber-700 w-full" />
          <div class="flex flex-col gap-0.5">
            <div class="h-0.5 bg-neutral-400 rounded w-3/5" />
            <div class="h-0.5 bg-neutral-300 rounded w-full" />
            <div class="h-0.5 bg-neutral-300 rounded w-4/5" />
            <div class="h-0.5 bg-neutral-400 rounded w-1/2" />
            <div class="h-0.5 bg-neutral-300 rounded w-full" />
          </div>
        </div>
      </div>
    </div>

    <!-- ============ Template 3 — 1-cột centered serif ============ -->
    <div
      v-else-if="resolvedId === 3"
      class="w-full h-full bg-white flex flex-col items-stretch px-2 py-1 gap-0.5 font-serif overflow-hidden"
    >
      <!-- Header centered -->
      <div class="flex flex-col items-center gap-0.5 mb-0.5">
        <div class="h-1 bg-neutral-800 rounded w-1/2" />
        <div class="h-0.5 bg-neutral-500 rounded w-1/3 italic" />
        <div class="flex gap-0.5 mt-0.5">
          <div class="w-2 h-0.5 bg-neutral-300 rounded" />
          <div class="w-2 h-0.5 bg-neutral-300 rounded" />
          <div class="w-2 h-0.5 bg-neutral-300 rounded" />
        </div>
      </div>
      <!-- Section: Mục tiêu -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-800 rounded w-1/4 mx-auto" />
        <div class="h-px bg-neutral-800 w-full" />
        <div class="h-0.5 bg-neutral-300 rounded w-full" />
        <div class="h-0.5 bg-neutral-300 rounded w-11/12 mx-auto" />
        <div class="h-0.5 bg-neutral-300 rounded w-3/4 mx-auto" />
      </div>
      <!-- Section: Học vấn -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-800 rounded w-1/4 mx-auto mt-0.5" />
        <div class="h-px bg-neutral-800 w-full" />
        <div class="flex justify-between gap-0.5"><div class="h-0.5 bg-neutral-600 rounded w-1/3" /><div class="h-0.5 bg-neutral-400 rounded w-1/5" /></div>
        <div class="h-0.5 bg-neutral-400 rounded w-1/2 italic" />
        <div class="h-0.5 bg-neutral-300 rounded w-full" />
        <div class="h-0.5 bg-neutral-300 rounded w-5/6" />
      </div>
      <!-- Section: Kinh nghiệm (2 items) -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-800 rounded w-1/4 mx-auto mt-0.5" />
        <div class="h-px bg-neutral-800 w-full" />
        <div class="flex justify-between gap-0.5"><div class="h-0.5 bg-neutral-600 rounded w-2/5" /><div class="h-0.5 bg-neutral-400 rounded w-1/5" /></div>
        <div class="h-0.5 bg-neutral-400 rounded w-1/3 italic" />
        <div class="h-0.5 bg-neutral-300 rounded w-full" />
        <div class="h-0.5 bg-neutral-300 rounded w-11/12" />
        <div class="flex justify-between gap-0.5 mt-0.5"><div class="h-0.5 bg-neutral-600 rounded w-1/2" /><div class="h-0.5 bg-neutral-400 rounded w-1/5" /></div>
        <div class="h-0.5 bg-neutral-400 rounded w-2/5 italic" />
        <div class="h-0.5 bg-neutral-300 rounded w-full" />
        <div class="h-0.5 bg-neutral-300 rounded w-3/4" />
      </div>
      <!-- Section: Kỹ năng (table) -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-800 rounded w-1/4 mx-auto mt-0.5" />
        <div class="h-px bg-neutral-800 w-full" />
        <div class="flex gap-0.5"><div class="h-0.5 bg-neutral-500 rounded w-2/5" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
        <div class="flex gap-0.5"><div class="h-0.5 bg-neutral-500 rounded w-1/3" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
        <div class="flex gap-0.5"><div class="h-0.5 bg-neutral-500 rounded w-2/5" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
        <div class="flex gap-0.5"><div class="h-0.5 bg-neutral-500 rounded w-1/2" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
      </div>
      <!-- Section: Hoạt động -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-800 rounded w-1/4 mx-auto mt-0.5" />
        <div class="h-px bg-neutral-800 w-full" />
        <div class="flex justify-between gap-0.5"><div class="h-0.5 bg-neutral-600 rounded w-1/2" /><div class="h-0.5 bg-neutral-400 rounded w-1/5" /></div>
        <div class="h-0.5 bg-neutral-400 rounded w-2/5 italic" />
        <div class="h-0.5 bg-neutral-300 rounded w-full" />
      </div>
      <!-- Section: Chứng chỉ -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-800 rounded w-1/4 mx-auto mt-0.5" />
        <div class="h-px bg-neutral-800 w-full" />
        <div class="flex justify-between gap-0.5"><div class="h-0.5 bg-neutral-600 rounded w-2/5" /><div class="h-0.5 bg-neutral-400 rounded w-1/5" /></div>
        <div class="h-0.5 bg-neutral-300 rounded w-3/4" />
      </div>
    </div>

    <!-- ============ Template 4 — navy header + sidebar ============ -->
    <div
      v-else-if="resolvedId === 4"
      class="w-full h-full flex flex-col overflow-hidden"
    >
      <!-- Header 28% -->
      <div
        class="relative h-[28%] flex items-center gap-1 px-1"
        style="background: linear-gradient(120deg, #0e2a47 0%, #14365a 70%, #1a4267 100%)"
      >
        <div class="w-3.5 h-3.5 rounded-full bg-white p-px shrink-0">
          <div class="w-full h-full rounded-full bg-neutral-300" />
        </div>
        <div class="flex-1 flex flex-col gap-0.5">
          <div class="h-1 bg-white/90 rounded w-3/4" />
          <div class="h-0.5 bg-[#f4a261] rounded w-1/2" />
        </div>
        <div
          class="absolute bottom-0 left-0 h-0.5 w-full"
          style="background: linear-gradient(90deg, #b86c3b 0%, #d68a52 60%, transparent 100%)"
        />
      </div>
      <!-- Body 2-col -->
      <div class="flex-1 grid grid-cols-[30%_1fr] gap-1 p-1 bg-white overflow-hidden">
        <!-- Sidebar trái -->
        <div class="flex flex-col gap-0.5">
          <!-- Contact -->
          <div class="h-0.5 bg-[#b86c3b] rounded w-3/4" />
          <div class="h-px bg-[#b86c3b] w-full" />
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#b86c3b]" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#b86c3b]" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#b86c3b]" /><div class="h-0.5 bg-neutral-300 rounded w-3/4" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#b86c3b]" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
          </div>
          <!-- Summary -->
          <div class="h-0.5 bg-[#b86c3b] rounded w-2/3 mt-0.5" />
          <div class="h-px bg-[#b86c3b] w-full" />
          <div class="h-0.5 bg-neutral-300 rounded w-full" />
          <div class="h-0.5 bg-neutral-300 rounded w-5/6" />
          <div class="h-0.5 bg-neutral-300 rounded w-3/4" />
          <!-- Skills -->
          <div class="h-0.5 bg-[#b86c3b] rounded w-1/2 mt-0.5" />
          <div class="h-px bg-[#b86c3b] w-full" />
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#4a7c3a]" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#4a7c3a]" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#4a7c3a]" /><div class="h-0.5 bg-neutral-300 rounded w-3/4" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#4a7c3a]" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
          </div>
          <!-- Interests -->
          <div class="h-0.5 bg-[#b86c3b] rounded w-1/2 mt-0.5" />
          <div class="h-px bg-[#b86c3b] w-full" />
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#4a7c3a]" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#4a7c3a]" /><div class="h-0.5 bg-neutral-300 rounded flex-1" /></div>
            <div class="flex items-center gap-0.5"><div class="w-0.5 h-0.5 rounded-full bg-[#4a7c3a]" /><div class="h-0.5 bg-neutral-300 rounded w-3/4" /></div>
          </div>
        </div>
        <!-- Main phải: timeline dày -->
        <div class="flex flex-col gap-0.5">
          <!-- Học vấn -->
          <div class="h-0.5 bg-[#b86c3b] rounded w-3/4" />
          <div class="h-px bg-[#b86c3b] w-full" />
          <div class="flex gap-0.5 items-start">
            <div class="w-0.5 h-0.5 rounded-full bg-[#b86c3b] mt-0.5 shrink-0" />
            <div class="flex-1 flex flex-col gap-0.5">
              <div class="h-0.5 bg-[#0e2a47] rounded w-3/4" />
              <div class="h-0.5 bg-[#b86c3b] rounded w-1/2" />
              <div class="h-0.5 bg-neutral-300 rounded w-full" />
            </div>
          </div>
          <div class="flex gap-0.5 items-start mt-0.5">
            <div class="w-0.5 h-0.5 rounded-full bg-[#b86c3b] mt-0.5 shrink-0" />
            <div class="flex-1 flex flex-col gap-0.5">
              <div class="h-0.5 bg-[#0e2a47] rounded w-2/3" />
              <div class="h-0.5 bg-[#b86c3b] rounded w-1/2" />
              <div class="h-0.5 bg-neutral-300 rounded w-full" />
            </div>
          </div>
          <!-- Kinh nghiệm -->
          <div class="h-0.5 bg-[#b86c3b] rounded w-2/3 mt-0.5" />
          <div class="h-px bg-[#b86c3b] w-full" />
          <div class="flex gap-0.5 items-start">
            <div class="w-0.5 h-0.5 rounded-full bg-[#b86c3b] mt-0.5 shrink-0" />
            <div class="flex-1 flex flex-col gap-0.5">
              <div class="h-0.5 bg-[#0e2a47] rounded w-3/4" />
              <div class="h-0.5 bg-[#b86c3b] rounded w-1/2" />
              <div class="h-0.5 bg-neutral-300 rounded w-full" />
              <div class="h-0.5 bg-neutral-300 rounded w-5/6" />
            </div>
          </div>
          <div class="flex gap-0.5 items-start">
            <div class="w-0.5 h-0.5 rounded-full bg-[#b86c3b] mt-0.5 shrink-0" />
            <div class="flex-1 flex flex-col gap-0.5">
              <div class="h-0.5 bg-[#0e2a47] rounded w-3/5" />
              <div class="h-0.5 bg-[#b86c3b] rounded w-1/2" />
              <div class="h-0.5 bg-neutral-300 rounded w-full" />
              <div class="h-0.5 bg-neutral-300 rounded w-3/4" />
            </div>
          </div>
          <!-- Hoạt động -->
          <div class="h-0.5 bg-[#b86c3b] rounded w-1/2 mt-0.5" />
          <div class="h-px bg-[#b86c3b] w-full" />
          <div class="flex gap-0.5 items-start">
            <div class="w-0.5 h-0.5 rounded-full bg-[#b86c3b] mt-0.5 shrink-0" />
            <div class="flex-1 flex flex-col gap-0.5">
              <div class="h-0.5 bg-[#0e2a47] rounded w-3/4" />
              <div class="h-0.5 bg-[#b86c3b] rounded w-1/2" />
              <div class="h-0.5 bg-neutral-300 rounded w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ Template 5 — editorial 1-cột centered ============ -->
    <div
      v-else
      class="w-full h-full bg-white flex flex-col items-stretch px-2 py-1 overflow-hidden"
    >
      <!-- Header centered -->
      <div class="flex flex-col items-center gap-0.5 mb-0.5">
        <div class="w-3 h-3 rounded-full bg-neutral-100 border border-neutral-200" />
        <div class="h-1 bg-neutral-900 rounded w-3/4 mt-0.5" />
        <div class="h-0.5 bg-neutral-500 rounded w-1/2" />
        <div class="flex gap-0.5 mt-0.5">
          <div class="w-2 h-0.5 bg-neutral-400 rounded" />
          <div class="w-2 h-0.5 bg-neutral-400 rounded" />
          <div class="w-2 h-0.5 bg-neutral-400 rounded" />
        </div>
      </div>
      <!-- Section: Kinh nghiệm (2 items) -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-900 rounded w-1/5 mx-auto mt-0.5" />
        <div class="h-px mx-auto w-1/2" style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)" />
        <div class="flex justify-between gap-0.5"><div class="h-0.5 bg-neutral-700 rounded w-2/5" /><div class="h-0.5 bg-neutral-400 rounded w-1/5" /></div>
        <div class="h-0.5 bg-amber-700 rounded w-1/2" />
        <div class="h-0.5 bg-neutral-300 rounded w-full" />
        <div class="h-0.5 bg-neutral-300 rounded w-11/12" />
        <div class="flex justify-between gap-0.5 mt-0.5"><div class="h-0.5 bg-neutral-700 rounded w-1/2" /><div class="h-0.5 bg-neutral-400 rounded w-1/5" /></div>
        <div class="h-0.5 bg-amber-700 rounded w-2/5" />
        <div class="h-0.5 bg-neutral-300 rounded w-full" />
        <div class="h-0.5 bg-neutral-300 rounded w-3/4" />
      </div>
      <!-- Section: Học vấn -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-900 rounded w-1/5 mx-auto mt-0.5" />
        <div class="h-px mx-auto w-1/2" style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)" />
        <div class="flex justify-between gap-0.5"><div class="h-0.5 bg-neutral-700 rounded w-2/5" /><div class="h-0.5 bg-neutral-400 rounded w-1/5" /></div>
        <div class="h-0.5 bg-amber-700 rounded w-1/3" />
        <div class="h-0.5 bg-neutral-300 rounded w-full" />
        <div class="h-0.5 bg-neutral-300 rounded w-4/5" />
      </div>
      <!-- Section: Kỹ năng (pills) -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-900 rounded w-1/5 mx-auto mt-0.5" />
        <div class="h-px mx-auto w-1/2" style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)" />
        <div class="flex flex-wrap justify-center gap-0.5">
          <div class="h-1 bg-neutral-100 border border-neutral-200 rounded-full w-3" />
          <div class="h-1 bg-neutral-100 border border-neutral-200 rounded-full w-2.5" />
          <div class="h-1 bg-neutral-100 border border-neutral-200 rounded-full w-3.5" />
          <div class="h-1 bg-neutral-100 border border-neutral-200 rounded-full w-2" />
          <div class="h-1 bg-neutral-100 border border-neutral-200 rounded-full w-3" />
          <div class="h-1 bg-neutral-100 border border-neutral-200 rounded-full w-2.5" />
          <div class="h-1 bg-neutral-100 border border-neutral-200 rounded-full w-3" />
        </div>
      </div>
      <!-- Section: Dự án -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-900 rounded w-1/5 mx-auto mt-0.5" />
        <div class="h-px mx-auto w-1/2" style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)" />
        <div class="flex justify-between gap-0.5"><div class="h-0.5 bg-neutral-700 rounded w-1/3" /><div class="h-0.5 bg-neutral-400 rounded w-1/5" /></div>
        <div class="h-0.5 bg-amber-700 rounded w-1/4" />
        <div class="h-0.5 bg-neutral-300 rounded w-full" />
        <div class="h-0.5 bg-neutral-300 rounded w-11/12" />
      </div>
      <!-- Section: Hoạt động -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-900 rounded w-1/5 mx-auto mt-0.5" />
        <div class="h-px mx-auto w-1/2" style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)" />
        <div class="flex justify-between gap-0.5"><div class="h-0.5 bg-neutral-700 rounded w-2/5" /><div class="h-0.5 bg-neutral-400 rounded w-1/5" /></div>
        <div class="h-0.5 bg-amber-700 rounded w-1/3" />
        <div class="h-0.5 bg-neutral-300 rounded w-full" />
      </div>
      <!-- Section: Sở thích -->
      <div class="flex flex-col gap-0.5">
        <div class="h-0.5 bg-neutral-900 rounded w-1/5 mx-auto mt-0.5" />
        <div class="h-px mx-auto w-1/2" style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)" />
        <div class="flex flex-wrap justify-center gap-0.5">
          <div class="h-0.5 bg-neutral-400 rounded w-2.5" />
          <div class="h-0.5 bg-neutral-400 rounded w-3" />
          <div class="h-0.5 bg-neutral-400 rounded w-2" />
          <div class="h-0.5 bg-neutral-400 rounded w-3.5" />
        </div>
      </div>
    </div>
  </div>
</template>
