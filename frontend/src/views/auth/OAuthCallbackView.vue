<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useOAuth } from '@composables/useOAuth';

const route = useRoute();
const router = useRouter();
const { handleOAuthCallback } = useOAuth();
const error = ref('');

onMounted(async () => {
  try {
    const provider = route.params.provider as 'google' | 'facebook' | 'github';
    await handleOAuthCallback(provider);
    router.push('/onboarding');
  } catch (e: any) {
    error.value = e?.message ?? 'OAuth callback failed';
  }
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <div class="text-center">
      <div v-if="!error" class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
      <p class="mt-4 text-gray-600">{{ error || 'Đang xử lý đăng nhập...' }}</p>
      <RouterLink v-if="error" to="/login" class="btn-primary mt-4 inline-block">Về trang đăng nhập</RouterLink>
    </div>
  </div>
</template>