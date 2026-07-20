<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';

const router = useRouter();
const auth = useAuthStore();

const email = ref('');
const password = ref('');
const fullName = ref('');
const role = ref<'candidate' | 'employer'>('candidate');
const error = ref('');
const loading = ref(false);

const onSubmit = async () => {
  loading.value = true;
  error.value = '';
  try {
    await auth.register({
      email: email.value,
      password: password.value,
      fullName: fullName.value,
      role: role.value,
    });
    router.push(role.value === 'candidate' ? '/candidate' : '/employer');
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message ?? 'Đăng ký thất bại';
  } finally { loading.value = false; }
};
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
    <div class="card w-full max-w-md">
      <h1 class="text-2xl font-bold text-center mb-6">Đăng ký JobMatch</h1>

      <div class="grid grid-cols-2 gap-3 mb-4">
        <button @click="role = 'candidate'" :class="['p-3 rounded-lg border-2', role === 'candidate' ? 'border-primary-600 bg-primary-50' : 'border-gray-200']">
          👤 Ứng viên
        </button>
        <button @click="role = 'employer'" :class="['p-3 rounded-lg border-2', role === 'employer' ? 'border-primary-600 bg-primary-50' : 'border-gray-200']">
          🏢 Nhà tuyển dụng
        </button>
      </div>

      <form @submit.prevent="onSubmit" class="space-y-4">
        <input v-model="fullName" required class="input" placeholder="Họ và tên" />
        <input v-model="email" type="email" required class="input" placeholder="Email" />
        <input v-model="password" type="password" required minlength="8" class="input" placeholder="Mật khẩu (≥ 8 ký tự)" />
        <p v-if="error" class="text-red-500 text-sm">{{ error }}</p>
        <button type="submit" :disabled="loading" class="btn-primary w-full">
          {{ loading ? 'Đang đăng ký...' : 'Đăng ký' }}
        </button>
      </form>

      <p class="text-center mt-4 text-sm">
        Đã có tài khoản? <RouterLink to="/login" class="text-primary-600">Đăng nhập</RouterLink>
      </p>
    </div>
  </div>
</template>