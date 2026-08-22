<script setup lang="ts">
import CandidateSidebar from '@components/candidate/CandidateSidebar.vue';
</script>

<template>
  <div class="flex min-h-screen bg-gray-50">
    <CandidateSidebar />
    <main class="flex-1 min-w-0">
      <router-view />
    </main>
  </div>
</template>
