/**
 * Company — API types/interfaces (input/output contract)
 *
 * File này CHỈ chứa TypeScript types/interfaces mô tả dữ liệu API vào/ra.
 * KHÔNG chứa Zod schema, validation rule, hay validation middleware.
 *
 * - Model type `Company` derive từ Drizzle schema (DB shape) — dùng cho service return.
 * - Mỗi endpoint có 1 response interface riêng (1 API = 1 response type).
 * - Input types được khai báo tường minh (KHÔNG dùng `z.infer`) để giữ
 *   `interface` độc lập với `middleware`.
 */
import type { companies } from '../db/schema/companies';

/** Model Company (1 dòng trong bảng companies) — derive từ Drizzle schema */
export type Company = typeof companies.$inferSelect;

/** Lifecycle status: active | banned | removed — derive từ Drizzle enum */
export type CompanyStatus = typeof companies.status.enumValues[number];

/**
 * Body của POST /companies.
 * slug tự sinh ở service, createdBy lấy từ req.user (không nhận từ client).
 */
export interface CreateCompanyInput {
  name: string;
  logoUrl?: string;
  coverUrl?: string;
  description?: string;
  industry?: string;
  sizeRange?: string;
  website?: string;
  social?: Record<string, string>;
  address?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Body PATCH /companies/:id (tất cả field optional).
 * slug giữ nguyên — không cho đổi qua endpoint này.
 */
export interface UpdateCompanyInput {
  name?: string;
  logoUrl?: string;
  coverUrl?: string;
  description?: string;
  industry?: string;
  sizeRange?: string;
  website?: string;
  social?: Record<string, string>;
  address?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Body PATCH /companies/:id/status (admin đổi lifecycle).
 */
export interface UpdateCompanyStatusInput {
  status: CompanyStatus;
}

/**
 * Query GET /companies?page&limit&search&industry&sizeRange&status.
 */
export interface ListCompaniesQuery {
  search?: string;
  industry?: string;
  sizeRange?: string;
  status?: CompanyStatus;
  page: number;
  limit: number;
}

/**
 * Params /companies/:id và /companies/:id/status.
 */
export interface CompanyIdParam {
  id: string;
}

/**
 * Response của GET /companies (list + phân trang).
 */
export interface ListCompaniesResponse {
  items: Company[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Response của GET /companies/:id.
 * Company kèm danh sách job đang live (đến 10 job mới nhất).
 */
export interface GetCompanyByIdResponse extends Company {
  jobs: Array<{
    id: string;
    title: string;
    slug: string | null;
    jobLevel: string | null;
    jobType: string | null;
    salaryMin: string | null;
    salaryMax: string | null;
    location: unknown;
    publishedAt: Date | null;
  }>;
}

/**
 * Response của GET /companies/me — company của user hiện tại (qua membership).
 *
 * Trả `null` (không 404) khi user chưa thuộc company nào — để FE phân biệt
 * "chưa có" (cần tạo) với lỗi thực sự.
 *
 * Chỉ trả field cần cho UI header/picker (id, name, logoUrl) — tránh lộ
 * metadata nội bộ (social, address, ...).
 */
export interface MyCompanyResponse {
  id: string;
  name: string;
  logoUrl: string | null;
}

/**
 * Response của GET /companies/by-slug/:slug.
 * Company kèm danh sách job đang live (đến 10 job mới nhất).
 */
export type GetCompanyBySlugResponse = GetCompanyByIdResponse;

/**
 * Response của POST /companies (tạo mới).
 * Trả về Company vừa tạo, status 201.
 */
export type CreateCompanyResponse = Company;

/**
 * Response của PATCH /companies/:id (cập nhật info).
 * Trả về Company sau khi update.
 */
export type UpdateCompanyResponse = Company;

/**
 * Response của PATCH /companies/:id/status (admin đổi lifecycle).
 * Trả về Company sau khi đổi status.
 */
export type UpdateCompanyStatusResponse = Company;
