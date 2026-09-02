/**
 * Saved job Pinia store — share state "đã lưu" giữa JobsView / JobDetailView /
 * SavedJobsView / JobCard.
 *
 * Pattern:
 *   - `savedIds: Set<string>` — source of truth cho UI bookmark icon.
 *   - `pendingIds: Set<string>` — jobIds đang trong quá trình save/unsave (disable
 *     nút + chống double-click).
 *   - `fetchIds()` — gọi `savedJobApi.list({ limit: 100 })` để build initial set.
 *     CHƯA gọi tự động ở đây — caller (view) tự gọi sau khi ensureInit.
 *   - `toggle(jobId, { onUnsave })` — toggle state + gọi API. Optimistic, có rollback
 *     khi fail. `onUnsave` callback chỉ chạy khi unsave thật sự (SavedJobsView dùng
 *     để xoá entry khỏi list chính của nó).
 *
 * Lưu ý:
 *   - Không dùng `Set` cho reactivity trực tiếp — Vue 3 reactive proxy không track
 *     Set mutation tốt. Dùng `ref<Set<string>>` và replace nguyên Set khi thay đổi.
 *   - Backend `POST /saved-jobs` chấp nhận duplicate (PK = userId+jobId) → idempotent.
 *     Nếu backend trả 409 thì coi như success (đã lưu rồi).
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { savedJobApi } from '@services/savedJob.api';

export const useSavedJobStore = defineStore('savedJob', () => {
  // --- State ---
  const savedIds = ref<Set<string>>(new Set());
  const pendingIds = ref<Set<string>>(new Set());
  const error = ref<string | null>(null);
  /** Set true sau lần `fetchIds` đầu tiên thành công — tránh re-fetch nhiều lần. */
  const initialFetched = ref(false);

  // --- Helpers ---
  const setError = (e: unknown): void => {
    error.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
  };

  const isSaved = (jobId: string): boolean => savedIds.value.has(jobId);
  const isPending = (jobId: string): boolean => pendingIds.value.has(jobId);

  /**
   * Fetch toàn bộ saved-jobs (1 request, lấy max 100) để build Set ở client.
   * Gọi 1 lần khi user đăng nhập hoặc vào trang liên quan.
   */
  const fetchIds = async (): Promise<void> => {
    if (initialFetched.value) return;
    try {
      const { data } = await savedJobApi.list({ page: 1, limit: 100 });
      savedIds.value = new Set(data.data.map((s) => s.job.id));
      initialFetched.value = true;
    } catch (e) {
      setError(e);
    }
  };

  /**
   * Reset state — dùng khi logout hoặc chuyển user.
   */
  const reset = (): void => {
    savedIds.value = new Set();
    pendingIds.value = new Set();
    error.value = null;
    initialFetched.value = false;
  };

  /**
   * Toggle save/unsave. Optimistic — update state trước, rollback nếu API fail.
   *
   * @param jobId
   * @param opts.onUnsave — callback chạy SAU khi unsave thành công. SavedJobsView
   *   dùng để xoá entry khỏi list chính. Không chạy nếu unsave fail.
   * @returns `true` nếu action thành công, `false` nếu fail.
   */
  const toggle = async (
    jobId: string,
    opts?: { onUnsave?: () => void },
  ): Promise<boolean> => {
    if (pendingIds.value.has(jobId)) return false;

    const wasSaved = savedIds.value.has(jobId);
    // Optimistic: flip state trước.
    const next = new Set(savedIds.value);
    if (wasSaved) next.delete(jobId);
    else next.add(jobId);
    savedIds.value = next;

    const pendingNext = new Set(pendingIds.value);
    pendingNext.add(jobId);
    pendingIds.value = pendingNext;

    try {
      if (wasSaved) {
        await savedJobApi.unsave(jobId);
        opts?.onUnsave?.();
      } else {
        await savedJobApi.save(jobId);
      }
      return true;
    } catch (e) {
      // Rollback
      const rollback = new Set(savedIds.value);
      if (wasSaved) rollback.add(jobId);
      else rollback.delete(jobId);
      savedIds.value = rollback;
      setError(e);
      return false;
    } finally {
      const done = new Set(pendingIds.value);
      done.delete(jobId);
      pendingIds.value = done;
    }
  };

  return {
    // state
    savedIds,
    pendingIds,
    error,
    initialFetched,
    // helpers
    isSaved,
    isPending,
    // actions
    fetchIds,
    reset,
    toggle,
  };
});
