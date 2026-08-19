<script setup lang="ts">
/**
 * ChatView — trang chat chính.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ Header (logo + back)                         │
 *   ├──────────────┬───────────────────────────────┤
 *   │ Sidebar      │ ChatWindow                    │
 *   │ (conv list)  │  - Header (peer info)         │
 *   │              │  - MessageList                │
 *   │              │  - MessageInput               │
 *   └──────────────┴───────────────────────────────┘
 *
 * URL params:
 *   /chat                      → empty (chưa chọn conversation)
 *   /chat?peer=<userId>        → tạo/lấy conversation với peer, navigate
 *   /chat/:conversationId      → mở conversation có sẵn
 */
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChatStore } from '@stores/chat';
import { useAuthStore } from '@stores/auth';
import { useChat } from '@composables/useChat';
import { useSocket } from '@composables/useSocket';
import ConversationList from '@components/chat/ConversationList.vue';
import MessageList from '@components/chat/MessageList.vue';
import MessageInput from '@components/chat/MessageInput.vue';
import { ArrowLeft, MessageCircle } from 'lucide-vue-next';
import type { ChatNewPayload } from '@/types/chat';

const route = useRoute();
const router = useRouter();
const store = useChatStore();
const auth = useAuthStore();

const activeId = computed<string | null>(() => {
  const param = route.params.id;
  if (typeof param === 'string' && param.length > 0) return param;
  return null;
});

/** Hook socket + useChat cho conversation hiện tại. */
const chatHook = useChat(() => activeId.value ?? '');

/** Listen `chat:new` cho sidebar update (luôn bật khi vào /chat). */
useSocket('chat:new', (payload: ChatNewPayload) => {
  store.handleChatNew(payload);
});

// === On mount: handle deep-link /chat?peer=<userId> ===
onMounted(async () => {
  const peer = route.query.peer;
  if (typeof peer === 'string' && peer.length > 0) {
    try {
      const id = await store.createOrGet({ peerUserId: peer });
      router.replace({ name: 'chat', params: { id } });
    } catch (e) {
      console.error('createOrGet failed:', e);
    }
  }
});

// === Đổi route → setActive ===
watch(
  () => activeId.value,
  async (id) => {
    if (id) await store.setActive(id);
  },
  { immediate: true },
);

// Auto markRead khi mở conversation
watch(
  () => activeId.value,
  (id) => {
    if (id && chatHook) {
      // delay nhỏ để messages load xong
      setTimeout(() => chatHook.markRead(), 800);
    }
  },
);

const onSelect = (id: string): void => {
  router.push({ name: 'chat', params: { id } });
};

const onSend = (content: string): void => {
  chatHook?.send(content);
};

const onTyping = (val: boolean): void => {
  chatHook?.typing(val);
};

const onLoadMore = async (): Promise<void> => {
  await store.fetchMoreMessages();
};

const initial = computed(() => {
  const name = store.activeConversation?.peer.fullName;
  return (name?.[0] ?? '?').toUpperCase();
});

const goBack = (): void => {
  router.push({ name: 'chat' });
};
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-50">
    <!-- Top bar -->
    <header class="shrink-0 h-14 px-4 flex items-center gap-3 bg-white border-b border-gray-200 shadow-sm">
      <button
        type="button"
        class="md:hidden p-2 -ml-2 rounded hover:bg-gray-100"
        @click="goBack"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <h1 class="font-semibold text-gray-800">Chat</h1>
    </header>

    <!-- Body: sidebar + main -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Sidebar (ẩn trên mobile khi có active) -->
      <div
        class="md:flex shrink-0"
        :class="activeId ? 'hidden md:flex' : 'flex w-full'"
      >
        <ConversationList :active-id="activeId" @select="onSelect" />
      </div>

      <!-- Main chat area -->
      <main
        class="flex-1 flex flex-col bg-white"
        :class="activeId ? 'flex' : 'hidden md:flex'"
      >
        <!-- Empty state khi chưa chọn conversation -->
        <div
          v-if="!activeId"
          class="flex-1 flex flex-col items-center justify-center text-gray-400"
        >
          <MessageCircle class="w-16 h-16 mb-3 opacity-40" />
          <p class="text-sm">Chọn một cuộc hội thoại để bắt đầu</p>
        </div>

        <!-- Active conversation -->
        <template v-else>
          <!-- Header -->
          <header class="shrink-0 px-4 py-3 border-b border-gray-200 flex items-center gap-3 bg-white">
            <button
              type="button"
              class="md:hidden p-1 -ml-1 rounded hover:bg-gray-100"
              @click="goBack"
            >
              <ArrowLeft class="w-5 h-5" />
            </button>
            <div class="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
              <img
                v-if="store.activeConversation?.peer.avatarUrl"
                :src="store.activeConversation.peer.avatarUrl"
                :alt="store.activeConversation.peer.fullName ?? ''"
                class="w-full h-full object-cover"
              />
              <span v-else class="text-sm font-semibold text-gray-600">{{ initial }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-medium text-gray-900 truncate">
                {{ store.activeConversation?.peer.fullName ?? 'Người dùng' }}
              </p>
              <p class="text-xs text-gray-500">
                {{ store.activeConversation?.peer.role === 'employer' ? 'Nhà tuyển dụng' : 'Ứng viên' }}
              </p>
            </div>
          </header>

          <!-- Messages -->
          <MessageList
            v-if="chatHook"
            :messages="chatHook.messages.value"
            :current-user-id="auth.user?.id ?? ''"
            :has-more="!!store.messagesCursor"
            :loading="store.loadingMessages"
            :peer-typing="chatHook.peerTyping.value"
            @load-more="onLoadMore"
          />

          <!-- Input -->
          <MessageInput @send="onSend" @typing="onTyping" />
        </template>
      </main>
    </div>
  </div>
</template>