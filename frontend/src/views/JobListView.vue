<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { jobApi } from '@services/job.api';
import JobCard from '@components/job/JobCard.vue';
import JobFilter from '@components/job/JobFilter.vue';

const jobs = ref<any[]>([]);
const filters = ref<Record<string, any>>({});

const fetchJobs = async () => {
  const { data } = await jobApi.search(filters.value);
  jobs.value = data.data;
};

onMounted(fetchJobs);
</script>
<template>
  <div class="max-w-6xl mx-auto px-4 py-8 grid md:grid-cols-[280px_1fr] gap-6">
    <JobFilter v-model="filters" @change="fetchJobs" />
    <div class="space-y-4">
      <JobCard v-for="job in jobs" :key="job.id" :job="job" />
    </div>
  </div>
</template>