import { Request, Response, NextFunction } from 'express';
import { cvService } from '../service/cv.service';
import type { CreateCvInput } from '../interface/cv';

export const cvController = {
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
			console.log(req.body);
      const cv = await cvService.create(
        req.body as CreateCvInput,
        req.user!.userId,
      );

      res.status(201).json({
        success: true,
        data: cv,
      });
    } catch (err) {
      next(err);
    }
  },
};