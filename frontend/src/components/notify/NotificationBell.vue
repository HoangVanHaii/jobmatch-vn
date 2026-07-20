<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useNotificationStore } from '@stores/notification';
import { useAuthStore } from '@stores/auth';

const isOpen = ref(false);
const notif = useNotificationStore();
const auth = useAuthStore();

onMounted(async () => {
  if (auth.isAuthenticated) {
    await notif.fetch();
    notif.subscribeRealtime();
  }
});
</script>

<template>
  <div v-if="auth.isAuthenticated" class="fixed top-4 right-4 z-40">
    <button @click="isOpen = !isOpen" class="relative w-10 h-10 bg-white rounded-full shadow flex items-center justify-center">
      🔔
      <span v-if="notif.unreadCount" class="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
        {{ notif.unreadCount }}
      </span>
    </button>
    <div v-if="isOpen" class="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border max-h-96 overflow-y-auto">
      <header class="p-3 border-b flex justify-between items-center">
        <span class="font-semibold">Thông báo</span>
        <button v-if="notif.unreadCount" @click="notif.markAllRead" class="text-xs text-primary-600">Đánh dấu tất cả đã đọc</button>
      </header>
      <div v-if="notif.items.length === 0" class="p-6 text-center text-gray-500">Chưa có thông báo</div>
      <div v-for="n in notif.items" :key="n.id" @click="notif.markRead(n.id)"
        :class="['p-3 border-b cursor-pointer hover:bg-gray-50', !n.readAt && 'bg-blue-50']">
        <p class="font-medium text-sm">{{ n.title }}</p>
        <p v-if="n.body" class="text-xs text-gray-600">{{ n.body }}</p>
      </div>
    </div>
  </div>
</template>