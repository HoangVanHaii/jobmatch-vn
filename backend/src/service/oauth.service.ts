/**
 * OAuth service — verify token, defer user creation for new users, manage oauth_accounts
 */
import crypto from 'crypto';
import { redis } from '../config/redis';
import { db } from '../config/database';
import { oauthAccounts, users, userProfiles } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { googleVerify } from '../ai/../service/oauthProviders/google';
import { facebookVerify } from '../service/oauthProviders/facebook';
import { githubVerify } from '../service/oauthProviders/github';
import { signAccessToken, signRefreshToken } from '../utils/jwt';
import { otpService } from './otp.service';
import { assertUserAllowedForLogin, assertOAuthEmailVerified, shouldTriggerPendingVerification } from './oauthUserGuard';

// Re-export để backward-compatible: code khác (nếu có) import `assertUserAllowedForLogin`
// từ oauth.service vẫn hoạt động. Source of truth là `oauthUserGuard.ts`.
export { assertUserAllowedForLogin, assertOAuthEmailVerified, shouldTriggerPendingVerification } from './oauthUserGuard';

type Provider = 'google' | 'facebook' | 'github';
type Role = 'candidate' | 'employer';

interface OAuthProfile {
  provider: Provider;
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string;
  rawProfile: Record<string, unknown>;
}

const STATE_TTL_SECONDS = 300;

/** TTL cho pending OAuth registration trong Redis (10 phút).
 *  Đủ để user chọn Role + submit form; quá hạn phải restart OAuth flow. */
const PENDING_TTL_SECONDS = 600;

/**
 * Callback result — discriminated union, FE phải check `status` rồi dispatch.
 *
 *   - EXISTING_USER        → User đã active + OAuth identity hợp lệ → setTokens + login.
 *   - NEW_USER             → OAuth login lần đầu với email CHƯA có trong DB → defer
 *                            pendingToken → user chọn Role ở /select-role → completeRegistration.
 *   - PENDING_VERIFICATION → User match theo email/oauth_account nhưng status='pending'
 *                            (chưa verify OTP) → BE đã gửi/resend OTP, FE redirect thẳng
 *                            tới /verify-otp?from=register, KHÔNG qua /login.
 */
export type OAuthCallbackResult =
  | {
      status: 'EXISTING_USER';
      user: { id: string; email: string; role: 'candidate' | 'employer' | 'admin' };
      accessToken: string;
      refreshToken: string;
    }
  | {
      status: 'NEW_USER';
      pendingToken: string;
      profile: { name: string; email: string; avatarUrl: string; provider: Provider };
    }
  | {
      status: 'PENDING_VERIFICATION';
      email: string;
    };

/** Profile summary lưu trong Redis cho pending OAuth. */
interface PendingOAuthRegistration {
  provider: Provider;
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string;
  rawProfile: Record<string, unknown>;
}

export const oauthService = {
  initiate: async (provider: Provider, codeChallenge?: string): Promise<{ url: string; state: string }> => {
    const state = crypto.randomBytes(32).toString('hex');
    await redis.setex(`oauth:state:${state}`, STATE_TTL_SECONDS, provider);
    const config = getProviderConfig(provider);
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      state,
      scope: config.scopes.join(' '),
      response_type: 'code',
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    const url = `${config.authorizeUrl}?${params.toString()}`;
    return { url, state };
  },

  handleCallback: async (
    provider: Provider,
    code: string,
    codeVerifier: string,
    state: string,
  ): Promise<OAuthCallbackResult> => {
    const storedProvider = await redis.get(`oauth:state:${state}`);
    if (!storedProvider || storedProvider !== provider) {
      throw new AppError(400, 'INVALID_STATE', 'OAuth state mismatch or expired');
    }
    await redis.del(`oauth:state:${state}`);
    const profile = await verifyAndGetProfile(provider, code, codeVerifier);
    return await upsertOrDefer(profile);
  },

  /**
   * Hoàn tất đăng ký OAuth user mới sau khi user đã chọn Role.
   *
   * Flow:
   *   1. Lấy profile từ Redis theo pendingToken (throw nếu không có / hết hạn).
   *   2. Trong 1 transaction: insert users (với role do user chọn) + insert
   *      user_profiles (fullName/avatarUrl từ provider) + insert oauth_accounts.
   *   3. Xoá pending khỏi Redis (single-use).
   *   4. Trả về user + access/refresh tokens (giống login thường).
   *
   * Nếu pendingToken không hợp lệ → throw 400 INVALID_PENDING_TOKEN.
   * Nếu email đã được claim bởi pendingToken khác / user khác → DB unique
   * constraint văng 23505, transaction rollback sạch.
   */
  completeRegistration: async (
    pendingToken: string,
    role: Role,
  ): Promise<{
    user: { id: string; email: string; role: 'candidate' | 'employer' | 'admin' };
    accessToken: string;
    refreshToken: string;
  }> => {
    const key = `oauth:pending:${pendingToken}`;
    const raw = await redis.get(key);
    if (!raw) {
      throw new AppError(400, 'INVALID_PENDING_TOKEN', 'Phiên đăng ký OAuth đã hết hạn. Vui lòng thử lại.');
    }
    const pending = JSON.parse(raw) as PendingOAuthRegistration;

    const result = await db.transaction(async (tx) => {
      // Email đã có user chưa? (case user khác register trước bằng email-password)
      const existing = await tx.query.users.findFirst({ where: eq(users.email, pending.email) });
      if (existing) {
        throw new AppError(
          409,
          'EMAIL_TAKEN',
          'Email này đã được đăng ký. Vui lòng đăng nhập bằng tài khoản hiện có.',
        );
      }

      const [created] = await tx
        .insert(users)
        .values({
          email: pending.email,
          role,
          status: pending.emailVerified ? 'active' : 'pending',
          emailVerifiedAt: pending.emailVerified ? new Date() : null,
          metadata: { oauth_linked: [pending.provider], last_login_provider: pending.provider },
        })
        .returning();
      if (!created) {
        throw new AppError(500, 'USER_INSERT_FAILED', 'Failed to create user');
      }

      const trimmedName = pending.name?.trim() || null;
      const avatarUrl = pending.avatarUrl?.trim() || null;
      await tx.insert(userProfiles).values({
        userId: created.id,
        fullName: trimmedName,
        avatarUrl,
      });

      await tx.insert(oauthAccounts).values({
        userId: created.id,
        provider: pending.provider,
        providerUserId: pending.providerUserId,
        providerEmail: pending.email,
        rawProfile: pending.rawProfile,
      });

      return created;
    });

    // Đã tạo user thành công → consume pendingToken (không cho dùng lại).
    await redis.del(key);

    // Audit 2026-09-28 follow-up (A5 FIX): pending user (provider không verify email
    // — vd Facebook emailVerified=false, GitHub primary unverified) KHONG được
    // cấp access/refresh token. Lý do:
    //   - JWT auth middleware chi verify signature, KHONG check user.status → access
    //     token cho pending user có hiệu lực full authenticated API.
    //   - verifyRefreshToken (sau A3b fix) có check status, NHƯNG pending user
    //     không cần refresh — access token JWT_ACCESS_EXPIRES_IN đủ dài cho mọi
    //     endpoint không yêu cầu refresh.
    //   - User chưa chứng minh email ownership qua provider → chưa đủ tư cách
    //     authenticated. Phải verify email qua OTP trước.
    //
    // Sau fix: trigger OTP → throw 403 EMAIL_NOT_VERIFIED với email. FE catch error
    // → set pendingVerifyEmail → redirect /verify-otp?from=register (cùng pattern
    // với PENDING_VERIFICATION trong OAuth callback Case 1/2).
    if (!pending.emailVerified) {
      try {
        await otpService.requestOtp(pending.email, 'register');
      } catch (mailErr) {
        logger.warn(
          { email: pending.email, err: mailErr },
          'A5 FIX: failed to send OTP for pending OAuth user — user can retry via resend-otp',
        );
      }
      throw new AppError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Email chưa được xác thực bởi nhà cung cấp OAuth. Mã OTP đã được gửi tới email của bạn, vui lòng xác thực để hoàn tất đăng ký.',
      );
    }

    return {
      user: { id: result.id, email: result.email, role: result.role as 'candidate' | 'employer' | 'admin' },
      accessToken: signAccessToken({
        userId: result.id,
        role: result.role as any,
        email: result.email,
      }),
      refreshToken: signRefreshToken({
        userId: result.id,
        role: result.role as any,
        email: result.email,
      }),
    };
  },

  listLinked: async (userId: string) => {
    const accounts = await db.query.oauthAccounts.findMany({
      where: eq(oauthAccounts.userId, userId),
      columns: { id: true, provider: true, providerEmail: true, linkedAt: true, lastUsedAt: true },
    });
    return accounts;
  },

  link: async (userId: string, provider: Provider, code: string, codeVerifier: string) => {
    const profile = await verifyAndGetProfile(provider, code, codeVerifier);
    await db.insert(oauthAccounts).values({
      userId,
      provider,
      providerUserId: profile.providerUserId,
      providerEmail: profile.email,
      rawProfile: profile.rawProfile,
    }).onConflictDoUpdate({
      target: [oauthAccounts.provider, oauthAccounts.providerUserId],
      set: { providerEmail: profile.email, rawProfile: profile.rawProfile, lastUsedAt: new Date() },
    });
    return { provider, linked: true };
  },

  unlink: async (userId: string, provider: Provider) => {
    await db.delete(oauthAccounts).where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)));
  },
};

/**
 * Status gate (`assertUserAllowedForLogin`) đã được tách sang `oauthUserGuard.ts`
 * để unit-test được không cần DB/Redis. Xem file đó để biết logic + mapping status → error.
 *
 * Helper vẫn được re-export từ `oauth.service` (dòng import) cho backward compat.
 */

const getProviderConfig = (provider: Provider) => {
  switch (provider) {
    case 'google':
      return {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        callbackUrl: process.env.GOOGLE_CALLBACK_URL!,
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        scopes: ['openid', 'email', 'profile'],
      };
    case 'facebook':
      return {
        clientId: process.env.FACEBOOK_APP_ID!,
        callbackUrl: process.env.FACEBOOK_CALLBACK_URL!,
        authorizeUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
        scopes: ['email', 'public_profile'],
      };
    case 'github':
      return {
        clientId: process.env.GITHUB_CLIENT_ID!,
        callbackUrl: process.env.GITHUB_CALLBACK_URL!,
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        scopes: ['read:user', 'user:email'],
      };
  }
};

const verifyAndGetProfile = async (provider: Provider, code: string, codeVerifier: string): Promise<OAuthProfile> => {
  switch (provider) {
    case 'google': return googleVerify(code, codeVerifier);
    case 'facebook': return facebookVerify(code, codeVerifier);
    case 'github': return githubVerify(code, codeVerifier);
  }
};

/**
 * Decide sau OAuth verify:
 *   - OAuth account đã tồn tại (đã link từ trước) → trả tokens luôn, login thẳng.
 *   - User email đã tồn tại (đăng ký email-password trước, giờ bấm Google)
 *     → link OAuth vào user hiện có + login thẳng.
 *   - User hoàn toàn mới → KHÔNG tạo user ngay. Lưu profile vào Redis với
 *     pendingToken (TTL 10 phút) → trả về status=NEW_USER + pendingToken.
 *     User sẽ chọn Role ở /select-role, rồi gọi completeRegistration để hoàn tất.
 *
 * Tại sao defer (không tạo user ngay):
 *   - Trước đây hardcode role='candidate' → vi phạm quyền user chọn Role
 *     (đặc biệt employer muốn đăng ký qua Google).
 *   - Cho user chọn Role trước rồi mới tạo user với role đúng.
 *   - Pending token chỉ là 1 opaque string trong Redis — KHÔNG chứa credential
 *     nhạy cảm, chỉ reference profile data đã verify từ provider.
 */
/**
 * Reuse API đã có — send OTP `purpose='register'` cho user đang pending.
 *
 * Bypass cooldown (clear key `otp:lastsent:register:<email>`) vì:
 *   - User đã chọn OAuth flow → intent rõ ràng là muốn verify email, không phải
 *     spam. Tương tự logic ở `authController.registerRequestOtp` khi re-register.
 *   - Có thể user vừa register xong rồi thử OAuth liền → cooldown 60s sẽ chặn.
 *
 * Side effects:
 *   - Clear Redis cooldown key.
 *   - Generate OTP mới, store Redis (TTL 5 phút).
 *   - Send email.
 *   - Throw nếu OTP send fail (`EMAIL_SEND_FAILED`) — caller propagate cho
 *     errorHandler → user FE thấy message VN.
 */
const sendOtpForPendingVerification = async (email: string): Promise<void> => {
  await redis.del(`otp:lastsent:register:${email}`);
  await otpService.requestOtp(email, 'register');
};

const upsertOrDefer = async (profile: OAuthProfile): Promise<OAuthCallbackResult> => {
  // Case 1: oauth_account đã tồn tại → refresh last_used_at, login thẳng.
  const existingAccount = await db.query.oauthAccounts.findFirst({
    where: and(eq(oauthAccounts.provider, profile.provider), eq(oauthAccounts.providerUserId, profile.providerUserId)),
  });
  if (existingAccount) {
    await db.update(oauthAccounts)
      .set({ lastUsedAt: new Date(), rawProfile: profile.rawProfile })
      .where(eq(oauthAccounts.id, existingAccount.id));

    const user = await db.query.users.findFirst({ where: eq(users.id, existingAccount.userId) });
    if (!user) throw new AppError(500, 'USER_NOT_FOUND', 'User not found for existing OAuth account');

    // ─── PENDING → trigger OTP (audit 2026-09-28 follow-up) ──────────────
    // User đã link OAuth từ trước nhưng status='pending' (chưa verify email qua
    // OTP). Trước fix: throw 403 EMAIL_NOT_VERIFIED → FE redirect /login → user
    // confused vì tưởng OAuth login fail.
    //
    // Sau fix: gọi `sendOtpForPendingVerification` để resend OTP → trả về
    // `PENDING_VERIFICATION` cho FE → FE set pending email + redirect thẳng
    // tới /verify-otp?from=register. User nhập OTP → status='active' → bấm
    // Google lại → vào Case 1 active → login bình thường.
    //
    // Lưu ý: KHÔNG tự động bypass OTP. pending PHẢI verify qua OTP để chuyển
    // status='active'. assertUserAllowedForLogin dưới đây throw cho banned/
    // suspended/deleted; pending đã handle ở trên nên helper không vào pending.
    if (shouldTriggerPendingVerification(user)) {
      await sendOtpForPendingVerification(user.email);
      return {
        status: 'PENDING_VERIFICATION',
        email: user.email,
      };
    }

    // BUG #1 FIX: check user.status ngay tại OAuth callback để tránh bypass.
    // Trước đây: user bị ban/suspend mà đã link OAuth từ trước → vẫn OAuth login
    // thành công → nhận access token mới → ~15 phút hoạt động trước khi refresh fail.
    // Giờ: check status + deletedAt trước khi issue token (dùng helper chung).
    //
    // NOTE: Audit 2026-09-28 follow-up — refactor sang helper `assertUserAllowedForLogin`
    // để thống nhất giữa Case 1 + Case 2 và phân loại error code cụ thể theo status
    // (ACCOUNT_BANNED / ACCOUNT_SUSPENDED / ACCOUNT_INACTIVE). Lý do chuyển helper:
    //   - Tránh lệch logic giữa 2 case (audit đã từng flag Case 2 bypass).
    //   - Khi thêm status mới (vd 'locked'), fix 1 chỗ.
    assertUserAllowedForLogin(user);

    return {
      status: 'EXISTING_USER',
      user: { id: user.id, email: user.email, role: user.role as 'candidate' | 'employer' | 'admin' },
      accessToken: signAccessToken({ userId: user.id, role: user.role as any, email: user.email }),
      refreshToken: signRefreshToken({ userId: user.id, role: user.role as any, email: user.email }),
    };
  }

  // Case 2: User email đã tồn tại (đăng ký email-password trước, giờ OAuth login)
  // → link OAuth vào user hiện có + backfill fullName/avatarUrl nếu rỗng, login thẳng.
  const existingUserByEmail = await db.query.users.findFirst({ where: eq(users.email, profile.email) });
  if (existingUserByEmail) {
    // ─── PENDING → trigger OTP (audit 2026-09-28 follow-up) ──────────────
    // Đây là scenario chính của directive: user đã đăng ký email-password nhưng
    // chưa verify OTP (status='pending'), giờ thử login Google cùng email.
    //
    // Trước fix: Case 2 sẽ throw EMAIL_NOT_VERIFIED (qua assertUserAllowedForLogin)
    // → FE redirect /login → user mất context OAuth flow.
    //
    // Sau fix: detect pending trước status gate → gọi `sendOtpForPendingVerification`
    // để resend OTP → trả `PENDING_VERIFICATION` cho FE → FE redirect thẳng tới
    // /verify-otp?from=register (KHÔNG qua /login) → user nhập OTP → active → bấm
    // Google lại lần nữa → Case 2 active → auto-link + login.
    //
    // KHÔNG tạo user mới, KHÔNG link oauth_accounts, KHÔNG issue token. Status
    // của user VẪN 'pending' — chỉ khi verify OTP thành công mới chuyển 'active'.
    if (shouldTriggerPendingVerification(existingUserByEmail)) {
      await sendOtpForPendingVerification(existingUserByEmail.email);
      return {
        status: 'PENDING_VERIFICATION',
        email: existingUserByEmail.email,
      };
    }

    // ─── STATUS GATE (audit 2026-09-28 F-01/F-03/F-07 follow-up) ───────
    // Trước fix: Case 2 KHÔNG check status → banned / suspended / pending / deleted
    // user đều bị auto-link oauth_accounts + cấp token (account takeover).
    //
    // Sau fix: dùng helper chung `assertUserAllowedForLogin` để:
    //   1. Banned user → throw 403 ACCOUNT_BANNED, KHÔNG insert oauth_accounts,
    //      KHÔNG issue access/refresh token, KHÔNG touch status (vẫn `banned`).
    //   2. Suspended → 403 ACCOUNT_SUSPENDED, tương tự.
    //   3. Pending → 403 EMAIL_NOT_VERIFIED (giống Case 1).
    //   4. Soft-deleted → 403 ACCOUNT_DELETED.
    //   5. Active → pass và tiếp tục auto-link + login thẳng.
    //
    // Gate đặt TRƯỚC transaction và TRƯỚC oauth_accounts INSERT → đảm bảo không
    // có side-effect nào trên DB khi user không đủ tư cách.
    //
    // Business rule:
    //   - Password → Google auto-link vẫn hoạt động cho user `active` (rule 1).
    //   - Auto-link bị chặn với user `banned/suspended/pending/deleted` (rule mới).
    assertUserAllowedForLogin(existingUserByEmail);

    // ─── EMAIL-VERIFIED GATE (audit 2026-09-28 F-01 follow-up) ───────────
    // Trước fix: Case 2 KHÔNG check `profile.emailVerified` → attacker chiếm
    //   account bằng cách OAuth với email victim mà KHÔNG cần verify email trên
    //   provider. Với Google: `googleVerify` đã verify JWT signature + audience
    //   qua `google-auth-library`; `payload.email_verified` (OIDC standard) do
    //   Google set boolean, đáng tin cậy.
    //
    // Sau fix: yêu cầu `profile.emailVerified === true` cho mọi provider trước
    //   khi auto-link vào account password hiện có. Nếu false → throw 403
    //   OAUTH_EMAIL_NOT_VERIFIED → user phải verify email trên provider, hoặc
    //   dùng cách khác để chứng minh ownership.
    //
    // Gate đặt SAU status gate (status check trước) nhưng TRƯỚC transaction
    //   oauth_accounts INSERT → đảm bảo không có side-effect nào trên DB khi
    //   email không được verify.
    //
    // Lưu ý Facebook: hiện hardcode `emailVerified: true` ở
    //   `oauthProviders/facebook.ts:50` (audit F-02 Medium, ngoài scope directive
    //   này). Helper vẫn được gọi để Facebook — khi F-02 fix xong, gate tự động
    //   enforce mà không cần đổi code Case 2.
    assertOAuthEmailVerified(profile.provider, profile.emailVerified);

    await db.transaction(async (tx) => {
      // Link oauth_account (dùng onConflictDoNothing để tránh race condition).
      await tx
        .insert(oauthAccounts)
        .values({
          userId: existingUserByEmail.id,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          providerEmail: profile.email,
          rawProfile: profile.rawProfile,
        })
        .onConflictDoNothing();

      // Backfill fullName/avatarUrl nếu profile đang rỗng.
      const trimmedName = profile.name?.trim() || null;
      const avatarUrl = profile.avatarUrl?.trim() || null;
      const existingProfile = await tx.query.userProfiles.findFirst({
        where: eq(userProfiles.userId, existingUserByEmail.id),
      });
      if (!existingProfile) {
        await tx.insert(userProfiles).values({
          userId: existingUserByEmail.id,
          fullName: trimmedName,
          avatarUrl,
        });
      } else {
        const updates: { fullName?: string | null; avatarUrl?: string | null } = {};
        if (!existingProfile.fullName && trimmedName) updates.fullName = trimmedName;
        if (!existingProfile.avatarUrl && avatarUrl) updates.avatarUrl = avatarUrl;
        if (Object.keys(updates).length > 0) {
          await tx.update(userProfiles).set(updates).where(eq(userProfiles.userId, existingUserByEmail.id));
        }
      }
    });

    return {
      status: 'EXISTING_USER',
      user: {
        id: existingUserByEmail.id,
        email: existingUserByEmail.email,
        role: existingUserByEmail.role as 'candidate' | 'employer' | 'admin',
      },
      accessToken: signAccessToken({
        userId: existingUserByEmail.id,
        role: existingUserByEmail.role as any,
        email: existingUserByEmail.email,
      }),
      refreshToken: signRefreshToken({
        userId: existingUserByEmail.id,
        role: existingUserByEmail.role as any,
        email: existingUserByEmail.email,
      }),
    };
  }

  // Case 3: User hoàn toàn mới → defer, chờ user chọn Role.
  const pendingToken = crypto.randomBytes(32).toString('hex');
  const pending: PendingOAuthRegistration = {
    provider: profile.provider,
    providerUserId: profile.providerUserId,
    email: profile.email,
    emailVerified: profile.emailVerified,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    rawProfile: profile.rawProfile,
  };
  await redis.setex(`oauth:pending:${pendingToken}`, PENDING_TTL_SECONDS, JSON.stringify(pending));

  return {
    status: 'NEW_USER',
    pendingToken,
    profile: {
      name: profile.name ?? '',
      email: profile.email,
      avatarUrl: profile.avatarUrl ?? '',
      provider: profile.provider,
    },
  };
};

logger.info('OAuth service initialized');