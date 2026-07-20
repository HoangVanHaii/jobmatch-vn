/**
 * Auth API
 */
import { http } from './http';

export interface RegisterPayload {
  email: string;
  password: string;
  fullName: string;
  role: 'candidate' | 'employer';
}

export interface LoginPayload {
  email: string;
  password: string;
}

export const authApi = {
  register: (data: RegisterPayload) => http.post('/auth/register', data),
  login: (data: LoginPayload) => http.post('/auth/login', data),
  refresh: (refreshToken: string) => http.post('/auth/refresh', { refreshToken }),
  logout: (refreshToken: string) => http.post('/auth/logout', { refreshToken }),
  forgotPassword: (email: string) => http.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => http.post('/auth/reset-password', { token, password }),
  me: () => http.get('/users/me'),
  usage: () => http.get('/users/me/usage'),
};