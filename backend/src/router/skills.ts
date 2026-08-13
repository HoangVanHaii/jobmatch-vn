/**
 * Skills router — full CRUD cho skills master.
 * Mount tại /api/v1/skills (xem router/index.ts).
 *
 * Skills là dữ liệu master do admin quản lý:
 *   - GET (list / by-id / by-slug): optionalAuth — public đọc (admin + employer đều xem).
 *   - POST / PATCH / DELETE: auth + adminOnly.
 *
 * Middleware order theo convention của project:
 *   auth (optionalAuth | auth) → RBAC → validateParam → validateBody/Query → controller.
 *
 * Route order:
 *   /slug/:slug  mount TRƯỚC /:skillId để Express match chính xác "/skills/slug/..." thay vì
 *   nhận `slug/abc` làm `:skillId` (gây 400 invalid UUID).
 */
import { Router } from 'express';
import { auth, optionalAuth, adminOnly } from '../middleware/auth';
import {
  validateCreateSkill,
  validateUpdateSkill,
  validateSkillIdParam,
  validateSkillSlugParam,
} from '../middleware/skills';
import { skillsController } from '../controller/skills.controller';

export const skillsRouter = Router();

// --- Read (public — optionalAuth để controller biết viewer nếu cần) ---
skillsRouter.get('/', optionalAuth, skillsController.getAll);
skillsRouter.get('/slug/:slug', optionalAuth, validateSkillSlugParam, skillsController.getBySlug);
skillsRouter.get('/:skillId', optionalAuth, validateSkillIdParam, skillsController.getById);

// --- Write (admin only) ---
skillsRouter.post('/', auth, adminOnly, validateCreateSkill, skillsController.create);
skillsRouter.patch('/:skillId', auth, adminOnly, validateSkillIdParam, validateUpdateSkill, skillsController.update);
skillsRouter.delete('/:skillId', auth, adminOnly, validateSkillIdParam, skillsController.delete);