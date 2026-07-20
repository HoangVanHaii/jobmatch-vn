<script setup lang="ts">
import { ref, watch } from 'vue';
import { useInsight } from '@composables/useInsight';

const props = defineProps<{ keyword: string }>();
const insight = useInsight();
const data = ref<any>(null);

watch(() => props.keyword, async (k) => {
  data.value = await insight.fetch(k);
}, { immediate: true });
</script>

<template>
  <div v-if="data" class="card bg-gradient-to-br from-blue-50 to-purple-50">
    <h3 class="font-semibold mb-3 flex items-center gap-2">
      <span>✨</span> Insight cho "{{ keyword }}"
    </h3>
    <div class="grid md:grid-cols-3 gap-4 text-sm">
      <div>
        <div class="text-2xl font-bold text-primary-600">{{ data.jobCount }}</div>
        <div class="text-gray-600">jobs đang tuyển</div>
      </div>
      <div>
        <div class="text-2xl font-bold text-primary-600">
          {{ data.salaryMedian ? `${data.salaryMedian.min / 1e6}-${data.salaryMedian.max / 1e6}M` : 'N/A' }}
        </div>
        <div class="text-gray-600">Lương trung bình</div>
      </div>
      <div>
        <div class="text-2xl font-bold text-primary-600">{{ data.topSkills?.length || 0 }}</div>
        <div class="text-gray-600">Kỹ năng hot</div>
      </div>
    </div>
  </div>
</template>