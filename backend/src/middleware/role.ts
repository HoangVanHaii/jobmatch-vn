/**
 * Role-based middleware — check user role
 */
import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

export const requireRole = (...roles: Array<'candidate' | 'employer' | 'admin'>) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', `Requires role: ${roles.join(', ')}`));
    }
    next();
  };

export const candidateOnly = requireRole('candidate');
export const employerOnly = requireRole('employer');
export const adminOnly = requireRole('admin');
export const candidateOrEmployer = requireRole('candidate', 'employer');