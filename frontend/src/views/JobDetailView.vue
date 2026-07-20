<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { jobApi } from '@services/job.api';
import ApplyJob from '@components/job/ApplyJob.vue';

const route = useRoute();
const job = ref<any>(null);
onMounted(async () => {
  const { data } = await jobApi.detail(route.params.id as string);
  job.value = data.data;
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
    <ApplyJob :job="job" />
  </div>
</template>