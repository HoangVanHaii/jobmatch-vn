
import { z } from 'zod';

export const requestOtpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().trim().min(2).max(100),
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
 * POST /auth/change-password — đổi mật khẩu cho user đã đăng nhập.
 *
 * - currentPassword: bắt buộc, dùng để xác thực (tránh ai cầm token cũng đổi được).
 * - newPassword: tối thiểu 8 ký tự (đồng bộ với reset-password).
 *
 * Lưu ý: route yêu cầu `auth` middleware để đảm bảo chỉ user đang login mới
 * gọi được. Service sẽ tự verify currentPassword với bcrypt.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại'),
  newPassword: z.string().min(8, 'Mật khẩu mới phải có ít nhất 8 ký tự'),
});

/**
 * GET /users/search — search user by fullName để start chat.
 * Trim + lower trước khi query; max 50 results.
 */
export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * POST /auth/oauth/complete — hoàn tất đăng ký OAuth user mới với Role đã chọn.
 *
 * - pendingToken: opaque token từ callback (FE nhận khi status=NEW_USER). TTL 10 phút.
 * - role: 'candidate' | 'employer'. Bắt buộc user chọn — KHÔNG default.
 */
export const completeOAuthSchema = z.object({
  pendingToken: z.string().min(32).max(128),
  role: z.enum(['candidate', 'employer']),
});

/**
 * PATCH /candidates/profile — cập nhật hồ sơ ứng viên.
 *
 * Tất cả field đều optional — partial update. Trim fullName trước khi lưu;
 * nếu user gửi chuỗi rỗng → null (xem controller normalize).
 *
 * - fullName: 2-100 ký tự sau trim.
 * - phone: tối đa 20 ký tự, chỉ chấp nhận digit/space/+/-/().
 * - location: chỉ city + district (lat/lng do geocoder backend set sau).
 * - social: 3 URL LinkedIn/GitHub/Portfolio, optional từng cái.
 * - preferences: free-form JSON, BE không validate key.
 */
export const updateCandidateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[\d\s+\-()]*$/, 'Số điện thoại không hợp lệ')
    .optional()
    .or(z.literal('')),
  location: z
    .object({
      city: z.string().trim().max(100).optional(),
      district: z.string().trim().max(100).optional(),
    })
    .optional(),
  social: z
    .object({
      linkedin: z.string().trim().url('LinkedIn URL không hợp lệ').max(500).optional().or(z.literal('')),
      github: z.string().trim().url('GitHub URL không hợp lệ').max(500).optional().or(z.literal('')),
      portfolio: z.string().trim().url('Portfolio URL không hợp lệ').max(500).optional().or(z.literal('')),
    })
    .optional(),
  preferences: z.record(z.unknown()).optional(),
});
