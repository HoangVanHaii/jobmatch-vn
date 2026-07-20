<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { http } from '@services/http';

const plans = ref<any[]>([]);
onMounted(async () => {
  const { data } = await http.get('/plans');
  plans.value = data.data;
});
</script>
<template>
  <div class="max-w-6xl mx-auto px-4 py-12">
    <h1 class="text-3xl font-bold text-center mb-2">Chọn gói phù hợp với bạn</h1>
    <p class="text-center text-gray-600 mb-8">Free vẫn dùng đầy đủ tính năng. Nâng cấp khi cần mở rộng.</p>
    <div class="grid md:grid-cols-3 gap-6">
      <div v-for="plan in plans" :key="plan.id" class="card text-center">
        <h3 class="text-xl font-bold mb-2">{{ plan.name }}</h3>
        <p class="text-4xl font-bold text-primary-600 mb-4">
          {{ plan.priceVnd === '0' ? 'Miễn phí' : `${Number(plan.priceVnd).toLocaleString()}đ` }}
        </p>
        <button class="btn-primary w-full">{{ plan.code === 'free' ? 'Đang dùng' : 'Nâng cấp' }}</button>
      </div>
    </div>
  </div>
</template>