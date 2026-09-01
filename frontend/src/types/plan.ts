/**
 * Plan types — mirror backend Plan interface (src/interface/plan.ts).
 *
 * priceVnd là NUMERIC ở backend → string ở FE để tránh mất precision với số lớn.
 */
export interface Plan {
  id: string;
  code: string;
  name: string;
  priceVnd: string;
  durationDays: number;
  features: Record<string, unknown>;
  isActive: boolean | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Response shape chuẩn của backend. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  pagination?: Pagination;
  message?: string;
}

/** Query params cho GET /plans. */
export interface PlanListParams {
  includeInactive?: boolean;
  page?: number;
  limit?: number;
}

/** Body cho POST /plans (admin). */
export interface PlanCreatePayload {
  code: string;
  name: string;
  priceVnd: number;
  durationDays: number;
  features: Record<string, unknown>;
  isActive?: boolean;
}

/** Body cho PATCH /plans/:id (admin). Tất cả optional. */
export type PlanUpdatePayload = Partial<PlanCreatePayload>;
