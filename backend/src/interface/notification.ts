import type { notifications } from "../db/schema/notifications";


export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationType = Notification['type'];
export type NotificationPayload = Record<string, unknown>;

export interface CreateNotificationInput{
    userId: string;
    type: NotificationType;
    title: string;
    payload: NotificationPayload;
}

export interface ListNotificationsQuery{
    unread?: boolean;
    cursor?: string;
    limit: number;
}

export interface NotificationIdParam {
    id: string;
}

