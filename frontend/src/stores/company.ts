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
import type {
  Company,
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
  };

  return {
    // state
    items, total, current, loading, error, query,
    // computed
    hasMore, isEmpty,
    // actions
    fetchList, setQuery, fetchById, fetchBySlug, create, update, updateStatus, reset,
  };
});
