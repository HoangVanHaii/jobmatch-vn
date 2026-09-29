/**
 * Google OAuth verifier — exchange code, verify id_token, extract profile
 *
 * Audit 2026-09-28 (OAuth provider 500 fix): wrap toàn bộ logic trong try/catch
 * để convert MỌI lỗi từ Google library / network thành AppError có code
 * `OAUTH_PROVIDER_ERROR` (HTTP 502). Trước fix: error rơi xuống catch-all
 * trong errorHandler → 500 INTERNAL_ERROR (misleading: là upstream Google lỗi,
 * không phải server bug).
 */
import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../../middleware/errorHandler';

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

export const googleVerify = async (code: string, codeVerifier: string) => {
  try {
    const { tokens } = await client.getToken({
      code,
      redirect_uri: process.env.GOOGLE_CALLBACK_URL,
      codeVerifier,
    });

    if (!tokens.id_token) {
      throw new AppError(
        502,
        'OAUTH_PROVIDER_ERROR',
        'Google không trả về id_token. Vui lòng thử lại.',
      );
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      throw new AppError(
        502,
        'OAUTH_PROVIDER_ERROR',
        'Google trả về payload không hợp lệ. Vui lòng thử lại.',
      );
    }
    return {
      provider: 'google' as const,
      providerUserId: payload.sub,
      email: payload.email!,
      emailVerified: payload.email_verified ?? false,
      name: payload.name ?? '',
      avatarUrl: payload.picture ?? '',
      rawProfile: payload as unknown as Record<string, unknown>,
    };
  } catch (err) {
    // Đã là AppError → rethrow giữ nguyên (vd: no id_token, invalid payload).
    if (err instanceof AppError) throw err;
    // Lỗi từ Google library / network / timeout → wrap thành 502 OAUTH_PROVIDER_ERROR.
    throw new AppError(
      502,
      'OAUTH_PROVIDER_ERROR',
      'Google OAuth thất bại. Vui lòng thử lại sau.',
    );
  }
};