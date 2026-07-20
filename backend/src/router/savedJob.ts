import { Router } from 'express';
import { auth } from '../middleware/auth';

export const savedJobRouter = Router();
savedJobRouter.use(auth);

savedJobRouter.get('/', (_req, res) => res.json({ success: true, data: [] }));
savedJobRouter.post('/', (_req, res) => res.json({ success: true }));
savedJobRouter.delete('/:jobId', (_req, res) => res.json({ success: true }));