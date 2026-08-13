/**
 * Skills Pinia store — state chung cho danh sách + chi tiết skill.
 *
 * Phân trách nhiệm (theo pattern auth/notification/company store):
 *   - Service (skillsApi): gọi HTTP, trả AxiosResponse (chưa unwrap).
 *   - Store (file này): destruct `const { data } = await ...` rồi lấy `data.data`,
 *     giữ state (items/current/loading/error) + query, bắt lỗi vào `error`,
 *     đồng bộ local sau khi create/update/delete. UI chỉ đọc state + gọi action.
 *
 * Skills là master data ít thay đổi — UI thường cache list 1 lần, không cần
 * pagination (toàn bộ skill fit trong 1 page). Admin có thể toggle
 * `includeDeleted` để xem cả skill đã soft-delete.
 *
 * Lỗi 401 đã được interceptor trong http.ts tự refresh token; các lỗi khác
 * store catch → ghi vào `error.value` để UI hiển thị (toast/banner).
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { skillsApi } from '@services/skills.api';
import type {
  CreateSkillPayload,
  ListSkillsQuery,
  Skill,
  UpdateSkillPayload,
} from '@/types/skills';

export const useSkillsStore = defineStore('skills', () => {
  // --- State ---
  const items = ref<Skill[]>([]);
  const current = ref<Skill | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** Query cho list: includeDeleted (admin only). */
  const query = ref<ListSkillsQuery>({ includeDeleted: false });

  // --- Computed ---
  const isEmpty = computed(() => !loading.value && items.value.length === 0);

  // --- Helpers ---
  const setError = (e: unknown): void => {
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  };

  /** Cập nhật local: nếu skill đang trong items/current thì thay bằng bản mới. */
  const syncItem = (skill: Skill): void => {
    const idx = items.value.findIndex((s) => s.id === skill.id);
    if (idx >= 0) items.value[idx] = skill;
    if (current.value?.id === skill.id) current.value = skill;
  };

  /** Filter items theo status (dùng khi đổi includeDeleted để hiển thị đúng). */
  const filterByVisibility = (skills: Skill[]): Skill[] =>
    query.value.includeDeleted ? skills : skills.filter((s) => s.status === 'active');

  // --- Actions ---

  /** Lấy toàn bộ skills theo query hiện tại (admin có thể ?includeDeleted=true). */
  const fetchList = async (): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await skillsApi.list(query.value);
      items.value = data.data;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /** Đổi query; đổi includeDeleted thì refetch. */
  const setQuery = async (patch: Partial<ListSkillsQuery>): Promise<void> => {
    const changed = patch.includeDeleted !== undefined;
    Object.assign(query.value, patch);
    if (changed) await fetchList();
  };

  /** Chi tiết theo id. */
  const fetchById = async (skillId: string): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await skillsApi.getById(skillId);
      current.value = data.data;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /** Chi tiết theo slug. */
  const fetchBySlug = async (slug: string): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await skillsApi.getBySlug(slug);
      current.value = data.data;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /** Tạo skill mới (admin) — trả về skill mới hoặc null nếu lỗi. */
  const create = async (payload: CreateSkillPayload): Promise<Skill | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await skillsApi.create(payload);
      // Nếu đang xem active, append row mới (status='active' mặc định).
      if (filterByVisibility([data.data]).length > 0) {
        items.value = [...items.value, data.data];
      }
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Cập nhật skill (admin) — đồng bộ local nếu đang hiển thị. */
  const update = async (skillId: string, payload: UpdateSkillPayload): Promise<Skill | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await skillsApi.update(skillId, payload);
      syncItem(data.data);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Soft delete skill (admin) — set status='deleted'. Xoá khỏi list nếu không xem deleted. */
  const deleteSkill = async (skillId: string): Promise<boolean> => {
    loading.value = true;
    error.value = null;
    try {
      await skillsApi.delete(skillId);
      // Cập nhật local: nếu không bao gồm deleted → xoá khỏi list; nếu có → set status='deleted'.
      if (query.value.includeDeleted) {
        const idx = items.value.findIndex((s) => s.id === skillId);
        if (idx >= 0) items.value[idx] = { ...items.value[idx], status: 'deleted' };
      } else {
        items.value = items.value.filter((s) => s.id !== skillId);
      }
      if (current.value?.id === skillId) current.value = null;
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      loading.value = false;
    }
  };

  /** Xoá sạch state (khi rời trang quản lý, tránh hiển thị data cũ). */
  const reset = (): void => {
    items.value = [];
    current.value = null;
    error.value = null;
    query.value = { includeDeleted: false };
  };

  return {
    // state
    items, current, loading, error, query,
    // computed
    isEmpty,
    // helpers
    filterByVisibility,
    // actions
    fetchList, setQuery, fetchById, fetchBySlug, create, update, deleteSkill, reset,
  };
});