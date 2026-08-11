import { Router } from 'express';
import { auth } from '../middleware/auth';
import { oauthRateLimiter } from '../middleware/rateLimit';
import { oauthController } from '../controller/auth.oauth.controller';

export const authOauthRouter = Router();

authOauthRouter.use(oauthRateLimiter);

authOauthRouter.post('/:provider', oauthController.initiate);
authOauthRouter.post('/:provider/callback', oauthController.callback);
authOauthRouter.get('/accounts', auth, oauthController.listLinked);
authOauthRouter.post('/:provider/link', auth, oauthController.link);
authOauthRouter.delete('/:provider', auth, oauthController.unlink);