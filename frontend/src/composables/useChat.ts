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
/**
 * Thời gian giữ typing indicator sau khi nhận `isTyping=false`.
 * Backend phát false 300ms sau keystroke cuối; thêm delay này để:
 *   - Tránh flicker khi peer gõ chậm (gap giữa các keystroke > 300ms).
 *   - UX giống Messenger/Telegram: dots "đứng lại" thêm chút sau khi peer
 *     dừng gõ, tạo cảm giác mượt.
 */
const TYPING_HIDE_DELAY_MS = 1000;

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

  /**
   * Delay ẩn typing indicator để tránh nhấp nháy khi peer gõ chậm.
   *
   * Vấn đề: backend gửi `isTyping=false` 300ms sau keystroke cuối. Nếu peer
   * gõ chậm (gap giữa các keystroke > 300ms), false phát ra giữa các lần
   * gõ → dots tắt → true lại → dots bật → flicker.
   *
   * Cách xử lý: nhận `false` thì chờ thêm TYPING_HIDE_DELAY_MS rồi mới tắt.
   * Nếu `true` đến trong khoảng đó → cancel timer, dots vẫn sáng → mượt.
   *
   * Cleanup: timer được clear khi component unmount / đổi conversationId
   * để tránh stale callback set peerTyping cho conv cũ.
   */
  let hideTypingTimer: ReturnType<typeof setTimeout> | null = null;

  const onTyping = (data: ChatTypingBroadcast): void => {
    if (data.conversationId !== conversationId()) return;
    if (data.userId === auth.user?.id) return; // bỏ qua typing của mình

    if (data.isTyping) {
      // Có typing mới → hiện ngay + cancel pending hide.
      if (hideTypingTimer) {
        clearTimeout(hideTypingTimer);
        hideTypingTimer = null;
      }
      peerTyping.value = true;
    } else {
      // typing=false → delay ẩn. Nếu true đến trước khi timer fire,
      // timer sẽ bị cancel ở nhánh trên.
      if (hideTypingTimer) clearTimeout(hideTypingTimer);
      hideTypingTimer = setTimeout(() => {
        hideTypingTimer = null;
        // Double-check conv vẫn match (tránh trường hợp user đổi conv
        // trong lúc timer pending — đã clear trong watch dưới, nhưng
        // giữ check phòng defensive).
        if (data.conversationId !== conversationId()) return;
        peerTyping.value = false;
      }, TYPING_HIDE_DELAY_MS);
    }
  };

  const onRead = (data: ChatReadBroadcast): void => {
    if (data.conversationId !== conversationId()) return;
    if (data.userId === auth.user?.id) return;
    // Đánh dấu các message của mình (senderId === me) là đã đọc bởi peer.
    // So theo VỊ TRÍ trong mảng (messages đã sort theo createdAt ASC) thay vì
    // so sánh string UUID lexicographic (UUID v4 không sort được theo thời gian,
    // nên cách cũ `m.id <= data.lastReadMessageId` cho kết quả sai).
    const me = auth.user?.id;
    if (!me) return;
    const lastReadIdx = data.lastReadMessageId
      ? store.messages.findIndex((x) => x.id === data.lastReadMessageId)
      : store.messages.length - 1;
    if (data.lastReadMessageId && lastReadIdx < 0) {
      // Không tìm thấy lastReadMessageId trong cache (có thể do paginate chưa load)
      // → fallback: mark tất cả own messages đang hiện là đã đọc.
      store.messages = store.messages.map((m) =>
        m.senderId === me && !m.readAt ? { ...m, readAt: data.readAt } : m,
      );
      return;
    }
    store.messages = store.messages.map((m, idx) => {
      if (m.senderId !== me) return m;
      if (m.readAt) return m;
      return idx <= lastReadIdx ? { ...m, readAt: data.readAt } : m;
    });
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
    // Clear pending typing-hide timer — tránh callback fire sau unmount
    // set peerTyping.value trên component đã destroy.
    if (hideTypingTimer) {
      clearTimeout(hideTypingTimer);
      hideTypingTimer = null;
    }
    detach(conversationId());
  });

  // Khi conversationId đổi → leave room cũ, join room mới
  watch(
    () => conversationId(),
    (newId, oldId) => {
      if (oldId) detach(oldId);
      if (mounted && newId) attach(newId);
      syncMessages();
      // Reset typing state cho conv mới — tránh hiển thị stale dots từ conv cũ
      // và clear pending hide timer (nếu user đổi conv giữa lúc typing=false
      // đang chờ hide, dots của conv cũ không nên áp dụng cho conv mới).
      if (hideTypingTimer) {
        clearTimeout(hideTypingTimer);
        hideTypingTimer = null;
      }
      peerTyping.value = false;
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

  /**
   * Auto-emit chat:read khi có peer message MỚI NHẤT (covers 2 case):
   *   1) Initial load: lastPeerMessageId được set sau khi fetchMessages xong
   *      (timeout 800ms cũ không đảm bảo — fetch có thể chậm hơn).
   *   2) Realtime: peer gửi tin mới khi user đang mở conv → store.messages
   *      thay đổi → syncMessages → lastPeerMessageId update → emit read cho
   *      tin mới.
   *
   * Track `lastEmittedPeerId` để tránh spam: chỉ emit khi lastPeerMessageId
   * thực sự thay đổi (append own message không làm đổi lastPeerMessageId).
   */
  let lastEmittedPeerId: string | null = null;

  const emitReadIfNewer = (): void => {
    const id = conversationId();
    const peerId = lastPeerMessageId.value;
    if (!id || !peerId || peerId === lastEmittedPeerId) return;
    lastEmittedPeerId = peerId;
    markRead();
  };

  watch(
    () => lastPeerMessageId.value,
    () => emitReadIfNewer(),
  );

  // Reset state khi đổi conversation — tránh emit read cho conv cũ.
  watch(
    () => conversationId(),
    () => {
      lastEmittedPeerId = null;
    },
  );

  return {
    messages,
    peerTyping,
    send,
    typing,
    markRead,
  };
};