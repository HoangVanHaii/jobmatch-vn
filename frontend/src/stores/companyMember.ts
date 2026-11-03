/**
 * CompanyMember Pinia store — state cho danh sách thành viên (server-side
 * pagination) + các thao tác quản lý.
 *
 * Phân trách nhiệm (theo pattern auth/notification store):
 *   - Service (companyMemberApi): gọi HTTP, trả AxiosResponse (chưa unwrap).
 *   - Store (file này): destruct `const { data } = await ...` rồi lấy `data.data`,
 *     giữ state (page/total/counts/loading/error) + đồng bộ local sau khi
 *     thêm/sửa/accept.
 *
 * Danh sách thành viên phân trang tại backend (limit/offset + search + filter
 * + sort) — store chỉ giữ trang hiện tại của mỗi company, KHÔNG giữ full list.
 * Header của FE (owners/preview) và row của viewer (me) đi kèm trong cùng
 * response để không cần request riêng.
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
  CompanyMemberListCounts,
  CompanyMemberListQuery,
  CompanyMemberUserInfo,
  TransferCompanyOwnerPayload,
  TransferCompanyOwnerResult,
  UpdateCompanyMemberPayload,
} from '@/types/companyMember';

/** State danh sách (theo trang) của 1 company — cache để không refetch khi quay lại. */
interface CompanyMemberPage {
  members: CompanyMember[];
  total: number;
  limit: number;
  offset: number;
  counts: CompanyMemberListCounts;
  me: CompanyMember | null;
  owners: CompanyMemberUserInfo[];
  preview: CompanyMemberUserInfo[];
}

const EMPTY_COUNTS: CompanyMemberListCounts = { all: 0, active: 0, pending: 0, ended: 0 };

export const useCompanyMemberStore = defineStore('companyMember', () => {
  // --- State ---
  /** Key = companyId, value = trang hiện tại. Cache để không phải fetch lại khi chuyển tab. */
  const pageByCompany = ref<Record<string, CompanyMemberPage>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  // --- Helpers ---
  const setError = (e: unknown): void => {
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  };

  /** Trang hiện tại của 1 company — null nếu chưa fetch. */
  const getPage = (companyId: string): CompanyMemberPage | null =>
    pageByCompany.value[companyId] ?? null;

  /** Members của trang hiện tại — fallback `[]` nếu chưa cache. */
  const getMembers = (companyId: string): CompanyMember[] =>
    pageByCompany.value[companyId]?.members ?? [];

  /** Row membership của chính viewer (từ response `me`) — không phụ thuộc page. */
  const getMe = (companyId: string): CompanyMember | null =>
    pageByCompany.value[companyId]?.me ?? null;

  /** Ghi kết quả 1 lần fetch vào cache. */
  const setPage = (companyId: string, page: CompanyMemberPage): void => {
    pageByCompany.value = { ...pageByCompany.value, [companyId]: page };
  };

  /** Cập nhật local: thay bản mới cho 1 member trong trang hiện tại (+ me nếu khớp). */
  const syncMember = (companyId: string, member: CompanyMember): void => {
    const page = pageByCompany.value[companyId];
    if (!page) return;
    const idx = page.members.findIndex((m) => m.userId === member.userId);
    const next =
      idx < 0
        ? page.members
        : page.members.map((m, i) => (i === idx ? member : m));
    setPage(companyId, {
      ...page,
      members: next,
      me: page.me && page.me.userId === member.userId ? member : page.me,
    });
  };

  // --- Actions ---

  /**
   * Lấy 1 trang members theo companyId + query (limit/offset/search/status/sort).
   * Backend enforce phạm vi theo role viewer (owner thấy hết, member chỉ active).
   * Trả về page state mới (hoặc null nếu lỗi) để caller dùng tổng/counts.
   */
  const fetchPage = async (
    companyId: string,
    query: CompanyMemberListQuery = {},
  ): Promise<CompanyMemberPage | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyMemberApi.list(companyId, query);
      const page: CompanyMemberPage = {
        members: data.data.members,
        total: data.data.pagination.total,
        limit: data.data.pagination.limit,
        offset: data.data.pagination.offset,
        counts: data.data.counts,
        me: data.data.me,
        owners: data.data.owners,
        preview: data.data.preview,
      };
      setPage(companyId, page);
      return page;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Owner thêm member — trả về member mới (UI gọi fetchPage để đồng bộ chính xác). */
  const add = async (
    companyId: string,
    payload: AddCompanyMemberPayload,
  ): Promise<CompanyMember | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyMemberApi.add(companyId, payload);
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

  /**
   * Owner xoá cứng member khỏi công ty — hard delete row.
   * Đồng bộ local bằng cách filter row khỏi trang hiện tại (row không còn tồn
   * tại trong DB). Caller nên refetch để total/counts cập nhật đúng.
   */
  const remove = async (companyId: string, userId: string): Promise<boolean> => {
    loading.value = true;
    error.value = null;
    try {
      await companyMemberApi.remove(companyId, userId);
      const page = pageByCompany.value[companyId];
      if (page) {
        setPage(companyId, {
          ...page,
          members: page.members.filter((m) => m.userId !== userId),
        });
      }
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Member tự accept lời mời — đồng bộ local.
   *
   * BE route `/:companyId/members/:userId/accept` yêu cầu userId trên URL
   * (controller check `req.user.userId !== :userId` để chặn accept hộ).
   * Caller (view) lấy userId từ auth store và truyền vào.
   */
  const acceptInvite = async (
    companyId: string,
    userId: string,
  ): Promise<CompanyMember | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyMemberApi.acceptInvite(companyId, userId);
      syncMember(companyId, data.data);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Member tự decline lời mời — đồng bộ local. Mirror của acceptInvite;
   * cùng cơ chế self-only check ở controller nên cũng cần truyền userId.
   */
  const declineMyInvite = async (
    companyId: string,
    userId: string,
  ): Promise<CompanyMember | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyMemberApi.declineMyInvite(companyId, userId);
      syncMember(companyId, data.data);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Member tự rời công ty (chỉ áp dụng cho member active, không phải owner).
   * BE soft delete: status active → left, set ended_at.
   *
   * Sau khi thành công → caller nên:
   *   - Reload company context để chuyển user về state 'no-company'
   *   - Navigate về /employer/company
   *
   * Lưu ý: store KHÔNG navigate / reload company — để view quyết định UX.
   */
  const leaveCompany = async (
    companyId: string,
    userId: string,
  ): Promise<CompanyMember | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await companyMemberApi.leaveCompany(companyId, userId);
      syncMember(companyId, data.data);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Owner chuyển ownership (atomic swap) — cập nhật cả 2 row trong trang cache. */
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
    const next = { ...pageByCompany.value };
    delete next[companyId];
    pageByCompany.value = next;
  };

  /** Xoá sạch state. */
  const reset = (): void => {
    pageByCompany.value = {};
    error.value = null;
  };

  return {
    // state
    pageByCompany, loading, error, EMPTY_COUNTS,
    // helpers
    getPage, getMembers, getMe,
    // actions
    fetchPage, add, update, remove, acceptInvite, declineMyInvite, leaveCompany, transferOwner, clearCompany, reset,
  };
});
