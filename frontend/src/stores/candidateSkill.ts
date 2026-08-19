
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { candidateSkillApi } from '@services/candidateSkill.api';
import type {
  AddCandidateSkillByNamePayload,
  AddCandidateSkillByNameResult,
  CandidateSkill,
  CandidateSkillWithSkill,
  CreateCandidateSkillPayload,
  UpdateCandidateSkillPayload,
} from '@/types/candidateSkill';

export const useCandidateSkillStore = defineStore('candidateSkill', () => {
  // --- State ---
  const items = ref<CandidateSkillWithSkill[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // --- Computed ---
  const isEmpty = computed(() => !loading.value && items.value.length === 0);
  /** Map skillId → level để lookup nhanh (vd. badge hiển thị). */
  const levelBySkillId = computed<Record<string, number | null>>(() => {
    const out: Record<string, number | null> = {};
    for (const it of items.value) out[it.skillId] = it.level;
    return out;
  });

  // --- Helpers ---
  const setError = (e: unknown): void => {
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  };

  /** Reset state (khi rời profile page, tránh hiển thị data cũ). */
  const reset = (): void => {
    items.value = [];
    error.value = null;
  };

  // --- Actions ---

  /** Lấy toàn bộ skills của mình (server lấy candidateId từ JWT). */
  const fetchList = async (): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await candidateSkillApi.list();
      items.value = data.data;
    } catch (e) {
      setError(e);
    } finally {
      loading.value = false;
    }
  };

  /** Chi tiết 1 candidate_skill — trả row hoặc null nếu 404. */
  const fetchById = async (skillId: string): Promise<CandidateSkillWithSkill | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await candidateSkillApi.getById(skillId);
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Add bằng skillId. Trả row vừa tạo hoặc null nếu lỗi (404/409/...).
   * Caller handle 409 (candidate đã có skill) — store chỉ setError.
   */
  const create = async (payload: CreateCandidateSkillPayload): Promise<CandidateSkill | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await candidateSkillApi.create(payload);
      // items.value chỉ có skill info JOIN — cần reload để có `skill`.
      await fetchList();
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Add bằng name — dùng cho CV upload flow.
   * Trả discriminated union — KHÔNG throw ở 2 nhánh skip (duplicate / skill_not_found).
   * UI check `result.added` để xử lý:
   *   - added=true → toast "đã thêm"
   *   - added=false, reason='duplicate' → toast "đã có sẵn"
   *   - added=false, reason='skill_not_found' → toast "skill không tồn tại, bỏ qua"
   */
  const addByName = async (
    payload: AddCandidateSkillByNamePayload,
  ): Promise<AddCandidateSkillByNameResult | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await candidateSkillApi.addByName(payload);
      if (data.data.added) {
        // Reload để lấy skill info JOIN.
        await fetchList();
      }
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Update level — sync local items[].level */
  const update = async (
    skillId: string,
    payload: UpdateCandidateSkillPayload,
  ): Promise<CandidateSkill | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await candidateSkillApi.update(skillId, payload);
      // Cập nhật level trong items; giữ nguyên skill info.
      const idx = items.value.findIndex((x) => x.skillId === skillId);
      if (idx >= 0) {
        items.value[idx] = {
          ...items.value[idx],
          level: data.data.level,
        };
      }
      return data.data;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Xoá skill khỏi candidate. Trả true nếu thành công, false nếu lỗi. */
  const remove = async (skillId: string): Promise<boolean> => {
    loading.value = true;
    error.value = null;
    try {
      await candidateSkillApi.remove(skillId);
      items.value = items.value.filter((x) => x.skillId !== skillId);
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      loading.value = false;
    }
  };

  return {
    // state
    items, loading, error,
    // computed
    isEmpty, levelBySkillId,
    // actions
    fetchList, fetchById, create, addByName, update, remove, reset,
  };
});