/**
 * Audit log middleware — ghi log actions nhạy cảm
 */
import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { auditLogs } from '../db/schema';
import { logger } from '../config/logger';

export const auditLog = (action: string) =>
  (req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', async () => {
      if (res.statusCode >= 400) return;
      try {
        await db.insert(auditLogs).values({
          actorId: req.user?.userId ?? null,
          action,
          targetType: (req.params as any)?.id ? 'resource' : null,
          targetId: (req.params as any)?.id ?? null,
          ip: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        });
      } catch (err) {
        logger.warn({ err, action }, 'Audit log failed');
      }
    });
    next();
  };