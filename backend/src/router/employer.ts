import { Router } from 'express';
import { auth, employerOnly } from '../middleware/auth';

export const employerRouter = Router();
employerRouter.use(auth, employerOnly);

employerRouter.get('/profile', (_req, res) => res.json({ success: true }));
employerRouter.patch('/profile', (_req, res) => res.json({ success: true }));
employerRouter.get('/analytics', (_req, res) => res.json({ success: true, data: {} }));