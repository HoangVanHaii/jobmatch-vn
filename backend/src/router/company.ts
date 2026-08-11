/**
 * Company router — full CRUD + lifecycle status
 * Mount tại /api/companies (xem router/index.ts)
 */
import { Router } from 'express';
import { auth, optionalAuth, adminOnly } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import {
  validateCreateCompany,
  validateUpdateCompany,
  validateUpdateCompanyStatus,
  validateListCompanies,
  validateCompanyIdParam,
} from '../middleware/company';
import { requireCompanyOwnerOrAdmin } from '../middleware/companyMember';
import { companyController } from '../controller/company.controller';

export const companyRouter = Router();

// Employer + Admin mới được tạo công ty (sau đó sẽ là owner)
const createCompany = [auth, requireRole('employer', 'admin')];

companyRouter.get('/', optionalAuth, validateListCompanies, companyController.list);
companyRouter.get('/by-slug/:slug', optionalAuth, companyController.getBySlug);
companyRouter.get('/:id', optionalAuth, validateCompanyIdParam, companyController.getById);

// --- Tạo (employer | admin) — controller tự insert owner vào company_members ---
companyRouter.post('/', ...createCompany, validateCreateCompany, companyController.create);

// --- Sửa (owner active HOẶC admin) ---
companyRouter.patch('/:id', auth, validateCompanyIdParam, requireCompanyOwnerOrAdmin, validateUpdateCompany, companyController.update,);

// --- Lifecycle status (admin only) ---
companyRouter.patch('/:id/status', auth, validateCompanyIdParam, adminOnly, validateUpdateCompanyStatus, companyController.updateStatus);
