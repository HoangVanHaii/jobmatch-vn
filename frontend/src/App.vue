<script setup lang="ts">
/**
 * App.vue — root layout.
 *
 * Components global (luôn mount khi user login):
 *   - <RouterView />          : page chính
 *   - <NotificationBell />    : chuông + dropdown notification (đăng ký socket
 *                               `notification:new` để real-time update badge).
 *   - <ToastHost />           : global toast queue (peer chat realtime khi user
 *                               ở ngoài /chat).
 *
 * Global socket listeners:
 *   - `chat:new`  ← đăng ký TẠI ĐÂY (không phải ChatView) để hoạt động đúng
 *     khi user ở trang khác (chatbot, profile, ...). Hành vi:
 *       1. Luôn `chatStore.handleChatNew(payload)` — cập nhật sidebar +
 *          unread badge cho cache local. Idempotent.
 *       2. Nếu user KHÔNG ở `/chat*` → đẩy toast (peer name + preview +
 *          click → navigate tới /chat/:id).
 *       3. Nếu user ĐANG ở `/chat*` → sidebar update là đủ (họ đã thấy
 *          conv reorder + badge); tránh toast redundant.
 *
 *   Lưu ý: ChatView KHÔNG đăng ký `chat:new` nữa để khỏi duplicate
 *   (handleChatNew được gọi 2 lần — không sai nhưng tốn công vô ích).
 *
 *   - `notification:new` ← NotificationBell tự lo.
 */
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { useChatStore } from '@stores/chat';
import { useToastStore } from '@stores/toast';
import { useSocket } from '@composables/useSocket';
import NotificationBell from '@components/notify/NotificationBell.vue';
import ToastContainer from '@components/notify/ToastContainer.vue';

// Chatbot AI giờ là trang full-page tại `/chatbot` (ChatbotView.vue).
// Floating ChatbotWidget cũ đã thay thế — import giữ để tương thích nếu file còn được tham chiếu,
// nhưng không mount để tránh trùng UI.
// import ChatbotWidget from '@components/ai/ChatbotWidget.vue';
import ToastHost from '@components/common/ToastHost.vue';
import type { ChatNewPayload } from '@/types/chat';

const auth = useAuthStore();
const chat = useChatStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

/**
 * Global `chat:new` listener — đăng ký ở App.vue nên luôn sống cùng app.
 * useSocket auto-cleanup khi App unmount (chỉ xảy ra khi logout/refresh).
 */
useSocket('chat:new', (payload: ChatNewPayload) => {
  // 1. Update sidebar cache (unread + sort) — chạy ở mọi trang.
  chat.handleChatNew(payload);

  // 2. Toast CHỈ khi user KHÔNG ở /chat namespace — tránh spam trên trang
  //    chat (sidebar update đã là indicator đủ rõ).
  const onChatPage = route.path.startsWith('/chat');
  if (onChatPage) return;

  // Look up peer info từ chat store — nếu conversation chưa có trong cache
  // (vd user vừa mới nhận tin từ người lạ, hoặc sidebar chưa fetch) → fallback
  // title generic.
  const peer = chat.conversations.find((c) => c.id === payload.conversationId)?.peer;

  // Tự navigate về /chat theo role (giống ChatView.onSelect).
  const chatRouteName = auth.user?.role === 'candidate' ? 'chat' : 'e-chat';
  const goToChat = (): void => {
    void router.push({ name: chatRouteName, params: { id: payload.conversationId } });
  };

  toast.push({
    // Dedupe key — cùng conversationId + messageId chỉ hiện 1 toast.
    id: `${payload.conversationId}:${payload.lastMessage.id}`,
    variant: 'chat',
    title: peer?.fullName ?? 'Tin nhắn mới',
    body: payload.lastMessage.content,
    avatarUrl: peer?.avatarUrl ?? null,
    onClick: goToChat,
    action: { label: 'Mở', onClick: goToChat },
  });
});
</script>

<template>
  <RouterView />
  <NotificationBell />
  <!-- Toast container — render hàng đợi toast toàn cục. Teleport tới body. -->
  <ToastContainer />
</template>
  <ToastHost />
</template>
