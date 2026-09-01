/**
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

export type ToastVariant = 'chat' | 'info' | 'success' | 'error';

export interface ToastAction {
  /** Click handler — thường navigate tới conv/job/... */
  label?: string;
  onClick?: () => void;
}

export interface Toast {
  id: string;
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
