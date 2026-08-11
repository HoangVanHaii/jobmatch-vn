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
    // Replace với parsed (coerced) data.
    // Express 5: req.query / req.params là getter read-only trên prototype và
    // recompute mỗi lần truy cập → mutate in-place không persist. Dùng defineProperty
    // tạo own property (shadow getter) để controller đọc đúng parsed data.
    Object.defineProperty(req, source, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };