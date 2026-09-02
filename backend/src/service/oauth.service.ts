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

/** Callback result: existing user → tokens; new user → pendingToken + profile preview. */
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