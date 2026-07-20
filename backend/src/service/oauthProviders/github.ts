/**
 * GitHub OAuth verifier
 */
import axios from 'axios';
import { Octokit } from '@octokit/rest';

export const githubVerify = async (code: string, _codeVerifier: string) => {
  // Đổi code lấy access_token
  const tokenRes = await axios.post(
    'https://github.com/login/oauth/access_token',
    {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_CALLBACK_URL,
    },
    { headers: { Accept: 'application/json' } },
  );
  const accessToken = tokenRes.data.access_token;

  const octokit = new Octokit({ auth: accessToken });
  const { data: user } = await octokit.users.getAuthenticated();
  const { data: emails } = await octokit.users.listEmails({ visibility: 'public' });
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
};