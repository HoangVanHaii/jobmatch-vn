/**
 * Quota middleware — check user plan + remaining quota
 */
import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { logger } from '../config/logger';

type QuotaKey = 'cv_create' | 'job_apply' | 'ai_chat' | 'ai_cv_parse' | 'ai_cv_score' | 'cover_letter' | 'jd_generate';

export const checkQuota = (key: QuotaKey) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));

    try {
      // TODO: query DB for user's active subscription + plan.features
      // For now, allow all
      next();
    } catch (err) {
      logger.error({ err, key }, 'Quota check failed');
      next(err);
    }
  };