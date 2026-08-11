import { Router } from 'express';
import { authController } from '../controller/auth.controller';
import { auth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { otpRateLimiter } from '../middleware/rateLimit';
import *as userMiddleware from '../middleware/user';

export const authRouter = Router();

authRouter.post('/register/request-otp', validate(userMiddleware.requestOtpSchema), authController.registerRequestOtp);
authRouter.post('/register/verify-otp', otpRateLimiter, validate(userMiddleware.verifyOtpSchema), authController.registerVerifyOtp);
authRouter.post('/register/resend-otp', otpRateLimiter, validate(userMiddleware.resendOtpSchema), authController.resendOtp);
authRouter.post('/login', validate(userMiddleware.loginSchema), authController.login);
authRouter.post('/refresh', validate(userMiddleware.refreshSchema), authController.refresh);
authRouter.post('/logout', auth, validate(userMiddleware.logoutSchema), authController.logout);
authRouter.post('/forgot-password', otpRateLimiter, validate(userMiddleware.forgotPasswordSchema), authController.forgotPassword);
authRouter.post('/reset-password', otpRateLimiter, validate(userMiddleware.resetPasswordSchema), authController.resetPassword);
authRouter.post('/change-avatar', auth, validate(userMiddleware.changeAvatarSchema), authController.changeAvatar);
authRouter.post('/upsert-profile', auth, authController.upsertProfile);
authRouter.get('/profile', auth, authController.getProfile);
authRouter.put('/soft-delete', auth, authController.softDeleteAccount);