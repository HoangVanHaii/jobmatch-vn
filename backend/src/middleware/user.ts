
import { z } from 'zod';

// T7 FIX: password complexity rule. Tách thành const để dùng chung cho
// requestOtpSchema, resetPasswordSchema, changePasswordSchema.
//
// Audit 2026-09-28 follow-up (B4 FIX v2 — byte-based):
// bcrypt cost=12 chỉ nhìn 72 BYTES đầu của input (UTF-8 encoded). Phần sau
// byte 72 bị bỏ SILENT — hai password chỉ khác nhau sau byte 72 cho cùng hash.
//
// Vấn đề với fix v1 (`.max(64)` ký tự): KHÔNG đủ cho UTF-8 multi-byte.
//   - Tiếng Việt có dấu: 3 byte/char → 64 char = 192 bytes → bcrypt dùng
//     đúng 24 char đầu, 40 char sau bị truncate silent.
//   - Emoji: 4 byte/char → 64 char = 256 bytes → 18 emoji đầu được dùng.
//
// Fix v2: ràng buộc theo BYTE LENGTH (`Buffer.byteLength(pwd, 'utf8') <= 72`):
//   - ASCII: 72 char = 72 byte ✓ (char .max(72) là fast-path)
//   - Tiếng Việt: tối đa 24 char (72 byte) — vẫn mạnh hơn 8-char minimum policy
//   - Emoji: tối đa 18 emoji (72 byte)
//   - KHÔNG password nào được lưu vượt bcrypt window → không truncation.
//
// Login schema cũng áp cùng ràng buộc (xem loginSchema dưới): nếu chỉ chặn
// register mà login cho input >72 byte, bcrypt.compare vẫn truncate input —
// attacker biết password gốc có thể login bằng password + suffix thừa
// (không phải escalation — nhưng đóng hẳn để 1 password = 1 input duy nhất).
const MAX_PASSWORD_BYTES = 72;

const passwordBytesOk = (pwd: string) => Buffer.byteLength(pwd, 'utf8') <= MAX_PASSWORD_BYTES;

const passwordByteLimitMessage =
  'Mật khẩu quá dài khi mã hóa UTF-8 (tối đa 72 byte). Ký tự tiếng Việt/emoji chiếm 2-4 byte mỗi ký tự — vui lòng rút ngắn mật khẩu.';

const passwordSchema = z
  .string()
  .min(8, 'Mật khẩu phải có ít nhất 8 ký tự')
  .max(72, 'Mật khẩu không được vượt quá 72 ký tự')
  .regex(/[A-Z]/, 'Mật khẩu phải có ít nhất 1 chữ hoa')
  .regex(/[a-z]/, 'Mật khẩu phải có ít nhất 1 chữ thường')
  .regex(/[0-9]/, 'Mật khẩu phải có ít nhất 1 chữ số')
  // refine ĐẶT CUỐI — ZodEffects không chain tiếp được string methods
  .refine(passwordBytesOk, { message: passwordByteLimitMessage });

/**
 * SEC-2b FIX: Email schema dùng chung, normalize input TRƯỚC khi validate.
 *
 * Lý do cần:
 *   - DB column là CITEXT (migrations/0000_init.sql:38) → case-insensitive ở DB level.
 *   - Nhưng Zod `.email()` mặc định KHÔNG trim/lowercase → input " Foo@X.com " (có space)
 *     hoặc "FOO@x.com" (uppercase) bị reject bằng VALIDATION_ERROR.
 *   - Hậu quả: user copy-paste email có space thừa, hoặc iOS auto-capitalize chữ đầu,
 *     → bị reject → confused.
 *
 * Hành vi: trim whitespace 2 đầu + lowercase toàn bộ TRƯỚC khi check format.
 * Đồng bộ với DB CITEXT nên "Foo@X.com" và "foo@x.com" luôn map cùng 1 row.
 *
 * Áp dụng cho mọi schema public nhận email: requestOtp, verifyOtp, resendOtp,
 * login, forgotPassword, resetPassword. (Schema có `auth` middleware như
 * changePassword không cần — user đã authenticated, email không trong payload.)
 */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  // Bug 1 FIX (audit 2026-09-27): RFC 5321 §4.5.3.1.3 giới hạn address-path tối đa
  // 254 octets. Trước fix, schema chỉ `.email()` (regex check format) → chấp nhận
  // email 296+ ký tự → lưu vào DB (CITEXT không giới hạn length), OTP email phải
  // gửi qua SMTP với body cồng kềnh → DoS SMTP / phình index. Đặt max(254) TRƯỚC
  // `.email()` để length check chạy đầu → fail nhanh trước khi tốn regex.
  //
  // Lưu ý: KHÔNG truyền custom message cho `.email()` — errorHandler.ts:46 match theo
  // literal 'Invalid email' (Zod default) → dịch sang 'Email không đúng địch dạng'.
  // Nếu truyền custom, errorHandler fallback về generic 'Dữ liệu không hợp lệ'.
  // Còn `.max()` truyền custom VN message — errorHandler.ts 'too_big' chưa map
  // email → fall through về 'Dữ liệu không hợp lệ' (chấp nhận được, vẫn rõ ràng).
  .max(254, 'Email không được vượt quá 254 ký tự')
  .email();

export const requestOtpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(100),
  role: z.enum(['candidate', 'employer']),
  // F5 FIX: bắt buộc user đồng ý ToS/Privacy ở backend.
  // Trước đây chỉ check ở FE → user bypass được bằng API call trực tiếp.
  // Tuân thủ Nghị định 13/2023 về bảo vệ dữ liệu cá nhân VN.
  agreedToTerms: z.literal(true, {
    errorMap: () => ({ message: 'Bạn phải đồng ý với Điều khoản và Chính sách bảo mật' }),
  }),
});
export const verifyOtpSchema = z.object({
  email: emailSchema,
  otp: z.string().regex(/^\d{6}$/, 'OTP phải gồm 6 chữ số'),
});
export const resendOtpSchema = z.object({
  email: emailSchema,
});
export const loginSchema = z.object({
  email: emailSchema,
  // B4 FIX v2: cùng ràng buộc byte với passwordSchema — chặn input >72 byte
  // tại LOGIN để bcrypt.compare không truncate (1 password = 1 input duy nhất,
  // đóng hoàn toàn silent-truncation ở cả 2 chiều store + compare).
  password: z
    .string()
    .min(1)
    .max(72)
    .refine(passwordBytesOk, { message: passwordByteLimitMessage }),
});
export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export const resetPasswordSchema = z.object({
  email: emailSchema,
  otp: z.string().regex(/^\d{6}$/, 'OTP phải gồm 6 chữ số'),
  newPassword: passwordSchema,
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
  newPassword: passwordSchema,
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
