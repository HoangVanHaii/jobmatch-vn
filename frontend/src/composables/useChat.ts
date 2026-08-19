/**
 * useChat composable — chat realtime cho 1 conversation.
 *
 * Subscribe các event khi conversation được mở (mount):
 *   - chat:message  ← append + reconcile với optimistic message
 *   - chat:typing   ← isTyping ref
 *   - chat:read     ← mark peer messages as read
 *   - chat:new      ← delegated lên store (sidebar update)
 *
 * Tự cleanup khi component unmount hoặc conversationId đổi.
 */
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { getSocket, connectSocket } from '@services/socket';
import { useChatStore } from '@stores/chat';
import { useAuthStore } from '@stores/auth';
import type {
  ChatMessage,
  ChatMessageBroadcast,
  ChatTypingBroadcast,
  ChatReadBroadcast,
  ChatMessagePayload,
} from '@/types/chat';

const TYPING_DEBOUNCE_MS = 300;

export const useChat = (conversationId: () => string) => {
  const store = useChatStore();
  const auth = useAuthStore();

  const peerTyping = ref(false);
  const messages = ref<ChatMessage[]>([]);
  /** ID message cuối cùng của peer trong conv — dùng cho markRead. */
  const lastPeerMessageId = ref<string | null>(null);

  /** Gắn store messages vào local ref (computed mỗi tick). */
  const syncMessages = (): void => {
    messages.value = store.messages;
    const lastPeer = [...store.messages]
      .reverse()
      .find((m) => m.senderId !== auth.user?.id);
    lastPeerMessageId.value = lastPeer?.id ?? null;
  };

  // ----- Socket handlers -----
  const onMessage = (msg: ChatMessageBroadcast): void => {
    if (msg.conversationId !== conversationId()) return;
    // Echo từ server (mình vừa gửi) → reconcile bằng tempId
    if (msg.tempId) {
      store.reconcileMessage(msg, msg.tempId);
      return;
    }
    store.appendMessage(msg);
  };

  const onTyping = (data: ChatTypingBroadcast): void => {
    if (data.conversationId !== conversationId()) return;
    if (data.userId === auth.user?.id) return; // bỏ qua typing của mình
    peerTyping.value = data.isTyping;
  };

  const onRead = (data: ChatReadBroadcast): void => {
    if (data.conversationId !== conversationId()) return;
    if (data.userId === auth.user?.id) return;
    // Đánh dấu các message của mình (senderId === me) là đã đọc bởi peer
    const me = auth.user?.id;
    if (!me) return;
    store.messages = store.messages.map((m) =>
      m.senderId === me && (data.lastReadMessageId == null || m.id <= data.lastReadMessageId)
        ? { ...m, readAt: data.readAt }
        : m,
    );
  };

  // ----- Lifecycle -----
  let mounted = false;

  const attach = (id: string): void => {
    if (!id) return;
    const s = getSocket();
    s.emit('chat:join', id);
    s.on('chat:message', onMessage);
    s.on('chat:typing', onTyping);
    s.on('chat:read', onRead);
  };

  const detach = (id: string): void => {
    if (!id) return;
    const s = getSocket();
    s.emit('chat:leave', id);
    s.off('chat:message', onMessage);
    s.off('chat:typing', onTyping);
    s.off('chat:read', onRead);
  };

  onMounted(() => {
    connectSocket();
    mounted = true;
    attach(conversationId());
    syncMessages();
  });

  onUnmounted(() => {
    mounted = false;
    detach(conversationId());
  });

  // Khi conversationId đổi → leave room cũ, join room mới
  watch(
    () => conversationId(),
    (newId, oldId) => {
      if (oldId) detach(oldId);
      if (mounted && newId) attach(newId);
      syncMessages();
    },
  );

  // Đồng bộ khi store messages thay đổi (qua push từ chat:new khi active)
  watch(() => store.messages, syncMessages, { deep: true });

  // ----- Public actions -----

  /** Gửi message qua socket. Thêm UUID tạm để reconcile. */
  const send = (content: string): void => {
    const id = conversationId();
    if (!id) return;
    const trimmed = content.trim();
    if (!trimmed) return;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload: ChatMessagePayload = {
      conversationId: id,
      content: trimmed,
      tempId,
    };
    getSocket().emit('chat:message', payload);
    // Optimistic: append ngay với tempId, sẽ được reconcile khi server echo.
    // PHẢI set `tempId` (không chỉ `id`) để reconcileMessage tìm được.
    store.appendMessage({
      id: tempId,
      conversationId: id,
      senderId: auth.user?.id ?? '',
      content: trimmed,
      readAt: null,
      createdAt: new Date().toISOString(),
      metadata: null,
      tempId,
    });
  };

  /** Debounced typing indicator. */
  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTypingSent = false;

  const typing = (val: boolean): void => {
    const id = conversationId();
    if (!id) return;
    if (typingTimer) clearTimeout(typingTimer);
    if (val && !lastTypingSent) {
      lastTypingSent = true;
      getSocket().emit('chat:typing', { conversationId: id, isTyping: true });
    }
    typingTimer = setTimeout(() => {
      if (lastTypingSent) {
        lastTypingSent = false;
        getSocket().emit('chat:typing', { conversationId: id, isTyping: false });
      }
    }, TYPING_DEBOUNCE_MS);
  };

  /** Đánh dấu đã đọc tới message cuối cùng của peer. */
  const markRead = (): void => {
    const id = conversationId();
    if (!id || !lastPeerMessageId.value) return;
    const payload = {
      conversationId: id,
      lastReadMessageId: lastPeerMessageId.value,
    };
    getSocket().emit('chat:read', payload);
  };

  return {
    messages,
    peerTyping,
    send,
    typing,
    markRead,
  };
};