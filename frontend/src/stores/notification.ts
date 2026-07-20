/**
 * Notification store
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { notificationApi } from '@services/notification.api';
import { getSocket } from '@services/socket';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export const useNotificationStore = defineStore('notification', () => {
  const items = ref<Notification[]>([]);
  const unreadCount = computed(() => items.value.filter((n) => !n.readAt).length);

  const fetch = async (): Promise<void> => {
    const { data } = await notificationApi.list();
    items.value = data.data;
  };

  const markRead = async (id: string): Promise<void> => {
    await notificationApi.markRead(id);
    const n = items.value.find((x) => x.id === id);
    if (n) n.readAt = new Date().toISOString();
  };

  const markAllRead = async (): Promise<void> => {
    await notificationApi.markAllRead();
    items.value.forEach((n) => { n.readAt = n.readAt ?? new Date().toISOString(); });
  };

  const subscribeRealtime = (): void => {
    const socket = getSocket();
    socket.on('notification:new', (n: Notification) => {
      items.value.unshift(n);
    });
  };

  return { items, unreadCount, fetch, markRead, markAllRead, subscribeRealtime };
});