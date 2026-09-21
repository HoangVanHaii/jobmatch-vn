/**
 * Admin Users Store — Pinia state cho trang /admin/users.
 *
 * Filter + search chạy trên SERVER. Mỗi lần filter đổi → gọi cả 2 API:
 *   1. /admin/users       (paginated list, page hiện tại)
 *   2. /admin/users/counts (tổng + breakdown theo role/status — dùng cho summary + tabs)
 *
 * View chịu trách nhiệm debounce search (400ms) trước khi gọi setFilter('q', ...).
 */
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { adminUserApi, type AdminUserCounts } from '@/services/adminUser.api';
import type { User } from '@stores/auth';
import { useToastStore } from './toast';
import { isWithinDays, type UserRole, type UserStatus } from '@/utils/format';

export interface AdminUsersFilters {
  /** Chuỗi search (email/name). View phải debounce 400ms trước khi gọi setFilter. */
  q: string;
  role: UserRole | 'all';
  status: UserStatus | 'all';
  sort: 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'recently-active';
}

const DEFAULT_FILTERS: AdminUsersFilters = {
  q: '',
  role: 'all',
  status: 'all',
  sort: 'newest',
};

// Default counts khi BE chưa trả về (tránh lỗi null).
const EMPTY_COUNTS: AdminUserCounts = {
  total: 0,
  byRole: { candidate: 0, employer: 0, admin: 0 },
  byStatus: { active: 0, suspended: 0, pending: 0, banned: 0 },
};

export const useAdminUsersStore = defineStore('adminUsers', () => {
  const users = ref<User[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const page = ref(1);
  const pageSize = ref(20);
  /** Tổng record khớp filter hiện tại — từ BE list, dùng để tính số trang. */
  const total = ref(0);
  /**
   * Counts từ BE — KHÔNG phụ thuộc pagination, dùng cho summary + tab counts.
   * `null` khi chưa fetch lần đầu.
   */
  const counts = ref<AdminUserCounts | null>(null);
  const filters = ref<AdminUsersFilters>({ ...DEFAULT_FILTERS });

  /**
   * Server đã trả đúng `page` rồi, `users.value` là data của trang hiện tại.
   */
  const paged = computed(() => users.value);

  const canGoNext = computed(() => page.value * pageSize.value < total.value);
  const canGoPrev = computed(() => page.value > 1);

  /**
   * Gọi API list users với current `page` + filters.
   * Đây là điểm DUY NHẤT gọi adminUserApi.list.
   */
  async function refetch(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await adminUserApi.list({
        page: page.value,
        limit: pageSize.value,
        q: filters.value.q || undefined,
        role: filters.value.role !== 'all' ? filters.value.role : undefined,
        status: filters.value.status !== 'all' ? filters.value.status : undefined,
        sort: filters.value.sort,
      });
      users.value = res.data;
      total.value = res.pagination.total;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Không tải được danh sách';
      error.value = msg;
      users.value = [];
      total.value = 0;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Gọi API counts — lấy tổng + breakdown byRole + byStatus.
   * QUAN TRỌNG: KHÔNG truyền filter → counts luôn GLOBAL (toàn bộ DB).
   *
   * Lý do: hero stat + filter pill count cần hiển thị "toàn cảo hệ thống",
   * không bị ảnh hưởng bởi filter hiện tại. Nếu truyền filter, khi user chọn
   * "Tạm khoá" thì count các status khác đều về 0 — pill mất tác dụng so sánh.
   *
   * Pill: hiển thị "nếu click status này, bạn sẽ thấy bao nhiêu record" — cần global.
   * Hero: hiển thị "trạng thái tổng thể hệ thống" — cần global.
   */
  async function fetchCounts(): Promise<void> {
    try {
      counts.value = await adminUserApi.counts({});
    } catch {
      // Không block UI nếu counts fail — giữ null để dùng EMPTY_COUNTS fallback.
      counts.value = null;
    }
  }

  /**
   * Watch `page` — đổi trang thì refetch list. KHÔNG cần fetchCounts lại vì
   * counts không phụ thuộc page.
   */
  watch(page, () => {
    refetch();
  });

  /**
   * Set filter + refetch cả 2 API (list + counts). View debounce search trước
   * khi gọi với 'q'. Các filter khác (role/status/sort) gọi thẳng.
   */
  function setFilter<K extends keyof AdminUsersFilters>(key: K, value: AdminUsersFilters[K]): void {
    const before = filters.value[key];
    filters.value[key] = value;
    if (before !== value) {
      page.value = 1; // filter đổi → reset về trang 1
      refetch();
      fetchCounts();
    }
  }

  function resetFilters(): void {
    filters.value = { ...DEFAULT_FILTERS };
    page.value = 1;
    refetch();
    fetchCounts();
  }

  async function fetchUsers(): Promise<void> {
    // Làm mới thủ công (nút "Làm mới" trên UI): reset filter + refetch cả 2.
    filters.value = { ...DEFAULT_FILTERS };
    page.value = 1;
    await Promise.all([refetch(), fetchCounts()]);
  }

  /**
   * Fetch 1 user theo ID — dùng cho view modal / edit modal.
   * Trả về User mới nhất từ BE (không cache).
   */
  async function fetchUserById(userId: string): Promise<User> {
    return await adminUserApi.getById(userId);
  }

  async function changeStatus(userId: string, status: UserStatus): Promise<void> {
    const toast = useToastStore();
    try {
      await adminUserApi.changeStatus(userId, status);
      // Local update cho UX mượt — counts sẽ đúng sau khi refetch.
      const u = users.value.find(x => x.id === userId);
      if (u) u.status = status;
      // Refetch counts để cập nhật breakdown byStatus.
      fetchCounts();
      toast.success('Đã cập nhật trạng thái người dùng');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Cập nhật thất bại';
      toast.error(msg);
    }
  }

  async function softDelete(userId: string): Promise<void> {
    const toast = useToastStore();
    try {
      await adminUserApi.softDelete(userId);
      // BE loại user deleted khỏi list + counts → refetch cả 2.
      await Promise.all([refetch(), fetchCounts()]);
      toast.success('Đã xoá mềm người dùng');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Xoá thất bại';
      toast.error(msg);
    }
  }

  function nextPage(): void {
    if (canGoNext.value) page.value += 1;
  }
  function prevPage(): void {
    if (canGoPrev.value) page.value -= 1;
  }
  function goToPage(p: number): void {
    if (p >= 1) page.value = p;
  }

  return {
    // state
    users, loading, error, page, pageSize, total, counts, filters,
    // derived
    paged, canGoNext, canGoPrev,
    // actions
    fetchUsers, refetch, fetchCounts, fetchUserById, changeStatus, softDelete,
    setFilter, resetFilters, nextPage, prevPage, goToPage,
  };
});
