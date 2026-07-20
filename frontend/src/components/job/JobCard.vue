<script setup lang="ts">
import { useRouter } from 'vue-router';
defineProps<{ job: any }>();
const router = useRouter();
const fmtSalary = (min: string | null, max: string | null) => {
  if (!min || !max) return 'Thoả thuận';
  return `${(Number(min) / 1_000_000).toFixed(0)}–${(Number(max) / 1_000_000).toFixed(0)} triệu`;
};
</script>
<template>
  <div @click="router.push(`/jobs/${job.id}`)"
    class="card hover:shadow-md cursor-pointer transition">
    <div class="flex items-start justify-between">
      <div class="flex-1">
        <h3 class="font-semibold text-lg">{{ job.title }}</h3>
        <p class="text-gray-600 text-sm mt-1">{{ job.company?.name }} · {{ job.location?.city }}</p>
        <div class="flex gap-2 mt-3 flex-wrap">
          <span v-if="job.jobLevel" class="px-2 py-1 bg-primary-50 text-primary-700 text-xs rounded">{{ job.jobLevel }}</span>
          <span v-if="job.jobType" class="px-2 py-1 bg-gray-100 text-xs rounded">{{ job.jobType }}</span>
          <span class="px-2 py-1 bg-green-50 text-green-700 text-xs rounded">{{ fmtSalary(job.salaryMin, job.salaryMax) }}</span>
        </div>
      </div>
      <button v-if="job.featured" class="text-yellow-500">⭐</button>
    </div>
  </div>
</template>