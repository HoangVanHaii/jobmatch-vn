/**
 * GitHub OAuth verifier
 *
 * Audit 2026-09-28 (OAuth provider 500 fix): wrap toàn bộ logic trong try/catch
 * để convert MỌI lỗi từ GitHub API / network thành AppError có code
 * `OAUTH_PROVIDER_ERROR` (HTTP 502). Trước fix: error rơi xuống catch-all
 * trong errorHandler → 500 INTERNAL_ERROR.
 */
import axios from 'axios';
import { Octokit } from '@octokit/rest';
import { AppError } from '../../middleware/errorHandler';

export const githubVerify = async (code: string, codeVerifier: string) => {
  try {
    // Đổi code lấy access_token
    const tokenRes = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_CALLBACK_URL,
        code_verifier: codeVerifier,
      },
      { headers: { Accept: 'application/json' } },
    );
    const accessToken = tokenRes.data.access_token;
    if (!accessToken) {
      throw new AppError(
        502,
        'OAUTH_PROVIDER_ERROR',
        'GitHub không trả về access_token. Vui lòng thử lại.',
      );
    }

    const octokit = new Octokit({ auth: accessToken });
    const { data: user } = await octokit.users.getAuthenticated();
    if (!user?.id) {
      throw new AppError(
        502,
        'OAUTH_PROVIDER_ERROR',
        'GitHub trả về user không hợp lệ. Vui lòng thử lại.',
      );
    }
    const { data: emails } = await octokit.users.listEmailsForAuthenticatedUser({ visibility: 'public' });
    const primaryEmail = emails.find((e) => e.primary)?.email ?? user.email ?? '';

    return {
      provider: 'github' as const,
      providerUserId: user.id.toString(),
      email: primaryEmail,
      emailVerified: !!emails.find((e) => e.primary && e.verified),
      name: user.name ?? user.login,
      avatarUrl: user.avatar_url,
      rawProfile: { user, emails } as Record<string, unknown>,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      502,
      'OAUTH_PROVIDER_ERROR',
      'GitHub OAuth thất bại. Vui lòng thử lại sau.',
    );
  }
};