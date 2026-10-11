import { Request, Response, NextFunction } from 'express';
import { notificationService } from '../service/notification.service';
import { AppError } from '../middleware/errorHandler';
import type { AdminCreateNotificationInput, ListNotificationsQuery } from '../interface/notification';
import { buildNotificationMessage } from '../service/notificationMessage.builder';


export const notificationController = {
    list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const userId = req.user!.userId;
            const query = req.query as unknown as ListNotificationsQuery;
            const result = await notificationService.list(userId, query);
            res.json({
                success: true,
                data: result
            })
        } catch (error) {
            console.error('[Notification.list] error:', error);
            next(error);
        }
    },
    markRead: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params.id as string;
            const userId = req.user!.userId;
            const updated = await notificationService.markRead(id, userId);
            if (!updated) {
                throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo');
            }
            res.json({
                success: true,
                data: updated
            })

        } catch (error) {
            console.error('[Notification.markRead] error: ', error);
            next(error);
        }
    },
    markAllRead: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const userId = req.user!.userId;
            const updated = await notificationService.markAllRead(userId);
            res.json({
                success: true,
                data: { count: updated.length }
            });
        } catch (error) {
            console.error('[Notification.markAllRead] error: ', error);
            next(error);
        }
    },
    getUnreadCount: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const userId = req.user!.userId;
            const count = await notificationService.getUnreadCount(userId);
            res.json({
                success: true,
                data: { unreadCount: count }
            });
        } catch (error) {
            console.error('[Notification.getUnreadCount] error: ', error);
            next(error);
        }
    },
    create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const body = req.body as AdminCreateNotificationInput;
            const message = body.message?.trim() || buildNotificationMessage(body.type, body.payload ?? {}, body.title);
            const notification = await notificationService.create({
                ...body,
                message,
            });
            res.status(201).json({
              success: true,
              data: notification,
            });
        } catch (error) {
            console.error("[Notification.create] error: ", error)
            next(error);
        }
    },
    remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params.id as string;
            const userId = req.user!.userId;
            const result = await notificationService.remove(id, userId);
            if (!result) {
                throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo');
            }
            res.json({
                success: true,
                data: result,
            });
        } catch (error) {
            console.error('[Notification.remove] error: ', error);
            next(error);
        }
    },
}


