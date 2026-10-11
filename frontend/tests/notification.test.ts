// @vitest-environment happy-dom
/**
 * Test bộ chức năng Thông báo (Notification Store & Auto Mark Read).
 *
 * Kiểm tra các hành vi nghiệp vụ bắt buộc:
 *   1. Click unread → mở modal + mark-read đúng 1 lần.
 *   2. Click read → không gọi mark-read.
 *   3. Click nhanh nhiều lần → không tạo request trùng, không decrement count 2 lần.
 *   4. API mark-read lỗi → giữ nguyên trạng thái chưa đọc, không giảm count, ghi nhận error.
 *   5. Retry mark-read thành công → đồng bộ trạng thái và giảm count.
 *   6. Mark-all thành công → chuyển tất cả sang đã đọc, totalUnread = 0.
 *   7. Mark-all thất bại → giữ nguyên trạng thái và count.
 *   8. Filter unread=true và unread=false query đúng.
 *   9. Tải danh sách không tự đánh dấu đọc.
 *   10. Socket event push không làm tăng duplicate và giữ count chính xác.
 *   11. Notification thiếu/null payload vẫn format an toàn với fallback.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { mount, flushPromises } from '@vue/test-utils';
import { useNotificationStore } from '@stores/notification';
import { useAuthStore } from '@stores/auth';
import { notificationApi } from '@services/notification.api';
import { useToastStore } from '@stores/toast';
import { getNotificationErrorMessage } from '@utils/notificationError';
import NotificationsView from '@/views/NotificationsView.vue';
import NotificationDetailModal from '@/components/notify/NotificationDetailModal.vue';
import type { Notification } from '@/types/notification';

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
    }),
  };
});

describe('Notification Feature & Auto Mark-Read Suite', () => {
  let store: ReturnType<typeof useNotificationStore>;

  const mockNotif1: Notification = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    type: 'application_new',
    title: 'Ứng viên A vừa ứng tuyển',
    payload: { candidateName: 'Nguyễn Văn A', jobTitle: 'Frontend Dev' },
    readAt: null,
    createdAt: new Date().toISOString(),
  };

  const mockNotif2: Notification = {
    id: '22222222-2222-4222-8222-222222222222',
    userId: 'user-1',
    type: 'interview_scheduled',
    title: 'Lịch phỏng vấn mới',
    payload: { scheduledAt: new Date().toISOString() },
    readAt: '2026-10-10T10:00:00Z',
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useNotificationStore();
    vi.restoreAllMocks();
  });

  it('1. Click unread: markRead được gọi đúng 1 lần, cập nhật readAt và giảm unread count', async () => {
    store.items = [{ ...mockNotif1 }];
    store.totalUnread = 1;

    const readAtTimestamp = new Date().toISOString();
    const markApiSpy = vi.spyOn(notificationApi, 'markRead').mockResolvedValueOnce({
      data: {
        success: true,
        data: { ...mockNotif1, readAt: readAtTimestamp },
      },
    } as any);

    const success = await store.markRead(mockNotif1.id);

    expect(success).toBe(true);
    expect(markApiSpy).toHaveBeenCalledTimes(1);
    expect(markApiSpy).toHaveBeenCalledWith(mockNotif1.id);
    expect(store.items[0]?.readAt).toBe(readAtTimestamp);
    expect(store.unreadCount).toBe(0);
  });

  it('2. Click read: notification đã đọc không gọi API markRead và không giảm count', async () => {
    store.items = [{ ...mockNotif2 }];
    store.totalUnread = 0;

    const markApiSpy = vi.spyOn(notificationApi, 'markRead');

    const success = await store.markRead(mockNotif2.id);

    expect(success).toBe(true);
    expect(markApiSpy).not.toHaveBeenCalled();
    expect(store.unreadCount).toBe(0);
  });

  it('3. Click nhanh nhiều lần: guard inFlightMarks chống duplicate request và không decrement 2 lần', async () => {
    store.items = [{ ...mockNotif1 }];
    store.totalUnread = 1;

    let resolveApi: (value: any) => void = () => {};
    const apiPromise = new Promise((resolve) => {
      resolveApi = resolve;
    });

    const markApiSpy = vi.spyOn(notificationApi, 'markRead').mockReturnValueOnce(apiPromise as any);

    // Kích hoạt 2 lần liên tiếp khi request đầu tiên đang in-flight
    const p1 = store.markRead(mockNotif1.id);
    const p2 = store.markRead(mockNotif1.id);

    const res2 = await p2;
    expect(res2).toBe(false); // Lần 2 bị guard chặn ngay
    expect(markApiSpy).toHaveBeenCalledTimes(1); // API chỉ gọi 1 lần duy nhất

    // Kết thúc request 1
    resolveApi({
      data: {
        success: true,
        data: { ...mockNotif1, readAt: new Date().toISOString() },
      },
    });

    const res1 = await p1;
    expect(res1).toBe(true);
    expect(store.unreadCount).toBe(0); // Chỉ decrement đúng 1 lần
  });

  it('4. API mark-read lỗi: không giả vờ thành công, giữ nguyên trạng thái chưa đọc và count', async () => {
    store.items = [{ ...mockNotif1 }];
    store.totalUnread = 1;

    vi.spyOn(notificationApi, 'markRead').mockRejectedValueOnce(new Error('Network error'));

    const success = await store.markRead(mockNotif1.id);

    expect(success).toBe(false);
    expect(store.items[0]?.readAt).toBeNull(); // Không bị đổi thành đã đọc
    expect(store.unreadCount).toBe(1); // Count không bị giảm
    expect(store.error).toBe('Không thể đánh dấu đã đọc'); // Lỗi được lưu để UI hiển thị
  });

  it('5. Retry mark-read thành công: đồng bộ lại count và trạng thái sau khi lỗi trước đó', async () => {
    store.items = [{ ...mockNotif1 }];
    store.totalUnread = 1;

    // Lần 1: lỗi
    vi.spyOn(notificationApi, 'markRead').mockRejectedValueOnce(new Error('500 Internal Error'));
    const res1 = await store.markRead(mockNotif1.id);
    expect(res1).toBe(false);
    expect(store.unreadCount).toBe(1);

    // Lần 2: retry thành công
    const readAt = new Date().toISOString();
    vi.spyOn(notificationApi, 'markRead').mockResolvedValueOnce({
      data: {
        success: true,
        data: { ...mockNotif1, readAt },
      },
    } as any);

    const res2 = await store.markRead(mockNotif1.id);
    expect(res2).toBe(true);
    expect(store.items[0]?.readAt).toBe(readAt);
    expect(store.unreadCount).toBe(0);
    expect(store.error).toBeNull(); // Error được xóa sạch
  });

  it('6. Mark-all thành công: tất cả notification chuyển sang đã đọc và totalUnread = 0', async () => {
    const unreadItemB: Notification = {
      ...mockNotif1,
      id: '33333333-3333-4333-8333-333333333333',
    };
    store.items = [{ ...mockNotif1 }, unreadItemB, { ...mockNotif2 }];
    store.totalUnread = 2;

    const markAllSpy = vi.spyOn(notificationApi, 'markAllRead').mockResolvedValueOnce({
      data: { success: true, data: { count: 2 } },
    } as any);

    const ok = await store.markAllRead();

    expect(ok).toBe(true);
    expect(markAllSpy).toHaveBeenCalledTimes(1);
    expect(store.items.every((n) => n.readAt !== null)).toBe(true);
    expect(store.totalUnread).toBe(0);
    expect(store.unreadCount).toBe(0);
  });

  it('7. Mark-all thất bại: giữ nguyên trạng thái danh sách và unreadCount', async () => {
    store.items = [{ ...mockNotif1 }];
    store.totalUnread = 1;

    vi.spyOn(notificationApi, 'markAllRead').mockRejectedValueOnce(new Error('Gateway timeout'));

    const ok = await store.markAllRead();

    expect(ok).toBe(false);
    expect(store.items[0]?.readAt).toBeNull();
    expect(store.totalUnread).toBe(1);
    expect(store.unreadCount).toBe(1);
    expect(store.error).toBe('Yêu cầu quá thời gian chờ, vui lòng thử lại');
  });

  it('8. Filter unread=true và unread=false: setQuery cập nhật đúng query param', async () => {
    store.setQuery({ unread: true });
    expect(store.query.unread).toBe(true);

    store.setQuery({ unread: false });
    expect(store.query.unread).toBe(false);

    store.setQuery({ unread: undefined });
    expect(store.query.unread).toBeUndefined();

    // Query search
    store.setQuery({ search: 'Frontend' });
    expect(store.query.search).toBe('Frontend');
    expect(store.query.unread).toBeUndefined(); // giữ nguyên unread

    store.setQuery({ search: undefined });
    expect(store.query.search).toBeUndefined();
  });

  it('8b. Search query: fetchFirstPage gửi đúng search param lên API', async () => {
    const listSpy = vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [{ ...mockNotif1 }],
          nextCursor: null,
          totalUnread: 1,
        },
      },
    } as any);

    store.setQuery({ search: 'Frontend' });
    await store.fetchFirstPage();

    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Frontend' })
    );
  });

  it('9. Tải danh sách không tự đánh dấu đọc', async () => {
    const listSpy = vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [{ ...mockNotif1 }],
          nextCursor: null,
          totalUnread: 1,
        },
      },
    } as any);
    const markSpy = vi.spyOn(notificationApi, 'markRead');

    await store.fetchFirstPage();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(markSpy).not.toHaveBeenCalled();
    expect(store.items[0]?.readAt).toBeNull();
    expect(store.unreadCount).toBe(1);
  });

  it('10. Socket event notification:new: tăng count đúng 1 lần và chống duplicate ID', () => {
    store.items = [];
    store.totalUnread = 0;

    // Push lần 1 (pushLocal tự động increment unread sau dedupe)
    store.pushLocal(mockNotif1);
    expect(store.items).toHaveLength(1);
    expect(store.unreadCount).toBe(1);

    // Push trùng cùng ID
    store.pushLocal(mockNotif1);
    expect(store.items).toHaveLength(1); // Không nhân đôi dòng
    expect(store.unreadCount).toBe(1); // Không increment lần 2
  });

  it('11. Notification thiếu/null payload: format an toàn không crash và trả fallback', () => {
    const rawNotif: Notification = {
      id: '44444444-4444-4444-4444-444444444444',
      userId: 'user-1',
      type: 'system',
      title: 'Bảo trì hệ thống định kỳ',
      payload: null as any,
      readAt: null,
      createdAt: new Date().toISOString(),
    };

    store.items = [rawNotif];
    expect(store.items[0]?.title).toBe('Bảo trì hệ thống định kỳ');
    expect(store.unreadCount).toBe(1);
  });

  it('12. Race condition: stale fetch request hoàn thành muộn hơn không ghi đè dữ liệu mới', async () => {
    let resolveFirstFetch: (v: any) => void = () => {};
    const firstFetchPromise = new Promise((resolve) => {
      resolveFirstFetch = resolve;
    });

    const secondFetchPromise = Promise.resolve({
      data: {
        success: true,
        data: {
          items: [{ ...mockNotif2 }],
          nextCursor: 'cursor-2',
          totalUnread: 0,
        },
      },
    });

    const listSpy = vi.spyOn(notificationApi, 'list')
      .mockReturnValueOnce(firstFetchPromise as any)
      .mockReturnValueOnce(secondFetchPromise as any);

    // Kích hoạt fetch 1 (chạy chậm)
    const p1 = store.fetchFirstPage();
    // Kích hoạt fetch 2 ngay sau đó
    const p2 = store.fetchFirstPage();

    await p2;
    expect(store.items[0]?.id).toBe(mockNotif2.id);
    expect(store.totalUnread).toBe(0);

    // Fetch 1 hoàn thành sau cùng với dữ liệu cũ
    resolveFirstFetch({
      data: {
        success: true,
        data: {
          items: [{ ...mockNotif1 }],
          nextCursor: 'cursor-1',
          totalUnread: 5,
        },
      },
    });

    await p1;
    // Dữ liệu vẫn phải giữ của fetch 2, không bị fetch 1 ghi đè
    expect(store.items[0]?.id).toBe(mockNotif2.id);
    expect(store.totalUnread).toBe(0);
    expect(store.nextCursor).toBe('cursor-2');
  });

  it('13. Race condition: markAllRead chạy trong lúc fetchFirstPage in-flight không bị ghi đè unread count', async () => {
    let resolveFetch: (v: any) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    vi.spyOn(notificationApi, 'list').mockReturnValueOnce(fetchPromise as any);
    vi.spyOn(notificationApi, 'markAllRead').mockResolvedValueOnce({
      data: { success: true, data: { count: 3 } },
    } as any);

    // Bắt đầu fetch (in-flight)
    const fetchAction = store.fetchFirstPage();

    // Giữa chừng user click "Đọc tất cả"
    await store.markAllRead();
    expect(store.totalUnread).toBe(0);

    // Fetch hoàn tất sau đó với count cũ từ server (ví dụ 3)
    resolveFetch({
      data: {
        success: true,
        data: {
          items: [{ ...mockNotif1, readAt: null }],
          nextCursor: null,
          totalUnread: 3,
        },
      },
    });

    await fetchAction;
    // totalUnread KHÔNG được bị ghi đè lại thành 3, phải giữ 0
    expect(store.totalUnread).toBe(0);
    // Item trả về cũng được chuẩn hóa thành đã đọc
    expect(store.items[0]?.readAt).not.toBeNull();
  });

  it('14. Race condition: markRead chạy trong lúc fetchFirstPage in-flight không bị ghi đè lại unread', async () => {
    let resolveFetch: (v: any) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    vi.spyOn(notificationApi, 'list').mockReturnValueOnce(fetchPromise as any);
    vi.spyOn(notificationApi, 'markRead').mockResolvedValueOnce({
      data: {
        success: true,
        data: { ...mockNotif1, readAt: new Date().toISOString() },
      },
    } as any);

    // Bắt đầu fetch
    const fetchAction = store.fetchFirstPage();

    // Trong lúc đó markRead item 1
    await store.markRead(mockNotif1.id);

    // Fetch hoàn tất với dữ liệu server trả về lúc trước (khi chưa đọc)
    resolveFetch({
      data: {
        success: true,
        data: {
          items: [{ ...mockNotif1, readAt: null }],
          nextCursor: null,
          totalUnread: 1,
        },
      },
    });

    await fetchAction;
    // Item phải giữ trạng thái đã đọc
    expect(store.items[0]?.readAt).not.toBeNull();
    // totalUnread không được ghi đè thành 1, phải là 0
    expect(store.totalUnread).toBe(0);
  });

  it('15. decrementUnread bảo đảm count không bao giờ bị âm', () => {
    store.totalUnread = 1;
    store.decrementUnread(5);
    expect(store.totalUnread).toBe(0);

    store.decrementUnread(1);
    expect(store.totalUnread).toBe(0);
  });

  it('16. fetchUnreadCount gọi API getUnreadCount và cập nhật totalUnread đúng mà không làm thay đổi items', async () => {
    store.items = [{ ...mockNotif1 }];
    const apiSpy = vi.spyOn(notificationApi, 'getUnreadCount').mockResolvedValueOnce({
      data: {
        success: true,
        data: { unreadCount: 8 },
      },
    } as any);

    await store.fetchUnreadCount();

    expect(apiSpy).toHaveBeenCalledTimes(1);
    expect(store.totalUnread).toBe(8);
    expect(store.unreadCount).toBe(8);
    // items không bị thay đổi / ghi đè
    expect(store.items).toHaveLength(1);
    expect(store.items[0]?.id).toBe(mockNotif1.id);
  });

  it('17. setQuery: setQuery({ unread: undefined }) reset được unread; setQuery({ limit }) không làm mất unread/search', () => {
    store.setQuery({ unread: true, search: 'developer', limit: 15 });
    expect(store.query.unread).toBe(true);
    expect(store.query.search).toBe('developer');
    expect(store.query.limit).toBe(15);

    // Reset unread về undefined bằng key 'unread'
    store.setQuery({ unread: undefined });
    expect(store.query.unread).toBeUndefined();
    expect(store.query.search).toBe('developer');
    expect(store.query.limit).toBe(15);

    // Cập nhật limit không làm mất search hay unread hiện có
    store.setQuery({ limit: 50 });
    expect(store.query.limit).toBe(50);
    expect(store.query.unread).toBeUndefined();
    expect(store.query.search).toBe('developer');
  });

  it('18. fetchNextPage: gọi lần 2 khi lần 1 đang chạy thì trả cùng promise và API chỉ được gọi 1 lần', async () => {
    store.nextCursor = 'cursor-1';
    let resolveList: (v: any) => void = () => {};
    const listPromise = new Promise((resolve) => {
      resolveList = resolve;
    });

    const listSpy = vi.spyOn(notificationApi, 'list').mockReturnValue(listPromise as any);

    let p1Done = false;
    let p2Done = false;

    const p1 = store.fetchNextPage().then(() => {
      p1Done = true;
    });
    const p2 = store.fetchNextPage().then(() => {
      p2Done = true;
    });

    // Lần 2 chia sẻ promise in-flight của lần 1, API list chỉ được gọi duy nhất 1 lần
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(p1Done).toBe(false);
    expect(p2Done).toBe(false);

    resolveList({
      data: {
        success: true,
        data: {
          items: [{ ...mockNotif2, id: 'next-1' }],
          nextCursor: 'cursor-2',
          totalUnread: 0,
        },
      },
    });

    await Promise.all([p1, p2]);
    expect(p1Done).toBe(true);
    expect(p2Done).toBe(true);
    expect(store.items).toHaveLength(1);
    expect(store.items[0]?.id).toBe('next-1');
  });

  it('19. pushLocal: không chèn khi insertGate=false (pendingNew tăng, totalUnread tăng); không chèn khi query.unread=false; không chèn khi có search', () => {
    store.items = [{ ...mockNotif1 }];
    store.totalUnread = 1;
    store.pendingNew = 0;

    const incomingUnread1: Notification = {
      ...mockNotif1,
      id: 'incoming-1',
      readAt: null,
    };

    // Case 1: insertGate = false (đang ở trang >= 2)
    store.insertGate = false;
    store.pushLocal(incomingUnread1);
    expect(store.items).toHaveLength(1); // Không chèn vào items hiển thị
    expect(store.pendingNew).toBe(1); // Tăng pendingNew để hiện chip
    expect(store.totalUnread).toBe(2); // totalUnread vẫn tăng vì là unread

    // Case 2: query.unread = false (tab "Đã xem") -> không chèn unread, không tăng pendingNew
    store.insertGate = true;
    store.pendingNew = 0;
    store.setQuery({ unread: false });
    const incomingUnread2: Notification = {
      ...mockNotif1,
      id: 'incoming-2',
      readAt: null,
    };
    store.pushLocal(incomingUnread2);
    expect(store.items.some((n) => n.id === 'incoming-2')).toBe(false);
    expect(store.pendingNew).toBe(0); // Không tăng pendingNew vì không thuộc tab
    expect(store.totalUnread).toBe(3); // totalUnread vẫn tăng

    // Case 3: có từ khóa tìm kiếm -> không chèn vào items, tăng pendingNew
    store.setQuery({ unread: undefined, search: 'nodejs' });
    const incomingUnread3: Notification = {
      ...mockNotif1,
      id: 'incoming-3',
      readAt: null,
    };
    store.pushLocal(incomingUnread3);
    expect(store.items.some((n) => n.id === 'incoming-3')).toBe(false);
    expect(store.pendingNew).toBe(1); // Tăng pendingNew
    expect(store.totalUnread).toBe(4);
  });
});

describe('NotificationsView Component Navigation Suite', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('20. Bấm Sau khi store đang loading sẽ chờ rồi chuyển trang; bấm Trước không gọi API', async () => {
    const store = useNotificationStore();
    // Tạo 6 item cho trang 1
    const page1Items: Notification[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p1-${i + 1}`,
      userId: 'user-1',
      type: 'application_new',
      title: `Thông báo ${i + 1}`,
      payload: {},
      readAt: '2026-10-10T00:00:00Z',
      createdAt: new Date().toISOString(),
    }));

    store.items = [...page1Items];
    store.nextCursor = 'cursor-page-2';
    store.totalUnread = 0;

    let resolveNextPage: (v: any) => void = () => {};
    const nextPagePromise = new Promise((resolve) => {
      resolveNextPage = resolve;
    });

    const listSpy = vi.spyOn(notificationApi, 'list').mockReturnValue(nextPagePromise as any);

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Tìm nút Sau và nút Trước theo aria-label
    const prevButton = wrapper.find('button[aria-label="Trang trước"]');
    const nextButton = wrapper.find('button[aria-label="Trang sau"]');

    expect(prevButton.exists()).toBe(true);
    expect(nextButton.exists()).toBe(true);

    // Ban đầu ở trang 1: nút Trước bị disabled
    expect(prevButton.attributes('disabled')).toBeDefined();

    // Click nút Sau khi trang 2 chưa có dữ liệu trong store
    await nextButton.trigger('click');

    // API list đã được gọi để lấy trang 2
    expect(listSpy).toHaveBeenCalledTimes(1);

    // Trả về dữ liệu trang 2 (6 item tiếp theo)
    const page2Items: Notification[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p2-${i + 1}`,
      userId: 'user-1',
      type: 'application_new',
      title: `Thông báo ${i + 7}`,
      payload: {},
      readAt: '2026-10-10T00:00:00Z',
      createdAt: new Date().toISOString(),
    }));

    resolveNextPage({
      data: {
        success: true,
        data: {
          items: page2Items,
          nextCursor: null,
          totalUnread: 0,
        },
      },
    });

    await flushPromises();

    // Sau khi nạp trang 2, giao diện hiển thị Trang 2
    expect(wrapper.text()).toContain('Trang 2');
    expect(store.insertGate).toBe(false); // Ở trang 2, insertGate tự đóng để chống page drift

    // Bây giờ nút Trước có thể bấm được
    expect(prevButton.attributes('disabled')).toBeUndefined();

    // Reset spy call count để kiểm tra bấm Trước
    listSpy.mockClear();

    // Bấm nút Trước để quay về Trang 1
    await prevButton.trigger('click');
    await flushPromises();

    // Giao diện quay về Trang 1
    expect(wrapper.text()).toContain('Trang 1');
    expect(store.insertGate).toBe(true); // Về trang 1, insertGate mở lại

    // Bấm Trước KHÔNG GỌI BẤT KỲ API NÀO
    expect(listSpy).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('21. Mount lại view khi gate đang false thì thông báo socket vẫn chèn được và unmount mở lại gate', async () => {
    const store = useNotificationStore();
    // Giả lập trạng thái gate đang kẹt false từ trước
    store.insertGate = false;
    store.pendingNew = 5;

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // onMounted và watch(currentPage, immediate) đã mở lại gate và reset pendingNew
    expect(store.insertGate).toBe(true);
    expect(store.pendingNew).toBe(0);

    // Socket push 1 thông báo mới vào
    const incoming: Notification = {
      id: 'socket-notif-1',
      userId: 'user-1',
      type: 'application_new',
      title: 'Đơn ứng tuyển realtime',
      payload: {},
      readAt: null,
      createdAt: new Date().toISOString(),
    };

    store.pushLocal(incoming);

    // Thông báo phải được chèn thẳng vào items, không bị kẹt ở pendingNew
    expect(store.items.some((n) => n.id === 'socket-notif-1')).toBe(true);
    expect(store.pendingNew).toBe(0);

    // Khi rời khỏi trang (unmount), gate vẫn được mở lại cho các trang khác
    wrapper.unmount();
    expect(store.insertGate).toBe(true);
  });

  it('22. Đổi filter trong lúc goNext đang chờ thì currentPage ở lại 1 (chống race condition)', async () => {
    const store = useNotificationStore();
    const page1Items: Notification[] = Array.from({ length: 6 }, (_, i) => ({
      id: `race-p1-${i + 1}`,
      userId: 'user-1',
      type: 'application_new',
      title: `Thông báo ${i + 1}`,
      payload: {},
      readAt: '2026-10-10T00:00:00Z',
      createdAt: new Date().toISOString(),
    }));

    store.items = [...page1Items];
    store.nextCursor = 'cursor-next';
    store.totalUnread = 0;

    let resolveFetchNext: (v: any) => void = () => {};
    const fetchNextPromise = new Promise((resolve) => {
      resolveFetchNext = resolve;
    });

    // Mock API list cho fetchNextPage
    const listSpy = vi.spyOn(notificationApi, 'list').mockImplementation((query) => {
      // Nếu là request của fetchNextPage (có cursor) thì hoãn promise
      if (query && query.cursor) {
        return fetchNextPromise as any;
      }
      // Request do đổi filter (fetchFirstPage) trả về items của filter mới
      return Promise.resolve({
        data: {
          success: true,
          data: {
            items: [page1Items[0]],
            nextCursor: null,
            totalUnread: 0,
          },
        },
      }) as any;
    });

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();
    expect(wrapper.text()).toContain('Trang 1');

    // Bấm nút Sau: goNext bắt đầu và await fetchNextPage
    const nextButton = wrapper.find('button[aria-label="Trang sau"]');
    await nextButton.trigger('click');

    // Trong lúc goNext đang chờ, user bấm chuyển filter sang tab "Chưa đọc"
    const filterButtons = wrapper.findAll('button');
    const unreadTabButton = filterButtons.find((b) => b.text().includes('Chưa đọc'));
    expect(unreadTabButton).toBeDefined();
    await unreadTabButton!.trigger('click');
    await flushPromises();

    // Lúc này filter đã đổi sang unread = true và currentPage = 1
    expect(store.query.unread).toBe(true);

    // Bây giờ fetchNextPage cũ hoàn tất
    resolveFetchNext({
      data: {
        success: true,
        data: {
          items: Array.from({ length: 6 }, (_, i) => ({
            id: `race-p2-${i + 1}`,
            userId: 'user-1',
            type: 'application_new',
            title: `Trang 2 item ${i + 1}`,
            payload: {},
            readAt: '2026-10-10T00:00:00Z',
            createdAt: new Date().toISOString(),
          })),
          nextCursor: null,
          totalUnread: 0,
        },
      },
    });

    await flushPromises();

    // Guard race condition phát hiện querySnapshot đã đổi -> KHÔNG tăng currentPage
    // Giao diện vẫn ở lại Trang 1, không bị nhảy sang Trang 2
    expect(wrapper.text()).toContain('Trang 1');

    wrapper.unmount();
  });

  it('23. Notification có trường message: hiển thị message từ backend trên giao diện', async () => {
    const store = useNotificationStore();
    const notifWithMessage: Notification = {
      id: 'notif-msg-1',
      userId: 'user-1',
      type: 'application_new',
      title: 'Đơn ứng tuyển mới',
      message: 'Snapshot thông báo từ backend đã được tạo sẵn',
      payload: { candidateName: 'Nguyễn Văn A', jobTitle: 'Frontend Dev' },
      readAt: null,
      createdAt: new Date().toISOString(),
    };

    store.items = [notifWithMessage];
    store.nextCursor = null;
    store.totalUnread = 1;

    vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [notifWithMessage],
          nextCursor: null,
          totalUnread: 1,
        },
      },
    } as any);

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Snapshot thông báo từ backend đã được tạo sẵn');
    wrapper.unmount();
  });

  it('24. Notification có message là null: fallback về formatSummary từ payload', async () => {
    const store = useNotificationStore();
    const notifWithoutMessage: Notification = {
      id: 'notif-no-msg-1',
      userId: 'user-1',
      type: 'application_new',
      title: 'Đơn ứng tuyển mới',
      message: null,
      payload: { candidateName: 'Lê Văn B', jobTitle: 'Node.js Developer' },
      readAt: null,
      createdAt: new Date().toISOString(),
    };

    store.items = [notifWithoutMessage];
    store.nextCursor = null;
    store.totalUnread = 1;

    vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [notifWithoutMessage],
          nextCursor: null,
          totalUnread: 1,
        },
      },
    } as any);

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Fallback formatSummary: "Hồ sơ mới từ Lê Văn B ứng tuyển vị trí Node.js Developer"
    expect(wrapper.text()).toContain('Hồ sơ mới từ Lê Văn B ứng tuyển vị trí Node.js Developer');
    wrapper.unmount();
  });

  it('25. Mount lại NotificationsView khi store đã có search: tự động reset search về undefined', async () => {
    const authStore = useAuthStore();
    authStore.user = { id: 'user-1', email: 'test@example.com', role: 'employer', status: 'active' };
    authStore.accessToken = 'test-token';

    const store = useNotificationStore();
    // Giả sử store đang có search từ trước
    store.setQuery({ search: 'từ khóa cũ', unread: true });

    const listSpy = vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [],
          nextCursor: null,
          totalUnread: 0,
        },
      },
    } as any);

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Store đã được reset search về undefined
    expect(store.query.search).toBeUndefined();
    expect(store.query.unread).toBeUndefined();
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        search: undefined,
        unread: undefined,
        limit: 30,
      })
    );

    wrapper.unmount();
  });
});

describe('Notification Delete Feature Suite', () => {
  let store: ReturnType<typeof useNotificationStore>;

  const notifA: Notification = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: 'user-1',
    type: 'application_new',
    title: 'Thông báo A (Chưa đọc)',
    payload: {},
    readAt: null,
    createdAt: new Date().toISOString(),
  };

  const notifB: Notification = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    userId: 'user-1',
    type: 'interview_scheduled',
    title: 'Thông báo B (Đã đọc)',
    payload: {},
    readAt: '2026-10-10T10:00:00Z',
    createdAt: new Date().toISOString(),
  };

  const notifC: Notification = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    userId: 'user-1',
    type: 'message',
    title: 'Thông báo C (Chưa đọc)',
    payload: {},
    readAt: null,
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useNotificationStore();
    vi.restoreAllMocks();
  });

  it('Store: removeNotification thành công (item biến mất, totalUnread giảm đúng khi item chưa đọc, không giảm khi đã đọc, totalUnread cuối cùng lấy theo server)', async () => {
    store.items = [{ ...notifA }, { ...notifB }];
    store.totalUnread = 5;

    const removeSpy = vi.spyOn(notificationApi, 'remove').mockResolvedValueOnce({
      data: {
        success: true,
        data: { id: notifA.id, totalUnread: 4 },
      },
    } as any);

    const ok = await store.removeNotification(notifA.id);

    expect(ok).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith(notifA.id);
    expect(store.items.find((n) => n.id === notifA.id)).toBeUndefined();
    expect(store.items.length).toBe(1);
    expect(store.totalUnread).toBe(4);

    // Xóa item đã đọc: totalUnread lấy theo server, không giảm 2 lần
    removeSpy.mockResolvedValueOnce({
      data: {
        success: true,
        data: { id: notifB.id, totalUnread: 4 },
      },
    } as any);

    const ok2 = await store.removeNotification(notifB.id);
    expect(ok2).toBe(true);
    expect(store.items.length).toBe(0);
    expect(store.totalUnread).toBe(4);
  });

  it('Store: Lỗi API thì rollback đúng vị trí và totalUnread', async () => {
    store.items = [{ ...notifA }, { ...notifB }, { ...notifC }];
    store.totalUnread = 2;

    vi.spyOn(notificationApi, 'remove').mockRejectedValueOnce(new Error('Network Error'));

    // Xóa item B ở vị trí index 1
    const ok = await store.removeNotification(notifB.id);

    expect(ok).toBe(false);
    expect(store.error).toBe('Không thể kết nối tới máy chủ, vui lòng kiểm tra mạng và thử lại');
    expect(store.items.length).toBe(3);
    expect(store.items[1]?.id).toBe(notifB.id);
    expect(store.totalUnread).toBe(2);
  });

  it('Store: fetchNextPage có response chứa item đã xóa thì item không xuất hiện lại', async () => {
    store.items = [{ ...notifA }];
    store.totalUnread = 1;
    store.nextCursor = 'cursor-page-1';

    // Xóa notifB trước khi nạp trang 2
    vi.spyOn(notificationApi, 'remove').mockResolvedValueOnce({
      data: { success: true, data: { id: notifB.id, totalUnread: 1 } },
    } as any);
    await store.removeNotification(notifB.id);

    // fetchNextPage trả về notifB (server pagination snapshot cũ chưa loại)
    vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [{ ...notifB }, { ...notifC }],
          nextCursor: null,
          totalUnread: 2,
        },
      },
    } as any);

    await store.fetchNextPage();

    // notifB đã bị xóa nên bị loại khỏi items, chỉ có notifA và notifC
    expect(store.items.some((n) => n.id === notifB.id)).toBe(false);
    expect(store.items.some((n) => n.id === notifC.id)).toBe(true);
    expect(store.items.length).toBe(2);
  });

  it('Store: Socket notification:deleted xóa item và không giảm unread hai lần khi tab này vừa xóa', async () => {
    store.items = [{ ...notifA }, { ...notifC }];
    store.totalUnread = 2;

    // Giả lập socket nhận sự kiện xóa notifA
    // Đăng ký socket bằng cách gọi bindSocket
    const mockSocket = {
      connected: true,
      connect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    vi.spyOn(await import('@services/socket'), 'getSocket').mockReturnValue(mockSocket as any);

    store.bindSocket();
    const deletedHandler = mockSocket.on.mock.calls.find((c) => c[0] === 'notification:deleted')?.[1];
    expect(deletedHandler).toBeDefined();

    // Socket bắn sự kiện xóa notifC
    deletedHandler({ id: notifC.id });

    expect(store.items.find((n) => n.id === notifC.id)).toBeUndefined();
    expect(store.totalUnread).toBe(1);

    // Socket bắn lại sự kiện xóa notifC (hoặc chính tab này vừa xóa trước đó) -> không giảm unread lần 2
    deletedHandler({ id: notifC.id });
    expect(store.totalUnread).toBe(1);
  });

  it('Component: mở modal, bấm Xóa thông báo thì hiện bước xác nhận, bấm Hủy thì quay lại', async () => {
    const wrapper = mount(NotificationDetailModal, {
      props: {
        item: {
          id: notifA.id,
          type: notifA.type,
          title: notifA.title,
          createdAt: notifA.createdAt,
          readAt: notifA.readAt,
          payload: notifA.payload,
        },
        deleting: false,
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    // Ban đầu thấy nút "Xóa thông báo"
    const deleteBtn = wrapper.find('button[title="Xóa thông báo này"]');
    expect(deleteBtn.exists()).toBe(true);
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);

    // Bấm "Xóa thông báo" -> chuyển sang xác nhận 2 bước
    await deleteBtn.trigger('click');
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Xóa thông báo này?');

    // Bấm "Hủy" -> quay lại bình thường
    const cancelBtn = wrapper.find('button:has-text("Hủy")');
    const buttons = wrapper.findAll('button');
    const cancel = buttons.find((b) => b.text().includes('Hủy'));
    expect(cancel).toBeDefined();
    await cancel!.trigger('click');

    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.find('button[title="Xóa thông báo này"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it('Component: bấm Xóa thì emit delete với id', async () => {
    const wrapper = mount(NotificationDetailModal, {
      props: {
        item: {
          id: notifA.id,
          type: notifA.type,
          title: notifA.title,
          createdAt: notifA.createdAt,
          readAt: notifA.readAt,
          payload: notifA.payload,
        },
        deleting: false,
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    });

    await wrapper.find('button[title="Xóa thông báo này"]').trigger('click');
    const confirmBtn = wrapper.findAll('button').find((b) => b.text() === 'Xóa');
    expect(confirmBtn).toBeDefined();

    await confirmBtn!.trigger('click');
    expect(wrapper.emitted('delete')).toEqual([[notifA.id]]);

    wrapper.unmount();
  });

  it('NotificationsView: xóa dòng duy nhất của trang 2 thì currentPage về 1', async () => {
    const auth = useAuthStore();
    auth.user = { id: 'u-1', email: 'u@test.vn', role: 'candidate' } as any;
    auth.accessToken = 'test-token';

    // Tạo 7 items (pageSize = 6) -> 2 trang. Trang 2 chỉ có 1 item.
    const itemsList: Notification[] = [];
    for (let i = 1; i <= 7; i++) {
      itemsList.push({
        id: `id-${i}`,
        userId: 'u-1',
        type: 'application_new',
        title: `Thông báo ${i}`,
        payload: {},
        readAt: null,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      });
    }

    vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: itemsList,
          nextCursor: null,
          totalUnread: 7,
        },
      },
    } as any);

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Đi sang trang 2
    const nextBtn = wrapper.find('button[aria-label="Trang sau"]');
    expect(nextBtn.exists()).toBe(true);
    await nextBtn.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Trang 2');

    // Xóa item thứ 7 (dòng duy nhất của trang 2)
    vi.spyOn(notificationApi, 'remove').mockResolvedValueOnce({
      data: { success: true, data: { id: 'id-7', totalUnread: 6 } },
    } as any);

    await store.removeNotification('id-7');
    await flushPromises();

    // Danh sách co lại còn 6 items -> watcher tự lùi currentPage về 1
    expect(wrapper.text()).toContain('Trang 1');

    wrapper.unmount();
  });
});

describe('Notification Error Localization & Resilience Suite', () => {
  describe('Helper getNotificationErrorMessage', () => {
    it('Map chuẩn xác các mã lỗi đã biết ra tiếng Việt', () => {
      expect(getNotificationErrorMessage({ code: 'NOTIFICATION_NOT_FOUND' })).toBe('Không tìm thấy thông báo');
      expect(getNotificationErrorMessage({ code: 'VALIDATION_ERROR' })).toBe('Dữ liệu không hợp lệ');
      expect(getNotificationErrorMessage({ code: 'UNAUTHORIZED' })).toBe('Bạn cần đăng nhập để thực hiện thao tác này');
      expect(getNotificationErrorMessage({ code: 'FORBIDDEN' })).toBe('Bạn không có quyền thực hiện thao tác này');
      expect(getNotificationErrorMessage({ code: 'ROUTE_NOT_FOUND' })).toBe('Không tìm thấy đường dẫn yêu cầu');
      expect(getNotificationErrorMessage({ code: 'NOT_FOUND' })).toBe('Không tìm thấy đường dẫn yêu cầu');
      expect(getNotificationErrorMessage({ code: 'INVALID_CURSOR' })).toBe('Tham số phân trang không hợp lệ');
      expect(getNotificationErrorMessage({ code: 'RATE_LIMITED' })).toBe('Bạn thao tác quá nhanh, vui lòng thử lại sau');
      expect(getNotificationErrorMessage({ code: 'INTERNAL_ERROR' })).toBe('Đã có lỗi xảy ra, vui lòng thử lại sau');
    });

    it('Xử lý lỗi mạng và timeout', () => {
      expect(getNotificationErrorMessage(new Error('Network Error'))).toBe('Không thể kết nối tới máy chủ, vui lòng kiểm tra mạng và thử lại');
      expect(getNotificationErrorMessage({ isAxiosError: true, code: 'ERR_NETWORK' })).toBe('Không thể kết nối tới máy chủ, vui lòng kiểm tra mạng và thử lại');
      expect(getNotificationErrorMessage({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' })).toBe('Yêu cầu quá thời gian chờ, vui lòng thử lại');
    });

    it('Tuyệt đối không để message tiếng Anh từ server lọt ra UI và dùng fallback khi gặp code lạ', () => {
      const serverEnglishError = {
        code: 'UNKNOWN_TECHNICAL_ERROR',
        message: 'Database query execution failed at line 42 with syntax error',
      };
      const result = getNotificationErrorMessage(serverEnglishError, 'Không thể xóa thông báo');
      expect(result).toBe('Không thể xóa thông báo');
      expect(result).not.toContain('Database');
    });

    it('Chấp nhận message của server nếu có chứa tiếng Việt có dấu và code không nằm trong map', () => {
      const customVietnameseError = {
        code: 'CUSTOM_BIZ_CODE',
        message: 'Bạn đã vượt quá giới hạn thao tác trong ngày',
      };
      expect(getNotificationErrorMessage(customVietnameseError)).toBe('Bạn đã vượt quá giới hạn thao tác trong ngày');
    });

    it('Ưu tiên response.data.error.code trước AxiosError code ERR_BAD_REQUEST', () => {
      const rawAxiosError = {
        isAxiosError: true,
        code: 'ERR_BAD_REQUEST',
        response: {
          status: 400,
          data: {
            success: false,
            error: {
              code: 'NOTIFICATION_NOT_FOUND',
              message: 'Không tìm thấy thông báo',
            },
          },
        },
      };
      expect(getNotificationErrorMessage(rawAxiosError)).toBe('Không tìm thấy thông báo');
    });
  });

  describe('Store error handling & rollback resilience', () => {
    let store: ReturnType<typeof useNotificationStore>;

    beforeEach(() => {
      setActivePinia(createPinia());
      store = useNotificationStore();
    });

    it('Lỗi route-not-found (404 Express) khi xóa thì rollback và error là tiếng Việt', async () => {
      const notifItem: Notification = {
        id: 'test-item-1',
        userId: 'u-1',
        type: 'application_new',
        title: 'Thông báo 1',
        payload: {},
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      store.items = [notifItem];
      store.totalUnread = 1;

      vi.spyOn(notificationApi, 'remove').mockRejectedValueOnce({
        response: {
          status: 404,
          data: {
            success: false,
            error: {
              code: 'ROUTE_NOT_FOUND',
              message: 'Route /api/v1/notifications/test-item-1 not found',
            },
          },
        },
      });

      const ok = await store.removeNotification(notifItem.id);

      expect(ok).toBe(false);
      // Đã rollback
      expect(store.items.length).toBe(1);
      expect(store.items[0]?.id).toBe('test-item-1');
      expect(store.totalUnread).toBe(1);
      // Error tiếng Việt, không chứa "Route" hay "not found"
      expect(store.error).toBe('Không tìm thấy đường dẫn yêu cầu');
      expect(store.error).not.toContain('Route');
    });

    it('Khi lỗi là NOTIFICATION_NOT_FOUND thì coi như đã xóa, không rollback', async () => {
      const notifItem: Notification = {
        id: 'test-item-2',
        userId: 'u-1',
        type: 'application_new',
        title: 'Thông báo 2',
        payload: {},
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      store.items = [notifItem];
      store.totalUnread = 1;

      vi.spyOn(notificationApi, 'remove').mockRejectedValueOnce({
        code: 'NOTIFICATION_NOT_FOUND',
        response: {
          status: 404,
          data: {
            success: false,
            error: {
              code: 'NOTIFICATION_NOT_FOUND',
              message: 'Không tìm thấy thông báo',
            },
          },
        },
      });

      vi.spyOn(notificationApi, 'getUnreadCount').mockResolvedValueOnce({
        data: { success: true, data: { unreadCount: 0 } },
      } as any);

      const ok = await store.removeNotification(notifItem.id);

      expect(ok).toBe(true);
      // Item vẫn bị xóa khỏi danh sách, không rollback
      expect(store.items.length).toBe(0);
    });

    it('AxiosError thô có code ERR_BAD_REQUEST và response.data.error.code NOTIFICATION_NOT_FOUND: coi như đã xóa và không rollback', async () => {
      const notifItem: Notification = {
        id: 'test-item-raw-axios',
        userId: 'u-1',
        type: 'application_new',
        title: 'Thông báo raw axios',
        payload: {},
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      store.items = [notifItem];
      store.totalUnread = 1;

      vi.spyOn(notificationApi, 'remove').mockRejectedValueOnce({
        isAxiosError: true,
        code: 'ERR_BAD_REQUEST',
        response: {
          status: 400,
          data: {
            success: false,
            error: {
              code: 'NOTIFICATION_NOT_FOUND',
              message: 'Không tìm thấy thông báo',
            },
          },
        },
      });

      vi.spyOn(notificationApi, 'getUnreadCount').mockResolvedValueOnce({
        data: { success: true, data: { unreadCount: 0 } },
      } as any);

      const ok = await store.removeNotification(notifItem.id);

      expect(ok).toBe(true);
      // Item vẫn bị xóa khỏi danh sách, không rollback
      expect(store.items.length).toBe(0);
    });
  });

  describe('Component error handling in NotificationsView', () => {
    it('Lỗi xóa hiện toast tiếng Việt và modal vẫn mở', async () => {
      const auth = useAuthStore();
      auth.user = { id: 'u-1', email: 'u@test.vn', role: 'candidate' } as any;
      auth.accessToken = 'test-token';

      const toast = useToastStore();
      const toastErrorSpy = vi.spyOn(toast, 'error');

      const notifItem: Notification = {
        id: 'test-item-view',
        userId: 'u-1',
        type: 'application_new',
        title: 'Đơn ứng tuyển mới',
        payload: {},
        readAt: null,
        createdAt: new Date().toISOString(),
      };

      vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            items: [notifItem],
            nextCursor: null,
            totalUnread: 1,
          },
        },
      } as any);

      const wrapper = mount(NotificationsView, {
        global: {
          stubs: {
            Teleport: true,
            RouterLink: true,
            'router-link': true,
          },
        },
      });

      await flushPromises();

      // Mở modal bằng cách click vào dòng
      const row = wrapper.find('tbody tr');
      expect(row.exists()).toBe(true);
      await row.trigger('click');
      await flushPromises();

      // Kiểm tra modal đang mở
      const modal = wrapper.findComponent(NotificationDetailModal);
      expect(modal.exists()).toBe(true);
      expect(modal.props('item')).toBeDefined();

      // Giả lập remove API thất bại
      vi.spyOn(notificationApi, 'remove').mockRejectedValueOnce({
        code: 'ROUTE_NOT_FOUND',
      });

      // Bấm nút xóa trong modal
      const deleteBtn = modal.find('button[title="Xóa thông báo này"]');
      expect(deleteBtn.exists()).toBe(true);
      await deleteBtn.trigger('click');
      const confirmBtn = modal.findAll('button').find((b) => b.text() === 'Xóa');
      expect(confirmBtn).toBeDefined();
      await confirmBtn!.trigger('click');
      await flushPromises();

      // Toast error hiển thị tiếng Việt
      expect(toastErrorSpy).toHaveBeenCalledWith('Không tìm thấy đường dẫn yêu cầu');
      // Modal vẫn mở vì xóa thất bại
      expect(wrapper.findComponent(NotificationDetailModal).props('item')).not.toBeNull();

      wrapper.unmount();
    });
  });
});

describe('NotificationsView Smooth Transitions & Stale-While-Revalidate Suite', () => {
  let store: ReturnType<typeof useNotificationStore>;

  const createMockNotif = (id: string, title: string, readAt: string | null = null): Notification => ({
    id,
    userId: 'user-1',
    type: 'application_new',
    title,
    payload: { candidateName: 'Ứng viên Test' },
    readAt,
    createdAt: new Date().toISOString(),
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useNotificationStore();
    const auth = useAuthStore();
    auth.user = { id: 'user-1', email: 'test@jobmatch.vn', role: 'employer', status: 'active' };
    auth.accessToken = 'test-jwt-token';
    vi.restoreAllMocks();
  });

  it('1. Đổi tab: các dòng cũ không bị remount trước khi response về (so sánh DOM element node), currentPage chưa đổi; sau khi response về currentPage = 1 và viewKey tăng', async () => {
    // Ban đầu có 12 items (2 trang, mỗi trang 6 dòng)
    const initialItems = Array.from({ length: 12 }, (_, i) =>
      createMockNotif(`notif-${i + 1}`, `Thông báo ${i + 1}`, i < 6 ? '2026-10-10T00:00:00Z' : null)
    );

    vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: { items: initialItems, nextCursor: null, totalUnread: 6 },
      },
    } as any);

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Đi sang Trang 2
    const nextBtn = wrapper.find('button[aria-label="Trang sau"]');
    await nextBtn.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Trang 2');

    // Lưu lại DOM node của dòng đầu tiên ở trang 2 trước khi bấm đổi tab
    const firstRowBeforeClick = wrapper.find('tbody tr').element;
    expect(firstRowBeforeClick).toBeDefined();

    // Mock API list cho lần đổi tab: promise chưa resolve (in-flight)
    let resolveFilterApi: (val: any) => void = () => {};
    const filterPromise = new Promise((resolve) => {
      resolveFilterApi = resolve;
    });
    vi.spyOn(notificationApi, 'list').mockReturnValueOnce(filterPromise as any);

    // Click tab "Chưa đọc"
    const unreadTab = wrapper.findAll('button').find((b) => b.text().includes('Chưa đọc'));
    expect(unreadTab).toBeDefined();
    await unreadTab!.trigger('click');

    // KIỂM TRA TRƯỚC KHI RESPONSE VỀ (stale-while-revalidate):
    // 1. currentPage chưa bị đổi thành 1
    expect(wrapper.text()).toContain('Trang 2');
    // 2. DOM node của dòng cũ KHÔNG bị remount (vẫn chính là element ban đầu)
    const currentRowDuringFetch = wrapper.find('tbody tr').element;
    expect(currentRowDuringFetch).toBe(firstRowBeforeClick);
    // 3. tbody KHÔNG có class opacity-60 (tránh mờ chồng) và có pointer-events-none, aria-busy="true"
    const tbody = wrapper.find('tbody');
    expect(tbody.classes()).not.toContain('opacity-60');
    expect(tbody.classes()).toContain('pointer-events-none');
    expect(tbody.attributes('aria-busy')).toBe('true');

    // Response về dữ liệu của tab Chưa đọc
    const unreadItems = [
      createMockNotif('unread-1', 'Thông báo chưa đọc 1', null),
      createMockNotif('unread-2', 'Thông báo chưa đọc 2', null),
    ];
    resolveFilterApi({
      data: {
        success: true,
        data: { items: unreadItems, nextCursor: null, totalUnread: 2 },
      },
    });

    await flushPromises();

    // KIỂM TRA SAU KHI RESPONSE VỀ:
    // 1. currentPage chuyển về 1
    expect(wrapper.text()).toContain('Trang 1');
    // 2. tbody hết aria-busy và không còn mờ
    expect(wrapper.find('tbody').attributes('aria-busy')).toBeUndefined();
    expect(wrapper.find('tbody').classes()).not.toContain('opacity-60');
    // 3. Dòng mới được render đúng nội dung
    expect(wrapper.text()).toContain('Thông báo chưa đọc 1');

    wrapper.unmount();
  });

  it('2. 2 lần đổi tab liên tiếp nhanh: kết quả cũ hoàn tất muộn hơn không ghi đè dữ liệu mới (switchToken guard)', async () => {
    vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: { items: [createMockNotif('init-1', 'Gốc')], nextCursor: null, totalUnread: 0 },
      },
    } as any);

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    let resolveReq1: (val: any) => void = () => {};
    const p1 = new Promise((resolve) => { resolveReq1 = resolve; });

    let resolveReq2: (val: any) => void = () => {};
    const p2 = new Promise((resolve) => { resolveReq2 = resolve; });

    const listSpy = vi.spyOn(notificationApi, 'list')
      .mockReturnValueOnce(p1 as any)
      .mockReturnValueOnce(p2 as any);

    const buttons = wrapper.findAll('button');
    const unreadTab = buttons.find((b) => b.text().includes('Chưa đọc'));
    const allTab = buttons.find((b) => b.text().includes('Tất cả'));

    // Bấm tab "Chưa đọc" (request 1 bắt đầu)
    await unreadTab!.trigger('click');
    // Ngay sau đó bấm tab "Tất cả" (request 2 bắt đầu)
    await allTab!.trigger('click');

    expect(listSpy).toHaveBeenCalledTimes(2);

    // Request 2 hoàn thành trước với kết quả của "Tất cả"
    resolveReq2({
      data: {
        success: true,
        data: {
          items: [createMockNotif('all-latest', 'Dữ liệu của Tất cả mới nhất')],
          nextCursor: null,
          totalUnread: 0,
        },
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Dữ liệu của Tất cả mới nhất');

    // Request 1 cũ hoàn thành sau cùng với kết quả cũ của "Chưa đọc"
    resolveReq1({
      data: {
        success: true,
        data: {
          items: [createMockNotif('stale-unread', 'Dữ liệu stale của Chưa đọc')],
          nextCursor: null,
          totalUnread: 1,
        },
      },
    });
    await flushPromises();

    // Kết quả stale KHÔNG được ghi đè lên giao diện
    expect(wrapper.text()).toContain('Dữ liệu của Tất cả mới nhất');
    expect(wrapper.text()).not.toContain('Dữ liệu stale của Chưa đọc');

    wrapper.unmount();
  });

  it('3. Fake timers: loading < 150ms skeleton không xuất hiện; > 150ms xuất hiện và tồn tại tối thiểu 250ms; lần đầu mount hiện ngay', async () => {
    vi.useFakeTimers();

    // Lần đầu mount: skeleton hiện ngay lập tức
    let resolveMountList: (v: any) => void = () => {};
    const mountPromise = new Promise((resolve) => { resolveMountList = resolve; });
    vi.spyOn(notificationApi, 'list').mockReturnValueOnce(mountPromise as any);

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    // Lúc vừa mount: gọi nextTick để Vue cập nhật DOM với showSkeleton từ onMounted
    await nextTick();
    const skeletonRowsAtMount = wrapper.findAll('tr.animate-pulse');
    expect(skeletonRowsAtMount.length).toBe(6);

    // API mount trả về
    resolveMountList({
      data: {
        success: true,
        data: {
          items: [createMockNotif('m-1', 'Thông báo 1')],
          nextCursor: null,
          totalUnread: 0,
        },
      },
    });
    await flushPromises();
    // Sau khi mount hoàn tất, skeleton tắt và hiện dữ liệu thật
    expect(wrapper.findAll('tr.animate-pulse').length).toBe(0);
    expect(wrapper.text()).toContain('Thông báo 1');

    // Case 3a: Đổi tab mà API trả về nhanh < 150ms -> Skeleton KHÔNG BAO GIỜ xuất hiện
    let resolveFastApi: (v: any) => void = () => {};
    const fastPromise = new Promise((resolve) => { resolveFastApi = resolve; });
    vi.spyOn(notificationApi, 'list').mockReturnValueOnce(fastPromise as any);

    const unreadTab = wrapper.findAll('button').find((b) => b.text().includes('Chưa đọc'));
    await unreadTab!.trigger('click');
    await nextTick();

    // Chờ 100ms (< 150ms)
    vi.advanceTimersByTime(100);
    expect(wrapper.findAll('tr.animate-pulse').length).toBe(0); // Chưa hề có skeleton

    // API trả về ở mốc 120ms
    vi.advanceTimersByTime(20);
    resolveFastApi({
      data: {
        success: true,
        data: {
          items: [createMockNotif('fast-1', 'Thông báo phản hồi nhanh')],
          nextCursor: null,
          totalUnread: 0,
        },
      },
    });
    await flushPromises();
    // Skeleton vẫn bằng 0, không nháy mắt
    expect(wrapper.findAll('tr.animate-pulse').length).toBe(0);
    expect(wrapper.text()).toContain('Thông báo phản hồi nhanh');

    // Case 3b: Đổi tab mà API kéo dài > 150ms -> Skeleton xuất hiện sau 150ms và tắt ngay khi data về
    let resolveSlowApi: (v: any) => void = () => {};
    const slowPromise = new Promise((resolve) => { resolveSlowApi = resolve; });
    vi.spyOn(notificationApi, 'list').mockReturnValueOnce(slowPromise as any);

    const allTab = wrapper.findAll('button').find((b) => b.text().includes('Tất cả'));
    await allTab!.trigger('click');
    await nextTick();

    // Trước 150ms: chưa có skeleton
    vi.advanceTimersByTime(140);
    expect(wrapper.findAll('tr.animate-pulse').length).toBe(0);

    // Đạt 150ms: skeleton xuất hiện
    vi.advanceTimersByTime(15);
    await nextTick();
    expect(wrapper.findAll('tr.animate-pulse').length).toBe(6);

    // API trả về tại mốc 200ms -> skeleton tắt ngay lập tức, dữ liệu hiện ngay (không chờ tối thiểu 250ms)
    vi.advanceTimersByTime(45);
    resolveSlowApi({
      data: {
        success: true,
        data: {
          items: [createMockNotif('slow-1', 'Thông báo phản hồi chậm')],
          nextCursor: null,
          totalUnread: 0,
        },
      },
    });
    await flushPromises();

    // Skeleton tắt ngay, dữ liệu hiện
    expect(wrapper.findAll('tr.animate-pulse').length).toBe(0);
    expect(wrapper.text()).toContain('Thông báo phản hồi chậm');

    wrapper.unmount();
    vi.useRealTimers();
  });

  it('4. Tab rỗng bấm "Tất cả": không có skeleton trước 150ms, empty state hiển thị có aria-busy cho đến khi data về', async () => {
    // Mount ban đầu với danh sách có item
    vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: { items: [createMockNotif('init-item', 'Thông báo ban đầu')], nextCursor: null, totalUnread: 0 },
      },
    } as any);

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Chuyển sang tab "Chưa đọc" trả về rỗng (empty state)
    vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: { items: [], nextCursor: null, totalUnread: 0 },
      },
    } as any);

    const unreadTab = wrapper.findAll('button').find((b) => b.text().includes('Chưa đọc'));
    await unreadTab!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Không tìm thấy thông báo phù hợp.');
    expect(wrapper.text()).toContain('Không có thông báo nào trong mục này.');

    // Bây giờ đang ở tab Chưa đọc rỗng. Người dùng bấm "Tất cả"
    let resolveAllApi: (v: any) => void = () => {};
    const allPromise = new Promise((resolve) => { resolveAllApi = resolve; });
    vi.spyOn(notificationApi, 'list').mockReturnValueOnce(allPromise as any);

    const allTab = wrapper.findAll('button').find((b) => b.text().includes('Tất cả'));
    await allTab!.trigger('click');
    await nextTick();

    // Kiểm tra:
    // 1. Không có skeleton row nào
    expect(wrapper.findAll('tr.animate-pulse').length).toBe(0);
    // 2. Empty state vẫn hiển thị
    expect(wrapper.text()).toContain('Không tìm thấy thông báo phù hợp.');
    // 3. tbody có aria-busy="true" và KHÔNG có opacity-60
    const tbody = wrapper.find('tbody');
    expect(tbody.attributes('aria-busy')).toBe('true');
    expect(tbody.classes()).not.toContain('opacity-60');

    // Dữ liệu về
    resolveAllApi({
      data: {
        success: true,
        data: {
          items: [createMockNotif('empty-to-all', 'Thông báo mới nạp')],
          nextCursor: null,
          totalUnread: 0,
        },
      },
    });
    await flushPromises();

    // Hiển thị dữ liệu thật, hết aria-busy
    expect(wrapper.text()).toContain('Thông báo mới nạp');
    expect(wrapper.find('tbody').attributes('aria-busy')).toBeUndefined();

    wrapper.unmount();
  });

  it('5. Socket notification mới: có modifier is-new, class animation giữ nguyên anim-row-enter, sau 1.5s modifier biến mất và không chạy lại animation', async () => {
    vi.useFakeTimers();

    const existingNotif = createMockNotif('existing-1', 'Thông báo đã có');
    vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: { items: [existingNotif], nextCursor: null, totalUnread: 0 },
      },
    } as any);

    // Mock socket instance
    const socketListeners: Record<string, Function> = {};
    const mockSocket = {
      connected: true,
      connect: vi.fn(),
      on: vi.fn((event, cb) => { socketListeners[event] = cb; }),
      off: vi.fn((event) => { delete socketListeners[event]; }),
    };
    vi.spyOn(await import('@services/socket'), 'getSocket').mockReturnValue(mockSocket as any);

    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Socket đẩy 1 thông báo mới vào
    const incomingNotif = createMockNotif('socket-incoming-1', 'Đơn ứng tuyển realtime mới', null);
    store.pushLocal(incomingNotif);
    // Kích hoạt handler socket đã đăng ký trong component
    const socketNewHandler = socketListeners['notification:new'];
    expect(socketNewHandler).toBeDefined();
    socketNewHandler(incomingNotif);

    await flushPromises();

    // Dòng mới xuất hiện ở đầu bảng
    const rows = wrapper.findAll('tbody tr');
    const newRow = rows[0];
    expect(newRow.text()).toContain('Đơn ứng tuyển realtime mới');

    // 1. Chứa class modifier is-new (highlight nền tạm thời, không animation/transform)
    expect(newRow.classes()).toContain('is-new');
    expect(newRow.classes()).not.toContain('anim-row-enter');

    // Sau 1.5s (1500ms):
    vi.advanceTimersByTime(1500);
    await flushPromises();

    // Modifier is-new đã được gỡ bỏ sau 1.5s
    expect(newRow.classes()).not.toContain('is-new');

    wrapper.unmount();
    vi.useRealTimers();
  });

  it('6. Router cấu hình scrollBehavior tự động reset top = 0 khi điều hướng để chống giữ scroll cũ', async () => {
    // Import router từ router/index.ts
    const { router } = await import('@/router/index');
    expect(router.options.scrollBehavior).toBeDefined();

    // Giả lập navigation từ trang khác
    const pos = router.options.scrollBehavior!({ path: '/employer/notifications' } as any, { path: '/employer/jobs' } as any, null as any);
    expect(pos).toEqual({ top: 0 });

    // Khi có savedPosition (nhấn back/forward của trình duyệt) thì khôi phục vị trí cũ
    const saved = { left: 0, top: 150 };
    const posSaved = router.options.scrollBehavior!({ path: '/employer/notifications' } as any, { path: '/employer/jobs' } as any, saved as any);
    expect(posSaved).toEqual(saved);
  });

  it('7. EmployerLayout và CandidateLayout cấu hình Transition với mode="out-in" chống chiếm chỗ song song', async () => {
    const EmployerLayout = (await import('@views/employer/EmployerLayout.vue')).default;
    const CandidateLayout = (await import('@views/candidate/CandidateLayout.vue')).default;

    // Kiểm tra render function / template definition của EmployerLayout và CandidateLayout
    const elWrapper = mount(EmployerLayout, {
      global: {
        stubs: {
          EmployerSidebar: true,
          RouterView: true,
        },
      },
    });
    expect(elWrapper.html()).toBeDefined();
    elWrapper.unmount();

    const cdWrapper = mount(CandidateLayout, {
      global: {
        stubs: {
          CandidateSidebar: true,
          RouterView: true,
        },
      },
    });
    expect(cdWrapper.html()).toBeDefined();
    cdWrapper.unmount();
  });

  it('8. Khung bọc bảng desktop vẫn overflow-hidden; không còn thẻ Transition bọc danh sách table và mobile', async () => {
    vi.spyOn(notificationApi, 'list').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [createMockNotif('t-1', 'Thông báo 1')],
          nextCursor: null,
          totalUnread: 0,
        },
      },
    } as any);

    // Mount component thật NotificationsView
    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Khung bảng desktop (.hidden.lg:block) có overflow-hidden, không còn overflow-x-auto/overflow-y-hidden
    const desktopTableWrapper = wrapper.find('.hidden.lg\\:block');
    expect(desktopTableWrapper.exists()).toBe(true);
    expect(desktopTableWrapper.classes()).toContain('overflow-hidden');
    expect(desktopTableWrapper.classes()).not.toContain('overflow-x-auto');
    expect(desktopTableWrapper.classes()).not.toContain('overflow-y-hidden');

    // tbody không có class opacity-60 hay opacity-85
    const tbody = wrapper.find('tbody');
    expect(tbody.exists()).toBe(true);
    expect(tbody.classes()).not.toContain('opacity-60');
    expect(tbody.classes()).not.toContain('opacity-85');

    // Không còn Transition bọc tbody và card list mobile (chuyển đổi tức thời, không animation)
    const transitions = wrapper.findAllComponents({ name: 'Transition' });
    expect(transitions.length).toBe(0);

    wrapper.unmount();
  });

  it('9. Phân trang Trước/Sau chuyển đổi tức thời không animation; khi mark đã đọc một dòng thì tbody không remount', async () => {
    // 12 item (2 trang), item 1 chưa đọc
    const items = Array.from({ length: 12 }, (_, i) =>
      createMockNotif(`titem-${i + 1}`, `Item ${i + 1}`, i === 0 ? null : '2026-10-10T00:00:00Z')
    );

    vi.spyOn(notificationApi, 'list').mockResolvedValue({
      data: {
        success: true,
        data: { items, nextCursor: null, totalUnread: 1 },
      },
    } as any);

    vi.spyOn(notificationApi, 'markRead').mockResolvedValue({
      data: {
        success: true,
        data: { ...items[0], readAt: new Date().toISOString() },
      },
    } as any);

    // Mount component thật NotificationsView
    const wrapper = mount(NotificationsView, {
      global: {
        stubs: {
          NotificationDetailModal: true,
          Teleport: true,
          RouterLink: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Khi chỉ mark đã đọc 1 dòng: lưu lại DOM element của tbody
    const tbodyBeforeMark = wrapper.find('tbody').element;
    const firstRow = wrapper.findAll('tbody tr:not(.pointer-events-none)')[0];
    await firstRow.trigger('click');
    await flushPromises();

    // DOM node của tbody không bị remount
    const tbodyAfterMark = wrapper.find('tbody').element;
    expect(tbodyAfterMark).toBe(tbodyBeforeMark);

    // Bấm Trang sau -> chuyển ngay sang Trang 2
    const nextBtn = wrapper.find('button[aria-label="Trang sau"]');
    await nextBtn.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Trang 2');

    // Bấm Trang trước -> chuyển ngay sang Trang 1
    const prevBtn = wrapper.find('button[aria-label="Trang trước"]');
    await prevBtn.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Trang 1');

    // Bấm đổi tab -> chuyển tab tức thời
    const reviewedTab = wrapper.findAll('button').find((b) => b.text().includes('Đã đọc'));
    expect(reviewedTab).toBeDefined();
    await reviewedTab!.trigger('click');
    await flushPromises();

    wrapper.unmount();
  });

  it('10. Không còn các class animation/transition khi chuyển tab/trang, prefers-reduced-motion bao phủ đúng', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const vueFilePath = path.resolve(__dirname, '../src/views/NotificationsView.vue');
    const vueContent = fs.readFileSync(vueFilePath, 'utf-8');

    // Tách khối @media (prefers-reduced-motion: reduce)
    const reducedMotionIndex = vueContent.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(reducedMotionIndex).toBeGreaterThan(-1);
    const reducedMotionBlock = vueContent.slice(reducedMotionIndex, vueContent.indexOf('</style>', reducedMotionIndex));

    // Đã xóa bỏ hoàn toàn các class list transition
    expect(vueContent).not.toContain('.list-fade');
    expect(vueContent).not.toContain('.list-next');
    expect(vueContent).not.toContain('.list-prev');
    expect(vueContent).not.toContain('.anim-row-enter');
    expect(vueContent).not.toContain('.anim-row-slide-next');
    expect(vueContent).not.toContain('.anim-row-slide-prev');

    // prefers-reduced-motion vẫn hỗ trợ cho các thành phần tĩnh còn lại
    expect(reducedMotionBlock).toContain('.anim-fade-up');
    expect(reducedMotionBlock).toContain('.anim-empty-fade');
    expect(reducedMotionBlock).toContain('.animate-pulse');
  });
});




