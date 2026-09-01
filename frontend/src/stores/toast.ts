/**
 * Toast Pinia store — quản lý hàng đợi toast (thông báo transient).
 *
 * Tách ra riêng vì:
 *   - Toast là UI state ephemeral, dùng ở mọi nơi nên cần 1 store global
 *     (khác với store như notification Bell — chỉ gắn với 1 widget cụ thể).
 *   - Không persist, không cần gọi API — chỉ quản lý queue + auto-dismiss.
 *
 * 2 renderer cùng đọc từ store này:
 *   - `<ToastContainer />`  ([components/notify/ToastContainer.vue])
 *       Render toast simple (success/info/warning/error) với icon + title +
 *       message + progress bar. Đọc `toasts`, `t.level`, `t.message`, …
 *   - `<ToastHost />`        ([components/common/ToastHost.vue])
 *       Render toast chat realtime (peer message) với avatar + click +
 *       pause-on-hover. Đọc `items` (alias của `toasts`), `t.variant`,
 *       `t.body`, `t.avatarUrl`, `t.onClick`, `pause/resume`.
 *
 * Vì cả 2 share cùng queue nên store phải support CẢ 2 shape:
 *   - Simple form: `toast.success('msg')` → push level=success, message=msg
 *   - Chat form:   `toast.push({ variant: 'chat', title, body, avatarUrl,
 *     onClick, action, ... })` → push full object với chat variant
 *
 * Cả 2 form gộp vào cùng 1 Toast interface — field nào không có = undefined.
 * Chat variant được map sang `level='info'` để ToastContainer render nó
 * dạng info (cùng vị trí với toastHost) — chấp nhận hiển thị 2 nơi nhưng
 * đảm bảo user không miss notification.
 *
 * Usage:
 *   import { useToastStore } from '@stores/toast';
 *   const toast = useToastStore();
 *   toast.success('Đã lưu CV!');
 *   toast.error('Upload thất bại', { title: 'Lỗi upload', duration: 6000 });
 *
 *   // Chat variant (dùng cho socket realtime)
 *   toast.push({
 *     id: `${convId}:${msgId}`,
 *     variant: 'chat',
 *     title: peerName,
 *     body: messagePreview,
 *     avatarUrl: peer.avatarUrl,
 *     onClick: () => navigateToChat(),
 *   });
 *
 * 4 levels:
 *   - success  ✓ — hành động thành công
 *   - info     ℹ — thông tin chung
 *   - warning  ! — cảnh báo (không chặn flow)
 *   - error    ✕ — lỗi (failed action)
 *
 * Auto-dismiss:
 *   - `duration` (default 4000) — auto xoá sau khoảng đó. 0 = không auto-dismiss.
 *   - Pause khi user hover (ToastHost quản lý qua `pause(id)` / `resume(id)`).
 *     Khi pause, timer vẫn chạy nhưng không dismiss cho tới khi resume.
 *
 * ID generation:
 *   - Caller truyền id (vd conversationId + messageId cho chat dedupe).
 *   - Nếu không, auto-gen bằng `t_<base36-time>_<random>`. Đủ unique cho queue ephemeral.
 *   - Chat variant có thể pass `id` để dedupe khi socket emit duplicate.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastLevel = 'success' | 'info' | 'warning' | 'error';
export type ToastVariant = 'chat' | 'info' | 'success' | 'error';

export interface ToastAction {
  /** Nhãn nút action (vd "Mở"). Optional — chỉ hiện khi có onClick. */
  label?: string;
  /** Click handler — navigate hoặc side-effect. */
  onClick?: () => void;
}

export interface Toast {
  id: string;
  /* === Simple form (dùng bởi ToastContainer + helpers success/error/...) === */
  /** Style level cho ToastContainer — map từ variant nếu push chat. */
  level: ToastLevel;
  /** Nội dung chính hiển thị trong ToastContainer. Cũng dùng làm fallback
   *  cho `body` nếu push chat variant mà quên truyền body. */
  message: string;
  /** Tiêu đề ngắn (vd "Lỗi upload"). */
  title?: string;
  /** Thời gian hiển thị (ms). 0 = không auto-dismiss. */
  duration: number;
  /** Action button hiển thị bên phải toast. */
  action?: ToastAction;
  /* === Chat form (dùng bởi ToastHost) === */
  /** Variant — 'chat' dùng cho peer message realtime. Optional. */
  variant?: ToastVariant;
  /** Body preview (chat message content). */
  body?: string;
  /** Avatar URL — null/undefined → fallback tùy variant. */
  avatarUrl?: string | null;
  /** Click vào body (chat variant). */
  onClick?: () => void;
  /* === Internal state === */
  /** Timestamp tạo — dùng cho progress bar + check quá hạn. */
  createdAt: number;
  /** Set true khi user hover → auto-dismiss tạm dừng. */
  paused?: boolean;
}

export interface ToastOptions {
  /** Tiêu đề ngắn (vd. "Lỗi upload"). Optional — fallback dùng message. */
  title?: string;
  /** Thời gian hiển thị (ms). 0 = không auto-dismiss. Default 4000. */
  duration?: number;
  /** Action button hiển thị bên phải toast. */
  action?: ToastAction;
}

const DEFAULT_DURATION = 4000;

/** Random ID không cần dùng crypto — đủ unique cho queue ephemeral. */
const newId = (): string =>
  `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Map ToastVariant → ToastLevel cho ToastContainer rendering. */
const variantToLevel = (v: ToastVariant): ToastLevel => {
  if (v === 'success') return 'success';
  if (v === 'error') return 'error';
  // 'chat' và 'info' đều render như info (neutral, không urgent)
  return 'info';
};

export const useToastStore = defineStore('toast', () => {
  /** Queue chính — `items` chỉ là alias để ToastHost đọc (cùng ref). */
  const toasts = ref<Toast[]>([]);
  /** Map timeout handle → toast id, clear khi dismiss manually. */
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Internal: schedule auto-dismiss cho 1 toast. Pause-aware. */
  const scheduleDismiss = (id: string, duration: number): void => {
    if (duration <= 0) return;
    const handle = setTimeout(() => {
      const t = toasts.value.find((x) => x.id === id);
      if (t && !t.paused) dismiss(id);
    }, duration);
    timers.set(id, handle);
  };

  /** Push toast — hỗ trợ 2 dạng:
   *    1. Simple: `push(level: ToastLevel, message: string, opts?: ToastOptions)`
   *    2. Rich:   `push(input: Omit<Toast, 'id' | 'createdAt'> & { id?, dismissAfterMs? })`
   *  Return id để caller có thể dismiss / pause sau. */
  const push = (...args: unknown[]): string => {
    // Form 1: simple level-based (toast.success/error/warning/info wrappers)
    if (typeof args[0] === 'string') {
      const [level, message, opts = {}] = args as [ToastLevel, string, ToastOptions?];
      const id = newId();
      const duration = opts.duration ?? DEFAULT_DURATION;
      const toast: Toast = {
        id,
        level,
        message,
        title: opts.title,
        duration,
        action: opts.action,
        createdAt: Date.now(),
      };
      toasts.value = [...toasts.value, toast];
      scheduleDismiss(id, duration);
      return id;
    }

    // Form 2: rich object (chat variant dùng)
    const input = args[0] as Omit<Toast, 'id' | 'createdAt'> & {
      id?: string;
      dismissAfterMs?: number;
    };
    const id =
      input.id ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : newId());

    // Dedupe: nếu đã có toast cùng id → noop.
    if (toasts.value.some((t) => t.id === id)) return id;

    const variant = input.variant;
    const duration = input.dismissAfterMs ?? DEFAULT_DURATION;
    const toast: Toast = {
      id,
      level: variant ? variantToLevel(variant) : (input.level ?? 'info'),
      message: input.message ?? input.body ?? '',
      title: input.title,
      duration,
      action: input.action,
      variant,
      body: input.body,
      avatarUrl: input.avatarUrl ?? null,
      onClick: input.onClick,
      createdAt: Date.now(),
      paused: false,
    };
    toasts.value = [...toasts.value, toast];
    scheduleDismiss(id, duration);
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

  /** Pause auto-dismiss (khi user hover). Timer vẫn chạy nhưng check `paused`
   *  trước khi dismiss — khi resume, lần check tiếp theo sẽ dismiss. */
  const pause = (id: string): void => {
    const t = toasts.value.find((x) => x.id === id);
    if (t) t.paused = true;
  };

  /** Resume auto-dismiss sau hover-out. KHÔNG reset timer — chỉ cờ trạng thái. */
  const resume = (id: string): void => {
    const t = toasts.value.find((x) => x.id === id);
    if (t) t.paused = false;
  };

  /** Xoá tất cả toast (vd. khi logout, route thay đổi lớn). */
  const clear = (): void => {
    timers.forEach((handle) => clearTimeout(handle));
    timers.clear();
    toasts.value = [];
  };

  return {
    // === State ===
    /** Primary queue — ToastContainer đọc từ đây. */
    toasts,
    /** Alias cho ToastHost — cùng ref với `toasts`, không phải clone. */
    items: toasts,
    // === Actions ===
    /** Push entry — polymorphic (string-based hoặc object-based). */
    push,
    /** Convenience wrappers — hầu hết callers dùng cái này. */
    success: (message: string, opts?: ToastOptions) =>
      push('success', message, opts),
    info: (message: string, opts?: ToastOptions) =>
      push('info', message, opts),
    warning: (message: string, opts?: ToastOptions) =>
      push('warning', message, opts),
    error: (message: string, opts?: ToastOptions) =>
      push('error', message, opts),
    dismiss,
    pause,
    resume,
    clear,
  };
});
