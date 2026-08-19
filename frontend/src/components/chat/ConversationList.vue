<script setup lang="ts">
/**
 * ConversationList — sidebar trái: search + list conversation.
 *
 * Lấy data từ chatStore, search filter theo tên peer, emit 'select' khi click.
 */
import { computed, onMounted, ref } from 'vue';
import { useChatStore } from '@stores/chat';
import ConversationItem from './ConversationItem.vue';
import { Search, Loader2, MessageCircle } from 'lucide-vue-next';

const props = defineProps<{
  activeId: string | null;
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void;
}>();

const store = useChatStore();
const search = ref('');

onMounted(async () => {
  if (store.conversations.length === 0) await store.fetchConversations(true);
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return store.conversations;
  return store.conversations.filter((c) =>
    (c.peer.fullName ?? '').toLowerCase().includes(q),
  );
});

const onSelect = (id: string): void => emit('select', id);
const onLoadMore = async (): Promise<void> => {
  await store.fetchMoreConversations();
};
</script>

<template>
  <aside class="w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white flex flex-col h-full">
    <!-- Header -->
    <header class="px-4 py-3 border-b border-gray-100">
      <h2 class="font-semibold text-gray-800 mb-2">Tin nhắn</h2>
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="search"
          type="text"
          placeholder="Tìm người..."
          class="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-primary-400 focus:bg-white"
        />
      </div>
    </header>

    <!-- List -->
    <div class="flex-1 overflow-y-auto px-2 py-2 space-y-1">
      <p v-if="store.loadingList && store.conversations.length === 0" class="text-center text-gray-400 py-8 text-sm">
        <Loader2 class="w-5 h-5 animate-spin inline mr-1" /> Đang tải...
      </p>
      <p v-else-if="filtered.length === 0" class="text-center text-gray-400 py-12 text-sm">
        <MessageCircle class="w-10 h-10 mx-auto mb-2 opacity-50" />
        Chưa có cuộc hội thoại nào
      </p>
      <ConversationItem
        v-for="c in filtered"
        :key="c.id"
        :conversation="c"
        :active="c.id === activeId"
        @click="onSelect"
      />
      <button
        v-if="store.conversationsCursor"
        class="w-full py-2 text-xs text-gray-500 hover:bg-gray-50 rounded"
        :disabled="store.loadingList"
        @click="onLoadMore"
      >
        {{ store.loadingList ? 'Đang tải...' : 'Tải thêm' }}
      </button>
    </div>
  </aside>
</template>