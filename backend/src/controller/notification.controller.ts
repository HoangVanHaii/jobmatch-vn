import { Request, Response, NextFunction } from 'express';
import { notificationService } from '../service/notification.service';
import { AppError } from '../middleware/errorHandler';
import type { CreateNotificationInput, ListNotificationsQuery } from '../interface/notification';


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
                throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
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
    create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const notification = await notificationService.create(req.body as CreateNotificationInput);
            res.status(201).json({
              success: true,
              data: notification,
            });
        } catch (error) {
            console.error("[Notification.create] error: ", error)
            next(error);
        }
    }
}


