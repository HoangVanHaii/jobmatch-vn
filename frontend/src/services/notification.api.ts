/**
 * Notification API — tầng giao tiếp với backend /api/notifications.
 *
 * Format theo các api hiện có (auth/job/company): trả thẳng AxiosResponse,
 * KHÔNG unwrap ở đây. Nơi gọi tự destruct `const { data } = await ...` rồi lấy `data.data`.
 *
 * Endpoint backend (router notification.ts):
 *   GET   /notifications            list + cursor phân trang (unread, limit)
 *   PATCH /notifications/:id/read   mark 1 notification là đã đọc
 *   POST  /notifications            admin tạo notification hệ thống
 *
 * Lỗi 401 đã do interceptor trong http.ts tự refresh token; các lỗi khác
 * tự reject để nơi gọi (store) catch.
 */
import { http } from './http';
import type {
  CreateNotificationPayload,
  ListNotificationsQuery,
  Notification,
  NotificationListResult,
} from '@/types/notification';

/** Backend luôn bọc response: { success: boolean, data: T } */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const notificationApi = {
  /** GET /notifications — danh sách + cursor phân trang */
  list: (params?: ListNotificationsQuery) =>
    http.get<ApiResponse<NotificationListResult>>('/notifications', { params }),

  /** PATCH /notifications/:id/read — đánh dấu 1 notification là đã đọc */
  markRead: (id: string) => http.patch<ApiResponse<Notification>>(`/notifications/${id}/read`),

  /** PATCH /notifications/read-all — đánh dấu tất cả notification là đã đọc */
  markAllRead: () => http.patch<ApiResponse<{ count: number }>>('/notifications/read-all'),

  /** GET /notifications/unread-count — lấy riêng số lượng thông báo chưa đọc (nhẹ, tối ưu tốc độ) */
  getUnreadCount: () => http.get<ApiResponse<{ unreadCount: number }>>('/notifications/unread-count'),

  /** POST /notifications — admin tạo notification (system message) */
  create: (data: CreateNotificationPayload) =>
    http.post<ApiResponse<Notification>>('/notifications', data),

  /** DELETE /notifications/:id — xoá 1 notification */
  remove: (id: string) =>
    http.delete<ApiResponse<{ id: string; totalUnread: number }>>(`/notifications/${id}`),
};
