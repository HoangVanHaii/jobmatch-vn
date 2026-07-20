/**
 * useChat composable — chat realtime
 */
import { ref } from 'vue';
import { getSocket, connectSocket } from '@services/socket';

export const useChat = (conversationId: string) => {
  const messages = ref<Array<{ senderId: string; content: string; createdAt: string }>>([]);
  const isTyping = ref(false);

  const join = (): void => {
    connectSocket();
    const socket = getSocket();
    socket.emit('chat:join', conversationId);
    socket.on('chat:message', (msg: any) => {
      if (msg.conversationId === conversationId) messages.value.push(msg);
    });
    socket.on('chat:typing', (data: { userId: string; isTyping: boolean }) => {
      isTyping.value = data.isTyping;
    });
  };

  const send = (content: string): void => {
    getSocket().emit('chat:message', { conversationId, content });
  };

  const typing = (val: boolean): void => {
    getSocket().emit('chat:typing', { conversationId, isTyping: val });
  };

  return { messages, isTyping, join, send, typing };
};