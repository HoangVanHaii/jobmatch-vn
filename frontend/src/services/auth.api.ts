/**
 * Auth API
 */
import { http } from './http';

export interface RegisterRequestPayload {
  email: string;
  password: string;
  role: 'candidate' | 'employer';
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterVerifyOtpPayload {
  email: string;
  otp: string;
}
export const authApi = {
  registerRequestOtp: (data: RegisterRequestPayload) => http.post('/auth/register/request-otp', data),
  registerVerifyOtp: (data: RegisterVerifyOtpPayload) => http.post('/auth/register/verify-otp', data),
  resendOtp: (email: string) => http.post('/auth/register/resend-otp', { email }),
  login: (data: LoginPayload) => http.post('/auth/login', data),
  refresh: (refreshToken: string) => http.post('/auth/refresh', { refreshToken }),
  logout: (refreshToken: string) => http.post('/auth/logout', { refreshToken }),
  forgotPassword: (email: string) => http.post('/auth/forgot-password', { email }),
  resetPassword: (email: string, otp: string, newPassword: string) =>
    http.post('/auth/reset-password', { email, otp, newPassword }),
  me: () => http.get('/users/me'),
  usage: () => http.get('/users/me/usage'),
};