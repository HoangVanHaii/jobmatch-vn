/**
 * Skills controller — nhận request (đã validate ở middleware) -> gọi service -> trả response.
 * Mỗi hàm tự viết logic (không gộp helper chung) cho dễ đọc.
 * Pattern: try/catch + next(err); response { success, data }.
 *
 * includeDeleted:
 *   - Query param `includeDeleted=true` chỉ admin mới thấy được skill đã soft-delete.
 *   - Controller chuyển viewer role xuống service để service tự quyết định filter.
 */
import { Request, Response, NextFunction } from 'express';
import { skillsService } from '../service/skills.service';
import { AppError } from '../middleware/errorHandler';
import type {
  CreateSkillInput,
  UpdateSkillInput,
} from '../interface/skills';

/** Đọc query param includeDeleted (chỉ áp dụng cho admin). */
const isIncludeDeleted = (req: Request): boolean => {
  const v = (req.query as Record<string, unknown> | undefined)?.includeDeleted;
  return v === 'true' || v === true;
};

export const skillsController = {
  /** GET /skills — danh sách skills active (admin có thể ?includeDeleted=true) */
  getAll: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const items = await skillsService.getAll(
        req.user?.role,
        isIncludeDeleted(req),
      );
      res.json({ success: true, data: items });
    } catch (err) {
      console.error('[skills.getAll] error:', err);
      next(err);
    }
  },

  /** GET /skills/:skillId — chi tiết theo id */
  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { skillId } = req.params as { skillId: string };
      const skill = await skillsService.getById(
        skillId,
        req.user?.role,
        isIncludeDeleted(req),
      );

      if (!skill) throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill not found');

      res.json({ success: true, data: skill });
    } catch (err) {
      console.error('[skills.getById] error:', { skillId: req.params.skillId, err });
      next(err);
    }
  },

  /** GET /skills/slug/:slug — chi tiết theo slug */
  getBySlug: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { slug } = req.params as { slug: string };
      const skill = await skillsService.getBySlug(
        slug,
        req.user?.role,
        isIncludeDeleted(req),
      );

      if (!skill) throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill not found');

      res.json({ success: true, data: skill });
    } catch (err) {
      console.error('[skills.getBySlug] error:', { slug: req.params.slug, err });
      next(err);
    }
  },

  /** POST /skills — admin tạo skill mới */
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const skill = await skillsService.create(req.body as CreateSkillInput);
      res.status(201).json({ success: true, data: skill });
    } catch (err) {
      console.error('[skills.create] error:', { body: req.body, err });
      next(err);
    }
  },

  /** PATCH /skills/:skillId — admin cập nhật skill (chỉ name/slug; status chỉ đổi qua soft-delete) */
  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { skillId } = req.params as { skillId: string };
      const skill = await skillsService.update(skillId, req.body as UpdateSkillInput);

      if (!skill) throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill not found');

      res.json({ success: true, data: skill });
    } catch (err) {
      console.error('[skills.update] error:', { skillId: req.params.skillId, body: req.body, err });
      next(err);
    }
  },

  /** DELETE /skills/:skillId — admin soft-delete skill (set status='deleted') */
  delete: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { skillId } = req.params as { skillId: string };
      const deleted = await skillsService.delete(skillId);

      if (!deleted) throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill not found');

      res.json({ success: true, data: { id: skillId } });
    } catch (err) {
      console.error('[skills.delete] error:', { skillId: req.params.skillId, err });
      next(err);
    }
  },
};