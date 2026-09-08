/**
 * Admin User API — wrapper cho /api/v1/admin/users
 *
 * Note: BE controller `listUsers` trả về **bare array** (không wrap trong
 * {success, data, pagination}) — inconsistent với các endpoint khác. Service
 * này chuẩn hoá về cùng shape `{ data, returned }` cho FE dễ dùng.
 *
 * Filter (q, role, status, sort) chạy trên BE — không filter client-side.
 */
import { http } from './http';
import type { User } from '@stores/auth';

export interface AdminUserListParams {
  page?: number;
  limit?: number;
  /** Search email hoặc fullName (case-insensitive LIKE). */
  q?: string;
  role?: 'candidate' | 'employer' | 'admin';
  status?: 'active' | 'suspended' | 'pending' | 'banned';
  sort?: 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'recently-active';
}

export interface AdminPagination {
  page: number;
  limit: number;
  /** Tổng record khớp filter hiện tại (tính trên BE). */
  total: number;
}

export interface AdminUserListResult {
  data: User[];
  pagination: AdminPagination;
}

export interface AdminUserCounts {
  total: number;
  /** Đếm theo role (filter bỏ role) */
  byRole: {
    candidate: number;
    employer: number;
    admin: number;
  };
  /** Đếm theo status (filter bỏ status) */
  byStatus: {
    active: number;
    suspended: number;
    pending: number;
    banned: number;
  };
}

export interface AdminCountsParams {
  q?: string;
  role?: 'candidate' | 'employer' | 'admin';
  status?: 'active' | 'suspended' | 'pending' | 'banned';
}

export interface AdminChangeStatusPayload {
  status: 'active' | 'suspended' | 'pending' | 'banned';
}

export const adminUserApi = {
  /**
   * GET /api/v1/admin/users?page=&limit=&q=&role=&status=&sort=
   * BE trả `{ data: User[], pagination: { page, limit, total } }` (mới)
   * hoặc bare array `User[]` (cũ, nếu BE chưa restart).
   * Auto-detect format để không phải restart BE.
   */
  list: async (params: AdminUserListParams = {}): Promise<AdminUserListResult> => {
    const clean: Record<string, string | number> = {};
    if (params.page) clean.page = params.page;
    if (params.limit) clean.limit = params.limit;
    if (params.q) clean.q = params.q;
    if (params.role) clean.role = params.role;
    if (params.status) clean.status = params.status;
    if (params.sort) clean.sort = params.sort;

    const res = await http.get<unknown>(
      '/admin/users',
      { params: clean },
    );

    // Detect format: wrapped vs bare array
    const body = res.data;
    if (Array.isArray(body)) {
      // Bare array (BE cũ chưa restart)
      return {
        data: body as User[],
        pagination: { page: params.page ?? 1, limit: params.limit ?? body.length, total: body.length },
      };
    }
    // Wrapped format (BE mới)
    const wrapped = body as { data: User[]; pagination: AdminPagination };
    return { data: wrapped.data, pagination: wrapped.pagination };
  },

  /**
   * GET /api/v1/admin/users/counts?q=&role=&status=
   * Đếm tổng + breakdown theo role/status, dùng cho summary + tab count chính xác
   * bất kể đang ở trang nào.
   */
  counts: async (params: AdminCountsParams = {}): Promise<AdminUserCounts> => {
    const clean: Record<string, string> = {};
    if (params.q) clean.q = params.q;
    if (params.role) clean.role = params.role;
    if (params.status) clean.status = params.status;
    const res = await http.get<AdminUserCounts>('/admin/users/counts', { params: clean });
    return res.data;
  },

  /** GET /api/v1/admin/users/:id */
  getById: async (userId: string): Promise<User> => {
    const res = await http.get<{ success: boolean; data: User }>(`/admin/users/${userId}`);
    return res.data.data;
  },

  /** PATCH /api/v1/admin/users/:id/status */
  changeStatus: async (userId: string, status: AdminChangeStatusPayload['status']): Promise<void> => {
    await http.patch(`/admin/users/${userId}/status`, { status });
  },

  /** DELETE /api/v1/admin/users/:id (soft delete) */
  softDelete: async (userId: string): Promise<void> => {
    await http.delete(`/admin/users/${userId}`);
  },
};
