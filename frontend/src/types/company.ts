/**
 * Company types — đồng bộ với backend (companies schema + controller response).
 * Frontend dùng các type này làm contract khi gọi companyApi.
 */

/** Lifecycle status của công ty (enum company_status ở DB) */
export type CompanyStatus = 'active' | 'banned' | 'removed';

/** Social links, vd: { linkedin, facebook, website, ... } */
export type CompanySocial = Record<string, string>;

/** Địa chỉ linh hoạt, vd: { city, district, address, lat, lng, ... } */
export type CompanyAddress = Record<string, unknown>;

/** Metadata mở rộng, mặc định {} ở DB */
export type CompanyMetadata = Record<string, unknown>;

/** Job rút gọn gắn kèm trang profile công ty (backend withLiveJobs) */
export interface CompanyJob {
  id: string;
  title: string;
  slug: string | null;
  jobLevel?: string | null;
  jobType?: string | null;
  salaryMin?: string | null; // numeric(15,0) -> JSON trả về dạng string
  salaryMax?: string | null;
  location?: Record<string, unknown> | null;
  publishedAt?: string | null; // ISO 8601 timestamp
}

/** Một dòng trong bảng companies */
export interface Company {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  industry?: string | null;
  sizeRange?: string | null;
  website?: string | null;
  status: CompanyStatus;
  social?: CompanySocial | null;
  address?: CompanyAddress | null;
  createdBy?: string | null;
  createdAt: string; // ISO 8601
  metadata?: CompanyMetadata;
  /** Chỉ xuất hiện khi lấy chi tiết (getById/getBySlug) qua withLiveJobs */
  jobs?: CompanyJob[];
}

/** Payload tạo công ty — POST /companies (slug tự sinh, createdBy lấy từ token) */
export interface CreateCompanyPayload {
  name: string;
  logoUrl?: string;
  coverUrl?: string;
  description?: string;
  industry?: string;
  sizeRange?: string;
  website?: string;
  social?: CompanySocial;
  address?: CompanyAddress;
  metadata?: CompanyMetadata;
}

/** Payload cập nhật — PATCH /companies/:id (toàn bộ field optional) */
export type UpdateCompanyPayload = Partial<CreateCompanyPayload>;

/** Query params cho GET /companies */
export interface ListCompaniesQuery {
  search?: string;
  industry?: string;
  sizeRange?: string;
  status?: CompanyStatus;
  page?: number;
  limit?: number;
}

/** Kết quả phân trang từ GET /companies */
export interface CompanyListResult {
  items: Company[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Response của GET /companies/me — company của user hiện tại (qua membership).
 * Trả `null` khi user chưa thuộc company nào (không phải 404).
 * Slim shape — chỉ field cần cho UI header/picker.
 */
export interface MyCompany {
  id: string;
  name: string;
  logoUrl: string | null;
}
