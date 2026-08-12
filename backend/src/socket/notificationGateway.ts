import type { Server as IOServer } from 'socket.io';

let ioInstance: IOServer | null = null;

export const setNotificationGateway = (io: IOServer): void => {
    ioInstance = io;
}

export const getNotificationGateway = (): IOServer | null => ioInstance;

export const notificationGateway = {
    emitToUser: (userId: string, event: string, data: unknown) => {
        if (!ioInstance) {
            console.warn('[NotificationGateway] io chưa sẵn sàng, skip emit');
            return;
        }
        ioInstance.to(`user:${userId}`).emit(event, data);
    }
    
}