/**
 * Candidate controller — endpoints dành riêng cho role='candidate'.
 *
 * Hiện tại: profile (GET/PATCH).
 * Sau này có thể thêm: applied-jobs, saved-jobs, recommended-jobs…
 */
import { Request, Response, NextFunction } from 'express';
import { candidateService } from '../service/candidate.service';
import { AppError } from '../middleware/errorHandler';

export const candidateController = {
  /**
   * GET /candidates/profile — trả full profile của candidate hiện tại.
   *
   * Response: {
   *   email, fullName, avatarUrl, phone, location, social, preferences
   * }
   *
   * - 401: thiếu token (đã được auth middleware catch trước đó).
   * - 404: user không tồn tại (edge case: bị xoá giữa lúc request).
   */
  getProfile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await candidateService.getProfile(userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /candidates/profile — partial update profile của candidate hiện tại.
   *
   * Body: validate qua `updateCandidateProfileSchema` (zod) — chỉ field nào gửi
   * lên mới được update. Empty string → null (clear field).
   *
   * Sau khi update: trả lại profile đầy đủ để FE sync không cần GET lại.
   *
   * - 400: validate fail (BE zod error).
   * - 401: thiếu token.
   */
  updateProfile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await candidateService.updateProfile(userId, req.body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};
