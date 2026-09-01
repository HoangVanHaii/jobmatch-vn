<script setup lang="ts">
/**
 * ChatView — trang chat realtime giữa user ↔ user.
 *
 * Layout:
 *   ┌──────────────┬───────────────────────────────┐
 *   │ Sidebar      │ ChatWindow                    │
 *   │ (conv list)  │  - Header (peer info + back)  │
 *   │              │  - MessageList                │
 *   │              │  - MessageInput               │
 *   └──────────────┴───────────────────────────────┘
 *
 * Responsive behavior:
 *   - Desktop (≥768px): sidebar + main LUÔN cùng hiện cạnh nhau, không toggle.
 *     Click 1 conversation trên desktop → chỉ update phần content bên phải,
 *     sidebar KHÔNG bị ẩn.
 *   - Mobile (<768px): chỉ 1 panel tại 1 thời điểm — toggle sidebar ↔ chat
 *     qua `isMobileSidebar`. Click peer/conversation → chuyển sang chat view;
 *     tap back trong peer header → quay sidebar.
 *
 * URL params:
 *   /chat                      → sidebar view (chưa chọn conversation)
 *   /chat?peer=<userId>        → tạo/lấy conversation với peer, navigate
 *   /chat/:conversationId      → chat view của conversation
 */
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

/**
 * NOTE: `chat:new` listener đã chuyển lên App.vue (global) để handle cả khi
 * user ở trang khác (chatbot, profile, ...). ChatView chỉ tập trung vào
 * conversation đang mở + realtime message/typing/read của conv đó.
 */

/* ============================================================================
 * Responsive: tách rõ desktop (md+) vs mobile (<md).
 *   - Desktop: sidebar luôn hiện cạnh main.
 *   - Mobile : toggle giữa sidebar ↔ chat.
 * isDesktop phản ứng với resize để khi user xoay ngang/dọc hoặc kéo cửa sổ
 * trình duyệt, layout tự cập nhật mà không cần reload.
 * ==========================================================================*/
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

/**
 * Mobile-only routing — tương tự ChatbotView:
 *   - true  → hiển thị sidebar (danh sách conversation)
 *   - false → hiển thị chat area
 * Bootstrap set dựa trên activeId: có conversation → chat, không có → sidebar.
 * Chỉ có ý nghĩa trên mobile (xem `showSidebar` bên dưới).
 */
const isMobileSidebar = ref(true);

const setInitialMobileView = (): void => {
  isMobileSidebar.value = !activeId.value;
};

/**
 * Sidebar visibility (feed `v-show` cho `<ConversationList>`):
 *   - Desktop (md+): luôn `true` — sidebar không bao giờ bị ẩn, dù có chọn
 *     conversation hay không. Click conv trên desktop chỉ update content bên phải.
 *   - Mobile (<md): theo `isMobileSidebar` — toggle giữa sidebar view ↔ chat view.
 * v-show giữ DOM tĩnh nên search input + scroll position trong ConversationList
 * được bảo toàn khi user chuyển panel (đỡ reset UX).
 */
const showSidebar = computed(() => isDesktop.value || isMobileSidebar.value);

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
  // Set mobile view SAU khi route (có thể vừa replace sang /chat/:id).
  setInitialMobileView();
});

// === Initial load + đổi route → setActive + update mobile view ===
// `immediate: true` để load messages NGAY khi mount nếu URL đã có `:id`
// (vd F5 reload /chat/X — route param đã có sẵn, watch với `immediate: false`
// sẽ không fire vì activeId "không đổi" → setActive không chạy → store.messages
// trống + activeId = null → send() và onMessage bị filter sai).
watch(
  () => activeId.value,
  async (id) => {
    if (id) await store.setActive(id);
    // Có conversation → chat view; không có → sidebar view.
    isMobileSidebar.value = !id;
  },
  { immediate: true },
);

/**
 * NOTE: markRead tự động được xử lý bên trong `useChat` (watcher trên
 * `lastPeerMessageId`). Khi messages load xong (initial) hoặc peer gửi tin
 * mới → useChat tự emit `chat:read` qua socket. KHÔNG cần gọi markRead ở
 * đây — race với watcher + có thể double-emit.
 *
 * Trước đây có `setTimeout(markRead, 800)` — đã bỏ vì:
 *   1) Nếu fetchMessages chậm >800ms → markRead early-return (lastPeerMessageId
 *      chưa set), chat:read không bao giờ được emit.
 *   2) Sau khi useChat có watcher, hành vi này đã được cover đầy đủ và
 *      idempotent (track lastEmittedPeerId để tránh spam).
 */

const onSelect = (id: string): void => {
  auth.user?.role == 'candidate'
    ? router.push({ name: 'chat', params: { id } })
    : router.push({ name: 'e-chat', params: { id } });
  // Mobile: chọn conversation nào → chuyển sang chat view.
  isMobileSidebar.value = false;
};

/**
 * User click 1 peer trong search results (ConversationList gọi API /users/search).
 * Flow: tạo hoặc lấy conversation với peer → navigate tới /chat/:conversationId.
 * Trên mobile, tự chuyển sang chat view (giống onSelect conversation cũ).
 */
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

      <!--
        Main chat area — trên desktop (md+) luôn visible. Trên mobile:
          - showSidebar=true → main ẩn (đang ở sidebar view).
          - showSidebar=false → main hiện (chat view, sidebar đã bật sang phải).
        md:flex luôn override 'hidden' ở md+ (CSS source order).
      -->
      <main
        class="flex-1 flex flex-col bg-white"
        :class="[(!isDesktop && showSidebar) ? 'hidden' : 'flex', 'md:flex']"
      >
        <!-- Empty state khi chưa chọn conversation (chỉ desktop — mobile ở sidebar) -->
        <div
          v-if="!activeId"
          class="hidden flex-1 flex-col items-center justify-center text-gray-400 md:flex"
        >
          <MessageCircle class="w-16 h-16 mb-3 opacity-40" />
          <p class="text-sm">Chọn một cuộc hội thoại để bắt đầu</p>
        </div>

        <!-- Active conversation -->
        <template v-if="activeId">
          <!--
            Header — có nút back (mobile only) quay về sidebar danh sách conversation.
            UX hợp nhất với chatbot pattern: header này là header duy nhất của
            ChatWindow (không có top bar ngoài), back chỉ hiện trên mobile.
          -->
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