/**
 * Company middleware — Zod schemas + validation middleware.
 *
 * File này chỉ chịu trách nhiệm validation input cho Company:
 *   - Khai báo Zod schemas.
 *   - Compose validation middleware từ generic `validate()` ở `middleware/validate.ts`.
 *
 * Quy ước đặt tên:
 *   - `<useCase>Schema`   → Zod schema
 *   - `validate<UseCase>` → middleware (export cho router dùng)
 *
 * Input types (`CreateCompanyInput`, ...) và response types nằm ở
 * `interface/company.ts` — interface và middleware tách trách nhiệm độc lập.
 */
import { z } from 'zod';
import { validate } from './validate';

/**
 * Tạo công ty — body của POST /companies
 * slug tự sinh ở service, createdBy lấy từ req.user (không nhận từ client)
 */
export const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(200),
  logoUrl: z.string().url().max(1000).optional(),
  coverUrl: z.string().url().max(1000).optional(),
  description: z.string().max(5000).optional(),
  industry: z.string().trim().max(100).optional(),
  sizeRange: z.string().trim().max(20).optional(), // vd: '1-10', '11-50', '201-500', '1000+'
  website: z.string().url().max(500).optional(),
  social: z.record(z.string(), z.string()).optional(), // { linkedin, facebook, ... }
  address: z.record(z.string(), z.unknown()).optional(), // { city, district, address, lat, lng }
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Cập nhật công ty — PATCH /companies/:id (tất cả field optional) */
export const updateCompanySchema = createCompanySchema.partial();

/** Body PATCH /companies/:id/status (admin) */
export const updateCompanyStatusSchema = z.object({
  status: z.enum(['active', 'banned', 'removed']),
});

/** Query list — GET /companies?page&limit&search&industry&sizeRange&status */
export const listCompaniesQuerySchema = z.object({
  search: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  sizeRange: z.string().trim().optional(),
  status: z.enum(['active', 'banned', 'removed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Params /companies/:id và /companies/:id/status — validate UUID */
export const companyIdParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Validation middleware — compose từ generic `validate()`.
 * Dùng ở router/company.ts.
 */
export const validateCreateCompany = validate(createCompanySchema, 'body');
export const validateUpdateCompany = validate(updateCompanySchema, 'body');
export const validateUpdateCompanyStatus = validate(updateCompanyStatusSchema, 'body');
export const validateListCompanies = validate(listCompaniesQuerySchema, 'query');
export const validateCompanyIdParam = validate(companyIdParamSchema, 'params');
