/**
 * CompanyMember router — full invite lifecycle endpoints.
 * Mount tại /companies (xem router/index.ts).
 *
 * Lifecycle:
 *   POST   /companies/me/invitations                            (list pending của user)
 *   GET    /companies/:companyId/members                        (list members)
 *   POST   /companies/:companyId/members/invite                (owner invite / re-invite)
 *   POST   /companies/:companyId/members/:userId/accept        (user accept)
 *   POST   /companies/:companyId/members/:userId/decline       (user decline)
 *   DELETE /companies/:companyId/members/:userId                (owner remove — soft delete)
 *   POST   /companies/:companyId/members/:userId/leave         (user tự rời)
 *
 * Auth + guards:
 *   - Tất cả endpoints cần `auth` (user đã đăng nhập).
 *   - Owner endpoints: `requireCompanyOwner`.
 *   - User endpoints (accept/decline/leave): `requireActiveMember` + controller check userId.
 */
import { Router } from 'express';
import { auth } from '../middleware/auth';
import {
  validateInviteMember,
  validateCompanyMemberUserParams,
  validateCompanyIdParams,
  requireCompanyOwner,
  requireActiveMember,
} from '../middleware/companyMember';
import { companyMemberController } from '../controller/companyMember.controller';

export const companyMemberRouter = Router({ mergeParams: true });

// Tất cả endpoints đều cần đăng nhập
companyMemberRouter.use(auth);

/* ============================================================================
 * /companies/me/invitations — mount TRƯỚC /:companyId/members/* để match chính xác
 * ==========================================================================*/
companyMemberRouter.get(
  '/me/invitations',
  companyMemberController.listMyInvitations,
);

/* ============================================================================
 * POST /companies/:companyId/members — alias ngược của /members/invite.
 *
 * Mount TRƯỚC `/members/invite` để match exact `/members` (nếu không sẽ bị
 * route `/members/invite` chỉ match `/members/X` chứ không match exact
 * `/members`).
 *
 * Tại sao có alias này:
 *   - FE cũ đang gọi POST /:companyId/members (thiết kế cũ) → 404.
 *   - URL mới POST /:companyId/members/invite (clean hơn).
 *   - Alias này cho phép FE cũ work mà không cần đổi code ngay.
 *   - Sau khi FE refactor, có thể xoá route này.
 *
 * Body giống hệt /members/invite: { email, role? }
 * ==========================================================================*/
companyMemberRouter.post(
  '/:companyId/members',
  validateCompanyIdParams,
  requireCompanyOwner,
  validateInviteMember,
  companyMemberController.invite,
);

/* ============================================================================
 * GET /companies/:companyId/members — list members
 * (Filter status ở service theo role viewer — owner thấy hết, member chỉ thấy active)
 * ==========================================================================*/
companyMemberRouter.get(
  '/:companyId/members',
  validateCompanyIdParams,
  companyMemberController.list,
);

/* ============================================================================
 * POST /companies/:companyId/members/invite — owner invite / re-invite
 * (Service tự phân nhánh case 1, 8, 9, 10 theo status của existing row)
 * ==========================================================================*/
companyMemberRouter.post(
  '/:companyId/members/invite',
  validateCompanyIdParams,
  requireCompanyOwner,
  validateInviteMember,
  companyMemberController.invite,
);

/* ============================================================================
 * POST /companies/:companyId/members/:userId/accept — user accept invite
 * (requireActiveMember không cần — chưa accept thì user chưa phải member;
 *  controller check userId === token.userId)
 * ==========================================================================*/
companyMemberRouter.post(
  '/:companyId/members/:userId/accept',
  validateCompanyMemberUserParams,
  companyMemberController.accept,
);

/* ============================================================================
 * POST /companies/:companyId/members/:userId/decline — user decline invite
 * ==========================================================================*/
companyMemberRouter.post(
  '/:companyId/members/:userId/decline',
  validateCompanyMemberUserParams,
  companyMemberController.decline,
);

/* ============================================================================
 * DELETE /companies/:companyId/members/:userId — owner remove member (soft delete)
 * ==========================================================================*/
companyMemberRouter.delete(
  '/:companyId/members/:userId',
  validateCompanyMemberUserParams,
  requireCompanyOwner,
  companyMemberController.remove,
);

/* ============================================================================
 * POST /companies/:companyId/members/:userId/leave — user tự rời công ty
 * (Không cần requireActiveMember vì service sẽ check ở pre-check.
 *  Controller cũng check userId === token.userId.)
 * ==========================================================================*/
companyMemberRouter.post(
  '/:companyId/members/:userId/leave',
  validateCompanyMemberUserParams,
  companyMemberController.leave,
);

/* ============================================================================
 * POST /companies/:companyId/transfer-owner — atomic swap role owner
 * (Caller phải là active owner — requireCompanyOwner enforce ở middleware.
 *  Body: { newOwnerUserId }. Service demote caller → member, promote target
 *  → owner, tất cả trong 1 transaction để giữ constraint "1 active owner".)
 * ==========================================================================*/
companyMemberRouter.post(
  '/:companyId/transfer-owner',
  validateCompanyIdParams,
  requireCompanyOwner,
  companyMemberController.transferOwner,
);
