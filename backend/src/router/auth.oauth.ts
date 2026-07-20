/**
 * OAuth router — Google, Facebook, GitHub
 * PKCE flow cho SPA
 */
import { Router } from 'express';
import { auth } from '../middleware/auth';
import { oauthRateLimiter } from '../middleware/rateLimit';
import { oauthController } from '../controller/auth.oauth.controller';

export const authOauthRouter = Router();

authOauthRouter.use(oauthRateLimiter);

// Bắt đầu flow — backend generate state, trả authorization URL
authOauthRouter.get('/:provider', oauthController.initiate);
// Callback từ provider (server-side flow) hoặc SPA gửi code+verifier (PKCE flow)
authOauthRouter.post('/:provider/callback', oauthController.callback);
// List các OAuth đã link (cần auth)
authOauthRouter.get('/accounts', auth, oauthController.listLinked);
// Link thêm OAuth vào account hiện tại
authOauthRouter.post('/:provider/link', auth, oauthController.link);
// Unlink OAuth
authOauthRouter.delete('/:provider', auth, oauthController.unlink);