<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { useOAuth } from '@composables/useOAuth';
import OAuthButtons from '@components/auth/OAuthButtons.vue';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const { loginWith } = useOAuth();

const email = ref('');
const password = ref('');
const error = ref('');
const errorCode = ref('');
const loading = ref(false);

const onSubmit = async () => {
  loading.value = true;
  error.value = '';
  errorCode.value = '';
  try {
    await auth.login(email.value, password.value);
    const redirect = route.query.redirect as string;
    router.push(redirect || '/');
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message ?? 'Đăng nhập thất bại';
    errorCode.value = e?.response?.data?.error?.code ?? '';
  } finally { loading.value = false; }
};

const onOAuth = async (provider: 'google' | 'facebook' | 'github') => {
  await loginWith(provider);
};
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
    <div class="card w-full max-w-md">
      <h1 class="text-2xl font-bold text-center mb-6">Đăng nhập JobMatch</h1>

      <OAuthButtons @select="onOAuth" />

      <div class="flex items-center my-6">
        <div class="flex-1 border-t"></div>
        <span class="px-3 text-sm text-gray-500">Hoặc</span>
        <div class="flex-1 border-t"></div>
      </div>

      <form @submit.prevent="onSubmit" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">Email</label>
          <input v-model="email" type="email" required class="input" placeholder="you@example.com" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Mật khẩu</label>
          <input v-model="password" type="password" required class="input" placeholder="••••••••" />
        </div>
        <p v-if="error" class="text-red-500 text-sm">{{ error }}</p>
        <p v-if="errorCode === 'EMAIL_NOT_VERIFIED'" class="text-sm text-center">
          <RouterLink :to="{ name: 'verify-otp', query: { email } }" class="text-primary-600 font-medium">
            Xác thực email ngay →
          </RouterLink>
        </p>
        <button type="submit" :disabled="loading" class="btn-primary w-full">
          {{ loading ? 'Đang đăng nhập...' : 'Đăng nhập' }}
        </button>
      </form>

      <p class="text-center mt-6 text-sm">
        Chưa có tài khoản? <RouterLink to="/register" class="text-primary-600 font-medium">Đăng ký</RouterLink>
      </p>
    </div>
  </div>
</template>