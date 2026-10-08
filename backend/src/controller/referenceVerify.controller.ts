/**
 * Reference verification controller — HR endpoints (auth) + public referee
 * endpoints (token-based, KHÔNG JWT).
 */
import { Request, Response, NextFunction } from 'express';
import { referenceVerifyService } from '../service/referenceVerify.service';
import { AppError } from '../middleware/errorHandler';

export const referenceVerifyController = {
  /**
   * GET /application/:applicationId — HR xem referees của application.
   */
  listForApplication: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { applicationId } = req.params as { applicationId: string };
      const data = await referenceVerifyService.listForApplication(
        applicationId,
        userId,
        req.user?.role ?? 'employer',
      );
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /**
   * POST /application/:applicationId/send — HR gửi email xác minh cho 1 referee.
   * Body: { refereeName, refereeEmail, relationship?, company? }
   */
  send: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { applicationId } = req.params as { applicationId: string };
      const { refereeName, refereeEmail, relationship, company } = req.body as {
        refereeName: string;
        refereeEmail: string;
        relationship?: string;
        company?: string;
      };
      const data = await referenceVerifyService.sendVerification(
        { applicationId, refereeName, refereeEmail, relationship, company },
        userId,
        req.user?.role ?? 'employer',
      );
      res.status(201).json({ success: true, data });
    } catch (err) { next(err); }
  },

  /**
   * GET /public/:token — referee mở link → thông tin render form.
   * KHÔNG auth — token là proof-of-access.
   */
  getByToken: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.params as { token: string };
      const data = await referenceVerifyService.getPublicByToken(token);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /**
   * POST /public/:token/submit — referee confirm/decline.
   * Body: { confirmed: boolean, notes? }
   * KHÔNG auth — token là proof-of-access.
   */
  submit: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.params as { token: string };
      const { confirmed, notes } = req.body as { confirmed: boolean; notes?: string };
      if (typeof confirmed !== 'boolean') {
        throw new AppError(400, 'VALIDATION_ERROR', 'confirmed phải là boolean');
      }
      const data = await referenceVerifyService.submitByToken(token, confirmed, notes);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },
};
