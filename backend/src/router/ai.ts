import { Router } from 'express';
import { auth } from '../middleware/auth';
import { uploadMiddleware } from '../middleware/upload';
import { aiController } from '../controller/ai.controller';
import { checkQuota } from '../middleware/quota';

export const aiRouter = Router();

aiRouter.use(auth);

aiRouter.post('/chat', checkQuota('ai_chat'), aiController.chat);
aiRouter.post('/cv/parse', checkQuota('ai_cv_parse'), uploadMiddleware.single('file'), aiController.parseCv);
aiRouter.post('/cv/score', checkQuota('ai_cv_score'), aiController.scoreCv);
aiRouter.post('/jd/generate', checkQuota('jd_generate'), aiController.generateJd);
aiRouter.post('/cover-letter', checkQuota('cover_letter'), aiController.generateCoverLetter);