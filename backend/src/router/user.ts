import { Router } from 'express';
import { auth } from '../middleware/auth';
import { db } from '../config/database';
import { users, userProfiles, oauthAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { authService } from '../service/auth.service';
import { searchUsersQuerySchema } from '../middleware/user';
import { validate } from '../middleware/validate';

export const userRouter = Router();

userRouter.use(auth);

/**
 * GET /users/me — trả thông tin user hiện tại + profile (fullName, avatarUrl)
 * + auth methods (hasPassword + linkedProviders).
 *
 * Vì sao JOIN user_profiles:
 *   - Client cần fullName để hiển thị sidebar/onboarding thay vì email.
 *   - userProfiles là nơi chứa fullName + avatarUrl (đã populate từ register form
 *     hoặc OAuth provider). Trả từ DB join 1 query, không cần gọi thêm /users/me/profile.
 *
 * Vì sao trả hasPassword + linkedProviders:
 *   - SettingsView cần biết user đăng nhập bằng local password hay OAuth để:
 *       + Ẩn form đổi mật khẩu với OAuth-only user (không có password cũ để verify).
 *       + Hiển thị "Đăng nhập bằng Google" thay vì "Email và mật khẩu" cho OAuth user.
 *   - `hasPassword = users.passwordHash IS NOT NULL` (signup bằng form, hoặc OAuth user
 *     sau đó set password qua /auth/set-password — hiện tại chưa có flow này nên
 *     OAuth user luôn hasPassword=false).
 *   - `linkedProviders` = list các OAuth provider đã link (vd user link cả Google
 *     + Facebook thì trả cả 2). Mỗi provider 1 row trong oauth_accounts.
 *
 * Response:
 *   { id, email, role, status, fullName, avatarUrl, metadata,
 *     hasPassword, linkedProviders: [{ provider, providerEmail }] }
 *   - fullName/avatarUrl: từ user_profiles, có thể null nếu user chưa cập nhật profile.
 *   - linkedProviders: provider string enum ('google' | 'facebook' | 'github').
 */
userRouter.get('/me', async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        passwordHash: users.passwordHash,
        fullName: userProfiles.fullName,
        avatarUrl: userProfiles.avatarUrl,
        metadata: users.metadata,
      })
      .from(users)
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(eq(users.id, userId));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'User not found');

    // Lấy OAuth providers — query riêng vì 1 user có thể link nhiều provider.
    // Trả provider + providerEmail (vd "ten@gmail.com" hiển thị trong Settings UI).
    const oauths = await db
      .select({
        provider: oauthAccounts.provider,
        providerEmail: oauthAccounts.providerEmail,
      })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId));

    // Strip passwordHash — KHÔNG bao giờ trả về client. Compute hasPassword từ nó.
    const { passwordHash, ...rest } = row;
    res.json({
      success: true,
      data: {
        ...rest,
        hasPassword: !!passwordHash,
        linkedProviders: oauths,
      },
    });
  } catch (err) { next(err); }
});

userRouter.patch('/me', async (req, res, next) => {
  try {
    // TODO: validate input
    const [user] = await db.update(users).set({ updatedAt: new Date() }).where(eq(users.id, req.user!.userId)).returning();
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

userRouter.get('/me/usage', async (req, res, next) => {
  try {
    // TODO: query usage_logs + plan.features
    res.json({ success: true, data: { usage: {}, quota: {} } });
  } catch (err) { next(err); }
});

/**
 * GET /users/search?q=&limit= — tìm user theo fullName để start chat.
 *
 * Response shape (id + fullName + avatarUrl + role only — không leak email/status/metadata).
 * Filter backend: exclude self, active status, chưa soft-delete. Sort theo fullName ASC.
 *
 * Auth: bắt buộc (router.use(auth) phía trên).
 */
userRouter.get(
  '/search',
  validate(searchUsersQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { q, limit } = req.query as unknown as { q: string; limit: number };
      const results = await authService.searchUsers(req.user!.userId, q, limit);
      res.json({ success: true, data: results });
    } catch (err) { next(err); }
  },
);