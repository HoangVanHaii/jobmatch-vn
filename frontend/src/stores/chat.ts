/**
 * Chat Pinia store — state cho conversation list + active conversation.
 *
 * Phân trách nhiệm (theo pattern notification store):
 *   - chatApi: gọi HTTP, trả AxiosResponse (chưa unwrap).
 *   - store này: unwrap data, giữ state, quản lý cursor + pagination.
 *   - useChat composable: realtime events (socket).
 *   - ChatView: subscribe socket + đồng bộ với store khi có event.
 *
 * Lỗi 401 đã được interceptor trong http.ts tự refresh token; các lỗi khác
 * store catch → ghi vào `error.value` để UI hiển thị (toast/banner).
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { chatApi } from '@services/chat.api';
import type {
  ConversationWithPeer,
  ChatMessage,
  ListConversationsQuery,
  CreateConversationInput,
} from '@/types/chat';

const DEFAULT_PAGE_SIZE = 20;

export const useChatStore = defineStore('chat', () => {
  // --- State: conversation list ---
  const conversations = ref<ConversationWithPeer[]>([]);
  const conversationsCursor = ref<string | null>(null);
  const loadingList = ref(false);
  const listError = ref<string | null>(null);

  // --- State: active conversation ---
  const activeId = ref<string | null>(null);
  const activeConversation = ref<ConversationWithPeer | null>(null);

  // --- State: messages ---
  const messages = ref<ChatMessage[]>([]);
  const messagesCursor = ref<string | null>(null);
  const loadingMessages = ref(false);
  const messagesError = ref<string | null>(null);

  // --- Computed ---
  /** Tổng unread của mọi conversation — cho badge bell (nếu muốn). */
  const totalUnread = computed(() =>
    conversations.value.reduce((sum, c) => sum + c.unreadCount, 0),
  );

  // --- Helpers ---
  const setError = (e: unknown, target: 'list' | 'messages'): void => {
    const msg = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
    if (target === 'list') listError.value = msg;
    else messagesError.value = msg;
  };

  /** Tìm conversation trong cache (sidebar) theo id. */
  const findConversation = (id: string): ConversationWithPeer | undefined =>
    conversations.value.find((c) => c.id === id);

  /**
   * Cập nhật 1 conversation trong cache (cho peer info, last message, unread).
   * Dùng khi nhận socket event `chat:new` hoặc khi set active.
   */
  const upsertConversation = (conv: ConversationWithPeer): void => {
    const idx = conversations.value.findIndex((c) => c.id === conv.id);
    if (idx < 0) {
      conversations.value = [conv, ...conversations.value];
    } else {
      const next = [...conversations.value];
      next[idx] = { ...next[idx], ...conv };
      conversations.value = next;
    }
  };

  /**
   * Sort lại theo lastMessageAt DESC (chat:new có thể làm đảo thứ tự).
   * Conversations chưa có tin nhắn xuống cuối.
   */
  const sortByLastMessage = (): void => {
    conversations.value = [...conversations.value].sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      if (bt !== at) return bt - at;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  };

  // --- Actions: list ---
  const fetchConversations = async (reset = true): Promise<void> => {
    if (loadingList.value) return;
    loadingList.value = true;
    listError.value = null;
    try {
      const params: ListConversationsQuery = { limit: DEFAULT_PAGE_SIZE };
      if (!reset && conversationsCursor.value) params.cursor = conversationsCursor.value;
      const { data } = await chatApi.list(params);
      if (reset) {
        conversations.value = data.data.items;
      } else {
        conversations.value = [...conversations.value, ...data.data.items];
      }
      conversationsCursor.value = data.data.nextCursor;
    } catch (e) {
      setError(e, 'list');
    } finally {
      loadingList.value = false;
    }
  };

  const fetchMoreConversations = async (): Promise<void> => {
    if (!conversationsCursor.value || loadingList.value) return;
    await fetchConversations(false);
  };

  // --- Actions: messages ---
  /**
   * Set active conversation và load messages. Nếu đã có trong cache, dùng cache.
   * Reset messages cursor mỗi lần đổi conversation.
   */
  const setActive = async (conversationId: string): Promise<void> => {
    activeId.value = conversationId;
    activeConversation.value = findConversation(conversationId) ?? null;

    // Reset messages + reset unread count locally
    messages.value = [];
    messagesCursor.value = null;
    if (activeConversation.value) {
      upsertConversation({ ...activeConversation.value, unreadCount: 0 });
    }

    await fetchMessages(true);
  };

  const fetchMessages = async (reset = true): Promise<void> => {
    if (!activeId.value || loadingMessages.value) return;
    loadingMessages.value = true;
    messagesError.value = null;
    try {
      const { data } = await chatApi.listMessages(activeId.value, {
        limit: 50,
        ...(messagesCursor.value && !reset ? { cursor: messagesCursor.value } : {}),
      });
      // API trả DESC (mới nhất trước) — reverse để chat scroll xuống.
      const items = [...data.data.items].reverse();
      if (reset) {
        messages.value = items;
      } else {
        messages.value = [...items, ...messages.value];
      }
      messagesCursor.value = data.data.nextCursor;
    } catch (e) {
      setError(e, 'messages');
    } finally {
      loadingMessages.value = false;
    }
  };

  const fetchMoreMessages = async (): Promise<void> => {
    if (!messagesCursor.value || loadingMessages.value) return;
    await fetchMessages(false);
  };

  // --- Actions: helpers for socket events ---
  /** Append 1 message vào active conversation (khi nhận chat:message). */
  const appendMessage = (msg: ChatMessage): void => {
    if (msg.conversationId !== activeId.value) return;
    // Tránh duplicate (echo từ server có tempId, message mình vừa gửi đã thêm)
    if (msg.id && messages.value.some((m) => m.id === msg.id)) return;
    messages.value = [...messages.value, msg];
  };

  /** Replace 1 optimistic message (theo tempId) bằng message thật từ server. */
  const reconcileMessage = (realMsg: ChatMessage, tempId: string): void => {
    const idx = messages.value.findIndex((m) => (m as any).tempId === tempId);
    if (idx < 0) {
      appendMessage(realMsg);
      return;
    }
    const next = [...messages.value];
    next[idx] = { ...realMsg, tempId } as ChatMessage;
    messages.value = next;
  };

  /**
   * Xử lý chat:new — cập nhật sidebar + (nếu không phải active) tăng unread.
   * Đẩy conversation lên đầu.
   */
  const handleChatNew = (payload: {
    conversationId: string;
    lastMessage: { id: string; senderId: string; content: string; createdAt: string };
  }): void => {
    const idx = conversations.value.findIndex((c) => c.id === payload.conversationId);
    const isActive = payload.conversationId === activeId.value;

    if (idx < 0) {
      // Conversation chưa có trong cache — refetch sidebar
      void fetchConversations(true);
      return;
    }

    const prev = conversations.value[idx];
    const next: ConversationWithPeer = {
      ...prev,
      lastMessageAt: payload.lastMessage.createdAt,
      lastMessagePreview: payload.lastMessage.content.slice(0, 200),
      unreadCount: isActive ? 0 : prev.unreadCount + 1,
    };

    upsertConversation(next);
    sortByLastMessage();

    // Nếu conversation vừa nhận tin là active → append luôn
    if (isActive && activeId.value) {
      const newMsg: ChatMessage = {
        id: payload.lastMessage.id,
        conversationId: payload.conversationId,
        senderId: payload.lastMessage.senderId,
        content: payload.lastMessage.content,
        readAt: null,
        createdAt: payload.lastMessage.createdAt,
        metadata: null,
      };
      appendMessage(newMsg);
    }
  };

  /**
   * Tạo hoặc lấy conversation với peer — dùng khi bấm "Chat với X".
   * Trả về conversationId để navigate.
   */
  const createOrGet = async (input: CreateConversationInput): Promise<string> => {
    const { data } = await chatApi.createOrGet(input);
    upsertConversation({
      id: data.data.id,
      jobId: data.data.jobId,
      lastMessageAt: data.data.lastMessageAt,
      lastMessagePreview: data.data.lastMessagePreview,
      createdAt: data.data.createdAt,
      // createOrGet chỉ trả Conversation (không có peer) — lấy từ cache hoặc fallback
      peer: findConversation(data.data.id)?.peer ?? {
        id: input.peerUserId,
        fullName: null,
        avatarUrl: null,
        role: 'candidate',
      },
      unreadCount: 0,
    });
    sortByLastMessage();
    return data.data.id;
  };

  // --- Actions: cleanup ---
  const reset = (): void => {
    conversations.value = [];
    conversationsCursor.value = null;
    activeId.value = null;
    activeConversation.value = null;
    messages.value = [];
    messagesCursor.value = null;
    listError.value = null;
    messagesError.value = null;
  };

  return {
    // state
    conversations, conversationsCursor, loadingList, listError,
    activeId, activeConversation,
    messages, messagesCursor, loadingMessages, messagesError,
    // computed
    totalUnread,
    // helpers
    findConversation, upsertConversation,
    // actions
    fetchConversations, fetchMoreConversations,
    setActive, fetchMessages, fetchMoreMessages,
    appendMessage, reconcileMessage,
    handleChatNew,
    createOrGet,
    reset,
  };
});