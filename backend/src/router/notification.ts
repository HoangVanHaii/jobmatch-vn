import { Router } from "express";
import { auth, adminOnly } from '../middleware/auth';
import {
    validateListNotificationsQuery,
    validateNotificationIdParam,
    validateCreateNotification
} from '../middleware/notification';
import { notificationController } from "../controller/notification.controller";

export const notificationRouter = Router();

notificationRouter.use(auth);

notificationRouter.get('/', validateListNotificationsQuery, notificationController.list);
notificationRouter.get('/unread-count', notificationController.getUnreadCount);
notificationRouter.patch('/read-all', notificationController.markAllRead);
notificationRouter.patch('/:id/read', validateNotificationIdParam, notificationController.markRead);
notificationRouter.delete('/:id', validateNotificationIdParam, notificationController.remove);
notificationRouter.post('/', adminOnly, validateCreateNotification, notificationController.create);


