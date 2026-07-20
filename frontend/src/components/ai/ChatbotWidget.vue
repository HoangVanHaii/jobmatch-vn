<script setup lang="ts">
import { ref } from 'vue';
import { aiApi } from '@services/ai.api';

const isOpen = ref(false);
const messages = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
const input = ref('');
const streaming = ref(false);

const send = async () => {
  if (!input.value.trim()) return;
  const userMsg = input.value;
  messages.value.push({ role: 'user', content: userMsg });
  input.value = '';
  streaming.value = true;
  messages.value.push({ role: 'assistant', content: '' });
  try {
    let acc = '';
    for await (const chunk of aiApi.chat([...messages.value.slice(0, -1)])) {
      acc += chunk;
      messages.value[messages.value.length - 1].content = acc;
    }
  } finally { streaming.value = false; }
};
</script>

<template>
  <div class="fixed bottom-4 right-4 z-50">
    <button v-if="!isOpen" @click="isOpen = true"
      class="w-14 h-14 bg-primary-600 text-white rounded-full shadow-lg flex items-center justify-center text-2xl hover:bg-primary-700">
      💬
    </button>
    <div v-else class="w-96 h-[500px] bg-white rounded-2xl shadow-2xl flex flex-col">
      <header class="p-4 bg-primary-600 text-white rounded-t-2xl flex justify-between">
        <span class="font-semibold">AI Assistant</span>
        <button @click="isOpen = false">✕</button>
      </header>
      <div class="flex-1 overflow-y-auto p-4 space-y-2">
        <div v-for="(m, i) in messages" :key="i"
          :class="['p-2 rounded-lg max-w-[80%]', m.role === 'user' ? 'ml-auto bg-primary-100' : 'bg-gray-100']">
          {{ m.content || '...' }}
        </div>
      </div>
      <form @submit.prevent="send" class="p-3 border-t flex gap-2">
        <input v-model="input" class="input flex-1" placeholder="Hỏi gì đó..." :disabled="streaming" />
        <button type="submit" class="btn-primary" :disabled="streaming">Gửi</button>
      </form>
    </div>
  </div>
</template>