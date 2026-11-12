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

export interface CreateInterviewPayload {
  applicationId: string;
  interviewerId: string;
  interviewerName?: string;
  interviewerEmail?: string;
  interviewType?: string;
  scheduledAt: string;
  durationMin?: number;
  location?: string;
  meetingLink?: string;
  notes?: string;
  autoCreateMeet?: boolean;
}

export interface CreateInterviewResponse {
  id: string;
  status: string;
  meetingLink?: string | null;
}

export interface BusyTimeSlot {
  start: string;
  end: string;
}

export interface PublicInterviewDetails {
  id: string;
  interviewType?: string | null;
  status: string;
  scheduledAt: string;
  durationMin: number;
  location?: string | null;
  meetingLink?: string | null;
  confirmedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  candidateName?: string | null;
  candidateEmail?: string | null;
  jobTitle?: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
  interviewerName?: string | null;
  interviewerEmail?: string | null;
  interviewerAvatar?: string | null;
}

export interface PublicInterviewRespondPayload {
  token: string;
  action: 'confirm' | 'reschedule' | 'reject';
  reason?: string;
  proposedTime?: string;
}

export interface SubmitInterviewFeedbackPayload {
  scores?: Record<string, number>;
  comments: string;
  recommendation: 'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire';
}

export interface InterviewListItem {
  id: string;
  applicationId: string;
  jobId: string | null;
  jobTitle: string | null;
  candidateId: string | null;
  candidateName: string | null;
  candidateEmail: string | null;
  candidatePhone?: string | null;
  candidateAvatar?: string | null;
  interviewerId: string;
  interviewerName?: string | null;
  interviewerEmail?: string | null;
  interviewerAvatar?: string | null;
  interviewType?: string | null;
  scheduledAt: string;
  durationMin: number;
  location?: string | null;
  meetingLink?: string | null;
  status: string;
  confirmedAt?: string | null;
  createdAt: string;
}

export interface ListInterviewParams {
  status?: string;
  interviewType?: string;
  applicationId?: string;
  interviewerId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export const interviewApi = {
  /**
   * Lấy thông tin phỏng vấn public qua confirmation token (không cần login)
   */
  getPublicDetails: (token: string) =>
    http.get<ApiResponse<PublicInterviewDetails>>('/interviews/public/details', {
      params: { token },
    }),

  /**
   * Phản hồi phỏng vấn public qua token (confirm / reschedule / reject)
   */
  respondPublic: (payload: PublicInterviewRespondPayload) =>
    http.post<ApiResponse<{ id: string; status: string; message: string }>>('/interviews/public/respond', payload),

  /**
   * Tạo lịch phỏng vấn mới (tự động tạo Google Meet nếu chọn autoCreateMeet)
   */
  create: (payload: CreateInterviewPayload) =>
    http.post<ApiResponse<CreateInterviewResponse>>('/interviews', payload),

  /**
   * Lấy danh sách khung giờ bận trong ngày từ Google Calendar
   */
  getBusyTimes: (date: string, email?: string) =>
    http.get<ApiResponse<{ busyTimes: BusyTimeSlot[] }>>('/interviews/calendar/busy-times', {
      params: { date, email: email || undefined },
    }),

  /**
   * Danh sách lịch phỏng vấn (hỗ trợ lọc theo khoảng ngày, tuần, trạng thái, loại phỏng vấn)
   */
  list: (params?: ListInterviewParams) =>
    http.get<ApiResponse<{ rows: InterviewListItem[]; total: number; page: number; limit: number }>>('/interviews', { params }),

  /**
   * Huỷ lịch phỏng vấn
   */
  cancel: (id: string, cancelReason?: string) =>
    http.put<ApiResponse<{ id: string; status: string }>>(`/interviews/${id}/cancel`, { cancelReason }),

  /**
   * Người phỏng vấn / HR gửi đánh giá sau buổi phỏng vấn (status -> completed)
   */
  submitFeedback: (id: string, payload: SubmitInterviewFeedbackPayload) =>
    http.put<ApiResponse<{ id: string; status: string }>>(`/interviews/${id}/feedback`, payload),

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
