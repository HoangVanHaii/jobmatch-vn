/**
 * OAuth controller — handle Google/Facebook/GitHub flow
 */
import { Request, Response, NextFunction } from 'express';
import { oauthService } from '../service/oauth.service';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { completeOAuthSchema } from '../middleware/user';

type Provider = 'google' | 'facebook' | 'github';

export const oauthController = {
  /** Bắt đầu OAuth flow — generate state, trả authorization URL */
  initiate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const provider = req.params.provider as Provider;
      const { codeChallenge } = (req.body ?? {}) as { codeChallenge?: string };
      const { url, state } = await oauthService.initiate(provider, codeChallenge);
      // Lưu state vào cookie/Redis để verify khi callback
      res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 5 * 60 * 1000 });
      res.json({ success: true, data: { url } });
    } catch (err) { next(err); }
  },

  /**
   * Xử lý callback — đổi code lấy token, verify, upsert user.
   *
   * Response shape (discriminated union by `status`):
   *   - EXISTING_USER → { status, user, accessToken, refreshToken } → FE login thẳng
   *   - NEW_USER      → { status, pendingToken, profile } → FE redirect tới /select-role
   *
   * Frontend phải check `status` trước khi xử lý tiếp.
   */
  callback: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const provider = req.params.provider as Provider;
      const { code, codeVerifier } = req.body;
      const state = req.cookies?.oauth_state;
      if (!code || !state || !codeVerifier) {
        throw new AppError(400, 'INVALID_CALLBACK', 'Missing code, state, or codeVerifier');
      }
      const result = await oauthService.handleCallback(provider, code, codeVerifier, state);
      res.clearCookie('oauth_state');
      res.json({ success: true, data: result });
    } catch (err: any) {console.error(err.message); next(err); }
  },

  /**
   * POST /auth/oauth/complete — hoàn tất đăng ký OAuth user mới với Role đã chọn.
   *
   * Body: { pendingToken: string, role: 'candidate' | 'employer' }
   * Auth: không cần — pendingToken đã là proof-of-intent (đã được verify OAuth
   *       lúc callback và lưu trong Redis với TTL 10 phút).
   *
   * Response: giống login thường — { user, accessToken, refreshToken }.
   *
   * Errors:
   *   - 400 INVALID_PENDING_TOKEN: pendingToken hết hạn hoặc không tồn tại.
   *   - 409 EMAIL_TAKEN: email đã được đăng ký bởi user khác (race condition).
   */
  complete: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { pendingToken, role } = req.body as { pendingToken: string; role: 'candidate' | 'employer' };
      const result = await oauthService.completeRegistration(pendingToken, role);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  /** List các OAuth đã link */
  listLinked: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const accounts = await oauthService.listLinked(req.user!.userId);
      res.json({ success: true, data: accounts });
    } catch (err) { next(err); }
  },

  /** Link thêm OAuth vào account đang login */
  link: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const provider = req.params.provider as Provider;
      const { code, codeVerifier } = req.body;
      const result = await oauthService.link(req.user!.userId, provider, code, codeVerifier);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  /** Unlink OAuth khỏi account */
  unlink: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const provider = req.params.provider as Provider;
      await oauthService.unlink(req.user!.userId, provider);
      res.json({ success: true });
    } catch (err) { next(err); }
  },
};