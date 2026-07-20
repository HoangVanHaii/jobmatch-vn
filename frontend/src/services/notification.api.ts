import { http } from './http';

export const notificationApi = {
  list: () => http.get('/notifications'),
  markRead: (id: string) => http.patch(`/notifications/${id}/read`),
  markAllRead: () => http.post('/notifications/read-all'),
};