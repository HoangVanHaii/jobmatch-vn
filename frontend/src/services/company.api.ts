/**
 * Company API — tầng giao tiếp với backend /api/companies.
 * UI/Store import trực tiếp `companyApi` để gọi.
 *
 * Format theo các api hiện có (auth/job/notification): trả thẳng AxiosResponse,
 * KHÔNG unwrap ở đây. Nơi gọi tự destruct `const { data } = await ...` rồi lấy `data.data`.
 *
 * Endpoint backend (router company.ts):
 *   GET    /companies                list + search/filter + phân trang
 *   GET    /companies/by-slug/:slug  chi tiết theo slug
 *   GET    /companies/:id            chi tiết theo id
 *   POST   /companies                tạo (employer/admin)
 *   PATCH  /companies/:id            cập nhật (employer/admin)
 *   PATCH  /companies/:id/status     đổi status (admin)
 *
 * Lỗi 401 đã do interceptor trong http.ts tự refresh token; các lỗi khác
 * tự reject để nơi gọi (store) catch.
 */
import { http } from './http';
import type {
  Company,
  CompanyStatus,
  CreateCompanyPayload,
  UpdateCompanyPayload,
  ListCompaniesQuery,
  CompanyListResult,
  MyCompany,
} from '@/types/company';

/** Backend luôn bọc response: { success: boolean, data: T } */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const companyApi = {
  /** GET /companies — danh sách + search/filter + phân trang */
  list: (params?: ListCompaniesQuery) =>
    http.get<ApiResponse<CompanyListResult>>('/companies', { params }),

  /**
   * GET /companies/me — company của user hiện tại (qua companyMembers).
   * Trả `data = null` khi user chưa thuộc company nào (không phải lỗi).
   * Slim shape (id, name, logoUrl) — dùng cho header/picker khi tạo job.
   */
  getMyCompany: () =>
    http.get<ApiResponse<MyCompany | null>>('/companies/me'),

  /** GET /companies/:id — chi tiết (kèm jobs live) */
  getById: (id: string) => http.get<ApiResponse<Company>>(`/companies/${id}`),

  /** GET /companies/by-slug/:slug — chi tiết theo slug (kèm jobs live) */
  getBySlug: (slug: string) => http.get<ApiResponse<Company>>(`/companies/by-slug/${slug}`),

  /** POST /companies — tạo công ty (slug tự sinh, createdBy từ token) */
  create: (data: CreateCompanyPayload) => http.post<ApiResponse<Company>>('/companies', data),

  /** PATCH /companies/:id — cập nhật (slug giữ nguyên) */
  update: (id: string, data: UpdateCompanyPayload) =>
    http.patch<ApiResponse<Company>>(`/companies/${id}`, data),

  /** PATCH /companies/:id/status — admin đổi lifecycle (active/banned/removed) */
  updateStatus: (id: string, data: { status: CompanyStatus }) =>
    http.patch<ApiResponse<Company>>(`/companies/${id}/status`, data),
};
