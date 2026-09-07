import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { redis } from '../config/redis';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { signAccessToken, signRefreshToken, verifyRefreshToken, revokeRefreshToken } from '../utils/jwt';
import { otpService } from '../service/otp.service';
import { authService } from '../service/auth.service';
import bcrypt from 'bcrypt';

export const authController = {
  registerRequestOtp: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password, fullName, role } = req.body as {
        email: string;
        password: string;
        fullName: string;
        role: 'candidate' | 'employer';
      };
      const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

      // BUG #2 FIX: lấy timestamp consent từ request body để persist vào users.metadata.
      // FE đã validate agreedToTerms === true qua Zod schema → đảm bảo user đồng ý.
      const agreedAt = new Date().toISOString();

      // D1 FIX: Nếu user đã tồn tại nhưng đangở status='pending' (chưa verify)
      // và CHƯA link OAuth → cho phép đăng ký lại bằng cách UPDATE + gửi OTP mới.
      // Trước đây: throw EMAIL_TAKEN → user mất email vĩnh viễn nếu không verify
      // được OTP lần đầu (email bounce, spam, F5 nhầm, mất email).
      if (existing) {
        const isPending = existing.status === 'pending';
        const oauthLinked = existing.metadata?.oauth_linked;
        const hasOAuth = Array.isArray(oauthLinked) && oauthLinked.length > 0;

        if (hasOAuth) {
          // User đã OAuth-only → throw OAUTH_ONLY_ACCOUNT thay vì EMAIL_TAKEN generic
          // để FE hiển thị thông báo rõ ràng + gợi ý dùng nút Google/GitHub/Facebook.
          throw new AppError(
            409,
            'OAUTH_ONLY_ACCOUNT',
            'Email này đã được đăng ký qua Google/Facebook/GitHub. Vui lòng đăng nhập bằng phương thức đó.',
          );
        }

        if (!isPending) {
          // User đã verify + có password local → không cho đăng ký lại.
          throw new AppError(409, 'EMAIL_TAKEN', 'Email đã được đăng ký');
        }

        // User pending + không OAuth → UPDATE + gửi OTP mới.
        const passwordHash = await bcrypt.hash(password, 12);
        await authService.updatePendingUser(existing.id, passwordHash, role, fullName, agreedAt);
        // UX FIX: clear cooldown trước khi gọi requestOtp. Nếu không clear, user re-register
        // ngay (do OTP cũ expired) sẽ bị RESEND_COOLDOWN vì cooldown key còn từ lần trước.
        // User đã chọn re-register → intent rõ ràng → bypass cooldown.
        await redis.del(`otp:lastsent:register:${email}`);
        await otpService.requestOtp(email, 'register');

        res.status(201).json({
          success: true,
          message: 'Mã xác thực mới đã được gửi đến email của bạn. Vui lòng kiểm tra và nhập mã để hoàn tất đăng ký.',
        });
        return;
      }

      // User mới hoàn toàn — insert + gửi OTP.
      // BUG #6 FIX: wrap insert + send OTP để cleanup orphan user nếu mailer fail.
      // Trước đây: INSERT user → send OTP (fail) → user row orphan status='pending' vĩnh viễn.
      // Giờ: nếu send OTP fail → xóa user row (sau khi S5 đã rollback OTP).
      await authService.requestOtp(email, password, fullName, role, agreedAt);
      try {
        await otpService.requestOtp(email, 'register');
      } catch (otpErr) {
        // S5 đã rollback OTP + cooldown. Giờ rollback user row để tránh orphan.
        await db.delete(users).where(eq(users.email, email));
        throw otpErr;
      }

      res.status(201).json({
        success: true,
        message: 'Đăng ký thành công. Vui lòng kiểm tra email và nhập mã OTP để xác thực tài khoản.'
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
      // verifyOtp ném lỗi nếu sai/hết hạn/quá lần thử — đây chính là ủy quyền để đặt lại.
      // OAuth-only check trong authService.resetPassword chạy SAU → nếu user OAuth-only,
      // OTP đã bị consume nhưng password không đổi. User có thể request OTP mới (60s cooldown)
      // nhưng không thể reset password vì OAuth-only. Trade-off: attacker có thể waste 5 OTP attempts
      // nhưng rate-limit đã block sau đó. Acceptable.
      await otpService.verifyOtp(email, 'reset_password', otp);
      await authService.resetPassword(email, newPassword);
      res.json({ success: true, message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập.' });
    } catch (err) { next(err); }
  },
  changeAvatar: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
      const avatarUrl = req.body.avatarUrl as string;
      await authService.changeAvatar(userId, avatarUrl);
      res.json({ success: true, message: 'Cập nhật avatar thành công' });
    } catch (err) { next(err); }
  },
  /**
   * POST /auth/change-password — đổi mật khẩu cho user đang đăng nhập.
   * Yêu cầu `auth` middleware (route) + `changePasswordSchema` validation.
   */
  changePassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };
      await authService.changePassword(userId, currentPassword, newPassword);
      res.json({ success: true, message: 'Đổi mật khẩu thành công' });
    } catch (err) { next(err); }
  },
  upsertProfile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
      const { fullName, phone, location, social, preference } = req.body;
      await authService.upsertProfile(userId, { fullName, phone, location, social, preference });
      res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) { next(err); }
  },
  getProfile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
      const data = await authService.getProfile(userId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },
  softDeleteAccount: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
      await authService.softDeleteAccount(userId);
      res.json({ success: true, message: 'Account soft-deleted successfully' });
    } catch (err) { next(err); }
  }
};