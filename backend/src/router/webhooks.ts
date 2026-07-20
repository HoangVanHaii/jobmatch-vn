import { Router } from 'express';
import { logger } from '../config/logger';

export const webhooksRouter = Router();

// PayOS webhook
webhooksRouter.post('/payos', async (req, res) => {
  // TODO: verify signature, update subscription
  logger.info({ body: req.body }, 'PayOS webhook received');
  res.json({ success: true });
});