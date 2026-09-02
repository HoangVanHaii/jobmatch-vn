import { Router } from 'express';
import { auth } from '../middleware/auth';
import { oauthRateLimiter } from '../middleware/rateLimit';
import { oauthController } from '../controller/auth.oauth.controller';
import { validate } from '../middleware/validate';
import { completeOAuthSchema } from '../middleware/user';

export const authOauthRouter = Router();

authOauthRouter.use(oauthRateLimiter);

// QUAN TRỌNG: route cụ thể (/complete) phải đăng ký TRƯỚC route động (/:provider).
// Nếu đăng ký sau, request POST /auth/oauth/complete sẽ bị `/:provider` bắt
// với provider='complete' → initiate() → getProviderConfig(undefined) → 500.
//
// Thứ tự an toàn: route cụ thể trước, route động sau.
authOauthRouter.post('/complete', validate(completeOAuthSchema, 'body'), oauthController.complete);

authOauthRouter.post('/:provider', oauthController.initiate);
authOauthRouter.post('/:provider/callback', oauthController.callback);

authOauthRouter.get('/accounts', auth, oauthController.listLinked);
authOauthRouter.post('/:provider/link', auth, oauthController.link);
authOauthRouter.delete('/:provider', auth, oauthController.unlink);