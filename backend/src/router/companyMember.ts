/**
 * CompanyMember router — nested dưới /companies/:id/members
 * Mount tại /companies (xem router/index.ts)
 *
 * Nghiệp vụ: 1 công ty CHỈ CÓ 1 OWNER DUY NHẤT.
 *   - POST /:id/transfer-owner: chuyển ownership (atomic swap).
 */
import { Router } from 'express';
import { auth } from '../middleware/auth';
import {
  validateAddCompanyMember,
  validateUpdateCompanyMember,
  validateTransferOwner,
  validateCompanyMemberParams,
  validateCompanyIdParam,
  validateCompanyIdOnlyParam,
  requireCompanyOwner,
  requireCompanyOwnerOrAdmin,
} from '../middleware/companyMember';
import { companyMemberController } from '../controller/companyMember.controller';

export const companyMemberRouter = Router({ mergeParams: true });

// Tất cả endpoint đều cần đăng nhập
companyMemberRouter.use(auth);

// --- List (cần auth, không cần owner) ---
companyMemberRouter.get(
  '/:id/members',
  validateCompanyIdParam,
  companyMemberController.list,
);

// --- Transfer ownership owner — mount TRƯỚC POST /:id/members để match chính xác ---
companyMemberRouter.post(
  '/:id/transfer-owner',
  validateCompanyIdParam,
  requireCompanyOwner,
  validateTransferOwner,
  companyMemberController.transferOwner,
);

// --- Add member (chỉ owner) ---
companyMemberRouter.post(
  '/:id/members',
  validateCompanyIdParam,
  requireCompanyOwner,
  validateAddCompanyMember,
  companyMemberController.add,
);

// --- Update member (chỉ owner) ---
companyMemberRouter.patch(
  '/:companyId/members/:userId',
  validateCompanyMemberParams,
  requireCompanyOwner,
  validateUpdateCompanyMember,
  companyMemberController.update,
);

// --- Member tự accept lời mời (chỉ cần auth) ---
companyMemberRouter.post(
  '/:companyId/members/me/accept',
  validateCompanyIdOnlyParam,
  companyMemberController.acceptInvite,
);
