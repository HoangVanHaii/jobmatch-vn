
import { z } from 'zod';

export const requestOtpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['candidate', 'employer']),
});
export const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/, 'OTP phải gồm 6 chữ số'),
});
export const resendOtpSchema = z.object({
  email: z.string().email(),
});
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export const resetPasswordSchema = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/, 'OTP phải gồm 6 chữ số'),
  newPassword: z.string().min(8),
});
export const changeAvatarSchema = z.object({
  avatarUrl: z.string().url(),
});
