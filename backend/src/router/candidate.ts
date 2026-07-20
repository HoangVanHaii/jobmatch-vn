import { Router } from 'express';
import { auth, candidateOnly } from '../middleware/auth';

export const candidateRouter = Router();
candidateRouter.use(auth, candidateOnly);

candidateRouter.get('/profile', (_req, res) => res.json({ success: true, data: null /* TODO */ }));
candidateRouter.patch('/profile', (_req, res) => res.json({ success: true }));
candidateRouter.get('/jobs/recommended', (_req, res) => res.json({ success: true, data: [] }));