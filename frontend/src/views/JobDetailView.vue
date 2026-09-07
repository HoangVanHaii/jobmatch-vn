<script setup lang="ts">
/**
 * JobDetailView — public fallback cho route `/jobs/:id` (đã comment trong
 * router — hiện tại route này không mount). Giữ file để tránh vỡ import ở
 * các nơi khác, đồng thời dùng modal apply pattern giống candidate view.
 */
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { jobApi } from '@services/job.api';
import ApplyJob from '@components/job/ApplyJob.vue';

interface MinimalJob {
  id: string;
  title: string;
  description?: string | null;
  company?: { name?: string | null } | null;
  location?: { city?: string | null } | null;
}

const route = useRoute();
const job = ref<MinimalJob | null>(null);
const applyOpen = ref(false);

onMounted(async () => {
  const { data } = await jobApi.detail(route.params.id as string);
  job.value = data.data as MinimalJob;
});
</script>
<template>
  <div v-if="job" class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold mb-4">{{ job.title }}</h1>
    <p class="text-gray-600 mb-6">{{ job.company?.name }} · {{ job.location?.city }}</p>
    <div class="card mb-6">
      <h2 class="font-semibold mb-2">Mô tả công việc</h2>
      <p class="whitespace-pre-line">{{ job.description }}</p>
    </div>
    <button
      type="button"
      class="btn-primary"
      @click="applyOpen = true"
    >
      Ứng tuyển ngay
    </button>
    <ApplyJob
      v-if="job"
      :job="{ id: job.id, title: job.title }"
      v-model:open="applyOpen"
    />
  </div>
</template>