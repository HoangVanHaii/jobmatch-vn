<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import SearchBar from '@components/search/SearchBar.vue';
import InsightPanel from '@components/search/InsightPanel.vue';

const router = useRouter();
const keyword = ref('');

const onSearch = () => {
  router.push({ name: 'search', query: { keyword: keyword.value } });
};
</script>

<template>
  <div class="min-h-screen">
    <!-- Hero -->
    <section class="bg-gradient-to-br from-primary-600 to-primary-900 text-white py-20">
      <div class="max-w-5xl mx-auto px-4 text-center">
        <h1 class="text-4xl md:text-6xl font-bold mb-6">
          Tìm việc làm mơ ước với <span class="text-yellow-300">AI</span>
        </h1>
        <p class="text-lg mb-8 opacity-90">
          Sàn tuyển dụng thông minh kết nối ứng viên & nhà tuyển dụng tại Việt Nam
        </p>
        <SearchBar v-model="keyword" @search="onSearch" class="max-w-2xl mx-auto" />
        <div class="mt-6 flex flex-wrap gap-2 justify-center text-sm">
          <span class="px-3 py-1 bg-white/10 rounded-full">🔥 Java Developer</span>
          <span class="px-3 py-1 bg-white/10 rounded-full">Marketing</span>
          <span class="px-3 py-1 bg-white/10 rounded-full">Kế toán</span>
          <span class="px-3 py-1 bg-white/10 rounded-full">Designer</span>
        </div>
      </div>
    </section>

    <!-- Insight mặc định -->
    <section class="max-w-5xl mx-auto px-4 py-12">
      <InsightPanel keyword="Java Developer" />
    </section>
  </div>
</template>