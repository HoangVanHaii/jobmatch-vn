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

/**
 * Detect Postgres unique_violation (error code 23505) — xảy ra khi INSERT/UPDATE
 * vi phạm UNIQUE constraint. Trong context register/request-otp, đây là dấu hiệu
 * của race condition giữa 2 concurrent requests cho cùng email mới.
 *
 * Walk qua `cause` chain để handle:
 *   - Direct pg error: err.code === '23505'
 *   - Drizzle wraps trong DrizzleError: err.cause.code === '23505'
 *   - Có thể có extra wrapper layer tùy version.
 */
const isUniqueViolation = (err: unknown): boolean => {
  let cur: any = err;
  // Tránh infinite loop nếu chain có cycle (paranoid)
  const seen = new Set<unknown>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (cur.code === '23505') return true;
    cur = cur.cause ?? cur.original ?? cur.errors?.[0] ?? null;
  }
  return false;
};

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

      // Audit 2026-09-28 follow-up (A2): BAT BUOC throw EMAIL_TAKEN khi user pending.
      // Trước đây cho phép UPDATE passwordHash/role/fullName qua re-register (D1 FIX
      // cũ) — nhưng đây chính là cơ chế account takeover: attacker ghi đè credential
      // của pending user KHONG cần email ownership proof, nạn nhân verify OTP mới
      // (nhận được trong mail của mình) → tài khoản kích hoạt với password của attacker.
      //
      // UX: user pending mất OTP dùng endpoint /auth/register/resend-otp (đã gate
      // status từ A1 fix) — KHÔNG cần re-register form.
      //
      // Vì sao vẫn phân biệt OAuth-only: trả OAUTH_ONLY_ACCOUNT thay vì EMAIL_TAKEN
      // để FE gợi ý "Đăng nhập bằng Google/Facebook/GitHub". User đã OAuth-only
      // cũng không thể "re-register" với password mới (cùng lý do email ownership).
      if (existing) {
        const oauthLinked = existing.metadata?.oauth_linked;
        const hasOAuth = Array.isArray(oauthLinked) && oauthLinked.length > 0;

        if (hasOAuth) {
          throw new AppError(
            409,
            'OAUTH_ONLY_ACCOUNT',
            'Email này đã được đăng ký qua Google/Facebook/GitHub. Vui lòng đăng nhập bằng phương thức đó.',
          );
        }

        // Cả pending và active đều bị chặn re-register. User pending mất OTP →
        // dùng POST /auth/register/resend-otp.
        throw new AppError(
          409,
          'EMAIL_TAKEN',
          'Email đã được đăng ký. Nếu chưa xác thực OTP, vui lòng sử dụng mã đã được gửi tới email hoặc yêu cầu mã mới tại trang xác thực.',
        );
      }

      // User mới hoàn toàn — insert + gửi OTP.
      // BUG #6 FIX: wrap insert + send OTP để cleanup orphan user nếu mailer fail.
      // Trước đây: INSERT user → send OTP (fail) → user row orphan status='pending' vĩnh viễn.
      // Giờ: nếu send OTP fail → xóa user row (sau khi S5 đã rollback OTP).
      try {
        await authService.requestOtp(email, password, fullName, role, agreedAt);
      } catch (insertErr) {
        // NEW FIX: race condition giữa 2 concurrent request-otp cho cùng email MỚI.
        // Cả 2 đều thấy `existing = null` ở line 21 → cả 2 đều thử INSERT → 1 thành công,
        // 1 fail với Postgres 23505 (unique_violation trên cột email). Trước đây lỗi
        // này lọt xuống catch chung ở line 84 → errorHandler → 500 INTERNAL_ERROR.
        //
        // Giờ: detect 23505 và throw REGISTRATION_IN_PROGRESS để user biết phải
        // đợi (do request kia vừa trigger cooldown 60s qua otpService ở line 73).
        //
        // Tại sao KHÔNG dùng Redis lock preemptive:
        //   - Thêm 1 round-trip Redis cho MỌI request-otp (kể cả non-concurrent).
        //   - Phức tạp hơn đáng kể so với catch-after-the-fact.
        //   - Email cooldown key ở otpService vẫn prevent race ở tầng gần hơn (RC-1 fix).
        //   - 23505 catch là 1 dòng + 1 helper → đơn giản, đủ fix bug user-facing.
        //
        // Tại sao KHÔNG return EMAIL_TAKEN:
        //   - User B không thật sự "đã đăng ký" từ trước — user B đang trong quá trình
        //     đăng ký bị conflict bởi request khác. EMAIL_TAKEN misleading.
        //   - RESEND_COOLDOWN cũng không accurate vì user B CHƯA từng nhận OTP cho email này.
        //   - REGISTRATION_IN_PROGRESS truyền đạt đúng: "request khác đang xử lý, đợi vài giây".
        if (isUniqueViolation(insertErr)) {
          throw new AppError(
            409,
            'REGISTRATION_IN_PROGRESS',
            'Email này đang được đăng ký. Vui lòng đợi vài giây rồi thử lại.',
          );
        }
        throw insertErr;
      }
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

      // Audit 2026-09-28 follow-up: KHONG cho verify OTP cho user bi khoa.
      // Banned/suspended phai GIU NGUYEN trang thai, khong duoc flip ve active.
      // Check TRUOC khi consume OTP de khong tieu hao OTP code cho user bi khoa
      // (tranh unlock-by-burn: attacker dot nhieu OTP cho banned user).
      if (user.status === 'banned') {
        throw new AppError(
          403,
          'ACCOUNT_BANNED',
          'Tài khoản đã bị cấm. Vui lòng liên hệ hỗ trợ để biết thêm chi tiết.',
        );
      }
      if (user.status === 'suspended') {
        throw new AppError(
          403,
          'ACCOUNT_SUSPENDED',
          'Tài khoản đang bị tạm khóa. Vui lòng liên hệ hỗ trợ để biết thêm chi tiết.',
        );
      }
      // user.status phai la 'pending' de tiep tuc. Neu la 'active' (race vs ALREADY_VERIFIED)
      // hoac value khac → tu choi som, khong goi verifyEmail (cung co guard o service).
      if (user.status !== 'pending') {
        throw new AppError(
          403,
          'EMAIL_VERIFY_FAILED',
          'Không thể xác thực email ở trạng thái tài khoản hiện tại.',
        );
      }

      await otpService.verifyOtp(email, 'register', otp);
      await authService.verifyEmail(email);

      res.json({ success: true, message: 'Email đã được xác thực. Bạn có thể đăng nhập.' });
    } catch (err) { next(err); }
  },

  resendOtp: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body as { email: string };

      // Audit 2026-09-28 follow-up (C1 FIX): response generic cho mọi trạng thái
      // để chống account enumeration. Trước đây:
      //   - không tồn tại      → 404 USER_NOT_FOUND (lộ: email chưa từng đăng ký)
      //   - pending            → 200 OK                  (lộ: email đã đăng ký, chưa verify)
      //   - đã verify          → 400 ALREADY_VERIFIED    (lộ: email đã verify)
      //   - banned/suspended   → 403 ACCOUNT_BANNED/SUSPENDED (lộ: email bị khoá)
      //
      // Sau fix: TẤT CẢ state trả cùng 200 success + message generic. Chỉ thực sự
      // gọi otpService.requestOtp khi user tồn tại VÀ status='pending' VÀ chưa có
      // cooldown (cooldown do otpService tự check bên trong — nếu cooldown set sẽ
      // throw RESEND_COOLDOWN; ta bắt và cũng trả generic success).
      //
      // Lưu ý: vẫn giữ 1 user-visible warning cho case ALREADY_VERIFIED trong
      // message generic ("nếu tài khoản đã được xác thực, vui lòng đăng nhập")
      // để UX không quá tệ. Kẻ tấn công vẫn có thể đoán được nếu cố tình đăng
      // ký rồi verify, nhưng attack surface giảm đáng kể (không còn 4-way fingerprint).
      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (user && !user.emailVerifiedAt && user.status === 'pending') {
        try {
          await otpService.requestOtp(email, 'register');
        } catch (otpErr) {
          // Cooldown (429) hoặc mailer fail (500) — vẫn trả generic success
          // để không leak. Log chi tiết cho BE team debug.
          const code = (otpErr as any)?.code;
          if (code !== 'RESEND_COOLDOWN') {
            // Không phải cooldown → log error (mailer fail, etc.) nhưng vẫn trả 200
            // cho client để tránh leak; user không nhận được mail nhưng FE sẽ poll
            // resend sau hoặc dùng verify-otp endpoint.
            console.error('[resend-otp] unexpected error:', code, (otpErr as any)?.message);
          }
        }
      }

      res.json({
        success: true,
        message: 'Nếu email tồn tại và chưa được xác thực, mã OTP đã được gửi. Vui lòng kiểm tra hộp thư.',
      });
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
      // Audit 2026-09-28 follow-up (A3b FIX): verifyRefreshToken giờ thực hiện
      // atomic GET+DEL qua Lua (xem jwt.ts) → revokeRefreshToken() KHONG cần gọi
      // thêm từ controller (race window đã đóng ngay trong verify).
      const payload = await verifyRefreshToken(refreshToken);
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

      // Audit 2026-09-28 follow-up (C2 FIX): normalize response time ở mức MIN 500ms.
      // Mục tiêu: existing và non-existing có response time tương đương để chống
      // enumeration qua timing. Logic cũ: nhánh existing làm việc nặng (DB lookup +
      // bcrypt... actually no bcrypt ở đây, chỉ DB + SMTP send), nhánh non-existing
      // set cooldown + delay 500ms. Trong dev với MailHog local, SMTP < 500ms nên
      // existing NHANH HƠN non-existing (verified baseline mean=71ms vs 537ms,
      // delta ~466ms, 0 overlap → attacker phân biệt được).
      //
      // Sau fix: tính elapsed time từ đầu hàm → await Math.max(0, TARGET_MS - elapsed)
      // để TẤT CẢ response kéo dài ít nhất TARGET_MS. Existing cũng phải đợi nếu
      // nhanh hơn; non-existing cũng chờ đủ 500ms như cũ.
      //
      // TARGET_MS = 500ms: cover p99 ~480-600ms production SMTP, không tăng quá
      // nhiều latency cho legit user trong dev (existing từ 71ms → 500ms là đáng
      // chấp nhận cho 1 endpoint ít dùng).
      const TARGET_MS = 500;
      const t0 = Date.now();

      const user = await db.query.users.findFirst({ where: eq(users.email, email) });

      if (user) {
        // Bug 4 FIX (audit 2026-09-27): user OAuth-only (không có passwordHash) không
        // thể reset password qua email — auth.service.resetPassword throw
        // OAUTH_ONLY_ACCOUNT sau khi OTP đã consume. Trước fix: vẫn gửi OTP email
        // → lãng phí SMTP quota + confused UX (nhận mail mà không dùng được) + dễ
        // email-bomb OAuth-only victim. Giờ: skip mail send, vẫn set cooldown để
        // giữ no-enumeration timing nhánh `else` bên dưới (500ms fake delay).
        if (!user.passwordHash) {
          const cooldownKey = `otp:lastsent:reset_password:${email}`;
          if (await redis.exists(cooldownKey)) {
            // Cooldown conflict — vẫn normalize timing.
            const wait = Math.max(0, TARGET_MS - (Date.now() - t0));
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            res.json({ success: true, message: 'Nếu email tồn tại, mã đặt lại mật khẩu đã được gửi' });
            return;
          }
          await redis.setex(cooldownKey, 60, '1');
        } else {
          // User tồn tại + có local password → full OTP flow (set cooldown + generate code + gửi mail).
          try {
            await otpService.requestOtp(email, 'reset_password');
          } catch (e) {
            // Cooldown hoặc mailer fail — vẫn trả generic success sau khi normalize timing.
          }
        }
      } else {
        // User KHÔNG tồn tại → chỉ set cooldown key, KHÔNG gửi mail.
        const cooldownKey = `otp:lastsent:reset_password:${email}`;
        if (!(await redis.exists(cooldownKey))) {
          await redis.setex(cooldownKey, 60, '1');
        }
      }

      // Normalize timing: chờ đến TARGET_MS kể từ đầu hàm.
      const wait = Math.max(0, TARGET_MS - (Date.now() - t0));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      res.json({ success: true, message: 'Nếu email tồn tại, mã đặt lại mật khẩu đã được gửi' });
    } catch (err) { next(err); }
  },

  resetPassword: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, otp, newPassword } = req.body as { email: string; otp: string; newPassword: string };
      // verifyOtp ném lỗi nếu sai/hết hạn/quá lần thử — đây chính là ủy quyền để đặt lại.
      // OAuth-only check + OP-1 rowCount check trong authService.resetPassword.
      // Service throw RESET_FAILED nếu user bị soft-delete giữa findFirst và update
      // (không trả 200 success giả — khác với trước đây).
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