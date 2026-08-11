/**
 * CompanyMember controller — handler cho /companies/:id/members
 * Mỗi hàm tự viết logic (không gộp helper) cho dễ đọc. Pattern giống companyController.
 *
 * Nghiệp vụ: 1 công ty CHỈ CÓ 1 OWNER DUY NHẤT.
 *   - add: chỉ thêm được role='member'.
 *   - update: ủy quyền validation cho service (service chặn đổi owner rule).
 *   - transferOwner: swap owner atomic.
 */
import { Request, Response, NextFunction } from 'express';
import { companyMemberService } from '../service/companyMember.service';
import { companyService } from '../service/company.service';
import { AppError } from '../middleware/errorHandler';
import type {
  AddCompanyMemberInput,
  TransferOwnerInput,
  UpdateCompanyMemberInput,
} from '../interface/companyMember';

export const companyMemberController = {
  /** GET /companies/:id/members — owner thấy hết, member chỉ thấy active (filter ở service) */
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const companyId = (req.params as { id: string }).id;
      const viewerUserId = req.user!.userId;

      const company = await companyService.getById(companyId);
      if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');

      const members = await companyMemberService.listByCompany(companyId, viewerUserId);
        res.json({
          success: true,
          data: members
        });
    } catch (err) {
      console.error('[companyMember.list] error:', err);
      next(err);
    }
  },

  /** POST /companies/:id/members — owner thêm member (mặc định role=member, status=invited).
   *  Không cho thêm owner — phải dùng POST /:id/transfer-owner.
   */
  add: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const companyId = (req.params as { id: string }).id;
      const input = req.body as AddCompanyMemberInput;
      const invitedBy = req.user!.userId;  
      
      const company = await companyService.getById(companyId);
      if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');
      
      const existing = await companyMemberService.getByCompanyAndUser(companyId, input.userId);
      if (existing) throw new AppError(409, 'MEMBER_EXISTS', 'User đã là member của công ty');
      
      const otherMembership = await companyMemberService.getMembership(input.userId);
      if (otherMembership) {
        throw new AppError(409, 'ALREADY_IN_COMPANY', 'User đã thuộc một công ty khác');
      }

      await companyMemberService.validateAddRole(companyId, input.role);

      const member = await companyMemberService.inviteMember({ ...input, companyId, companyName: company.name, invitedBy });
     
      res.status(201).json({
        success: true,
        data: member
      });

    } catch (err) {
      console.error('[companyMember.add] error:', err);
      next(err);
    }
  },

  /** PATCH /companies/:companyId/members/:userId — owner đổi role/status.
   *  Business validation (khóa status owner / chặn promote / chặn demote owner cuối)
   *  nằm trong service.updateMember; controller chỉ ủy quyền + xử lý 404.
   */
  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { companyId, userId } = req.params as { companyId: string; userId: string };
      const input = req.body as UpdateCompanyMemberInput;

      const updated = await companyMemberService.updateMember(companyId, userId, input);
      if (!updated) throw new AppError(404, 'MEMBER_NOT_FOUND', 'Member not found');

      res.json({
        success: true,
        data: updated
      });
    } catch (err) {
      console.error('[companyMember.update] error:', err);
      next(err);
    }
  },

  /** POST /companies/:companyId/members/me/accept — member tự accept lời mời */
  acceptInvite: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { companyId } = req.params as { companyId: string };
      const userId = req.user!.userId;

      const otherMembership = await companyMemberService.getMembership(userId);
      if (otherMembership) {
        throw new AppError(409, 'ALREADY_IN_COMPANY', 'Bạn đã thuộc một công ty khác');
      }
        
      const updated = await companyMemberService.acceptInvite(companyId, userId);
      if (!updated) {
        throw new AppError(404, 'INVITE_NOT_FOUND', 'Không tìm thấy lời mời pending của bạn cho công ty này');
      }

      res.json({
        success: true,
        data: updated
      });
    } catch (err) {
      console.error('[companyMember.acceptInvite] error:', err);
      next(err);
    }
  },

  /**
   * POST /companies/:id/transfer-owner — owner hiện tại chuyển ownership cho member active khác.
   * Atomic: newOwner → role='owner', currentOwner → role='member' (status='active').
   */
  transferOwner: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const companyId = (req.params as { id: string }).id;
      const input = req.body as TransferOwnerInput;
      const currentUserId = req.user!.userId;

      const company = await companyService.getById(companyId);
      if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');

      const result = await companyMemberService.transferOwner(companyId, currentUserId, input);
      res.json({
        success: true,
        data: {
          newOwner: result.newOwner,
          previousOwner: result.previousOwner,
        },
      });
    } catch (err) {
      console.error('[companyMember.transferOwner] error:', err);
      next(err);
    }
  },
};
