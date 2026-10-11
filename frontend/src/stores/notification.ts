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
import { getNotificationErrorMessage } from '@utils/notificationError';
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

  /**
   * Cổng chèn realtime (insertGate):
   * Khi user ở trang 1 (currentPage === 1), insertGate = true cho phép push realtime vào đầu danh sách.
   * Khi ở trang >= 2, insertGate = false để tránh page drift (xô lệch thứ tự các trang sau).
   */
  const insertGate = ref(true);

  /** Số thông báo realtime mới nhận được nhưng chưa được chèn vào list hiển thị (do gate đóng hoặc lệch filter) */
  const pendingNew = ref(0);

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
  const setError = (e: unknown, fallbackMessage?: string): void => {
    error.value = getNotificationErrorMessage(e, fallbackMessage);
  };

  /** Cập nhật local: đánh dấu đã đọc trong cache. */
  const markLocal = (id: string, readAt: string | null): void => {
    const idx = items.value.findIndex((n) => n.id === id);
    if (idx < 0) return;
    const next = [...items.value];
    next[idx] = { ...next[idx], readAt };
    items.value = next;
  };

  /**
   * Thêm 1 notification mới (dùng khi nhận socket event notification:new).
   *
   * Chống trôi dòng (page drift) & tôn trọng filter:
   * - Sau dedupe: nếu notification chưa đọc (!readAt) thì luôn incrementUnread() để badge đồng bộ.
   * - Chỉ chèn vào `items` hiển thị khi thoả mãn đồng thời:
   *   1. insertGate = true (đang ở trang 1).
   *   2. Không có query.search khác rỗng.
   *   3. Khớp filter hiện tại: unread=false thì KHÔNG chèn thông báo chưa đọc; unread=true thì CHỈ chèn thông báo chưa đọc.
   * - Ngược lại: tăng pendingNew++ (trừ trường hợp unread=false, không cần đếm vì không thuộc tab này).
   */
  const pushLocal = (notification: Notification): void => {
    if (!notification || typeof notification !== 'object' || !notification.id) return;
    if (deletedIds.has(notification.id)) return;
    if (items.value.some((n) => n.id === notification.id)) return;

    const isUnread = !notification.readAt;
    if (isUnread) {
      incrementUnread();
    }

    const hasSearch = Boolean(query.value.search && query.value.search.trim().length > 0);
    const matchesFilter =
      query.value.unread === undefined ||
      (query.value.unread === true && isUnread) ||
      (query.value.unread === false && !isUnread);

    if (insertGate.value && !hasSearch && matchesFilter) {
      items.value = [notification, ...items.value];
    } else if (query.value.unread !== false) {
      pendingNew.value++;
    }
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

  // --- Race Condition Guards & Seq Tracking ---
  let fetchSeq = 0;
  let lastMarkAllAt = 0;
  let nextPagePromise: Promise<void> | null = null;
  const markedReadIds = new Set<string>();
  const deletedIds = new Set<string>();

  // --- Actions ---

  /** Lấy trang đầu theo query hiện tại. */
  const fetchFirstPage = async (): Promise<void> => {
    const currentSeq = ++fetchSeq;
    const startedAt = Date.now();
    loading.value = true;
    error.value = null;
    try {
      const { data } = await notificationApi.list(query.value);
      if (currentSeq !== fetchSeq) return; // Stale request, ignore

      let serverTotal = Math.max(0, data.data.totalUnread);
      // Lọc bỏ mọi item có id nằm trong deletedIds trước khi gán và trừ unread tương ứng nếu chưa đọc
      const validItems = data.data.items.filter((n) => {
        if (deletedIds.has(n.id)) {
          if (n.readAt === null) {
            serverTotal = Math.max(0, serverTotal - 1);
          }
          return false;
        }
        return true;
      });

      // Nếu markAllRead đã xảy ra sau khi fetch này bắt đầu, unread phải là 0
      if (lastMarkAllAt >= startedAt) {
        serverTotal = 0;
        items.value = validItems.map((n) => ({
          ...n,
          readAt: n.readAt ?? new Date(lastMarkAllAt).toISOString(),
        }));
      } else {
        // Giữ trạng thái nếu item đã được markRead cục bộ sau khi fetch bắt đầu
        items.value = validItems.map((n) => {
          if (markedReadIds.has(n.id) && n.readAt === null) {
            serverTotal = Math.max(0, serverTotal - 1);
            return { ...n, readAt: new Date().toISOString() };
          }
          return n;
        });
      }

      nextCursor.value = data.data.nextCursor;
      totalUnread.value = serverTotal;
      pendingNew.value = 0;
    } catch (e) {
      if (currentSeq === fetchSeq) {
        setError(e, 'Không thể tải danh sách thông báo');
      }
    } finally {
      if (currentSeq === fetchSeq) {
        loading.value = false;
      }
    }
  };

  /**
   * Lấy riêng số lượng chưa đọc từ API nhẹ /unread-count.
   * Dùng cho Sidebar/Header để tối ưu tốc độ, không kéo danh sách notification.
   */
  const fetchUnreadCount = async (): Promise<void> => {
    try {
      const { data } = await notificationApi.getUnreadCount();
      totalUnread.value = Math.max(0, data.data.unreadCount);
    } catch (e) {
      setError(e);
    }
  };

  /**
   * Lấy trang tiếp theo (cursor-based). Không làm gì nếu hết page.
   * `totalUnread` luôn lấy từ response mới nhất (server-truth) thay vì cộng dồn.
   *
   * Khóa nextPagePromise chống duplicate request:
   * Nếu có một request fetchNextPage đang chạy in-flight thì trả về cùng promise đó.
   */
  const fetchNextPage = (): Promise<void> => {
    if (nextPagePromise) return nextPagePromise;
    if (!nextCursor.value || loading.value) return Promise.resolve();

    nextPagePromise = (async () => {
      const currentSeq = ++fetchSeq;
      const startedAt = Date.now();
      loading.value = true;
      error.value = null;
      try {
        const { data } = await notificationApi.list({
          ...query.value,
          cursor: nextCursor.value ?? undefined,
        });
        if (currentSeq !== fetchSeq) return; // Stale request, ignore

        let serverTotal = Math.max(0, data.data.totalUnread);
        const validNewItems = data.data.items.filter((n) => {
          if (deletedIds.has(n.id)) {
            if (n.readAt === null) {
              serverTotal = Math.max(0, serverTotal - 1);
            }
            return false;
          }
          return true;
        });

        let newItems = validNewItems;

        if (lastMarkAllAt >= startedAt) {
          serverTotal = 0;
          newItems = newItems.map((n) => ({
            ...n,
            readAt: n.readAt ?? new Date(lastMarkAllAt).toISOString(),
          }));
        } else {
          newItems = newItems.map((n) => {
            if (markedReadIds.has(n.id) && n.readAt === null) {
              serverTotal = Math.max(0, serverTotal - 1);
              return { ...n, readAt: new Date().toISOString() };
            }
            return n;
          });
        }

        // Tránh duplicate ID khi append
        const existingIds = new Set(items.value.map((n) => n.id));
        const filteredNewItems = newItems.filter((n) => !existingIds.has(n.id));

        items.value = [...items.value, ...filteredNewItems];
        nextCursor.value = data.data.nextCursor;
        totalUnread.value = serverTotal;
      } catch (e) {
        if (currentSeq === fetchSeq) {
          setError(e, 'Không thể tải thêm thông báo');
        }
      } finally {
        if (currentSeq === fetchSeq) {
          loading.value = false;
        }
        nextPagePromise = null;
      }
    })();

    return nextPagePromise;
  };

  /** Cập nhật query; đổi `unread` hoặc `search` thì cập nhật query tương ứng. */
  const setQuery = (patch: Partial<ListNotificationsQuery>): void => {
    query.value = {
      limit: patch.limit ?? query.value.limit ?? DEFAULT_PAGE_SIZE,
      unread: 'unread' in patch ? patch.unread : query.value.unread,
      search: 'search' in patch ? patch.search : query.value.search,
      cursor: 'cursor' in patch ? patch.cursor : query.value.cursor,
    };
  };

  /** Set các notification ID đang có request markRead in-flight để chống gọi trùng */
  const inFlightMarks = new Set<string>();

  /** Đánh dấu 1 notification là đã đọc — đồng bộ local ngay.
   *
   * Idempotent & Chống double-request:
   * - Nếu notification đã đọc (readAt !== null): trả về true ngay, không gọi backend.
   * - Nếu đang có request in-flight cho ID này: trả về false ngay, tránh trùng request.
   * - Khi backend xác nhận: cập nhật local readAt, decrement unread count đúng 1 lần.
   * - Khi lỗi: ghi vào error.value, không cập nhật local readAt giả vờ thành công.
   */
  const markRead = async (id: string): Promise<boolean> => {
    const existing = items.value.find((n) => n.id === id);
    if (existing && existing.readAt !== null) {
      return true;
    }
    if (inFlightMarks.has(id)) {
      return false;
    }

    inFlightMarks.add(id);
    error.value = null;
    try {
      const { data } = await notificationApi.markRead(id);
      markedReadIds.add(id);
      const wasUnread = existing ? existing.readAt === null : true;
      markLocal(id, data.data.readAt);
      if (wasUnread) decrementUnread(1);
      return true;
    } catch (e) {
      setError(e, 'Không thể đánh dấu đã đọc');
      return false;
    } finally {
      inFlightMarks.delete(id);
    }
  };

  /** Đánh dấu TẤT CẢ notifications là đã đọc qua API backend */
  const markAllRead = async (): Promise<boolean> => {
    error.value = null;
    try {
      await notificationApi.markAllRead();
      lastMarkAllAt = Date.now();
      const now = new Date().toISOString();
      items.value = items.value.map((n) => (n.readAt === null ? { ...n, readAt: now } : n));
      totalUnread.value = 0;
      return true;
    } catch (e) {
      setError(e, 'Không thể đánh dấu tất cả đã đọc');
      return false;
    }
  };

  /**
   * Xóa 1 notification với cập nhật optimistic UI và rollback an toàn.
   *
   * Lưu ý phân trang:
   * nextCursor KHÔNG cần thay đổi khi xóa (cursor là vị trí createdAt/id đã được encode trước đó,
   * vẫn trỏ chính xác mốc phân trang tiếp theo bất kể dòng cuối của trang đã nạp có bị xóa hay không).
   */
  const removeNotification = async (id: string): Promise<boolean> => {
    const itemIndex = items.value.findIndex((n) => n.id === id);
    const removedItem = itemIndex >= 0 ? items.value[itemIndex] : null;
    const previousTotalUnread = totalUnread.value;
    const wasUnread = removedItem ? removedItem.readAt === null : false;

    // Ghi nhận deletedIds ngay để chặn race condition từ fetch/socket
    deletedIds.add(id);

    // Optimistic update: xóa khỏi danh sách và giảm unread nếu chưa đọc
    if (itemIndex >= 0) {
      items.value = items.value.filter((n) => n.id !== id);
    }
    if (wasUnread) {
      decrementUnread(1);
    }

    error.value = null;
    try {
      const { data } = await notificationApi.remove(id);
      // Cập nhật totalUnread chuẩn xác từ response server
      totalUnread.value = Math.max(0, data.data.totalUnread);
      return true;
    } catch (e: any) {
      const errorCode = e?.response?.data?.error?.code || e?.code;
      // Chỉ coi là xóa thành công khi thông báo thực sự không còn trên server (NOTIFICATION_NOT_FOUND).
      // KHÔNG dùng status 404 đơn thuần vì 404 'route không tồn tại' (ROUTE_NOT_FOUND/NOT_FOUND) phải rollback và báo lỗi.
      if (errorCode === 'NOTIFICATION_NOT_FOUND') {
        void fetchUnreadCount();
        return true;
      }

      // Rollback: khôi phục item đúng vị trí cũ và hoàn lại totalUnread
      deletedIds.delete(id);
      if (removedItem && itemIndex >= 0) {
        const next = [...items.value];
        next.splice(itemIndex, 0, removedItem);
        items.value = next;
      }
      totalUnread.value = previousTotalUnread;
      setError(e, 'Không thể xóa thông báo');
      return false;
    }
  };

  /** Xoá sạch state (khi logout / rời trang notification). */
  const reset = (): void => {
    fetchSeq = 0;
    lastMarkAllAt = 0;
    nextPagePromise = null;
    insertGate.value = true;
    pendingNew.value = 0;
    markedReadIds.clear();
    deletedIds.clear();
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
   * pushLocal tự quản lý increment unread, dedupe, gate chèn danh sách và đếm pendingNew.
   */
  const onSocketNew = (notification: Notification): void => {
    if (!notification || typeof notification !== 'object' || !notification.id) return;
    pushLocal(notification);
  };

  /**
   * Handler khi nhận socket event `notification:deleted` ({ id }).
   * Xóa khỏi items nếu có (giảm unread nếu chưa đọc) và ghi vào deletedIds.
   * Nếu chính tab này vừa xóa (item không còn) thì không làm gì thêm, không trừ unread 2 lần.
   */
  const onSocketDeleted = (data: { id: string }): void => {
    if (!data || !data.id) return;
    const id = data.id;
    deletedIds.add(id);
    const existing = items.value.find((n) => n.id === id);
    if (existing) {
      if (existing.readAt === null) {
        decrementUnread(1);
      }
      items.value = items.value.filter((n) => n.id !== id);
    }
  };

  /**
   * Bind socket listeners cho notification realtime:
   *   - notification:new (chuẩn, mọi loại notification → bell update)
   *   - notification:deleted (xoá notification đồng bộ các tab/thiết bị)
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
    socket.on('notification:deleted', onSocketDeleted);
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
    socket.off('notification:deleted', onSocketDeleted);
    socketBound = false;
  };

  return {
    // state
    items, nextCursor, loading, error, query, totalUnread, insertGate, pendingNew,
    // computed
    unreadCount, hasMore, isEmpty,
    // helpers
    pushLocal, markLocal, decrementUnread, incrementUnread,
    // actions
    fetchFirstPage, fetchNextPage, fetchUnreadCount, setQuery, markRead, markAllRead, removeNotification, reset,
    bindSocket, unbindSocket,
  };
});
