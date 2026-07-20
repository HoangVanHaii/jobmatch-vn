<script setup lang="ts">
import { ref } from 'vue';
const email = ref('');
const sent = ref(false);
const onSubmit = () => { sent.value = true; };
</script>
<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
    <div class="card max-w-md w-full">
      <h1 class="text-2xl font-bold mb-4">Quên mật khẩu</h1>
      <form v-if="!sent" @submit.prevent="onSubmit" class="space-y-4">
        <input v-model="email" type="email" required class="input" placeholder="Email" />
        <button class="btn-primary w-full">Gửi link reset</button>
      </form>
      <p v-else class="text-green-600">Đã gửi link reset. Vui lòng kiểm tra email.</p>
    </div>
  </div>
</template>