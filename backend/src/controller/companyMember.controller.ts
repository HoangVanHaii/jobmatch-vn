/**
 * CompanyMember controller — handler cho /companies/:companyId/members/*.
 *
 * Mỗi hàm tự viết logic (không gộp helper) cho dễ đọc. Pattern giống companyController.
 *
 * Lifecycle (xem interface/companyMember.ts):
 *   POST   /:companyId/members/invite           (owner)
 *   POST   /:companyId/members/:userId/accept  (user)
 *   POST   /:companyId/members/:userId/decline (user)
 *   DELETE /:companyId/members/:userId          (owner — soft delete)
 *   POST   /:companyId/members/:userId/leave    (user tự rời)
 *   GET    /companies/me/invitations           (user list pending của mình)
 *   GET    /:companyId/members                  (list members)
 */
import { Request, Response, NextFunction } from 'express';
import { companyMemberService } from '../service/companyMember.service';
import { AppError } from '../middleware/errorHandler';
import type {
  AcceptInvitationResponse,
  CompanyIdParams,
  CompanyMemberUserParams,
  DeclineInvitationResponse,
  InviteMemberBody,
  InviteMemberResponse,
  LeaveCompanyResponse,
  ListCompanyMembersResponse,
  MyInvitationsResponse,
  RemoveMemberResponse,
  TransferCompanyOwnerBody,
  TransferCompanyOwnerResult,
} from '../interface/companyMember';

export const companyMemberController = {
  /* ==========================================================================
   * POST /companies/:companyId/members/invite — owner mời user
   * Body: { email, role? }
   * ==========================================================================
   *
   * Flow:
   *   1. Đọc params (companyId) + body (email, role).
   *   2. Gọi service.invite — service lo lookup userId + check status + insert/re-invite.
   *   3. Trả row mới cho FE.
   * ==========================================================================*/
  invite: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { companyId } = req.params as unknown as CompanyIdParams;
      const body = req.body as InviteMemberBody;
      const invitedBy = req.user!.userId;

      const member = await companyMemberService.invite(
        companyId,
        body.email,
        invitedBy,
        body.role,
      );

      res.status(201).json({
        success: true,
        data: member satisfies InviteMemberResponse,
      });
    } catch (err) {
      console.error('[companyMember.invite] error:', err);
      next(err);
    }
  },

  /* ==========================================================================
   * POST /companies/:companyId/members/:userId/accept — user accept invite
   * ==========================================================================
   *
   * BE tự check: row có status='pending' không, user không active ở company khác.
   * Service xử lý atomic UPDATE + auto-cancel các pending invites khác.
   * ==========================================================================*/
  accept: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { companyId, userId } = req.params as unknown as CompanyMemberUserParams;
      // Bảo vệ thêm ở controller: chỉ cho phép user tự accept cho chính mình
      if (req.user!.userId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Chỉ được accept lời mời của chính mình.');
      }

      const { membership, autoCancelledCount } = await companyMemberService.accept(
        companyId,
        userId,
      );

      const response: AcceptInvitationResponse = {
        ...membership,
        autoCancelledCount,
        user: null, // accept không trả user info — FE sẽ tự load lại list
      };

      res.json({ success: true, data: response });
    } catch (err) {
      console.error('[companyMember.accept] error:', err);
      next(err);
    }
  },

  /* ==========================================================================
   * POST /companies/:companyId/members/:userId/decline — user decline invite
   * ==========================================================================*/
  decline: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { companyId, userId } = req.params as unknown as CompanyMemberUserParams;
      // Bảo vệ thêm ở controller: chỉ cho phép user tự decline cho chính mình
      if (req.user!.userId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Chỉ được decline lời mời của chính mình.');
      }

      const member = await companyMemberService.decline(companyId, userId);

      const response: DeclineInvitationResponse = member;
      res.json({ success: true, data: response });
    } catch (err) {
      console.error('[companyMember.decline] error:', err);
      next(err);
    }
  },

  /* ==========================================================================
   * DELETE /companies/:companyId/members/:userId — owner xoá member
   * ==========================================================================
   *
   * Soft delete: chỉ UPDATE status → 'removed', không bao giờ DELETE row.
   * Service check: target phải active + không phải owner cuối cùng.
   * ==========================================================================*/
  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { companyId, userId } = req.params as unknown as CompanyMemberUserParams;
      const removedBy = req.user!.userId;

      const member = await companyMemberService.remove(companyId, userId, removedBy);

      const response: RemoveMemberResponse = member;
      res.json({ success: true, data: response });
    } catch (err) {
      console.error('[companyMember.remove] error:', err);
      next(err);
    }
  },

  /* ==========================================================================
   * POST /companies/:companyId/members/:userId/leave — user tự rời công ty
   * ==========================================================================
   *
   * Chỉ cho phép user tự rời chính mình (controller check userId === token).
   * Service check: owner cuối → chặn, phải transfer trước.
   * ==========================================================================*/
  leave: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { companyId, userId } = req.params as unknown as CompanyMemberUserParams;
      // Bảo vệ: chỉ rời chính mình
      if (req.user!.userId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Chỉ được rời công ty cho chính mình.');
      }

      const member = await companyMemberService.leave(companyId, userId);

      const response: LeaveCompanyResponse = member;
      res.json({ success: true, data: response });
    } catch (err) {
      console.error('[companyMember.leave] error:', err);
      next(err);
    }
  },

  /* ==========================================================================
   * POST /companies/:companyId/transfer-owner — atomic swap role
   * ==========================================================================
   *
   * Caller phải là active owner (middleware requireCompanyOwner đã check).
   * Service: demote caller → member, promote target → owner (atomic trong 1 tx).
   * ==========================================================================*/
  transferOwner: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { companyId } = req.params as unknown as CompanyIdParams;
      const { newOwnerUserId } = req.body as TransferCompanyOwnerBody;
      const currentOwnerUserId = req.user!.userId;

      const result: TransferCompanyOwnerResult = await companyMemberService.transferOwner(
        companyId,
        currentOwnerUserId,
        newOwnerUserId,
      );

      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[companyMember.transferOwner] error:', err);
      next(err);
    }
  },

  /* ==========================================================================
   * GET /companies/me/invitations — user list tất cả pending invites của mình
   * (across companies)
   * ==========================================================================*/
  listMyInvitations: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const items = await companyMemberService.listMyInvitations(userId);

      const response: MyInvitationsResponse = items;
      res.json({ success: true, data: response });
    } catch (err) {
      console.error('[companyMember.listMyInvitations] error:', err);
      next(err);
    }
  },

  /* ==========================================================================
   * GET /companies/:companyId/members — list members của company
   * ==========================================================================
   *
   * Permission:
   *   - Owner: thấy TẤT CẢ status (active, pending, declined, removed, left, auto_cancelled).
   *   - Member active: chỉ thấy active.
   *   - Người ngoài: [] (không tự ý 401 — không leak info về company tồn tại).
   * ==========================================================================*/
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { companyId } = req.params as unknown as CompanyIdParams;
      const viewerUserId = req.user!.userId;

      const members = await companyMemberService.listByCompany(companyId, viewerUserId);

      const response: ListCompanyMembersResponse = members;
      res.json({ success: true, data: response });
    } catch (err) {
      console.error('[companyMember.list] error:', err);
      next(err);
    }
  },
};
