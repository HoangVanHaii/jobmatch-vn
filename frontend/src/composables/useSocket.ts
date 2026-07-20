/**
 * useSocket composable — subscribe socket events với cleanup
 */
import { onMounted, onUnmounted } from 'vue';
import { getSocket, connectSocket, disconnectSocket } from '@services/socket';

export const useSocket = (
  event: string,
  handler: (...args: any[]) => void,
) => {
  onMounted(() => {
    connectSocket();
    const socket = getSocket();
    socket.on(event, handler);
  });
  onUnmounted(() => {
    const socket = getSocket();
    socket.off(event, handler);
  });
};

export const useSocketLifecycle = (): void => {
  onMounted(connectSocket);
  onUnmounted(disconnectSocket);
};