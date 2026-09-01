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
 * Toast store — global queue cho popup notification.
 *
 * Use case chính: hiển thị "peer vừa nhắn tin" khi user ở ngoài /chat (vd đang
 * dùng /chatbot, /profile, /,...). Bell notification đã lo badge số — toast là
 * channel thứ 2 cho peer-aware (kèm avatar + preview + click-to-open).
 *
 * Pattern Pinia setup-style giống các store khác. Toast không persist (chỉ
 * sống trong session) — khi reload → sạch.
 *
 * Auto-dismiss:
 *   - `dismissAfterMs` (default 5000) — auto xoá sau khoảng đó.
 *   - Pause khi user hover (ToastHost quản lý qua `pause(id)` / `resume(id)`).
 *   - Force dismiss thủ công bằng `dismiss(id)`.
 *
 * ID generation:
 *   - Caller truyền id (vd conversationId + messageId). Nếu không, auto-gen
 *     bằng crypto.randomUUID(). Khuyến khích truyền id để dedupe khi socket
 *     emit duplicate.
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
export type ToastVariant = 'chat' | 'info' | 'success' | 'error';

export interface ToastAction {
  /** Click handler — thường navigate tới conv/job/... */
  label?: string;
  onClick?: () => void;
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
  variant: ToastVariant;
  title: string;
  /** Nội dung phụ (vd message preview). Tối đa 1 dòng. */
  body?: string;
  /** URL avatar (có thể null → fallback image). */
  avatarUrl?: string | null;
  /** Bấm vào toast body sẽ gọi handler này (vd navigate /chat/:id). */
  onClick?: () => void;
  /** Nhãn action phụ (vd "Mở"). */
  action?: ToastAction;
  /** Timestamp tạo — dùng cho "vừa xong" countdown. */
  createdAt: number;
  /** Set false khi user hover → không auto-dismiss. */
  paused?: boolean;
}

const DEFAULT_DURATION_MS = 5000;

export const useToastStore = defineStore('toast', () => {
  const items = ref<Toast[]>([]);

  /**
   * Đẩy toast mới. Nếu id đã tồn tại → noop (dedupe).
   * Trả về id để caller có thể dismiss / pause nếu cần.
   */
  const push = (input: Omit<Toast, 'id' | 'createdAt'> & { id?: string; dismissAfterMs?: number }): string => {
    const id = input.id ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

    // Dedupe: nếu đã có toast cùng id → không push nữa.
    if (items.value.some((t) => t.id === id)) return id;

    const toast: Toast = {
      id,
      variant: input.variant,
      title: input.title,
      body: input.body,
      avatarUrl: input.avatarUrl ?? null,
      onClick: input.onClick,
      action: input.action,
      createdAt: Date.now(),
      paused: false,
    };
    items.value = [...items.value, toast];

    // Auto-dismiss timer — bỏ qua nếu paused tại thời điểm timeout.
    const duration = input.dismissAfterMs ?? DEFAULT_DURATION_MS;
    if (duration > 0) {
      setTimeout(() => {
        const t = items.value.find((x) => x.id === id);
        if (t && !t.paused) dismiss(id);
      }, duration);
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
  /** Xoá 1 toast. */
  const dismiss = (id: string): void => {
    items.value = items.value.filter((t) => t.id !== id);
  };

  /** Pause auto-dismiss (khi user hover). */
  const pause = (id: string): void => {
    const t = items.value.find((x) => x.id === id);
    if (t) t.paused = true;
  };

  /** Resume auto-dismiss sau hover-out. KHÔNG tự đếm lại timer — chỉ cờ
   *  trạng thái, toast sẽ tự dismiss khi timer gốc đến hạn. */
  const resume = (id: string): void => {
    const t = items.value.find((x) => x.id === id);
    if (t) t.paused = false;
  };

  /** Xoá tất cả (vd khi logout). */
  const clear = (): void => {
    items.value = [];
  };

  return { items, push, dismiss, pause, resume, clear };
});
