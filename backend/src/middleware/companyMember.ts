/**
 * CompanyMember middleware — Zod schemas + validation middleware + guards.
 *
 * File này chỉ chịu trách nhiệm validation + authorization cho CompanyMember:
 *   - Khai báo Zod schemas.
 *   - Compose validation middleware từ generic `validate()`.
 *   - Ownership guards: `requireCompanyOwner`, `requireCompanyOwnerOrAdmin`.
 *
 * Nghiệp vụ: 1 công ty CHỈ CÓ 1 OWNER DUY NHẤT.
 *   - requireCompanyOwner: chỉ owner active (admin KHÔNG pass). Cho thêm/sửa member.
 *   - requireCompanyOwnerOrAdmin: owner active HOẶC admin. Cho update company info + transfer owner.
 *
 * Input/response types nằm ở `interface/companyMember.ts` — interface và middleware
 * tách trách nhiệm độc lập.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from './validate';
import { AppError } from './errorHandler';
import { companyMemberService } from '../service/companyMember.service';

// ============================================================================
// Zod schemas
// ============================================================================

/**
 * Body POST /companies/:id/members — owner thêm member.
 * role CHỈ được là 'member'. Nếu muốn thêm owner phải dùng transfer-owner.
 */
export const addCompanyMemberSchema = z.object({
  userId: z.string().uuid(),
  // role CHỈ được 'member' — muốn chuyển owner phải dùng POST /:id/transfer-owner.
  // (Trước đây dùng z.enum(['owner','member']) + refine nhưng owner luôn bị service
  //  chặn → dead code. Khóa luôn literal cho rõ nghĩa.)
  role: z.literal('member').default('member'),
  status: z.enum(['active', 'invited', 'inactive']).default('invited'),
});

/**
 * Body PATCH /companies/:companyId/members/:userId — đổi role/status.
 * KHÔNG cho phép đổi status của owner.
 * KHÔNG cho phép đổi role thành 'owner' (phải dùng transfer-owner).
 */
export const updateCompanyMemberSchema = z.object({
  role: z.enum(['owner', 'member']).optional(),
  status: z.enum(['active', 'invited', 'inactive']).optional(),
}).refine(
  (v) => v.role !== undefined || v.status !== undefined,
  { message: 'Cần ít nhất 1 trong role/status' },
);

/** Body POST /companies/:id/transfer-owner — chuyển ownership */
export const transferOwnerSchema = z.object({
  newOwnerUserId: z.string().uuid(),
});

/** Params /companies/:companyId/members/:userId */
export const companyMemberParamsSchema = z.object({
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
});

/** Params /companies/:id/members và /companies/:id/transfer-owner (chỉ cần id) */
export const companyIdParamSchema = z.object({
  id: z.string().uuid(),
});

/** Params /companies/:companyId/members/me/accept */
export const companyIdOnlyParamSchema = z.object({
  companyId: z.string().uuid(),
});

// ============================================================================
// Validation middleware
// ============================================================================

export const validateAddCompanyMember = validate(addCompanyMemberSchema, 'body');
export const validateUpdateCompanyMember = validate(updateCompanyMemberSchema, 'body');
export const validateTransferOwner = validate(transferOwnerSchema, 'body');
export const validateCompanyMemberParams = validate(companyMemberParamsSchema, 'params');
export const validateCompanyIdParam = validate(companyIdParamSchema, 'params');
export const validateCompanyIdOnlyParam = validate(companyIdOnlyParamSchema, 'params');

// ============================================================================
// Guards (authorization)
// ============================================================================

/**
 * Guard: owner active của company HOẶC admin mới được phép.
 * Dùng cho: PATCH /companies/:id (update info), POST /:id/transfer-owner.
 * Admin pass; user là owner active pass; member/inactive fail.
 * Sử dụng sau auth + validate params.
 */
export const requireCompanyOwnerOrAdmin = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const params = req.params as { companyId?: string; id?: string };
    const companyId = params.companyId ?? params.id;
    if (!companyId) throw new AppError(400, 'BAD_REQUEST', 'Missing companyId');

    // Admin pass luôn
    if (req.user!.role === 'admin') {
      next();
      return;
    }

    const userId = req.user!.userId;
    const member = await companyMemberService.getByCompanyAndUser(companyId, userId);
    if (!member || member.role !== 'owner' || member.status !== 'active') {
      throw new AppError(403, 'FORBIDDEN', 'Chỉ owner của công ty hoặc admin mới có quyền này');
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Guard: chỉ owner active của company (admin cũng KHÔNG được).
 * Dùng cho: thêm/sửa member — vì admin không quản lý membership.
 * Sử dụng sau auth + validate params.
 */
export const requireCompanyOwner = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const params = req.params as { companyId?: string; id?: string };
    const companyId = params.companyId ?? params.id;
    if (!companyId) throw new AppError(400, 'BAD_REQUEST', 'Missing companyId');

    const userId = req.user!.userId;
    const member = await companyMemberService.getByCompanyAndUser(companyId, userId);
    if (!member || member.role !== 'owner' || member.status !== 'active') {
      throw new AppError(403, 'FORBIDDEN', 'Chỉ owner của công ty mới có quyền này');
    }
    next();
  } catch (err) {
    next(err);
  }
};
