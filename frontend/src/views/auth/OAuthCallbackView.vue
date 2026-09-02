<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useOAuth } from '@composables/useOAuth';

type Provider = 'google' | 'facebook' | 'github';
const VALID_PROVIDERS: readonly Provider[] = ['google', 'facebook', 'github'] as const;

const route = useRoute();
const router = useRouter();
const { handleOAuthCallback } = useOAuth();
const error = ref('');

onMounted(async () => {
  const provider = String(route.params.provider ?? '') as Provider;

  // Validate provider ngay từ đầu — tránh user gõ /auth/callback/bat-cu-thu
  // → backend văng lỗi → trang treo vô thời hạn.
  if (!VALID_PROVIDERS.includes(provider)) {
    error.value = 'Đường dẫn đăng nhập không hợp lệ.';
    setTimeout(() => router.replace('/login'), 1500);
    return;
  }

  // Cần `code` từ provider redirect — nếu thiếu → fail nhanh.
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code) {
    error.value = 'Thiếu mã xác thực từ nhà cung cấp.';
    setTimeout(() => router.replace('/login'), 1500);
    return;
  }

  try {
    const result = await handleOAuthCallback(provider);
    // Dispatch theo status:
    //   - EXISTING_USER → đã login, redirect theo role.
    //   - NEW_USER → chưa tạo user, cần user chọn Role trước.
    if (result.status === 'EXISTING_USER') {
      const target = result.user.role === 'employer' ? '/employer' : '/candidate';
      router.replace(target);
    } else {
      router.replace({ name: 'select-role' });
    }
  } catch (e: any) {
    error.value = e?.message ?? 'Đăng nhập thất bại. Vui lòng thử lại.';
    // Auto-redirect sau 3s để user không kẹt ở trang callback.
    setTimeout(() => router.replace('/login'), 3000);
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