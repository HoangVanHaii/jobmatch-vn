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
 *
 * Badge bell: `unreadCount` ưu tiên `totalUnread` từ server (count thực tế từ
 * DB) thay vì đếm trên items đã tải. Khi `totalUnread === null` (chưa fetch
 * lần đầu) → fallback đếm từ items (chỉ để khởi đầu). Optimistic update
 * khi markRead/socket push để badge phản hồi ngay.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { notificationApi } from '@services/notification.api';
import { getSocket } from '@services/socket';
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

  /**
   * Tổng chưa đọc từ server (response list). `null` = chưa fetch lần đầu.
   * `unreadCount` computed ưu tiên giá trị này → bell badge chính xác bất kể
   * page size. Trước đây bug: đếm trên items đã tải (≤20) → user có 50 unread
   * thấy badge "20". Bây giờ server count cho tổng thực.
   */
  const totalUnread = ref<number | null>(null);

  /** Query cho list: unread + cursor + limit (đổi filter sẽ reset ở setQuery). */
  const query = ref<ListNotificationsQuery>({ limit: DEFAULT_PAGE_SIZE });

  // --- Computed ---
  /**
   * Badge bell — ưu tiên `totalUnread` (server-truth). Fallback `items.filter`
   * chỉ khi server chưa trả lần nào (khởi đầu trước khi fetchFirstPage chạy).
   */
  const unreadCount = computed(() => {
    if (totalUnread.value !== null) return totalUnread.value;
    return items.value.filter((n) => n.readAt === null).length;
  });
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

  /** Helper — dùng cho "Đọc tất cả": giảm badge theo số item đã mark. */
  const decrementUnread = (count: number): void => {
    if (count <= 0) return;
    if (totalUnread.value !== null) {
      totalUnread.value = Math.max(0, totalUnread.value - count);
    }
  };

  /** Increment local totalUnread (khi socket push notification mới unread). */
  const incrementUnread = (): void => {
    if (totalUnread.value !== null) {
      totalUnread.value += 1;
    }
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
      totalUnread.value = data.data.totalUnread;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /**
   * Lấy trang tiếp theo (cursor-based). Không làm gì nếu hết page.
   * `totalUnread` luôn lấy từ response mới nhất (server-truth) thay vì cộng dồn.
   */
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
      totalUnread.value = data.data.totalUnread;
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

  /** Đánh dấu 1 notification là đã đọc — đồng bộ local ngay.
   *
   * Bug 3: reset `error.value = null` đầu action. Trước đây nếu request fail
   * trước đó → error banner cũ vẫn hiển thị → user nghĩ đang lỗi dù đã retry
   * thành công. fetchFirstPage/fetchNextPage đã reset từ trước; markRead thiếu.
   *
   * Badge: optimistic decrement 1 khi server trả readAt (success).
   */
  const markRead = async (id: string): Promise<boolean> => {
    error.value = null;
    try {
      const { data } = await notificationApi.markRead(id);
      // Chỉ decrement nếu lần đầu tiên mark (readAt chưa có → có).
      // (Backend không cho mark-read 2 lần, nhưng check defensive vẫn đúng.)
      const wasUnread = items.value.find((n) => n.id === id)?.readAt === null;
      markLocal(id, data.data.readAt);
      if (wasUnread) decrementUnread(1);
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
    totalUnread.value = null;
    query.value = { limit: DEFAULT_PAGE_SIZE };
    unbindSocket();
  };

  // --------------------------------------------------------------------------
  // Socket binding
  //
  // Khi user đăng nhập, App.vue / auth flow sẽ gọi `bindSocket()`. Khi logout
  // → `reset()` tự unbind. Listener push notification mới vào `items` đầu list,
  // bell icon + list tự update reactive.
  //
  // KHÔNG dispatch toast ở đây — để view-level (vd AppliedJobsView) tự quyết
  // định có toast hay không (vd employer thấy "có 1 đơn mới" → toast OK,
  // candidate thấy "match ready" → toast OK, nhưng admin đang xem user list
  // thì không cần).
  // --------------------------------------------------------------------------

  /**
   * Handler khi nhận socket event `notification:new`. Server emit row full
   * (id, userId, type, title, payload, readAt, createdAt).
   *
   * Badge: optimistic increment 1 — server vẫn coi đó là unread (readAt === null).
   * Race vs `fetchNextPage`: nếu server response chưa thấy push mới, totalUnread
   * có thể bị overwrite thấp. Acceptable: hiếm và chỉ "giật" 1 giây cho tới
   * khi fetch/push đồng bộ.
   */
  const onSocketNew = (notification: Notification): void => {
    pushLocal(notification);
    incrementUnread();
  };

  /**
   * Bind socket listeners cho 3 event application realtime:
   *   - notification:new (chuẩn, mọi loại notification → bell update)
   *   - application:match-ready (candidate, score updated)
   *   - application:match-skipped (candidate, quota_exceeded)
   *
   * Idempotent: nếu đã bind rồi thì skip (tránh double-listener nếu gọi 2 lần).
   * Backend namespace là `user:<userId>`; socket client đã auth tự join đúng
   * room (xem backend notificationGateway).
   */
  let socketBound = false;
  const bindSocket = (): void => {
    if (socketBound) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    socket.on('notification:new', onSocketNew);
    socketBound = true;
  };

  /**
   * Unbind socket listeners. Gọi khi logout hoặc trước khi bindSocket lại
   * nếu user đổi role (vd admin → employer).
   */
  const unbindSocket = (): void => {
    if (!socketBound) return;
    const socket = getSocket();
    socket.off('notification:new', onSocketNew);
    socketBound = false;
  };

  return {
    // state
    items, nextCursor, loading, error, query, totalUnread,
    // computed
    unreadCount, hasMore, isEmpty,
    // helpers
    pushLocal, markLocal, decrementUnread, incrementUnread,
    // actions
    fetchFirstPage, fetchNextPage, setQuery, markRead, reset,
    bindSocket, unbindSocket,
  };
});
