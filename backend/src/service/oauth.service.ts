/**
 * OAuth service — verify token, upsert user, manage oauth_accounts
 */
import crypto from 'crypto';
import { redis } from '../config/redis';
import { db } from '../config/database';
import { oauthAccounts, users } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { googleVerify } from '../ai/../service/oauthProviders/google';
import { facebookVerify } from '../service/oauthProviders/facebook';
import { githubVerify } from '../service/oauthProviders/github';
import { signAccessToken, signRefreshToken } from '../utils/jwt';

type Provider = 'google' | 'facebook' | 'github';

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

  handleCallback: async (provider: Provider, code: string, codeVerifier: string, state: string) => {
    const storedProvider = await redis.get(`oauth:state:${state}`);
    if (!storedProvider || storedProvider !== provider) {
      throw new AppError(400, 'INVALID_STATE', 'OAuth state mismatch or expired');
    }
    await redis.del(`oauth:state:${state}`);
    const profile = await verifyAndGetProfile(provider, code, codeVerifier);
    const result = await upsertUser(profile);
    return result;
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

const upsertUser = async (profile: OAuthProfile) => {
  // Tìm existing oauth_account
  const existing = await db.query.oauthAccounts.findFirst({
    where: and(eq(oauthAccounts.provider, profile.provider), eq(oauthAccounts.providerUserId, profile.providerUserId)),
    with: { user: true },
  });
  let userId: string;
  if (existing) {
    userId = existing.userId;
    // Update last_used_at + raw_profile
    await db.update(oauthAccounts)
      .set({ lastUsedAt: new Date(), rawProfile: profile.rawProfile })
      .where(eq(oauthAccounts.id, existing.id));
  } else {
    // Tìm user theo email
    let user = await db.query.users.findFirst({ where: eq(users.email, profile.email) });
    if (!user) {
      const [created] = await db.insert(users).values({
        email: profile.email,
        role: 'candidate',
        emailVerifiedAt: profile.emailVerified ? new Date() : null,
        metadata: { oauth_linked: [profile.provider], last_login_provider: profile.provider },
      }).returning();
      user = created;
    }
    await db.insert(oauthAccounts).values({
      userId: user.id,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      providerEmail: profile.email,
      rawProfile: profile.rawProfile,
    });
    userId = user.id;
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new AppError(500, 'USER_NOT_FOUND', 'User not found after upsert');

  return {
    user: { id: user.id, email: user.email, role: user.role },
    accessToken: signAccessToken({ userId: user.id, role: user.role as any, email: user.email }),
    refreshToken: signRefreshToken({ userId: user.id, role: user.role as any, email: user.email }),
  };
};

logger.info('OAuth service initialized');