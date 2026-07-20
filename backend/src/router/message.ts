import { Router } from 'express';
import { auth } from '../middleware/auth';

export const messageRouter = Router();
messageRouter.use(auth);

messageRouter.get('/conversations', (_req, res) => res.json({ success: true, data: [] }));
messageRouter.get('/conversations/:id/messages', (_req, res) => res.json({ success: true, data: [] }));
messageRouter.post('/conversations/:id/messages', (_req, res) => res.json({ success: true }));