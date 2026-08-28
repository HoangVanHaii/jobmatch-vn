/**
 * Composable: useChatbot
 *
 * Thin wrapper quanh Pinia store + auto-scroll behavior cho messages container.
 * Tách composable để view không cần biết scroll logic + dễ test.
 */
import { ref, nextTick, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useChatbotStore } from '@stores/chatbot';

export function useChatbot() {
  const store = useChatbotStore();
  const refs = storeToRefs(store);

  const messagesRef = ref<HTMLElement | null>(null);

  /**
   * Scroll xuống cuối messages container. Dùng khi có message mới / streaming update.
   */
  const scrollToBottom = async (smooth = true): Promise<void> => {
    await nextTick();
    if (!messagesRef.value) return;
    messagesRef.value.scrollTo({
      top: messagesRef.value.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  /**
   * Auto-abort stream khi unmount (không để request treo lại trên server).
   */
  onUnmounted(() => {
    store.abortStream();
  });

  return {
    store,
    refs,
    messagesRef,
    scrollToBottom,
  };
}