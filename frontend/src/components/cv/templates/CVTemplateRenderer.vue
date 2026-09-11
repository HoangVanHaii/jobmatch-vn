<script setup lang="ts">
/**
 * CVTemplateRenderer — switch template theo templateId.
 * 5 template hiện có: 1, 2, 3, 4, 5. Ngoài phạm vi → fallback về 1.
 *
 * Prop `disableLinks`:
 *   - true  → mỗi template render link dạng text thuần (<span>) thay vì <a>.
 *              Dùng cho chỗ user chỉ "xem trước / chọn mẫu" — không muốn click
 *              nhầm vào URL bên trong preview để navigate đi (vd: step 7 picker,
 *              CvPreview modal).
 *   - false → render <a> như bình thường (mặc định).
 *
 * Hiện tại chỉ CVTemplate3 có anchor; 1/2/4/5 nhận prop nhưng ignore. Khi sau
 * này template nào thêm link, cứ wrap `<a>` với `<template v-if="!disableLinks">`
 * tương tự CVTemplate3.
 */
import { computed } from 'vue';
import CVTemplate1 from './CVTemplate1.vue';
import CVTemplate2 from './CVTemplate2.vue';
import CVTemplate3 from './CVTemplate3.vue';
import CVTemplate4 from './CVTemplate4.vue';
import CVTemplate5 from './CVTemplate5.vue';
import type { CvRenderData } from '@/types/cv';

const props = withDefaults(
  defineProps<{
    templateId: number;
    data: CvRenderData;
    /** true = render text-only (no <a>). Default false để giữ behavior cũ. */
    disableLinks?: boolean;
  }>(),
  { disableLinks: false },
);

/** Map templateId → component. */
const templateMap = {
  1: CVTemplate1,
  2: CVTemplate2,
  3: CVTemplate3,
  4: CVTemplate4,
  5: CVTemplate5,
} as const;

const ResolvedTemplate = computed(() => {
  const tpl = templateMap[props.templateId as 1 | 2 | 3 | 4 | 5];
  return tpl ?? CVTemplate1;
});
</script>

<template>
  <component
    :is="ResolvedTemplate"
    :data="data"
    :disable-links="disableLinks"
  />
</template>
