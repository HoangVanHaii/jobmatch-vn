/**
 * Facebook OAuth verifier
 *
 * Audit 2026-09-28 (OAuth provider 500 fix): wrap toàn bộ logic trong try/catch
 * để convert MỌI lỗi từ Facebook API / network thành AppError có code
 * `OAUTH_PROVIDER_ERROR` (HTTP 502). Trước fix: error rơi xuống catch-all
 * trong errorHandler → 500 INTERNAL_ERROR.
 */
import axios from 'axios';
import { AppError } from '../../middleware/errorHandler';

export const facebookVerify = async (code: string, codeVerifier: string) => {
  try {
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
    if (!accessToken) {
      throw new AppError(
        502,
        'OAUTH_PROVIDER_ERROR',
        'Facebook không trả về access_token. Vui lòng thử lại.',
      );
    }

    // Lấy profile
    const profileRes = await axios.get('https://graph.facebook.com/me', {
      params: { fields: 'id,name,email,picture.type(large)', access_token: accessToken },
    });
    const profile = profileRes.data;
    if (!profile?.id) {
      throw new AppError(
        502,
        'OAUTH_PROVIDER_ERROR',
        'Facebook trả về profile không hợp lệ. Vui lòng thử lại.',
      );
    }

    return {
      provider: 'facebook' as const,
      providerUserId: profile.id,
      email: profile.email,
      // F-02 FIX (audit 2026-09-28 follow-up):
      // Facebook Graph API KHÔNG expose email-level verification flag.
      //   - Field `verified` trên User reference là ACCOUNT-level verification
      //     (register mobile / confirm SMS / enter valid credit card) — đã deprecated
      //     và không phải email ownership confirmation. Xem
      //     https://developers.facebook.com/docs/graph-api/reference/user
      //   - Field `email_verified` KHÔNG tồn tại trong documented User fields.
      //   - Endpoint `/me?fields=email` trả về address nhưng KHÔNG kèm flag
      //     cho biết user đã confirm ownership email đó hay chưa.
      //
      // Trước fix: hardcode `true` cho phép attacker tạo Facebook account với email
      //   bất kỳ (kể cả victim), OAuth callback pass mọi gate → auto-link + chiếm
      //   account (audit 2026-09-28 F-01 + F-02).
      //
      // Sau fix: set `false` để khớp thực tế API. Từ đó helper
      //   `assertOAuthEmailVerified()` ở oauth.service.ts Case 2 sẽ tự động
      //   reject — KHÔNG cần đổi code service. Password account `active` +
      //   Facebook cùng email sẽ throw 403 OAUTH_EMAIL_NOT_VERIFIED.
      //
      // Hệ quả:
      //   - Case 1 (user đã link Facebook từ trước): KHÔNG liên quan tới flag này
      //     vì quyết định dựa trên (provider, provider_user_id) unique key,
      //     KHÔNG đụng emailVerified. Existing Facebook-linked user vẫn login OK.
      //   - Case 3 (user mới hoàn toàn qua Facebook): defer → completeRegistration,
      //     user chọn Role → tạo user với status='pending' (vì emailVerified=false).
      //     Vẫn cần verify email qua OTP để activate. Đúng behavior.
      emailVerified: false,
      name: profile.name,
      avatarUrl: profile.picture?.data?.url ?? '',
      rawProfile: profile,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      502,
      'OAUTH_PROVIDER_ERROR',
      'Facebook OAuth thất bại. Vui lòng thử lại sau.',
    );
  }
};