// @vitest-environment happy-dom
/**
 * Test Bug H1: clearAllFilters debounce race trong MyResumesView.vue.
 *
 * Scenario bug:
 *   1. User gõ "engineer" → watch(searchQuery) set timer 400ms với q="engineer".
 *   2. Trước khi timer fire, user click "Xoá lọc" (clearAllFilters):
 *      - Clear timer cũ (engineer search bị huỷ — ĐÚNG)
 *      - Set searchQuery.value = ''  → trigger watch (queued async, flush: 'pre')
 *      - Clear searchTimer lần 2 → NO-OP vì watch chưa fire
 *      - Call fetchList với resetFilters=true (caller chính thức)
 *   3. Watch fire async → set timer MỚI 400ms với q=undefined
 *   4. 400ms sau: setTimeout fire → fetchList(undefined, undefined, undefined)
 *      → redundant call, KHÔNG có resetFilters=true. Nếu user đã đổi page
 *      hoặc search trong 400ms → state clobber.
 *
 * Fix: await nextTick() giữa set searchQuery và clear timer lần 2 — buộc
 * watch fire đồng bộ, set timer mới, rồi clear timer mới.
 *
 * Test approach: replicate watch + clearAllFilters logic y hệt production trong
 * test harness (vì clearAllFilters là closure trong component setup, không
 * export được). Dùng Vue's watch + nextTick giống production code.
 *
 * Verify:
 *   - BEFORE FIX: redundant fetchList call xảy ra sau 400ms (regression test)
 *   - AFTER FIX: chỉ 1 fetchList call (từ clearAllFilters)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick, ref, watch } from 'vue';

describe('Bug H1: clearAllFilters debounce race', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('AFTER FIX: type → clearAllFilters → wait 500ms → chỉ 1 fetchList call', async () => {
    const searchQuery = ref('');
    const sourceFilter = ref<'all' | 'upload' | 'direct'>('all');
    const fetchListSpy = vi.fn().mockResolvedValue(undefined);
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    const SEARCH_DEBOUNCE_MS = 400;

    watch(searchQuery, (val) => {
      if (searchTimer) clearTimeout(searchTimer);
      const trimmed = val.trim();
      const q = trimmed.length > 0 ? trimmed : undefined;
      searchTimer = setTimeout(() => {
        fetchListSpy(undefined, undefined, q);
      }, SEARCH_DEBOUNCE_MS);
    });

    // Replicate FIXED clearAllFilters
    const clearAllFilters = async (): Promise<void> => {
      if (searchTimer) clearTimeout(searchTimer);
      searchQuery.value = '';
      await nextTick();
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = null;
      sourceFilter.value = 'all';
      await fetchListSpy(undefined, 1, undefined, true);
    };

    // User gõ "engineer"
    searchQuery.value = 'engineer';
    await nextTick(); // watch fire → set timer 400ms
    expect(searchTimer).not.toBeNull();

    // Ngay lập tức (trong 400ms) user click Xoá lọc
    await clearAllFilters();

    // Verify: chỉ có 1 fetchList call (từ clearAllFilters với resetFilters=true)
    expect(fetchListSpy).toHaveBeenCalledTimes(1);
    expect(fetchListSpy).toHaveBeenCalledWith(undefined, 1, undefined, true);

    // Wait thêm 500ms — timer từ watch đã bị cancel sau nextTick
    vi.advanceTimersByTime(500);
    // Flush microtasks cho promise resolution
    await vi.runAllTimersAsync();

    // Vẫn chỉ 1 call — bug không còn
    expect(fetchListSpy).toHaveBeenCalledTimes(1);
  });

  it('REGRESSION: nếu KHÔNG có nextTick() → redundant fetchList sau 400ms', async () => {
    // Đây là logic TRƯỚC khi fix — chứng minh bug tồn tại.
    const searchQuery = ref('');
    const fetchListSpy = vi.fn().mockResolvedValue(undefined);
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    const SEARCH_DEBOUNCE_MS = 400;

    watch(searchQuery, (val) => {
      if (searchTimer) clearTimeout(searchTimer);
      const trimmed = val.trim();
      const q = trimmed.length > 0 ? trimmed : undefined;
      searchTimer = setTimeout(() => {
        fetchListSpy(undefined, undefined, q);
      }, SEARCH_DEBOUNCE_MS);
    });

    // BUGGY clearAllFilters (không có nextTick)
    const buggyClearAllFilters = async (): Promise<void> => {
      if (searchTimer) clearTimeout(searchTimer);
      searchQuery.value = '';
      if (searchTimer) clearTimeout(searchTimer);
      await fetchListSpy(undefined, 1, undefined, true);
    };

    searchQuery.value = 'engineer';
    await nextTick(); // watch fire → set timer
    expect(searchTimer).not.toBeNull();

    await buggyClearAllFilters();
    // Call thứ 1 từ clearAllFilters
    expect(fetchListSpy).toHaveBeenCalledTimes(1);

    // Đợi watch fire async (queued bởi searchQuery.value = '') + 400ms
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();

    // BUG: watch đã set timer mới với q=undefined → fire sau 400ms → 2nd call
    expect(fetchListSpy).toHaveBeenCalledTimes(2);
    const calls = fetchListSpy.mock.calls;
    // 2nd call là từ watch setTimeout — KHÔNG có resetFilters=true
    expect(calls[1]).toEqual([undefined, undefined, undefined]);
  });

  it('AFTER FIX: clearAllFilters khi searchQuery đã rỗng sẵn → không có extra fetch', async () => {
    const searchQuery = ref('');
    const sourceFilter = ref<'all' | 'upload' | 'direct'>('upload');
    const fetchListSpy = vi.fn().mockResolvedValue(undefined);
    let searchTimer: ReturnType<typeof setTimeout> | null = null;

    watch(searchQuery, (val) => {
      if (searchTimer) clearTimeout(searchTimer);
      const trimmed = val.trim();
      const q = trimmed.length > 0 ? trimmed : undefined;
      searchTimer = setTimeout(() => {
        fetchListSpy(undefined, undefined, q);
      }, 400);
    });

    const clearAllFilters = async (): Promise<void> => {
      if (searchTimer) clearTimeout(searchTimer);
      searchQuery.value = '';
      await nextTick();
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = null;
      sourceFilter.value = 'all';
      await fetchListSpy(undefined, 1, undefined, true);
    };

    await clearAllFilters();
    expect(fetchListSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();
    expect(fetchListSpy).toHaveBeenCalledTimes(1);
  });

  it('AFTER FIX: type → type → clearAllFilters trong 400ms → không có stale fetch', async () => {
    // Edge case: user gõ rồi gõ tiếp (debounce reset timer), rồi clearAllFilters
    // → timer cuối cùng phải bị cancel, không có redundant call.
    const searchQuery = ref('');
    const fetchListSpy = vi.fn().mockResolvedValue(undefined);
    let searchTimer: ReturnType<typeof setTimeout> | null = null;

    watch(searchQuery, (val) => {
      if (searchTimer) clearTimeout(searchTimer);
      const trimmed = val.trim();
      const q = trimmed.length > 0 ? trimmed : undefined;
      searchTimer = setTimeout(() => {
        fetchListSpy(undefined, undefined, q);
      }, 400);
    });

    const clearAllFilters = async (): Promise<void> => {
      if (searchTimer) clearTimeout(searchTimer);
      searchQuery.value = '';
      await nextTick();
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = null;
      await fetchListSpy(undefined, 1, undefined, true);
    };

    searchQuery.value = 'en';
    await nextTick();
    searchQuery.value = 'eng';
    await nextTick();
    searchQuery.value = 'engineer';
    await nextTick();

    await clearAllFilters();
    expect(fetchListSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();
    expect(fetchListSpy).toHaveBeenCalledTimes(1);
  });
});
