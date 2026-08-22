import { Request, Response, NextFunction } from 'express';
import { cvService } from '../service/cv.service';
import type { CreateCvInput, CreateDirectCvInput, CvSource, UpdateDirectCvInput } from '../interface/cv';
import { AppError } from "../middleware/errorHandler";
import { notificationGateway } from "../socket/notificationGateway";


const requireSelfCandidateId = (req: Request): string => {
  if (!req.user) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }
  return req.user.userId;
};

/**
 * Parse pagination query về number. Zod đã coerce số ở middleware, nhưng
 * TypeScript vẫn nhìn thấy string|undefined — ép kiểu an toàn tại controller.
 */
const toInt = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' ? Number(v) : (typeof v === 'number' ? v : NaN);
  return Number.isFinite(n) ? n : fallback;
};
export const cvController = {
  upload: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cv = await cvService.upload(
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
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const source = req.query.source as CvSource | undefined;
      const limit = toInt(req.query.limit, 10);
      const offset = toInt(req.query.offset, 0);
      const result = await cvService.list(candidateId, source, limit, offset);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[cv.list] error:', err);
      next(err);
    }
  },
  getDetail: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { cvId } = req.params as { cvId: string };
      const cv = await cvService.getDetail(candidateId, cvId);

      if (!cv) {
        throw new AppError(404, 'CV_NOT_FOUND', 'CV not found or already deleted');
      }

      res.json({ success: true, data: cv });
    } catch (err) {
      console.error('[cv.getDetail] error:', err);
      next(err);
    }
  },
  setPrimary: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { cvId } = req.params as { cvId: string };
      const updated = await cvService.setPrimary(candidateId, cvId);

      if (!updated) {
        throw new AppError(404, 'CV_NOT_FOUND', 'CV not found or already deleted');
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      console.error('[cv.setPrimary] error:', err)
      next(err);
    }
  },
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const body = req.body as CreateDirectCvInput;
      const cv = await cvService.create(candidateId, body);
      res.status(201).json({ success: true, data: cv });

    } catch (err) {
      console.error('[cv.create] error:', err);
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { cvId } = req.params as { cvId: string };
      const body = req.body as UpdateDirectCvInput;

      const updated = await cvService.update(candidateId, cvId, body);
      if (!updated) {
        throw new AppError(404, 'CV_NOT_FOUND', 'CV not found or already deleted');
      }

      notificationGateway.emitToUser(candidateId, "cv:status-changed", {
        cvId,
        status: updated.status,
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      console.error('[cv.update] error:', err);
      next(err);
    }
  },
  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
			const { cvId } = req.params as { cvId: string };

			const deleted = await cvService.softDelete(cvId, candidateId);

			if (!deleted) {
				throw new AppError(404, "CV_NOT_FOUND", 'CV not found or already deleted');
			}
			res.json({ success: true, data: deleted });
      
    } catch (err) {
      console.error('[cv.remove] error:', err);
      next(err);
    }
  },
};