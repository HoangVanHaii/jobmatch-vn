/**
 * Pure helper — quyết định redirect target khi F5 / reload / paste-URL mất
 * `pendingVerifyEmail` tại `/verify-otp`.
 *
 * Tách riêng thành pure function để:
 *   1. Unit-test không cần mount component (VerifyOtpView.vue).
 *   2. Tài liệu hóa decision tree cho 2 flow:
 *        - Password register: /verify-otp?from=register        → /register
 *        - Google OAuth pending: /verify-otp?from=register&oauth=pending
 *                                                              → /login
 *        - Login OTP (legacy "Xác thực ngay" từ LoginView):    → /login
 *        - Paste bare URL (không có flag):                       → /login (fallback)
 *
 * Input là `route.query`-style object. Chỉ quan tâm 2 key:
 *   - `oauth`: nếu === 'pending' → Google OAuth pending flow.
 *   - `from` : 'login' | 'register' | undefined → flow gốc của session verify.
 *
 * KHÔNG đụng vào email (PII) — chỉ check non-PII flags để phân biệt 2 flow.
 * Pinia store vẫn giữ `pendingVerifyEmail` in-memory (xem stores/auth.ts:55-74).
 */
export type VerifyOtpRedirectTarget = 'login' | 'register';

export type VerifyOtpQuery = {
  oauth?: string | null;
  from?: string | null;
};

/**
 * Decision tree:
 *   1. `oauth === 'pending'` (Google OAuth pending OTP) → /login
 *   2. `from === 'register'` (Password registration OTP) → /register
 *   3. Fallback (`from=login` hoặc null — vd paste bare URL) → /login
 *
 * Lý do Google OAuth pending dẫn về /login (không /register):
 *   - User đã có account (đăng ký qua OAuth trước đó). Recovery path là login
 *     (qua Google button hoặc password sau khi set). Đẩy về /register sẽ gây
 *     confused — user tưởng phải đăng ký mới.
 *
 * Lý do Password registration dẫn về /register:
 *   - User đang giữa flow đăng ký. Sau F5, họ cần nhập lại form đăng ký. Đẩy
 *     về /login sẽ yêu cầu "đăng nhập" trong khi họ chưa có account — sai UX.
 */
export const decideF5RedirectTarget = (query: VerifyOtpQuery): VerifyOtpRedirectTarget => {
  // Rule 1: oauth=pending có precedence cao nhất.
  if (query.oauth === 'pending') return 'login';

  // Rule 2: from=register mà không có oauth=pending → password register flow.
  if (query.from === 'register') return 'register';

  // Rule 3: from=login, hoặc paste bare URL — vào /login (session expired standard).
  return 'login';
};

/**
 * Message phù hợp theo redirect target.
 * Tách riêng để dễ test + localize sau này.
 */
export const decideF5Message = (target: VerifyOtpRedirectTarget): string => {
  if (target === 'register') {
    return 'Phiên xác minh đã hết hạn. Vui lòng đăng ký lại để tiếp tục.';
  }
  return 'Phiên xác minh đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.';
};
