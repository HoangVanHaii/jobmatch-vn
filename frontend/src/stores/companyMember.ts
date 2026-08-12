/**
 * CompanyMember Pinia store — state cho danh sách thành viên + các thao tác quản lý.
 *
 * Phân trách nhiệm (theo pattern auth/notification store):
 *   - Service (companyMemberApi): gọi HTTP, trả AxiosResponse (chưa unwrap).
 *   - Store (file này): destruct `const { data } = await ...` rồi lấy `data.data`,
 *     giữ state (items/loading/error) + đồng bộ local sau khi thêm/sửa/accept.
 *
 * Lỗi 401 đã được interceptor trong http.ts tự refresh token; các lỗi khác
 * store catch → ghi vào `error.value` để UI hiển thị (toast/banner).
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { companyMemberApi } from '@services/companyMember.api';
import type {
  AddCompanyMemberPayload,
  CompanyMember,
  TransferCompanyOwnerPayload,
  TransferCompanyOwnerResult,
  UpdateCompanyMemberPayload,
} from '@/types/companyMember';

export const useCompanyMemberStore = defineStore('companyMember', () => {
  // --- State ---
  /** Key = companyId, value = danh sách member. Cache để không phải fetch lại khi chuyển tab. */
  const membersByCompany = ref<Record<string, CompanyMember[]>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  // --- Helpers ---
  const setError = (e: unknown): void => {
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  };

  /** Lấy danh sách member của 1 company — fallback `[]` nếu chưa cache. */
  const getMembers = (companyId: string): CompanyMember[] =>
    membersByCompany.value[companyId] ?? [];

  /** Cập nhật cache cho 1 company. */
  const setMembers = (companyId: string, list: CompanyMember[]): void => {
    membersByCompany.value = { ...membersByCompany.value, [companyId]: list };
  };

  /** Cập nhật local: thay bản mới cho 1 member trong cache. */
  const syncMember = (companyId: string, member: CompanyMember): void => {
    const list = membersByCompany.value[companyId];
    if (!list) return;
    const idx = list.findIndex((m) => m.userId === member.userId);
    if (idx < 0) return;
    const next = [...list];
    next[idx] = member;
    setMembers(companyId, next);
  };

  // --- Actions ---

  /** Lấy danh sách member theo companyId (filter ở service — owner thấy hết, member thấy active). */
  const fetchList = async (companyId: string): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyMemberApi.list(companyId);
      setMembers(companyId, data.data);
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /** Owner thêm member — trả về member mới (UI gọi fetchList để đồng bộ chính xác). */
  const add = async (
    companyId: string,
    payload: AddCompanyMemberPayload,
  ): Promise<CompanyMember | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyMemberApi.add(companyId, payload);
      const list = membersByCompany.value[companyId] ?? [];
      setMembers(companyId, [...list, data.data]);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Owner đổi role/status — đồng bộ local. */
  const update = async (
    companyId: string,
    userId: string,
    payload: UpdateCompanyMemberPayload,
  ): Promise<CompanyMember | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyMemberApi.update(companyId, userId, payload);
      syncMember(companyId, data.data);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Member tự accept lời mời — đồng bộ local. */
  const acceptInvite = async (companyId: string): Promise<CompanyMember | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyMemberApi.acceptInvite(companyId);
      syncMember(companyId, data.data);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Owner chuyển ownership (atomic swap) — cập nhật cả 2 row trong cache. */
  const transferOwner = async (
    companyId: string,
    payload: TransferCompanyOwnerPayload,
  ): Promise<TransferCompanyOwnerResult | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyMemberApi.transferOwner(companyId, payload);
      syncMember(companyId, data.data.newOwner);
      syncMember(companyId, data.data.previousOwner);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Xoá cache cho 1 company (khi rời trang quản lý, tránh data cũ). */
  const clearCompany = (companyId: string): void => {
    const next = { ...membersByCompany.value };
    delete next[companyId];
    membersByCompany.value = next;
  };

  /** Xoá sạch state. */
  const reset = (): void => {
    membersByCompany.value = {};
    error.value = null;
  };

  return {
    // state
    membersByCompany, loading, error,
    // helpers
    getMembers,
    // actions
    fetchList, add, update, acceptInvite, transferOwner, clearCompany, reset,
  };
});
