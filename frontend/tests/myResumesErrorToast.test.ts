// @vitest-environment happy-dom
/**
 * Test chuyển error banner → toast trong MyResumesView.vue.
 *
 * Trước fix: store set `cvStore.error.value` → template banner đỏ sticky
 *   đầu trang hiển thị → layout giật, tốn chỗ.
 * Sau fix: watch ở setup() fire `toast.error(msg)` + clear `error.value`
 *   → transient, không chiếm chỗ.
 *
 * Test approach: replicate watcher logic y hệt production (vì watcher là
 * inline trong component setup, không export được). Setup real Pinia
 * toast store, mock cvStore với ref error.
 *
 * Verify:
 *   - error.value set → toast.level='error', message đúng
 *   - error.value cleared sau khi toast fire
 *   - error.value = null → KHÔNG fire toast (initial state / cleared)
 *   - error set 2 lần liên tiếp → 2 toast (clear in-between)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ref, watch } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useToastStore } from '@stores/toast';

describe('MyResumesView: error → toast (thay vì inline banner)', () => {
  let error: ReturnType<typeof ref<string | null>>;
  let toast: ReturnType<typeof useToastStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    toast = useToastStore();
    error = ref<string | null>(null);

    // Replicate watcher logic y hệt MyResumesView.vue setup()
    watch(error, (msg) => {
      if (msg) {
        toast.error(msg);
        error.value = null;
      }
    });
  });

  it('PASS case: error.value set → toast error + clear error', async () => {
    error.value = 'CV chưa parse xong. Vui lòng đợi hoặc upload lại.';

    // Wait 1 tick cho watcher fire
    await new Promise((r) => setTimeout(r, 0));

    // Toast fired
    expect(toast.toasts).toHaveLength(1);
    expect(toast.toasts[0]?.level).toBe('error');
    expect(toast.toasts[0]?.message).toBe(
      'CV chưa parse xong. Vui lòng đợi hoặc upload lại.',
    );

    // Error cleared (KHÔNG sticky trên store — chỉ transient toast)
    expect(error.value).toBeNull();
  });

  it('PASS case: error.value = null ban đầu → KHÔNG fire toast', async () => {
    await new Promise((r) => setTimeout(r, 0));
    expect(toast.toasts).toHaveLength(0);
  });

  it('PASS case: error set 2 lần liên tiếp → 2 toast (mỗi lần clear)', async () => {
    error.value = 'Lỗi lần 1';
    await new Promise((r) => setTimeout(r, 0));
    expect(toast.toasts).toHaveLength(1);

    error.value = 'Lỗi lần 2';
    await new Promise((r) => setTimeout(r, 0));
    expect(toast.toasts).toHaveLength(2);
    expect(toast.toasts[1]?.message).toBe('Lỗi lần 2');
    expect(error.value).toBeNull();
  });

  it('PASS case: error set rồi clear bằng tay trước watcher fire → KHÔNG toast', async () => {
    // Edge: nếu ai đó clear error trước khi watcher microtask chạy.
    // Watch chỉ fire khi value thay đổi từ null → msg. Nếu set rồi clear
    // ngay trong cùng tick, watch có thể miss hoặc fire với null.
    error.value = 'Lỗi';
    error.value = null;
    await new Promise((r) => setTimeout(r, 0));

    // Không toast nào được fire
    expect(toast.toasts).toHaveLength(0);
  });
});
