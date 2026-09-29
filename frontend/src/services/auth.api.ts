/**
 * Auth API
 *
 * Generic types `<TResponse>` lấy từ `ApiResponseEnvelope<T>` của `http.ts`.
 * Caller có thể destructure `response.data.data` với type-safe assertion.
 */
import { http } from './http';
import type { ApiResponseEnvelope } from './http';
import type { User } from '@stores/auth';

export interface RegisterRequestPayload {
  email: string;
  password: string;
  fullName: string;
  role: 'candidate' | 'employer';
  // F5 FIX: gửi consent lên BE để validate + lưu audit trail.
  agreedToTerms: true;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterVerifyOtpPayload {
  email: string;
  otp: string;
}

/** Login response — cấu trúc BE trả về trong `data` của envelope. */
export interface LoginResponse {
  user: { id: string; email: string; role: User['role'] };
  accessToken: string;
  refreshToken: string;
}

/** Refresh response — cặp token mới sau rotation. */
export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

/** Me response — FE nhận đầy đủ User shape (xem stores/auth.ts). */
export type MeResponse = User;

/** Các endpoint không cần đọc body response (chỉ cần HTTP status 2xx). */
type EmptyData = undefined;

export const authApi = {
  registerRequestOtp: (data: RegisterRequestPayload) =>
    http.post<ApiResponseEnvelope<EmptyData>>('/auth/register/request-otp', data),
  registerVerifyOtp: (data: RegisterVerifyOtpPayload) =>
    http.post<ApiResponseEnvelope<EmptyData>>('/auth/register/verify-otp', data),
  resendOtp: (email: string) =>
    http.post<ApiResponseEnvelope<EmptyData>>('/auth/register/resend-otp', { email }),
  login: (data: LoginPayload) =>
    http.post<ApiResponseEnvelope<LoginResponse>>('/auth/login', data),
  refresh: (refreshToken: string) =>
    http.post<ApiResponseEnvelope<RefreshResponse>>('/auth/refresh', { refreshToken }),
  logout: (refreshToken: string) =>
    http.post<ApiResponseEnvelope<EmptyData>>('/auth/logout', { refreshToken }),
  forgotPassword: (email: string) =>
    http.post<ApiResponseEnvelope<EmptyData>>('/auth/forgot-password', { email }),
  resetPassword: (email: string, otp: string, newPassword: string) =>
    http.post<ApiResponseEnvelope<EmptyData>>('/auth/reset-password', { email, otp, newPassword }),
  me: () => http.get<ApiResponseEnvelope<MeResponse>>('/users/me'),
  usage: () => http.get<ApiResponseEnvelope<EmptyData>>('/users/me/usage'),
};