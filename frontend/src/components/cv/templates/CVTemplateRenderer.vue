<script setup lang="ts">
/**
 * CVTemplateRenderer — switch template theo templateId.
 * 5 template hiện có: 1, 2, 3, 4, 5. Ngoài phạm vi → fallback về 1.
 */
import { computed } from 'vue';
import CVTemplate1 from './CVTemplate1.vue';
import CVTemplate2 from './CVTemplate2.vue';
import CVTemplate3 from './CVTemplate3.vue';
import CVTemplate4 from './CVTemplate4.vue';
import CVTemplate5 from './CVTemplate5.vue';
import type { CvRenderData } from '@/types/cv';

const props = defineProps<{
  templateId: number;
  data: CvRenderData;
}>();

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
  <component :is="ResolvedTemplate" :data="data" />
</template>
