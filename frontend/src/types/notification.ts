/**
 * Notification types — đồng bộ với backend (notifications schema + controller response).
 * Frontend dùng các type này làm contract khi gọi notificationApi.
 */

/**
 * Loại notification (enum notification_type ở DB).
 *
 * `company` chứa tất cả sự kiện company-member lifecycle, dispatch bằng
 *   payload.kind (10 kind — xem CompanyNotificationKind).
 *
 * `company_invite` legacy chỉ còn trong rows cũ trước migration 0032.
 *   Backend không emit nữa; FE fallback coi như kind='company_invite_sent'.
 *
 * `system` để dành cho payment/quota tương lai (hiện không emit).
 *
 * Tham chiếu backend:
 *   - `application_new`: gửi cho employer khi có candidate apply → bell + tab ứng tuyển
 *   - `application_match_ready`: gửi cho candidate khi AI matching worker hoàn tất
 *   - `application_withdrawn`: gửi cho employer khi candidate rút đơn
 *
 * Migration: 0025/0026 (application_*), 0032 (gom company_invite + system[*]
 *   thành type='company' với payload.kind).
 */
export type NotificationType =
  | 'company'
  | 'company_invite'       // legacy — chỉ từ rows cũ
  | 'job_match'
  | 'message'
  | 'system'
  | 'application_new'
  | 'application_match_ready'
  | 'application_withdrawn';

/**
 * Các kind của payload khi type='company'.
 * TypeScript union để ép FE xử lý đầy đủ khi dispatch.
 *
 * Mapping xem backend/src/service/companyMember.service.ts (buildCompanyNotification
 * và buildInviteNotification).
 */
export type CompanyNotificationKind =
  | 'company_invite_sent'
  | 'company_invite_accepted'
  | 'company_invite_declined'
  | 'company_invite_auto_cancelled'
  | 'invite_cancelled'
  | 'removed_from_company'
  | 'company_member_left'
  | 'company_owner_transferred'
  | 'company_owner_transferred_to_you'
  | 'company_owner_transferred_from_you';

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
  /**
   * Tổng số notification CHƯA ĐỌC của user. Trả kèm response list, dùng cho
   * badge bell — FE không phải đếm trong items đã tải.
   *
   * Độc lập với filter `unread` trong query: người dùng có thể lọc unread=true
   * nhưng badge vẫn cần tổng CHƯA ĐỌC thực sự (không phụ thuộc filter).
   */
  totalUnread: number;
}
