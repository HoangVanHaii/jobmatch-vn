import { Router } from 'express';
import { auth } from '../middleware/auth';
import { messageController } from '../controller/message';

export const messageRouter = Router();
messageRouter.use(auth);
// Mount tại /api/v1/messages
messageRouter.post('/conversations', messageController.create);
messageRouter.get('/conversations', messageController.list);
messageRouter.get('/conversations/:id/messages', messageController.listMessages);
// TODO: wire khi sẵn sàng
messageRouter.post('/conversations/:id/messages', (_req, res) => res.json({ success: true }));