/**
 * Interview & Calendar Integration API
 */
import { http } from './http';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface CalendarStatus {
  isConnected: boolean;
  provider?: string;
  calendarEmail?: string | null;
  connectedAt?: string;
}

export const interviewApi = {
  /**
   * Lấy URL để chuyển hướng HR sang Google OAuth cấp quyền Calendar
   */
  getCalendarConnectUrl: (returnTo?: string) =>
    http.get<ApiResponse<{ url: string }>>('/interviews/calendar/connect-url', {
      params: returnTo ? { returnTo } : undefined,
    }),

  /**
   * Lấy trạng thái kết nối Google Calendar của HR
   */
  getCalendarStatus: () =>
    http.get<ApiResponse<CalendarStatus>>('/interviews/calendar/status'),

  /**
   * Ngắt kết nối Google Calendar
   */
  disconnectCalendar: () =>
    http.delete<ApiResponse<{ message: string }>>('/interviews/calendar/disconnect'),
};
