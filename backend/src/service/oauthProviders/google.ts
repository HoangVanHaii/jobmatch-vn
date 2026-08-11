/**
 * Google OAuth verifier — exchange code, verify id_token, extract profile
 */
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

export const googleVerify = async (code: string, codeVerifier: string) => {
  const { tokens } = await client.getToken({
    code,
    redirect_uri: process.env.GOOGLE_CALLBACK_URL,
    codeVerifier,
  });

  if (!tokens.id_token) throw new Error('No id_token from Google');

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload) throw new Error('Invalid id_token payload');
  console.log('Google profile payload:', payload as unknown as Record<string, unknown>);
  return {
    provider: 'google' as const,
    providerUserId: payload.sub,
    email: payload.email!,
    emailVerified: payload.email_verified ?? false,
    name: payload.name ?? '',
    avatarUrl: payload.picture ?? '',
    rawProfile: payload as unknown as Record<string, unknown>,
  };
};