/**
 * candidateSkill controller — nhận request (đã validate ở middleware) →
 * gọi service → trả response.
 *
 * Authorization model (sau khi refactor):
 *   - Tất cả 6 API đều là self-service — candidateId = req.user.userId
 *     (LUÔN từ JWT, KHÔNG BAO GIỜ từ URL hay body).
 *   - Không có admin route riêng cho resource này (admin nếu cần xem candidate
 *     có thể dùng route admin/candidates/:id tổng quát — ngoài scope).
 *
 * Controller KHÔNG tin tưởng req.params/body cho candidateId. Helper
 * `requireSelfCandidateId` throw 401 nếu chưa auth.
 */
import { Request, Response, NextFunction } from 'express';
import { candidateSkillService } from '../service/candidateSkill.service';
import { AppError } from '../middleware/errorHandler';
import type {
  AddCandidateSkillByNameInput,
  CreateCandidateSkillInput,
  UpdateCandidateSkillInput,
} from '../interface/candidateSkill';

/** Helper: lấy candidateId từ req.user.userId. Throw 401 nếu chưa auth. */
const requireSelfCandidateId = (req: Request): string => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return req.user.userId;
};

export const candidateSkillController = {
  /**
   * GET /me/skills
   * Trả danh sách skills của chính mình (kèm skill info JOIN).
   */
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const items = await candidateSkillService.listByCandidate(candidateId);
      res.json({ success: true, data: items });
    } catch (err) {
      console.error('[candidateSkill.list] error:', { userId: req.user?.userId, err });
      next(err);
    }
  },

  /**
   * GET /me/skills/:skillId
   * Trả 1 candidate_skill (kèm skill info). 404 nếu không tồn tại.
   */
  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { skillId } = req.params as { skillId: string };
      const item = await candidateSkillService.getOne(candidateId, skillId);

      if (!item) {
        throw new AppError(404, 'CANDIDATE_SKILL_NOT_FOUND', 'Candidate skill not found');
      }

      res.json({ success: true, data: item });
    } catch (err) {
      console.error('[candidateSkill.getById] error:', { userId: req.user?.userId, err });
      next(err);
    }
  },

  /**
   * POST /me/skills
   * Body: { skillId, level? }. Trả 201 + row vừa tạo.
   * 404 nếu skillId không tồn tại / đã soft-delete.
   * 409 nếu candidate đã có skill này.
   */
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const body = req.body as Omit<CreateCandidateSkillInput, 'candidateId'>;
      const row = await candidateSkillService.create(candidateId, body);
      res.status(201).json({ success: true, data: row });
    } catch (err) {
      console.error('[candidateSkill.create] error:', { userId: req.user?.userId, body: req.body, err });
      next(err);
    }
  },

  /**
   * POST /me/skills/by-name
   * Body: { name, level? }. Lookup + insert idempotent.
   * Trả 200 (không phải 201) vì có thể là no-op:
   *   - { added: true, row }          → vừa insert
   *   - { added: false, reason: ... } → skill_not_found | duplicate
   */
  addByName: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const body = req.body as AddCandidateSkillByNameInput;
      const result = await candidateSkillService.addByName(candidateId, body);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[candidateSkill.addByName] error:', { userId: req.user?.userId, body: req.body, err });
      next(err);
    }
  },

  /**
   * PATCH /me/skills/:skillId
   * Body: { level? }. Trả row sau update. 404 nếu không tồn tại.
   */
  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { skillId } = req.params as { skillId: string };
      const body = req.body as UpdateCandidateSkillInput;
      const row = await candidateSkillService.update(candidateId, skillId, body);

      if (!row) {
        throw new AppError(404, 'CANDIDATE_SKILL_NOT_FOUND', 'Candidate skill not found');
      }

      res.json({ success: true, data: row });
    } catch (err) {
      console.error('[candidateSkill.update] error:', { userId: req.user?.userId, body: req.body, err });
      next(err);
    }
  },

  /**
   * DELETE /me/skills/:skillId
   * Trả { id } nếu xoá được. 404 nếu không tồn tại.
   */
  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { skillId } = req.params as { skillId: string };
      const removed = await candidateSkillService.remove(candidateId, skillId);

      if (!removed) {
        throw new AppError(404, 'CANDIDATE_SKILL_NOT_FOUND', 'Candidate skill not found');
      }

      res.json({ success: true, data: { id: skillId } });
    } catch (err) {
      console.error('[candidateSkill.remove] error:', { userId: req.user?.userId, err });
      next(err);
    }
  },
};