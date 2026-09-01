
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

/**
 * GET /users/search — search user by fullName để start chat.
 * Trim + lower trước khi query; max 50 results.
 */
export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
