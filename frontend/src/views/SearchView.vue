<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useInsight } from '@composables/useInsight';
import { useDebounce } from '@composables/useDebounce';
import { jobApi } from '@services/job.api';
import JobCard from '@components/job/JobCard.vue';
import InsightPanel from '@components/search/InsightPanel.vue';

const route = useRoute();
const router = useRouter();
const keyword = ref(String(route.query.keyword ?? ''));
const debouncedKeyword = useDebounce(keyword, 400);
const insight = useInsight();
const jobs = ref<any[]>([]);

watch(debouncedKeyword, async (val) => {
  router.replace({ query: { ...route.query, keyword: val } });
  await Promise.all([
    insight.fetch(val),
    jobApi.search({ search: val }).then(({ data }) => { jobs.value = data.data; }),
  ]);
}, { immediate: true });
</script>
<template>
  <div class="max-w-6xl mx-auto px-4 py-8">
    <input v-model="keyword" placeholder="Tìm kiếm việc làm..." class="input mb-6" />
    <InsightPanel :keyword="debouncedKeyword" />
    <div class="mt-6 space-y-4">
      <JobCard v-for="job in jobs" :key="job.id" :job="job" />
    </div>
  </div>
</template>