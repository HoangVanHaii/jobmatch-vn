import { Router } from 'express';
import { authController } from '../controller/auth.controller';
import { auth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  otpRequestRateLimiter,    // S2 FIX: rate limit cho request-otp (chống email bomb)
  otpVerifyRateLimiter,
  otpResendRateLimiter,
  otpForgotRateLimiter,
  otpResetRateLimiter,
  loginRateLimiter,
} from '../middleware/rateLimit';
import { auditLog } from '../middleware/auditLog';
import *as userMiddleware from '../middleware/user';

export const authRouter = Router();

// T3 FIX: apply auditLog cho các actions nhạy cảm để có audit trail khi
// investigate security incident (compromised account, brute-force, etc.).
// Middleware chỉ ghi log khi response status < 400 (success) — không spam
// log với các request bị rate limit / validation fail.
//
// S2 FIX: Mỗi route OTP giờ có rate limiter RIÊNG (xem rateLimit.ts) để tránh
// cross-route interference. Thứ tự middleware: rateLimiter → auditLog → validate
// → controller. Rate limiter chạy đầu tiên để chặn request spam TRƯỚC khi tốn
// bandwidth body parse + schema validate.
authRouter.post(
  '/register/request-otp',
  otpRequestRateLimiter,
  auditLog('USER_REGISTER_REQUEST'),
  validate(userMiddleware.requestOtpSchema),
  authController.registerRequestOtp,
);
authRouter.post(
  '/register/verify-otp',
  otpVerifyRateLimiter,
  auditLog('USER_REGISTER_VERIFY'),
  validate(userMiddleware.verifyOtpSchema),
  authController.registerVerifyOtp,
);
authRouter.post(
  '/register/resend-otp',
  otpResendRateLimiter,
  auditLog('USER_REGISTER_RESEND_OTP'),
  validate(userMiddleware.resendOtpSchema),
  authController.resendOtp,
);
// S2 FIX (trước đó): thêm loginRateLimiter để chặn brute-force password.
authRouter.post(
  '/login',
  loginRateLimiter,
  auditLog('USER_LOGIN'),
  validate(userMiddleware.loginSchema),
  authController.login,
);
authRouter.post('/refresh', auditLog('USER_REFRESH'), validate(userMiddleware.refreshSchema), authController.refresh);
authRouter.post('/logout', auth, auditLog('USER_LOGOUT'), validate(userMiddleware.logoutSchema), authController.logout);
authRouter.post(
  '/forgot-password',
  otpForgotRateLimiter,
  auditLog('USER_FORGOT_PASSWORD'),
  validate(userMiddleware.forgotPasswordSchema),
  authController.forgotPassword,
);
authRouter.post(
  '/reset-password',
  otpResetRateLimiter,
  auditLog('USER_RESET_PASSWORD'),
  validate(userMiddleware.resetPasswordSchema),
  authController.resetPassword,
);
authRouter.post('/change-avatar', auth, validate(userMiddleware.changeAvatarSchema), authController.changeAvatar);
authRouter.post('/change-password', auth, auditLog('USER_CHANGE_PASSWORD'), validate(userMiddleware.changePasswordSchema), authController.changePassword);
authRouter.post('/upsert-profile', auth, authController.upsertProfile);
authRouter.get('/profile', auth, authController.getProfile);
authRouter.put('/soft-delete', auth, auditLog('USER_SOFT_DELETE'), authController.softDeleteAccount);