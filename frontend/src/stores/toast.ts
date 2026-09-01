/**
 * Toast Pinia store — quản lý hàng đợi toast (thông báo transient).
 *
 * Tách ra riêng vì:
 *   - Toast là UI state ephemeral, dùng ở mọi nơi nên cần 1 store global
 *     (khác với store như notification Bell — chỉ gắn với 1 widget cụ thể).
 *   - Không persist, không cần gọi API — chỉ quản lý queue + auto-dismiss.
 *
 * Usage:
 *   import { useToastStore } from '@stores/toast';
 *   const toast = useToastStore();
 *   toast.success('Đã lưu CV!');
 *   toast.error('Upload thất bại', { title: 'Lỗi upload', duration: 6000 });
 *
 * 4 levels:
 *   - success  ✓ — hành động thành công
 *   - info     ℹ — thông tin chung
 *   - warning  ! — cảnh báo (không chặn flow)
 *   - error    ✕ — lỗi (failed action)
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastLevel = 'success' | 'info' | 'warning' | 'error';

export interface ToastOptions {
  /** Tiêu đề ngắn (vd. "Lỗi upload"). Optional — fallback dùng message. */
  title?: string;
  /** Thời gian hiển thị (ms). 0 = không auto-dismiss. Default 4000. */
  duration?: number;
  /** Action button hiển thị bên phải toast. */
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface Toast {
  id: string;
  level: ToastLevel;
  message: string;
  title?: string;
  duration: number;
  /** Timestamp tạo — dùng cho progress bar + check quá hạn. */
  createdAt: number;
  /** Action nếu có. */
  action?: ToastOptions['action'];
}

const DEFAULT_DURATION = 4000;

/** Random ID không cần dùng crypto — đủ unique cho queue ephemeral. */
const newId = (): string =>
  `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);
  /** Map timeout handle → toast id, để clear khi dismiss manually. */
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Internal: push 1 toast + schedule auto-dismiss. */
  const push = (level: ToastLevel, message: string, opts: ToastOptions = {}): string => {
    const id = newId();
    const duration = opts.duration ?? DEFAULT_DURATION;
    const toast: Toast = {
      id,
      level,
      message,
      title: opts.title,
      duration,
      createdAt: Date.now(),
      action: opts.action,
    };
    toasts.value = [...toasts.value, toast];

    if (duration > 0) {
      const handle = setTimeout(() => dismiss(id), duration);
      timers.set(id, handle);
    }
    return id;
  };

  /** Xoá 1 toast theo id. Clear timeout tương ứng để tránh dismiss 2 lần. */
  const dismiss = (id: string): void => {
    const handle = timers.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.delete(id);
    }
    toasts.value = toasts.value.filter((t) => t.id !== id);
  };

  /** Xoá tất cả toast (vd. khi logout, route thay đổi lớn). */
  const clear = (): void => {
    timers.forEach((handle) => clearTimeout(handle));
    timers.clear();
    toasts.value = [];
  };

  return {
    // state
    toasts,
    // actions
    success: (message: string, opts?: ToastOptions) => push('success', message, opts),
    info: (message: string, opts?: ToastOptions) => push('info', message, opts),
    warning: (message: string, opts?: ToastOptions) => push('warning', message, opts),
    error: (message: string, opts?: ToastOptions) => push('error', message, opts),
    dismiss,
    clear,
  };
});
