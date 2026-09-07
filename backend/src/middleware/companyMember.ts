/**
 * CompanyMember middleware — Zod schemas + validation middleware + guards.
 *
 * Validate input cho tất cả endpoints + 2 guards authorization:
 *   - `requireCompanyOwner`: chỉ owner active mới pass.
 *   - `requireActiveMember`: chỉ member active mới pass.
 *
 * Service throw AppError với code từ `CompanyMemberErrorCode` (interface/companyMember.ts).
 * Middleware cũng throw AppError nếu guard fail.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { validate } from './validate';
import { AppError } from './errorHandler';
import { db } from '../config/database';
import { companyMembers } from '../db/schema';
import {
  CompanyMemberErrorCode,
  CompanyMemberRole,
} from '../interface/companyMember';

/* ============================================================================
 * Zod schemas
 * ==========================================================================*/

/**
 * Body POST /companies/:companyId/members/invite — owner mời user.
 * FE gửi email + role (optional). role chỉ được 'member' (owner phải dùng transfer).
 */
export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['owner', 'member']).default('member'),
});

/** Params cho endpoints có :companyId + :userId (accept/decline/remove/leave). */
export const companyMemberUserParamsSchema = z.object({
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
});

/** Params cho endpoint /:companyId/members (list, invite). */
export const companyIdParamsSchema = z.object({
  companyId: z.string().uuid(),
});

/* ============================================================================
 * Validation middleware (composed from Zod schemas + generic validate())
 * ==========================================================================*/
export const validateInviteMember = validate(inviteMemberSchema, 'body');
export const validateCompanyMemberUserParams = validate(companyMemberUserParamsSchema, 'params');
export const validateCompanyIdParams = validate(companyIdParamsSchema, 'params');

/* ============================================================================
 * Authorization guards
 *
 * Pattern: query row trong DB → check role/status → throw 403 nếu không pass.
 * Đặt SAU `auth` middleware (cần req.user).
 * ==========================================================================*/

/**
 * Guard: owner active HOẶC admin.
 * Dùng cho: PATCH /:id (update company info — route mount tại /companies, param là :id).
 *
 * Lưu ý: route dùng tên param `:id` (vì match RESTful convention), nhưng các
 * routes ở companyMemberRouter dùng `:companyId`. Middleware accept CẢ HAI
 * để dùng được cho cả 2 nhóm routes mà không cần wrapper.
 */
export const requireCompanyOwnerOrAdmin = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const params = req.params as { companyId?: string; id?: string };
    const companyId = params.companyId ?? params.id;
    if (!companyId) {
      throw new AppError(400, CompanyMemberErrorCode.MEMBER_NOT_FOUND, 'Thiếu companyId');
    }

    // Admin pass luôn (FE không có endpoint admin, nhưng giữ để tương lai).
    if (req.user!.role === 'admin') {
      next();
      return;
    }

    const userId = req.user!.userId;
    const [member] = await db
      .select({ role: companyMembers.role, status: companyMembers.status })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, userId),
        ),
      )
      .limit(1);

    if (!member || member.role !== 'owner' || member.status !== 'active') {
      throw new AppError(
        403,
        CompanyMemberErrorCode.FORBIDDEN_NOT_OWNER,
        'Chỉ owner active của công ty hoặc admin mới có quyền này.',
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Guard: chỉ owner active mới pass.
 * Dùng cho: POST /:companyId/members/invite, DELETE /:companyId/members/:userId.
 * (Không dùng cho transfer-owner — endpoint đó có logic riêng.)
 */
export const requireCompanyOwner = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { companyId } = req.params as { companyId?: string };
    if (!companyId) {
      throw new AppError(400, CompanyMemberErrorCode.MEMBER_NOT_FOUND, 'Thiếu companyId');
    }

    const userId = req.user!.userId;
    const [member] = await db
      .select({ role: companyMembers.role, status: companyMembers.status })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, userId),
        ),
      )
      .limit(1);

    if (!member || member.role !== 'owner' || member.status !== 'active') {
      throw new AppError(
        403,
        CompanyMemberErrorCode.FORBIDDEN_NOT_OWNER,
        'Chỉ owner active của công ty mới có quyền này.',
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Guard: chỉ member active mới pass.
 * Dùng cho: POST /:companyId/members/:userId/accept|leave (userId phải match
 * auth.user, status phải 'active' hoặc 'pending' tùy endpoint).
 *
 * Lưu ý: chỉ check role/status active; không check userId khớp với auth.user
 * (endpoint tự check ở controller — tránh hardcode rule ở middleware).
 */
export const requireActiveMember = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { companyId } = req.params as { companyId?: string };
    if (!companyId) {
      throw new AppError(400, CompanyMemberErrorCode.MEMBER_NOT_FOUND, 'Thiếu companyId');
    }

    const userId = req.user!.userId;
    const [member] = await db
      .select({ role: companyMembers.role, status: companyMembers.status })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, userId),
        ),
      )
      .limit(1);

    if (!member || member.status !== 'active') {
      throw new AppError(
        403,
        CompanyMemberErrorCode.FORBIDDEN_NOT_MEMBER,
        'Bạn không phải thành viên active của công ty này.',
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Helper: lấy role/status row của (companyId, userId) — dùng trong service nếu cần.
 * (Không phải middleware — đặt ở đây để gần các guard khác.)
 */
export const getMembershipRoleStatus = async (
  companyId: string,
  userId: string,
): Promise<{ role: CompanyMemberRole; status: string } | null> => {
  const [row] = await db
    .select({ role: companyMembers.role, status: companyMembers.status })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
};
