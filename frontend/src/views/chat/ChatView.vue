<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChatStore } from '@stores/chat';
import { useAuthStore } from '@stores/auth';
import { useChat } from '@composables/useChat';
import ConversationList from '@components/chat/ConversationList.vue';
import MessageList from '@components/chat/MessageList.vue';
import MessageInput from '@components/chat/MessageInput.vue';
import { ArrowLeft, MessageCircle } from 'lucide-vue-next';

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
const MOBILE_BREAKPOINT = 768;
const isDesktop = ref(true);

const updateIsDesktop = (): void => {
  if (typeof window === 'undefined') return;
  isDesktop.value = window.innerWidth >= MOBILE_BREAKPOINT;
};

onMounted(() => {
  updateIsDesktop();
  window.addEventListener('resize', updateIsDesktop);
});
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsDesktop);
  }
});

const isMobileSidebar = ref(true);

const setInitialMobileView = (): void => {
  isMobileSidebar.value = !activeId.value;
};

const showSidebar = computed(() => isDesktop.value || isMobileSidebar.value);

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
  setInitialMobileView();
});
watch(
  () => activeId.value,
  async (id) => {
    if (id) await store.setActive(id);
    // Có conversation → chat view; không có → sidebar view.
    isMobileSidebar.value = !id;
  },
  { immediate: true },
);

const onSelect = (id: string): void => {
  auth.user?.role == 'candidate'
    ? router.push({ name: 'chat', params: { id } })
    : router.push({ name: 'e-chat', params: { id } });
  // Mobile: chọn conversation nào → chuyển sang chat view.
  isMobileSidebar.value = false;
};

const onSelectPeer = async (peer: { id: string; fullName: string | null; avatarUrl: string | null; role: 'candidate' | 'employer' | 'admin' }): Promise<void> => {
  try {
    const id = await store.createOrGet({ peerUserId: peer.id });
    router.push({ name: 'chat', params: { id } });
    isMobileSidebar.value = false;
  } catch (e) {
    console.error('createOrGet from peer search failed:', e);
  }
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

/** Back từ chat view → sidebar danh sách conversation (mobile only). */
const onBackToSidebar = (): void => {
  isMobileSidebar.value = true;
};
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-50">
    <!-- Body: sidebar + main -->
    <div class="flex-1 flex overflow-hidden">
      <!--
        Sidebar — `v-show` để giữ DOM + state (search input, scroll position) khi
        switch mobile state. Transition fade tạo hiệu ứng mượt khi đổi panel.
        Trên md+ luôn show (showSidebar=true bất chấp isMobileSidebar); trên
        mobile theo isMobileSidebar (toggle sidebar ↔ chat).
      -->
      <Transition name="fade">
        <ConversationList
          v-show="showSidebar"
          :active-id="activeId"
          @select="onSelect"
          @select-peer="onSelectPeer"
        />
      </Transition>

     <main
        class="flex-1 flex flex-col bg-white"
        :class="[(!isDesktop && showSidebar) ? 'hidden' : 'flex', 'md:flex']"
      >
        <div
          v-if="!activeId"
          class="hidden flex-1 flex-col items-center justify-center text-gray-400 md:flex"
        >
          <MessageCircle class="w-16 h-16 mb-3 opacity-40" />
          <p class="text-sm">Chọn một cuộc hội thoại để bắt đầu</p>
        </div>

        <!-- Active conversation -->
        <template v-if="activeId">
          <header class="shrink-0 px-4 py-3 border-b border-gray-200 flex items-center gap-3 bg-white">
            <button
              type="button"
              class="md:hidden p-1 -ml-1 rounded hover:bg-gray-100"
              title="Về danh sách"
              aria-label="Về danh sách hội thoại"
              @click="onBackToSidebar"
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
              <img
                v-else
                src="/avatars/peer-default.svg"
                alt=""
                class="w-full h-full object-cover"
              />
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
            :peer-avatar="store.activeConversation?.peer.avatarUrl ?? null"
            :peer-name="store.activeConversation?.peer.fullName ?? null"
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

<style scoped>
/*
 * Fade ngầm khi switch giữa sidebar ↔ chat trên mobile (300ms). Đồng bộ với
 * chatbot page pattern.
 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>