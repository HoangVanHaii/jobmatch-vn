<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import ChatbotWidget from '@components/ai/ChatbotWidget.vue';
import NotificationBell from '@components/notify/NotificationBell.vue';

const auth = useAuthStore();
</script>

<template>
  <RouterView />
  <NotificationBell />
  <ChatbotWidget v-if="auth.user" />
</template>