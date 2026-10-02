<script setup lang="ts">
/**
 * CvPreviewPane — panel preview trái của builder CV (split-view).
 *
 * Render CVTemplateRenderer ở khổ A4 794px rồi `transform: scale()` xuống
 * vừa pane (scale ĐỘNG theo chiều rộng pane qua ResizeObserver — khác
 * pattern hardcode 0.3025 của thumbnail step-7 cũ).
 *
 * Cơ chế scale (quan trọng):
 *   - `transform` KHÔNG đổi layout → cần 1 "sizer div" bên ngoài với
 *     width/height = kích thước ĐÃ scale để vùng cuộn tính chiều cao đúng.
 *   - RO-1 quan sát scroll container (contentRect.width = không gồm padding)
 *     → scale = width / 794.
 *   - RO-2 quan sát sheet 794px → naturalH = offsetHeight — tự cập nhật khi
 *     user gõ (nội dung mọc dài hơn → sizer cao lên → vùng cuộn cuộn được).
 *
 * Component PURE — chỉ props/emits, không đụng store/router:
 *   - `update:templateId` / `update:language`: v-model từ view (state nằm ở
 *     CreateResumeView để dùng chung cho preview modal).
 *   - `expand`: mở preview modal full-size (pane luôn bị scale nên cần 1
 *     chỗ xem 1:1).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Eye } from 'lucide-vue-next';
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue';
import { CV_TEMPLATE_META } from '@/utils/cvTemplates';
import type { CvLanguage } from '@/utils/cvLabels';
import type { CvRenderData } from '@/types/cv';

const props = defineProps<{
  templateId: number;
  data: CvRenderData;
  language?: CvLanguage;
}>();

const emit = defineEmits<{
  'update:templateId': [id: number];
  'update:language': [lang: CvLanguage];
  /** User bấm nút Eye — mở preview modal full-size ở view cha. */
  expand: [];
}>();

/** Khổ A4 96dpi — khớp sheet `max-w-[794px]` của CvTemplateLightbox. */
const PAPER_W = 794;

const scrollRef = ref<HTMLElement | null>(null);
const sheetRef = ref<HTMLElement | null>(null);
const scale = ref(1);
const naturalH = ref(0);

let ro: ResizeObserver | null = null;

const measure = () => {
  if (scrollRef.value) {
    // contentRect của RO = content box (không gồm padding p-3).
    const w = scrollRef.value.clientWidth - 24; // trừ padding p-3 2 bên
    scale.value = Math.min(1, Math.max(0.3, w / PAPER_W));
  }
  if (sheetRef.value) {
    naturalH.value = sheetRef.value.offsetHeight;
  }
};

onMounted(() => {
  measure();
  ro = new ResizeObserver(measure);
  if (scrollRef.value) ro.observe(scrollRef.value);
  if (sheetRef.value) ro.observe(sheetRef.value);
});

onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
});

const lang = computed<CvLanguage>(() => props.language ?? 'en');
const activeMeta = computed(
  () => CV_TEMPLATE_META.find((t) => t.id === props.templateId) ?? CV_TEMPLATE_META[0],
);

const langs = ['en', 'vi'] as const;
</script>

<template>
  <!-- Nền trong suốt — chỉ tờ CV (sheet trắng) nổi trên backdrop của overlay;
       toolbar pill/toggle tự mang nền riêng nên vẫn đọc được trên nền dim. -->
  <div>
    <!-- ============ Toolbar: switcher 7 mẫu + EN/VI + mở rộng ============ -->
    <div class="flex items-center gap-2 px-3.5 pb-1.5">
      <div class="scrollbar-hide flex flex-1 items-center gap-1.5 overflow-x-auto pb-1">
        <button
          v-for="tpl in CV_TEMPLATE_META"
          :key="tpl.id"
          type="button"
          class="h-7 shrink-0 rounded-md px-2.5 text-[11px] font-semibold transition-colors"
          :class="templateId === tpl.id
            ? 'bg-[#5b4eea] text-white shadow-sm'
            : 'border border-[#e6e7e9] text-slate-600 hover:bg-slate-50'"
          :title="tpl.desc"
          :aria-pressed="templateId === tpl.id"
          @click="emit('update:templateId', tpl.id)"
        >
          {{ tpl.id }} · {{ tpl.name }}
        </button>
      </div>

      <!-- Toggle ngôn ngữ tiêu đề — pattern segmented của CvTemplateLightbox,
           đổi sang light theme cho khớp nền trắng của builder. -->
      <div class="flex shrink-0 items-center rounded-md bg-slate-100 p-0.5">
        <button
          v-for="l in langs"
          :key="l"
          type="button"
          class="h-6 rounded px-2 text-[11px] font-semibold uppercase transition-colors"
          :class="lang === l
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-800'"
          :aria-pressed="lang === l"
          @click="emit('update:language', l)"
        >
          {{ l }}
        </button>
      </div>

      <button
        type="button"
        class="btn-secondary inline-flex h-8 shrink-0 items-center gap-1.5 !px-2.5 !py-0 text-[12px] font-medium"
        title="Xem trước full-size"
        @click="emit('expand')"
      >
        <Eye class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- ============ Vùng preview: cuộn dọc nội bộ khi CV dài >1 trang ============ -->
    <div
      ref="scrollRef"
      class="mx-3 mb-3 h-full overflow-y-auto rounded-lg p-2.5"
    >
      <!-- Sizer giữ layout đúng chiều cao đã scale (transform không đổi layout). -->
      <div
        class="mx-auto"
        :style="{ width: `${PAPER_W * scale}px`, height: `${naturalH * scale}px` }"
      >
        <div
          ref="sheetRef"
          :style="{
            width: `${PAPER_W}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }"
        >
          <CVTemplateRenderer
            :template-id="templateId"
            :data="data"
            :language="lang"
            :disable-links="true"
          />
        </div>
      </div>
    </div>
  </div>
</template>
