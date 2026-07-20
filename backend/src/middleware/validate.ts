/**
 * Zod validate middleware
 */
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(result.error);
    }
    // Replace với parsed (coerced) data
    (req as any)[source] = result.data;
    next();
  };