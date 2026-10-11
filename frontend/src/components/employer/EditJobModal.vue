<script setup lang="ts">
/**
 * EditJobModal.vue — Đồng bộ 100% giao diện và trải nghiệm với CreateJobModal.vue
 *
 * Tái sử dụng toàn bộ:
 *  - Stepper 3 bước SaaS tông tím #7C22E8 cao cấp (Desktop 922px × 656px)
 *  - AI JD Generator card & Preview modal
 *  - Toàn bộ field dữ liệu: lương, địa điểm, yêu cầu, kỹ năng, chu kỳ trả lương,
 *    phân quyền phụ trách tin, kênh chia sẻ JobMatch VN.
 *  - Tương thích 100% với các component cha (JobDetailView.vue, PostedJobsView.vue).
 */
import CreateJobModal from './CreateJobModal.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    jobId: string;
  }>(),
  {
    open: false,
    jobId: '',
  },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'saved'): void;
}>();
</script>

<template>
  <CreateJobModal
    :open="open"
    :job-id="jobId"
    @update:open="emit('update:open', $event)"
    @saved="emit('saved')"
    @created="emit('saved')"
  />
</template>
