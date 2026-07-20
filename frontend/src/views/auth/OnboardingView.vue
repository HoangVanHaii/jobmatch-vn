<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';

const router = useRouter();
const auth = useAuthStore();
const role = ref<'candidate' | 'employer'>(auth.user?.role === 'employer' ? 'employer' : 'candidate');

const onConfirm = () => {
  router.push(role.value === 'candidate' ? '/candidate' : '/employer');
};
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
    <div class="card max-w-md w-full">
      <h1 class="text-2xl font-bold mb-2">Chào mừng {{ auth.user?.email }}! 🎉</h1>
      <p class="text-gray-600 mb-6">Bạn là ai trên JobMatch VN?</p>

      <div class="grid grid-cols-2 gap-4">
        <button @click="role = 'candidate'"
          :class="['p-6 rounded-xl border-2 transition', role === 'candidate' ? 'border-primary-600 bg-primary-50' : 'border-gray-200']">
          <div class="text-3xl mb-2">👤</div>
          <div class="font-semibold">Ứng viên</div>
          <div class="text-xs text-gray-500 mt-1">Tìm việc làm</div>
        </button>
        <button @click="role = 'employer'"
          :class="['p-6 rounded-xl border-2 transition', role === 'employer' ? 'border-primary-600 bg-primary-50' : 'border-gray-200']">
          <div class="text-3xl mb-2">🏢</div>
          <div class="font-semibold">Nhà tuyển dụng</div>
          <div class="text-xs text-gray-500 mt-1">Đăng tin, tìm ứng viên</div>
        </button>
      </div>

      <button @click="onConfirm" class="btn-primary w-full mt-6">Tiếp tục</button>
    </div>
  </div>
</template>