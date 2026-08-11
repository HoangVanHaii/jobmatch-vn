/**
 * Notification Pinia store — state cho danh sách thông báo của user đang đăng nhập.
 *
 * Phân trách nhiệm (theo pattern auth/company store):
 *   - Service (notificationApi): gọi HTTP, trả AxiosResponse (chưa unwrap).
 *   - Store (file này): destruct `const { data } = await ...` rồi lấy `data.data`,
 *     giữ state (items/loading/error/unreadCount), quản lý cursor, đồng bộ local
 *     sau khi markRead.
 *
 * Lỗi 401 đã được interceptor trong http.ts tự refresh token; các lỗi khác
 * store catch → ghi vào `error.value` để UI hiển thị (toast/banner).
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { notificationApi } from '@services/notification.api';
import type {
  ListNotificationsQuery,
  Notification,
} from '@/types/notification';

const DEFAULT_PAGE_SIZE = 20;

export const useNotificationStore = defineStore('notification', () => {
  // --- State ---
  const items = ref<Notification[]>([]);
  const nextCursor = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** Query cho list: unread + cursor + limit (đổi filter sẽ reset ở setQuery). */
  const query = ref<ListNotificationsQuery>({ limit: DEFAULT_PAGE_SIZE });

  // --- Computed ---
  /** Đếm số notification chưa đọc — dùng cho badge chuông. */
  const unreadCount = computed(() => items.value.filter((n) => n.readAt === null).length);
  const hasMore = computed(() => nextCursor.value !== null);
  const isEmpty = computed(() => !loading.value && items.value.length === 0);

  // --- Helpers ---
  const setError = (e: unknown): void => {
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  };

  /** Cập nhật local: đánh dấu đã đọc trong cache. */
  const markLocal = (id: string, readAt: string | null): void => {
    const idx = items.value.findIndex((n) => n.id === id);
    if (idx < 0) return;
    const next = [...items.value];
    next[idx] = { ...next[idx], readAt };
    items.value = next;
  };

  /** Thêm 1 notification mới (dùng khi nhận socket event notification:new). */
  const pushLocal = (notification: Notification): void => {
    items.value = [notification, ...items.value];
  };

  // --- Actions ---

  /** Lấy trang đầu theo query hiện tại. */
  const fetchFirstPage = async (): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await notificationApi.list(query.value);
      items.value = data.data.items;
      nextCursor.value = data.data.nextCursor;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /** Lấy trang tiếp theo (cursor-based). Không làm gì nếu hết page. */
  const fetchNextPage = async (): Promise<void> => {
    if (!nextCursor.value || loading.value) return;
    loading.value = true;
    error.value = null;
    try {
      const { data } = await notificationApi.list({
        ...query.value,
        cursor: nextCursor.value,
      });
      items.value = [...items.value, ...data.data.items];
      nextCursor.value = data.data.nextCursor;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /** Cập nhật query; đổi `unread` thì tự reset page. */
  const setQuery = (patch: Partial<ListNotificationsQuery>): void => {
    if (patch.unread !== undefined) {
      query.value = { limit: query.value.limit, unread: patch.unread };
    } else {
      Object.assign(query.value, patch);
    }
  };

  /** Đánh dấu 1 notification là đã đọc — đồng bộ local ngay. */
  const markRead = async (id: string): Promise<boolean> => {
    try {
      const { data } = await notificationApi.markRead(id);
      markLocal(id, data.data.readAt);
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };

  /** Xoá sạch state (khi logout / rời trang notification). */
  const reset = (): void => {
    items.value = [];
    nextCursor.value = null;
    error.value = null;
    query.value = { limit: DEFAULT_PAGE_SIZE };
  };

  return {
    // state
    items, nextCursor, loading, error, query,
    // computed
    unreadCount, hasMore, isEmpty,
    // helpers
    pushLocal, markLocal,
    // actions
    fetchFirstPage, fetchNextPage, setQuery, markRead, reset,
  };
});
