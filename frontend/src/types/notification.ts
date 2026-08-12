/**
 * Notification types — đồng bộ với backend (notifications schema + controller response).
 * Frontend dùng các type này làm contract khi gọi notificationApi.
 */

/** Loại notification (enum notification_type ở DB) */
export type NotificationType = 'company_invite' | 'job_match' | 'message' | 'system';

/** Payload tuỳ loại notification — lưu JSON ở DB */
export type NotificationPayload = Record<string, unknown>;

/** Một dòng trong bảng notifications */
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  payload: NotificationPayload;
  readAt: string | null; // ISO 8601, null = chưa đọc
  createdAt: string; // ISO 8601
}

/** Body POST /notifications (admin) */
export interface CreateNotificationPayload {
  userId: string;
  type: NotificationType;
  title: string;
  payload?: NotificationPayload;
}

/** Query GET /notifications */
export interface ListNotificationsQuery {
  unread?: boolean;
  cursor?: string;
  limit?: number;
}

/** Kết quả phân trang (cursor-based) */
export interface NotificationListResult {
  items: Notification[];
  nextCursor: string | null;
}
