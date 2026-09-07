<script setup lang="ts">
/**
 * ToastContainer — render toast đơn (single) ở top-center theo BPM pattern.
 *
 * Mô hình reference: BPM `D:/metadata/business-process-management-platform`
 * (`.luuly-glaze` shell + pill Toast.tsx với tone dot + dismiss + condense-up
 * animation). Anchor `.toast` của BPM là `position: fixed; top: 72px; left: 50%;
 * translateX(-50%); z-index: 90` — ta đặt z-index 100 để vẫn nằm trên modal
 * (z-50) và cao hơn ToastHost chat (z-60).
 *
 * Design:
 *   - Single toast: chỉ render entry MỚI NHẤT trong queue (latest). Push entry
 *     mới → replace ngay (giống BPM Shell state `navToast`). Queue cũ vẫn nằm
 *     trong store và tự hết sau `duration` — container KHÔNG prune queue để
 *     tránh mất message trước khi user kịp đọc.
 *   - Pill glaze: trắng gradient nhẹ + backdrop-blur + rim glow. Tone dot 9×9
 *     borderRadius 3 với gradient per-tone (jade/blue/amber/red). Dismiss ×
 *     bên phải, action pill bên dưới message nếu có.
 *   - Aromor ARIA: `role="status"` (info/success, polite) hoặc
 *     `role="alert"` (warning/error, assertive) — screen reader announce đúng
 *     mức độ urgent.
 *   - Stack scope: chỉ render toast SIMPLE (không có `variant='chat'`). Chat
 *     realtime do `<ToastHost />` lo (filter `variant === 'chat'` ở file đó) → 2
 *     component cùng đọc 1 queue nhưng render tầng khác nhau, không hiện 2
 *     toast trùng.
 */
import { computed } from 'vue';
import { X, ArrowRight } from 'lucide-vue-next';
import { useToastStore, type Toast, type ToastLevel } from '@stores/toast';

const store = useToastStore();

/**
 * Latest non-chat toast. `variant !== 'chat'` filter giống phiên bản cũ để
 * không trùng với ToastHost (chat realtime).
 *
 * WHY LATEST-ONLY: user chọn "Single toast, replace khi có mới" → UI chỉ hiển
 * thị 1 entry. Queue cũ vẫn có trong store và sẽ tự hết sau timeout, không
 * can thiệp từ component để tránh mất message trước khi user kịp đọc.
 */
const latest = computed<Toast | null>(() => {
  const list = store.toasts.filter((t) => t.variant !== 'chat');
  return list.length === 0 ? null : list[list.length - 1];
});

/* ----------------------------------------------------------------------------
 * Tone config — dot gradient + ARIA role cho mỗi level.
 *
 * Gradient theo từng tone map với glaze palette của BPM `luuly.css`:
 *   - success → `--glaze-jade` (xanh ngọc)
 *   - info    → glaze-blue   (xanh dương) — BPM không có 'info' tone, dùng blue
 *   - warning → `--glaze-amber`
 *   - error   → `--glaze-red`
 *
 * Inline gradient cho tone dot để không phụ thuộc CSS variables ở root (project
 * jobmatch-vn chưa có glaze tokens) — copy đúng màu BPM để giữ nhất quán visual.
 * -------------------------------------------------------------------------- */
interface ToneCfg {
  dotBg: string;
  /** Text emphasis color cho title + message khi là error (urgent). */
  textAccent: string;
  /** ARIA role + live region per tone (xem comment class header). */
  role: 'status' | 'alert';
  ariaLive: 'polite' | 'assertive';
}

const TONE_CFG: Record<ToastLevel, ToneCfg> = {
  success: {
    dotBg: 'linear-gradient(180deg, #3E8F6C 0%, #2E7D5B 100%)', // glaze-jade
    textAccent: 'text-emerald-900',
    role: 'status',
    ariaLive: 'polite',
  },
  info: {
    dotBg: 'linear-gradient(180deg, #3D7EA6 0%, #2F6A8F 100%)', // glaze-blue
    textAccent: 'text-sky-900',
    role: 'status',
    ariaLive: 'polite',
  },
  warning: {
    dotBg: 'linear-gradient(180deg, #D29A2A 0%, #B9861B 100%)', // glaze-amber
    textAccent: 'text-amber-900',
    role: 'alert',
    ariaLive: 'assertive',
  },
  error: {
    dotBg: 'linear-gradient(180deg, #C24C3E 0%, #B43A2E 100%)', // glaze-red
    textAccent: 'text-rose-900',
    role: 'alert',
    ariaLive: 'assertive',
  },
};

const onAction = (t: Toast): void => {
  t.action?.onClick?.();
  store.dismiss(t.id);
};

const onDismiss = (t: Toast): void => {
  store.dismiss(t.id);
};
</script>

<template>
  <!--
    Anchor: BPM `.toast` dùng fixed top:72px + left:50% + translateX(-50%).
    Tailwind có sẵn `top-[72px] left-1/2 -translate-x-1/2`.
    z-100 cao hơn modal z-50 và ToastHost z-60 để không bị che.
  -->
  <Teleport to="body">
    <div
      class="toast-anchor pointer-events-none"
      aria-label="Thông báo"
    >
      <!-- Top-right: offset right 16px (cùng gutter với topbar). -->
      <Transition>
        <div
          v-if="latest"
          :key="latest.id"
          class="toast-pill pointer-events-auto"
          :role="TONE_CFG[latest.level].role"
          :aria-live="TONE_CFG[latest.level].ariaLive"
          :data-tone="latest.level"
        >
          <!-- Tone dot: 9×9 borderRadius 3 (BPM Toast.tsx). -->
          <span
            aria-hidden="true"
            class="toast-dot shrink-0"
            :style="{ background: TONE_CFG[latest.level].dotBg }"
          />

          <!-- Text block: title (optional) + message + action (optional). -->
          <div class="toast-body min-w-0 flex-1">
            <p
              v-if="latest.title"
              class="toast-title"
              :class="TONE_CFG[latest.level].textAccent"
            >
              {{ latest.title }}
            </p>
            <p
              class="toast-message"
              :class="[
                latest.title ? 'with-title' : 'standalone',
                latest.level === 'success' || latest.level === 'info'
                  ? 'text-slate-800'
                  : TONE_CFG[latest.level].textAccent,
              ]"
            >
              {{ latest.message }}
            </p>

            <!-- Action pill: optional. Click → onClick → dismiss. -->
            <button
              v-if="latest.action"
              type="button"
              class="toast-action"
              @click="onAction(latest)"
            >
              {{ latest.action.label }}
              <ArrowRight class="action-arrow" aria-hidden="true" />
            </button>
          </div>

          <!-- Dismiss × button (BPM Toast.tsx pattern). -->
          <button
            type="button"
            class="toast-dismiss shrink-0"
            aria-label="Đóng thông báo"
            @click="onDismiss(latest)"
          >
            <X class="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
/* ============================================================================
 * Anchor — BPM `.toast` (luuly.css): fixed top-center, dưới topbar.
 * z-index 100 (cao hơn modal 50 + ToastHost 60) để không bị che.
 * =========================================================================*/
.toast-anchor {
  position: fixed;
  top: 72px;
  right: 16px;
  z-index: 100;
  max-width: min(92vw, 380px);
  width: max-content;
  display: flex;
  justify-content: flex-end;
}

/* ============================================================================
 * Pill — BPM `.luuly-glaze` rim + shadow + gradient trắng trong suốt + backdrop
 * blur. Pill shape `border-radius: 999px`. Inline-flex căn giữa theo chiều dọc.
 *
 * Inner top highlight `inset 0 1px 0 rgba(255,255,255,0.6)` mô phỏng glaze 3D
 * nhẹ. Right padding nhỏ để dismiss button không chen vào text.
 * =========================================================================*/
.toast-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px 8px 10px;
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(255, 255, 255, 0.88) 100%);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow:
    0 1px 2px rgba(20, 48, 47, 0.05),
    0 8px 24px rgba(20, 48, 47, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  max-width: 100%;
  box-sizing: border-box;
}

/* ============================================================================
 * Tone dot — 9×9 rounded-square (BPM Toast.tsx). Inset white highlight ở top
 * để tạo cảm giác khối 3D nhẹ.
 * =========================================================================*/
.toast-dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

/* ============================================================================
 * Body (text column) — title + message + action.
 *
 * WHY COLUMN (không phải row như BPM Toast): title + message dài cần wrap →
 * column layout tự nhiên hơn. BPM chỉ có 1 dòng message nên dùng row OK; ở
 * jobmatch title có thể 2-3 từ + message có thể wrap.
 * =========================================================================*/
.toast-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  flex: 1;
}

.toast-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.25;
  margin: 0;
  letter-spacing: -0.005em;
}

.toast-message {
  font-size: 13px;
  line-height: 1.4;
  margin: 0;
  word-break: break-word;
  color: #5a6763; /* slate-600 — BPM --text-2 */
}
/* Khi có title → message nhỏ hơn, secondary feel. */
.toast-message.with-title {
  font-size: 12.5px;
  color: #5a6763;
  margin-top: 1px;
}
/* Message alone (không title) → đậm hơn một chút để dễ scan. */
.toast-message.standalone {
  font-weight: 500;
}

/* ============================================================================
 * Action pill — BPM không có (chỉ children message). jobmatch-cũ v2 có
 * `ToastAction` → giữ support, style subtle để không vỡ pill.
 * =========================================================================*/
.toast-action {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
  padding: 2px 6px;
  font-size: 12px;
  font-weight: 600;
  color: #11535b; /* BPM --primary */
  background: transparent;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  transition: background 120ms ease;
}
.toast-action:hover {
  background: rgba(17, 83, 91, 0.06);
}
.action-arrow {
  width: 12px;
  height: 12px;
  transition: transform 200ms ease;
}
.toast-action:hover .action-arrow {
  transform: translateX(2px);
}

/* ============================================================================
 * Dismiss × — 22×22 transparent bg với hover nền nhẹ + ink color.
 * Lấy cảm hứng từ BPM `.luuly-focusable` (focus-visible outline 2px solid).
 * =========================================================================*/
.toast-dismiss {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 5px;
  color: #8a9591; /* BPM --text-3 */
  cursor: pointer;
  transition:
    color 120ms ease,
    background 120ms ease;
}
.toast-dismiss:hover {
  color: #16201e; /* BPM --text */
  background: rgba(0, 0, 0, 0.04);
}
.toast-dismiss:focus-visible {
  outline: 2px solid #11535b; /* BPM --focus-ring */
  outline-offset: 2px;
}

/* ============================================================================
 * Animation — BPM `luuly-condense` cho entrance (translateY 8→0, scale 0.97→1,
 * opacity 0→1) + custom dissolve cho leave (translateY 0→-6, scale 1→0.97,
 * opacity 1→0).
 *
 * `forwards` cho leave giữ final state (=opacity 0) để toast biến mất hẳn.
 * =========================================================================*/
.v-enter-active.toast-pill {
  animation: toast-condense 400ms cubic-bezier(0.2, 0.85, 0.3, 1);
}
.v-leave-active.toast-pill {
  animation: toast-dissolve 200ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes toast-condense {
  from {
    transform: translateY(8px) scale(0.97);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

@keyframes toast-dissolve {
  from {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
  to {
    transform: translateY(-6px) scale(0.97);
    opacity: 0;
  }
}

/* Mobile — topbar thường nhỏ hơn desktop, hạ anchor xuống 64px. */
@media (max-width: 640px) {
  .toast-anchor {
    top: 64px;
  }
}

/* Reduced motion — tắt animation để tránh giật cho user vestibular sensitive. */
@media (prefers-reduced-motion: reduce) {
  .v-enter-active.toast-pill,
  .v-leave-active.toast-pill {
    animation: none;
  }
}
</style>
