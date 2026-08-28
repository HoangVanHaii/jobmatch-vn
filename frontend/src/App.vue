<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import NotificationBell from '@components/notify/NotificationBell.vue';

// Chatbot AI giờ là trang full-page tại `/chatbot` (ChatbotView.vue).
// Floating ChatbotWidget cũ đã thay thế — import giữ để tương thích nếu file còn được tham chiếu,
// nhưng không mount để tránh trùng UI.
// import ChatbotWidget from '@components/ai/ChatbotWidget.vue';

const auth = useAuthStore();
</script>

<template>
  <RouterView />
  <NotificationBell />
</template>