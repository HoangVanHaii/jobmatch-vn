import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { signAccessToken, signRefreshToken, verifyRefreshToken, revokeRefreshToken } from '../utils/jwt';
import { otpService } from '../service/otp.service';
import { authService } from '../service/auth.service';

export const authController = {
  registerRequestOtp: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password, role } = req.body as { email: string; password: string; role: 'candidate' | 'employer' };
      const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (existing) throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered');
     
      await authService.requestOtp(email, password, role);
     
      await otpService.requestOtp(email, 'register');
      
      res.status(201).json({
        success: true,
        message: 'User registered successfully. Please verify your email with the OTP sent.'
      });
    } catch (err) { next(err); }
  },
  registerVerifyOtp: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, otp } = req.body as { email: string; otp: string };
      const user = await db.query.users.findFirst({ where: eq(users.email, email) });

      if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản');
      if (user.emailVerifiedAt) throw new AppError(400, 'ALREADY_VERIFIED', 'Email đã được xác thực');

      await otpService.verifyOtp(email, 'register', otp); 
      await authService.verifyEmail(email); 

      res.json({ success: true, message: 'Email đã được xác thực. Bạn có thể đăng nhập.' });
    } catch (err) { next(err); }
  },

  resendOtp: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body as { email: string };
      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản');
      if (user.emailVerifiedAt) throw new AppError(400, 'ALREADY_VERIFIED', 'Email đã được xác thực');

      await otpService.requestOtp(email, 'register'); 

      res.json({ success: true, message: 'Mã OTP mới đã được gửi tới email của bạn' });
    } catch (err) { next(err); }
  },

  login: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const user = await authService.verifyPassword(email, password);
      const payload = { userId: user.id, role: user.role as any, email: user.email };
      res.json({
        success: true,
        data: {
          user: { id: user.id, email: user.email, role: user.role },
          accessToken: signAccessToken(payload),
          refreshToken: signRefreshToken(payload),
        },
      });
    } catch (err) { next(err); }
  },

  refresh: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body as { refreshToken: string };
      const payload = await verifyRefreshToken(refreshToken);
      await revokeRefreshToken(refreshToken);
      const newPayload = { userId: payload.userId, role: payload.role, email: payload.email };
      res.json({
        success: true,
        data: {
          accessToken: signAccessToken(newPayload),
          refreshToken: signRefreshToken(newPayload),
        },
      });
    } catch (err) { next(err); }
  },

  logout: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body as { refreshToken: string };
      if (refreshToken) await revokeRefreshToken(refreshToken);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  forgotPassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body as { email: string };
      const user = await db.query.users.findFirst({ where: eq(users.email, email) });

      if (user) await otpService.requestOtp(email, 'reset_password');
      res.json({ success: true, message: 'Nếu email tồn tại, mã đặt lại mật khẩu đã được gửi' });
    } catch (err) { next(err); }
  },

  resetPassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, otp, newPassword } = req.body as { email: string; otp: string; newPassword: string };
      // verifyOtp ném lỗi nếu sai/hết hạn/quá lần thử — đây chính là ủy quyền để đặt lại
      await otpService.verifyOtp(email, 'reset_password', otp);
      await authService.resetPassword(email, newPassword);
      res.json({ success: true, message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập.' });
    } catch (err) { next(err); }
  },
  changeAvatar: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const avatarUrl = req.body.avatarUrl as string;
      await authService.changeAvatar(userId, avatarUrl);
      res.json({ success: true, message: 'Avatar updated successfully' });
    } catch (err) { next(err); }
  },
  upsertProfile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { fullName, phone, location, social, preference } = req.body;
      await authService.upsertProfile(userId, { fullName, phone, location, social, preference });
      res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) { next(err); }
  },
  getProfile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const data = await authService.getProfile(userId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },
  softDeleteAccount: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      await authService.softDeleteAccount(userId);
      res.json({ success: true, message: 'Account soft-deleted successfully' });
    } catch (err) { next(err); }
  }
};