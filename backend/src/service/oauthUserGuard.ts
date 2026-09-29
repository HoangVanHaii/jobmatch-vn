/**
 * OAuth user-guard helper — tách riêng khỏi oauth.service.ts để:
 *   1. Unit-test được không cần Postgres/Redis (oauth.service import DB/Redis
 *      ngay tại module load → jest test import service sẽ hang).
 *   2. Reuse logic giữa service (login) và các entry point khác nếu sau này có
 *      (vd admin endpoint muốn kiểm tra account có thể OAuth login không).
 *
 * Audit 2026-09-28 follow-up:
 *   - Trước fix: Case 2 (auto-link existing user by email) bypass mọi status check
 *     → banned user có thể bị auto-link oauth_accounts + nhận token (account takeover).
 *   - Sau fix: status gate `assertUserAllowedForLogin` chạy TRƯỚC transaction
 *     → banned/suspended/pending/deleted user bị reject với error code riêng.
 *
 * Status gate — từ chối tất cả OAuth login (cả Case 1 "existing oauth_account"
 * và Case 2 "auto-link via email") nếu user không active.
 *
 * Mapping status → AppError:
 *   - `active`      → return (pass through).
 *   - `pending`     → 403 EMAIL_NOT_VERIFIED
 *   - `banned`      → 403 ACCOUNT_BANNED
 *   - `suspended`   → 403 ACCOUNT_SUSPENDED
 *   - bất kỳ khác   → 403 ACCOUNT_INACTIVE (catch-all)
 *
 * deletedAt có precedence cao nhất (soft-delete → reject bất kể status).
 */
import { AppError } from '../middleware/errorHandler';

/**
 * Provider mà ta gate theo `emailVerified` claim từ OAuth server.
 *
 * Tin cậy `emailVerified`:
 *   - google : CÓ. `google-auth-library` verifyIdToken verify signature + audience;
 *     claim `email_verified` (OIDC ID Token) do Google set boolean — true khi Google
 *     đã verify email (vd Gmail user, hoặc Workspace user được admin accept).
 *   - github : CÓ. `users.listEmailsForAuthenticatedUser` trả `verified: boolean`
 *     GitHub-driven — true khi GitHub đã verify email primary.
 *   - facebook: KHÔNG. Provider hiện hardcode `emailVerified: true` ở
 *     `oauthProviders/facebook.ts:50`. Đây là audit finding F-02 (Medium), chưa
 *     fix — thuộc scope riêng. Khi F-02 được fix, helper này sẽ tự động gate
 *     Facebook mà không cần đổi dòng dưới (đó là lý do giữ 1 helper chung).
 */
export type GuardedProvider = 'google' | 'facebook' | 'github';

export const assertOAuthEmailVerified = (
  provider: GuardedProvider,
  emailVerified: boolean | undefined | null,
): void => {
  if (emailVerified !== true) {
    throw new AppError(
      403,
      'OAUTH_EMAIL_NOT_VERIFIED',
      'OAuth provider chưa xác minh email này. Vui lòng verify email trước khi liên kết tài khoản JobMatch.',
    );
  }
  // Suppress unused parameter warning; provider có thể dùng cho audit log sau này.
  void provider;
};

export const assertUserAllowedForLogin = (user: {
  status: string;
  deletedAt: Date | null | string | undefined;
}): void => {
  if (user.deletedAt) {
    throw new AppError(403, 'ACCOUNT_DELETED', 'Tài khoản đã bị xóa.');
  }
  switch (user.status) {
    case 'active':
      return;
    case 'pending':
      throw new AppError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Email chưa được xác thực. Vui lòng kiểm tra email và nhập mã OTP.',
      );
    case 'banned':
      throw new AppError(
        403,
        'ACCOUNT_BANNED',
        'Tài khoản đã bị cấm. Vui lòng liên hệ hỗ trợ để biết thêm chi tiết.',
      );
    case 'suspended':
      throw new AppError(
        403,
        'ACCOUNT_SUSPENDED',
        'Tài khoản đang bị tạm khóa. Vui lòng liên hệ hỗ trợ để biết thêm chi tiết.',
      );
    default:
      throw new AppError(
        403,
        'ACCOUNT_INACTIVE',
        'Tài khoản không hoạt động. Vui lòng liên hệ hỗ trợ.',
      );
  }
};

/**
 * Quyết định xem OAuth callback có nên trigger flow OTP verification thay vì
 * auto-link/login hay không.
 *
 * Pure function — không side effect, không phụ thuộc DB/Redis. Tách riêng để
 * unit-test được dễ dàng.
 *
 * Trả về `true` khi:
 *   - User tồn tại.
 *   - User chưa bị soft-delete (`deletedAt` = null).
 *   - User `status = 'pending'` — đã đăng ký (password hoặc OAuth completeRegistration
 *     ở Case 3) nhưng chưa verify email qua OTP.
 *
 * Khi `true`:
 *   - Caller KHÔNG được auto-link oauth_accounts (kể cả active provider).
 *   - Caller KHÔNG được issue access/refresh token.
 *   - Caller phải gửi/resend OTP qua `otpService.requestOtp(email, 'register')`
 *     → trả về OAuthCallbackResult với `status: 'PENDING_VERIFICATION'`.
 *   - FE phải redirect thẳng tới /verify-otp?from=register (KHÔNG qua /login)
 *     để user nhập OTP ngay.
 *
 * Khi `false`: caller tiếp tục flow bình thường (assertUserAllowedForLogin +
 * assertOAuthEmailVerified + auto-link).
 *
 * Bảo toàn: User `active`/`banned`/`suspended`/soft-deleted → `false` → behavior
 * không đổi so với trước fix.
 */
export const shouldTriggerPendingVerification = (user: {
  status: string;
  deletedAt: Date | null | string | undefined;
}): boolean => {
  return user.status === 'pending' && !user.deletedAt;
};
