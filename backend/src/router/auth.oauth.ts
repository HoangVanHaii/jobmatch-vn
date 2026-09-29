import { Router } from 'express';
import { auth } from '../middleware/auth';
import { oauthRateLimiter, oauthCompleteRateLimiter } from '../middleware/rateLimit';
import { oauthController } from '../controller/auth.oauth.controller';
import { validate } from '../middleware/validate';
import { completeOAuthSchema } from '../middleware/user';
import { auditLog } from '../middleware/auditLog';

export const authOauthRouter = Router();

// QUAN TRỌNG: route cụ thể (/complete) phải đăng ký TRƯỚC route động (/:provider).
// Nếu đăng ký sau, request POST /auth/oauth/complete sẽ bị `/:provider` bắt
// với provider='complete' → initiate() → getProviderConfig(undefined) → 500.
//
// Thứ tự an toàn: route cụ thể trước, route động sau.
// Mỗi route nhóm có rate limit riêng:
//   - /complete: oauthCompleteRateLimiter (5/min/IP) — chặt vì user có thể spam đổi role
//   - /:provider + /:provider/callback: oauthRateLimiter (10/min/IP) — initiate/callback OAuth
//   - /accounts, /:provider/link, /:provider (DELETE): qua `auth` middleware — đã rate limit theo user
authOauthRouter.post('/complete', auditLog('OAUTH_REGISTRATION_COMPLETE'), oauthCompleteRateLimiter, validate(completeOAuthSchema, 'body'), oauthController.complete);

authOauthRouter.post('/:provider', oauthRateLimiter, oauthController.initiate);
authOauthRouter.post('/:provider/callback', auditLog('OAUTH_CALLBACK'), oauthRateLimiter, oauthController.callback);

authOauthRouter.get('/accounts', oauthRateLimiter, auth, oauthController.listLinked);
authOauthRouter.post('/:provider/link', oauthRateLimiter, auth, oauthController.link);
authOauthRouter.delete('/:provider', oauthRateLimiter, auth, auditLog('OAUTH_UNLINK'), oauthController.unlink);