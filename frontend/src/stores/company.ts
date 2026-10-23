/**
 * Company Pinia store — state chung cho danh sách + chi tiết công ty.
 *
 * Phân trách nhiệm (theo pattern auth/notification store):
 *   - Service (companyApi): gọi HTTP, trả AxiosResponse (chưa unwrap).
 *   - Store (file này): destruct `const { data } = await ...` rồi lấy `data.data`,
 *     giữ state (items/current/loading/error) + query, bắt lỗi vào `error`,
 *     đồng bộ local sau khi sửa/xoá. UI chỉ đọc state + gọi action.
 *
 * Lỗi 401 đã được interceptor trong http.ts tự refresh token; các lỗi khác
 * store catch → ghi vào `error.value` để UI hiển thị (toast/banner).
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { companyApi } from '@services/company.api';
import { uploadApi } from '@services/upload.api';
import { HttpError } from '@services/http';
import {
  companyToProfile,
  profileToCreatePayload,
  profileToUpdatePayload,
  type CompanyProfile,
} from '@/utils/companyProfileUtils';
import type {
  Company,
  CompanyInvite,
  CompanyStatus,
  CreateCompanyPayload,
  UpdateCompanyPayload,
  ListCompaniesQuery,
} from '@/types/company';

const DEFAULT_PAGE_SIZE = 20;

export const useCompanyStore = defineStore('company', () => {
  // --- State ---
  const items = ref<Company[]>([]);
  const total = ref(0);
  const current = ref<Company | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // State tách riêng cho màn hồ sơ công ty để không làm ảnh hưởng loading/error của các màn company khác.
  const company = ref<CompanyProfile | null>(null);
  const companyLoading = ref(false);
  const companySaving = ref(false);
  // "Chưa có công ty" (GET /companies/me trả 200 + data:null) tách riêng khỏi lỗi tải
  // thật (500/mất mạng) — nhánh trước hiển thị màn tạo, nhánh sau hiển thị "Thử lại".
  const companyNotFound = ref(false);
  const companyCreating = ref(false);
  const companyLoadError = ref<string | null>(null);
  const companySaveError = ref<string | null>(null);
  const companyFieldErrors = ref<Record<string, string>>({});
  // Lời mời tham gia công ty đang chờ (chỉ dùng khi user chưa có công ty).
  const companyInvites = ref<CompanyInvite[]>([]);
  const invitesLoading = ref(false);
  const invitesError = ref<string | null>(null);
  let companyFetchRequestId = 0;

  /** Query cho list: search/filter + phân trang (đổi filter sẽ reset page ở setQuery) */
  const query = ref<ListCompaniesQuery>({ page: 1, limit: DEFAULT_PAGE_SIZE });

  // --- Computed ---
  const hasMore = computed(() => items.value.length < total.value);
  const isEmpty = computed(() => !loading.value && items.value.length === 0);

  // --- Helpers ---
  const setError = (e: unknown): void => {
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  };

  /** Cập nhật local: nếu company đang trong items/current thì thay bằng bản mới (không thêm mới). */
  const syncItem = (company: Company): void => {
    const idx = items.value.findIndex((c) => c.id === company.id);
    if (idx >= 0) items.value[idx] = company;
    if (current.value?.id === company.id) current.value = company;
  };

  const toFieldErrors = (details: Record<string, unknown> | undefined): Record<string, string> => {
    if (!details) return {};
    return Object.entries(details).reduce<Record<string, string>>((result, [field, value]) => {
      if (typeof value === 'string') result[field] = value;
      else if (Array.isArray(value) && typeof value[0] === 'string') result[field] = value[0];
      return result;
    }, {});
  };

  /** Tải company của user hiện tại; chỉ request mới nhất được phép ghi state. */
  const fetchCompany = async (): Promise<boolean> => {
    const requestId = ++companyFetchRequestId;
    companyLoading.value = true;
    companyLoadError.value = null;
    companyNotFound.value = false;
    try {
      const { data: mine } = await companyApi.getMyCompany();
      if (!mine.data) {
        // BE trả 200 + data:null khi user chưa thuộc company nào (không phải lỗi).
        if (requestId === companyFetchRequestId) {
          company.value = null;
          companyNotFound.value = true;
        }
        return false;
      }
      const { data } = await companyApi.getById(mine.data.id);
      if (requestId === companyFetchRequestId) {
        current.value = data.data;
        company.value = companyToProfile(data.data);
      }
      return true;
    } catch (e) {
      if (requestId === companyFetchRequestId) {
        companyLoadError.value = e instanceof Error ? e.message : 'Không thể tải hồ sơ công ty.';
      }
      return false;
    } finally {
      if (requestId === companyFetchRequestId) companyLoading.value = false;
    }
  };

  /** Upload logo (nếu có) rồi PATCH profile; không optimistic update. */
  const updateCompany = async (profile: CompanyProfile, logoFile?: File | null): Promise<boolean> => {
    if (companySaving.value || !current.value) return false;
    companySaving.value = true;
    companySaveError.value = null;
    companyFieldErrors.value = {};
    try {
      let logoUrl = current.value.logoUrl ?? undefined;
      if (logoFile) {
        const { data: upload } = await uploadApi.uploadImage(logoFile, 'logos');
        logoUrl = upload.data.url;
      }
      const payload = profileToUpdatePayload(profile);
      if (logoUrl) payload.logoUrl = logoUrl;
      const { data } = await companyApi.update(current.value.id, payload);
      syncItem(data.data);
      company.value = companyToProfile(data.data);
      return true;
    } catch (e) {
      companyFieldErrors.value = e instanceof HttpError ? toFieldErrors(e.details) : {};
      companySaveError.value = e instanceof Error ? e.message : 'Không thể lưu hồ sơ công ty.';
      return false;
    } finally {
      companySaving.value = false;
    }
  };

  /** Tạo công ty (POST /companies) — trả về company mới; không optimistic update. */
  const createCompany = async (profile: CompanyProfile): Promise<boolean> => {
    if (companyCreating.value) return false;
    companyCreating.value = true;
    companySaveError.value = null;
    companyFieldErrors.value = {};
    try {
      const { data } = await companyApi.create(profileToCreatePayload(profile));
      current.value = data.data;
      company.value = companyToProfile(data.data);
      companyNotFound.value = false;
      return true;
    } catch (e) {
      companyFieldErrors.value = e instanceof HttpError ? toFieldErrors(e.details) : {};
      companySaveError.value = e instanceof Error ? e.message : 'Không thể tạo hồ sơ công ty.';
      return false;
    } finally {
      companyCreating.value = false;
    }
  };

  /** Tải lời mời đang chờ (GET /companies/me/invites); lỗi ghi vào invitesError. */
  const fetchInvites = async (): Promise<void> => {
    invitesLoading.value = true;
    invitesError.value = null;
    try {
      const { data } = await companyApi.getMyInvites();
      companyInvites.value = data.data;
    } catch (e) {
      invitesError.value = e instanceof Error ? e.message : 'Không thể tải lời mời.';
      companyInvites.value = [];
    } finally {
      invitesLoading.value = false;
    }
  };

  /** Bỏ 1 lời mời khỏi danh sách local (sau khi server xác nhận declined). */
  const dismissInvite = (companyId: string): void => {
    companyInvites.value = companyInvites.value.filter((i) => i.companyId !== companyId);
  };

  // --- Actions ---
  /** Lấy danh sách theo query hiện tại (search/filter/phân trang). */
  const fetchList = async (): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyApi.list(query.value);
      items.value = data.data.items;
      total.value = data.data.total;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /** Cập nhật query; đổi filter/search thì tự reset về trang 1. */
  const setQuery = (patch: Partial<ListCompaniesQuery>): void => {
    const changedFilter =
      patch.search !== undefined ||
      patch.industry !== undefined ||
      patch.sizeRange !== undefined ||
      patch.status !== undefined;
    Object.assign(query.value, patch);
    if (changedFilter) query.value.page = 1;
  };

  /** Chi tiết theo id (kèm jobs live). */
  const fetchById = async (id: string): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyApi.getById(id);
      current.value = data.data;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /** Chi tiết theo slug (kèm jobs live). */
  const fetchBySlug = async (slug: string): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyApi.getBySlug(slug);
      current.value = data.data;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /** Tạo công ty — trả về company mới (UI có thể gọi fetchList để sync chính xác). */
  const create = async (payload: CreateCompanyPayload): Promise<Company | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyApi.create(payload);
      total.value += 1;
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Cập nhật — đồng bộ local nếu item đang hiển thị. */
  const update = async (id: string, payload: UpdateCompanyPayload): Promise<Company | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyApi.update(id, payload);
      syncItem(data.data);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Đổi lifecycle status (admin) — đồng bộ local. */
  const updateStatus = async (id: string, status: CompanyStatus): Promise<Company | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyApi.updateStatus(id, { status });
      syncItem(data.data);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Xoá sạch state (khi rời trang quản lý, tránh hiển thị data cũ). */
  const reset = (): void => {
    items.value = [];
    total.value = 0;
    current.value = null;
    error.value = null;
    query.value = { page: 1, limit: DEFAULT_PAGE_SIZE };
    company.value = null;
    companyLoading.value = false;
    companySaving.value = false;
    companyCreating.value = false;
    companyNotFound.value = false;
    companyLoadError.value = null;
    companySaveError.value = null;
    companyFieldErrors.value = {};
    companyInvites.value = [];
    invitesLoading.value = false;
    invitesError.value = null;
  };

  return {
    // state
    items, total, current, loading, error, query,
    company, companyLoading, companySaving, companyNotFound, companyCreating,
    companyLoadError, companySaveError, companyFieldErrors,
    companyInvites, invitesLoading, invitesError,
    // computed
    hasMore, isEmpty,
    // actions
    fetchList, setQuery, fetchById, fetchBySlug, create, update, updateStatus,
    fetchCompany, updateCompany, createCompany, fetchInvites, dismissInvite, reset,
  };
});
