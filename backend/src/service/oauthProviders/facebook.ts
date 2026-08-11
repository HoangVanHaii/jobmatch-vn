/**
 * Facebook OAuth verifier
 */
import axios from 'axios';

export const facebookVerify = async (code: string, codeVerifier: string) => {
  // Đổi code lấy access_token
  const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
    params: {
      client_id: process.env.FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      redirect_uri: process.env.FACEBOOK_CALLBACK_URL,
      code,
      code_verifier: codeVerifier,
    },
  });
  const accessToken = tokenRes.data.access_token;

  // Lấy profile
  const profileRes = await axios.get('https://graph.facebook.com/me', {
    params: { fields: 'id,name,email,picture.type(large)', access_token: accessToken },
  });
  const profile = profileRes.data;

  return {
    provider: 'facebook' as const,
    providerUserId: profile.id,
    email: profile.email,
    emailVerified: true, // Facebook verify email
    name: profile.name,
    avatarUrl: profile.picture?.data?.url ?? '',
    rawProfile: profile,
  };
};