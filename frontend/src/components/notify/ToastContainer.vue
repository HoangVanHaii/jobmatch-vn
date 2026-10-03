<script setup lang="ts">
/**
 * ToastContainer — render toast đơn (single) ở top-right dạng CARD trắng.
 *
 * Mô hình reference: BPM `D:/metadata/business-process-management-platform`
 * (`.luuly-glaze` shell + pill Toast.tsx với dismiss + condense-up animation).
 * Anchor `.toast` của BPM là `position: fixed; top: 72px; left: 50%;
 * translateX(-50%); z-index: 90` — ta đặt z-index 100 để vẫn nằm trên modal
 * (z-50) và cao hơn ToastHost chat (z-60).
 *
 * Design (mockup toast card — cập nhật 2026-10, thay pill glaze cũ):
 *   - Single toast: chỉ render entry MỚI NHẤT trong queue (latest). Push entry
 *     mới → replace ngay (giống BPM Shell state `navToast`). Queue cũ vẫn nằm
 *     trong store và tự hết sau `duration` — container KHÔNG prune queue để
 *     tránh mất message trước khi user kịp đọc.
 *   - Card trắng đặc (không còn backdrop-blur/glaze), 3 phần dọc: HEADER
 *     (icon theo tone + title + chevron mở rộng + nút X), BODY (message +
 *     action, thu/mở bằng max-height), FOOTER (đếm ngược "Nhấn để dừng" +
 *     progress bar màu tone chạy theo `duration` của toast).
 *   - AROMOR ARIA: `role="status"` (info/success, polite) hoặc
 *     `role="alert"` (warning/error, assertive) — screen reader announce đúng
 *     mức độ urgent.
 *   - Stack scope: chỉ render toast SIMPLE (không có `variant='chat'`). Chat
 *     realtime do `<ToastHost />` lo (filter `variant === 'chat'` ở file đó) → 2
 *     component cùng đọc 1 queue nhưng render tầng khác nhau, không hiện 2
 *     toast trùng.
 */
import { computed, ref, watch, defineComponent, h, type Component } from 'vue';
import {
  X,
  CircleCheck,
  TriangleAlert,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-vue-next';
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
 * Tone config — màu icon + màu progress bar + ARIA role cho mỗi level.
 *
 * WHY chỉ icon + bar mang màu tone (không tô title/message): title luôn đen
 * giữ độ đọc được, màu tone chỉ dùng làm tín hiệu thị giác phụ theo mockup.
 * Màu lấy từ design tokens của mockup toast card.
 * -------------------------------------------------------------------------- */
interface ToneCfg {
  /** Màu icon theo tone (header, 18px). */
  iconColor: string;
  /** Màu progress bar cuối footer. */
  barColor: string;
  /** ARIA role + live region per tone (xem comment class header). */
  role: 'status' | 'alert';
  ariaLive: 'polite' | 'assertive';
}

const TONE_CFG: Record<ToastLevel, ToneCfg> = {
  success: {
    iconColor: '#22A55B',
    barColor: '#22A55B',
    role: 'status',
    ariaLive: 'polite',
  },
  info: {
    iconColor: '#1AA6C7',
    barColor: '#1AA6C7',
    role: 'status',
    ariaLive: 'polite',
  },
  warning: {
    iconColor: '#E6A817',
    barColor: '#E6A817',
    role: 'alert',
    ariaLive: 'assertive',
  },
  error: {
    iconColor: '#E5233D',
    barColor: '#E5233D',
    role: 'alert',
    ariaLive: 'assertive',
  },
};

/* Icon theo tone (mockup): success tick tròn, warning tam giác "!", info
 * trong vòng tròn. Config hiển thị thuần — không logic. */

/**
 * HexagonAlert — mockup tone error dùng LỤC GIÁC ĐỀU viền + dấu "!" ở giữa,
 * lucide chỉ có OctagonAlert (bát giác) nên vẽ tay bằng SVG inline để khớp
 * 100% hình reference. Pointy-top hexagon đều R=9 (đỉnh trên/dưới), line "!"
 * dọc 8→13 + chấm round-cap ở 16.5. Stroke qua `currentColor` nên vẫn ăn
 * `iconColor` của TONE_CFG y như icon lucide. Component render-thuần, KHÔNG
 * có state — chỉ là config hiển thị thay thế icon.
 */
const HexagonAlert: Component = defineComponent({
  name: 'HexagonAlert',
  props: {
    size: { type: [Number, String], default: 24 },
    strokeWidth: { type: [Number, String], default: 2 },
  },
  setup(props) {
    return () =>
      h('svg', {
        viewBox: '0 0 24 24',
        width: props.size,
        height: props.size,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': props.strokeWidth,
        'stroke-linejoin': 'round',
      }, [
        // Lục giác đều đỉnh trên/dưới: (12,3) (19.79,7.5) (19.79,16.5) (12,21) (4.21,16.5) (4.21,7.5)
        h('path', {
          d: 'M12 3l7.79 4.5v9L12 21l-7.79-4.5v-9L12 3z',
          'stroke-linecap': 'round',
        }),
        h('line', {
          x1: '12', y1: '8', x2: '12', y2: '13',
          'stroke-linecap': 'round',
        }),
        // Chấm "!" — lệch 0.01 đơn vị để mọi renderer vẽ được round-cap dot.
        h('line', {
          x1: '12', y1: '16.5', x2: '12', y2: '16.51',
          'stroke-linecap': 'round',
        }),
      ]);
  },
});

const TONE_ICON: Record<ToastLevel, Component> = {
  success: CircleCheck,
  error: HexagonAlert,
  warning: TriangleAlert,
  info: Info,
};

const onAction = (t: Toast): void => {
  t.action?.onClick?.();
  store.dismiss(t.id);
};

const onDismiss = (t: Toast): void => {
  store.dismiss(t.id);
};

/* ----------------------------------------------------------------------------
 * UI-only state — KHÔNG đụng logic store, chỉ điều khiển hiển thị.
 * -------------------------------------------------------------------------- */

/** Body thu/mở (chevron). Toast mới phải bắt đầu thu gọn nên reset theo id. */
const expanded = ref(false);

/** Cờ freeze animation progress bar ở UI (đi kèm store.pause/resume). */
const timerPaused = ref(false);

// WHY RESET THEO ID: `expanded`/`timerPaused` là state của container (nằm ngoài
// `<Transition :key>`), không tự reset khi toast mới replace toast cũ → watch
// id để toast kế tiếp luôn vào ở trạng thái thu gọn + bar chạy lại từ đầu.
watch(
  () => latest.value?.id,
  () => {
    expanded.value = false;
    timerPaused.value = false;
  },
);

/** Body chỉ có nội dung khi (title + message) hoặc action — theo mockup. */
const hasBody = computed<boolean>(() => {
  const t = latest.value;
  if (!t) return false;
  return (!!t.title && !!t.message) || !!t.action;
});

/** Duration hiển thị (ms). Store luôn set `duration` (default 4000) — `??` chỉ
 * là guard khi latest null. 0 = không auto-dismiss → ẩn luôn footer countdown. */
const durationMs = computed<number>(() => latest.value?.duration ?? 4000);

/** Số giây hiển thị trong footer. Math.max(1,…) để duration <500ms không ra
 * "0 giây" trong khi toast vẫn đang hiện. */
const durationSec = computed<number>(() =>
  Math.max(1, Math.round(durationMs.value / 1000)),
);

const onToggleExpand = (): void => {
  expanded.value = !expanded.value;
};

/**
 * "Nhấn để dừng" — store ĐÃ có sẵn API `pause(id)`/`resume(id)` nên gọi thẳng
 * (cờ `paused` được store check khi timeout fire). `timerPaused` chỉ dừng
 * ANIMATION progress bar ở UI cho khớp; bản thân semantics timer thuộc về
 * store, container không tự bấm giờ thay.
 */
const onToggleTimer = (): void => {
  const t = latest.value;
  if (!t) return;
  if (timerPaused.value) {
    store.resume(t.id);
    timerPaused.value = false;
  } else {
    store.pause(t.id);
    timerPaused.value = true;
  }
};
</script>

<template>
  <!--
    Anchor: sát góc trên phải (top 12px, thẳng hàng NotificationBell — bell
    là fixed top-3 right-2 z-50). z-100 cao hơn bell/modal (z-50) và ToastHost
    (z-60) → toast tạm che chuông trong lúc hiện (4s hoặc đến khi dismiss).
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
          class="toast-card pointer-events-auto"
          :role="TONE_CFG[latest.level].role"
          :aria-live="TONE_CFG[latest.level].ariaLive"
          :data-tone="latest.level"
        >
          <!-- ================= HEADER =================
               Icon tone + title (luôn đậm đen) + chevron + X. Nếu toast không
               có title → message đứng ở vị trí title (vẫn đậm đen). -->
          <div class="toast-header">
            <span
              aria-hidden="true"
              class="toast-icon shrink-0"
              :style="{ color: TONE_CFG[latest.level].iconColor }"
            >
              <component
                :is="TONE_ICON[latest.level]"
                :size="18"
                :stroke-width="1.75"
              />
            </span>

            <p class="toast-title">
              {{ latest.title || latest.message }}
            </p>

            <div class="toast-header-actions">
              <!-- Chevron chỉ có nghĩa khi có body để mở → ẩn khi rỗng. -->
              <button
                v-if="hasBody"
                type="button"
                class="toast-icon-btn"
                :aria-label="expanded ? 'Thu gọn' : 'Mở rộng'"
                :aria-expanded="expanded"
                @click="onToggleExpand"
              >
                <ChevronUp
                  v-if="expanded"
                  :size="15"
                  :stroke-width="1.75"
                  aria-hidden="true"
                />
                <ChevronDown
                  v-else
                  :size="15"
                  :stroke-width="1.75"
                  aria-hidden="true"
                />
              </button>

              <!-- Dismiss × (giữ nguyên handler onDismiss). -->
              <button
                type="button"
                class="toast-icon-btn"
                aria-label="Đóng thông báo"
                @click="onDismiss(latest)"
              >
                <X :size="15" :stroke-width="1.75" aria-hidden="true" />
              </button>
            </div>
          </div>

          <!-- ================= BODY =================
               Chỉ hiện khi expanded VÀ có nội dung (title + message, hoặc
               action). Thu/mở bằng max-height + opacity ~200ms; max-height
               280px ≈ 14 dòng message — đủ chứa text dài nhất thực tế, đổi
               quá lớn sẽ làm transition mở bị trễ. -->
          <div v-if="hasBody" class="toast-collapse" :class="{ open: expanded }">
            <div class="toast-collapse-inner">
              <!-- Message chỉ lặp ở đây khi đã có title (nếu không, message
                   đang đứng ở header rồi). -->
              <p v-if="latest.title && latest.message" class="toast-message">
                {{ latest.message }}
              </p>

              <!-- Action OUTLINE (bỏ ArrowRight cũ). Handler onAction giữ nguyên. -->
              <button
                v-if="latest.action"
                type="button"
                class="toast-action"
                @click="onAction(latest)"
              >
                {{ latest.action.label }}
              </button>
            </div>
          </div>

          <!-- ================= FOOTER =================
               Đếm ngược + "Nhấn để dừng" (toggle store.pause/resume) + progress
               bar màu tone chạy 100% → 0% đúng bằng `duration` của toast.
               duration = 0 (không auto-dismiss) → ẩn cả footer cho khỏi hiện
               "đóng sau 0 giây" với toast thật ra không tự đóng. -->
          <div v-if="durationMs > 0" class="toast-footer">
            <button
              type="button"
              class="toast-footer-btn"
              :aria-pressed="timerPaused"
              @click="onToggleTimer"
            >
              <template v-if="timerPaused">
                Đã tạm dừng. <strong>Nhấn để tiếp tục.</strong>
              </template>
              <template v-else>
                Thông báo này sẽ đóng sau {{ durationSec }} giây.
                <strong>Nhấn để dừng.</strong>
              </template>
            </button>
            <div class="toast-progress-track" aria-hidden="true">
              <div
                class="toast-progress-bar"
                :class="{ paused: timerPaused }"
                :style="{
                  background: TONE_CFG[latest.level].barColor,
                  animationDuration: durationMs + 'ms',
                }"
              />
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
/* ============================================================================
 * Anchor — sát góc trên phải viewport: top 12px thẳng hàng với NotificationBell
 * (bell là `fixed top-3 right-2 z-50`). Trước đây anchor ở top 72px (dưới
 * topbar) → user feedback "hơi thấp" → đưa lên corner. Toast chỉ transient
 * (4s/pause) nên việc tạm che chuông không đáng kể.
 * z-index 100 (cao hơn bell/modal 50 + ToastHost 60) để không bị che.
 * =========================================================================*/
.toast-anchor {
  position: fixed;
  top: 12px;
  right: 16px;
  z-index: 100;
  max-width: min(92vw, 380px);
  width: max-content;
  display: flex;
  justify-content: flex-end;
}

/* ============================================================================
 * Card — toast giờ là CARD TRẮNG ĐẶC (thay pill glaze/backdrop-blur cũ):
 * nền trắng, radius 8, shadow mềm 2 lớp, overflow hidden để footer + progress
 * bar được vuốt sát 2 góc dưới. Width ~360px nằm trong khoảng 340–380 mockup.
 * =========================================================================*/
.toast-card {
  display: flex;
  flex-direction: column;
  width: 360px;
  max-width: 100%;
  box-sizing: border-box;
  background: #ffffff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.08),
    0 8px 24px rgba(0, 0, 0, 0.06);
}

/* ============================================================================
 * Header — icon tone + title đen đậm + cụm nút phải (chevron + X).
 * Title LUÔN đen (slate-900) — màu tone chỉ nằm ở icon (xem Tone config).
 *
 * WHY flex-start (thay vì center): khi title xuống 2 dòng, center làm icon +
 * cụm nút phải trôi xuống giữa khối text, lệch khỏi dòng đầu theo mockup →
 * căn từ trên để icon/nút khóa ở dòng đầu tiên.
 * =========================================================================*/
.toast-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
}

.toast-icon {
  display: inline-flex;
  flex-shrink: 0;
  /* Nudge 1px để tâm icon thẳng baseline dòng đầu với title 14px. */
  margin-top: 1px;
}

.toast-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.005em;
  color: #0f172a; /* slate-900 — title luôn đen dù tone nào */
  word-break: break-word;
}

.toast-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}

/* Nút icon 22×22 (chevron + X) — xám #6B7280, hover nền xám nhạt. */
.toast-icon-btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 5px;
  color: #6b7280;
  cursor: pointer;
  transition:
    color 120ms ease,
    background 120ms ease;
}
.toast-icon-btn:hover {
  color: #374151;
  background: #f3f4f6;
}
.toast-icon-btn:focus-visible {
  outline: 2px solid #11535b; /* BPM --focus-ring (giữ nguyên cũ) */
  outline-offset: 2px;
}

/* ============================================================================
 * Body thu/mở — dùng max-height + opacity (~200ms) thay vì v-show để có
 * transition mượt. `open` bật max-height dương; overflow hidden cả 2 trạng
 * thái để text không tràn ra khi đang animate.
 * =========================================================================*/
.toast-collapse {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition:
    max-height 200ms ease,
    opacity 200ms ease;
}
.toast-collapse.open {
  max-height: 280px;
  opacity: 1;
}

/* WHY left 40px: message + action thẳng hàng với TITLE (thụt sau icon) theo
 * mockup, không thẳng hàng với icon = 14 (padding header) + 18 (icon) +
 * 8 (gap header) = 40px. */
.toast-collapse-inner {
  padding: 0 14px 12px 40px;
}

/* Message trong body: 13px xám đậm #4B5563 (không còn tint màu theo tone). */
.toast-message {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: #4b5563;
  word-break: break-word;
}

/* ============================================================================
 * Action — nút OUTLINE nhỏ (border xám, nền trắng) theo mockup; bỏ arrow.
 * =========================================================================*/
.toast-action {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  color: #111827;
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease;
}
.toast-action + .toast-action,
.toast-message + .toast-action {
  margin-top: 10px;
}
.toast-action:hover {
  background: #f3f4f6;
}
.toast-action:focus-visible {
  outline: 2px solid #11535b;
  outline-offset: 2px;
}

/* ============================================================================
 * Footer — nền xám rất nhạt + text đếm ngược (11.5px xám #9CA3AF, phần
 * "Nhấn để dừng." đậm đen) + progress bar 3px màu tone ở mép dưới.
 * =========================================================================*/
.toast-footer {
  background: #f6f8f9;
}

.toast-footer-btn {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 14px;
  text-align: left;
  font-size: 11.5px;
  line-height: 1.4;
  color: #9ca3af;
  background: transparent;
  border: none;
  cursor: pointer;
}
.toast-footer-btn strong {
  font-weight: 600;
  color: #111827;
}
.toast-footer-btn:focus-visible {
  outline: 2px solid #11535b;
  outline-offset: -2px;
}

.toast-progress-track {
  height: 3px;
}

/* Bar chạy 100% → 0% bằng transform: scaleX (thay vì width) — GPU-composited,
 * không trigger layout mỗi frame nên mượt hơn; transform-origin left để bar
 * co dần từ PHẢI về trái như đồng hồ đếm ngược. animation-duration bind từ
 * `duration` của toast (ms) qua inline style. linear cho tốc độ đều. */
.toast-progress-bar {
  height: 100%;
  width: 100%;
  transform-origin: left center;
  animation-name: toast-progress-scale;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
/* "Nhấn để dừng" — chỉ đóng băng ANIMATION (timer thật do store.pause lo). */
.toast-progress-bar.paused {
  animation-play-state: paused;
}

@keyframes toast-progress-scale {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

/* ============================================================================
 * Animation vào/ra — GIỮ NGUYÊN toast-condense / toast-dissolve cũ, chỉ đổi
 * selector theo class card mới.
 *
 * `forwards` cho leave giữ final state (=opacity 0) để toast biến mất hẳn.
 * =========================================================================*/
.v-enter-active.toast-card {
  animation: toast-condense 400ms cubic-bezier(0.2, 0.85, 0.3, 1);
}
.v-leave-active.toast-card {
  animation: toast-dissolve 200ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
  /* WHY absolute: Transition đổi :key chạy enter/leave ĐỒNG THỜI — nếu card cũ
     vẫn nằm trong flex flow thì 2 card cùng bị co (flex-shrink) trong anchor
     max-width 380px → card mới hiện dạng "ô vuông" bẹp trong ~200ms rồi mới
     giãn ra 360px khi card cũ unmount (spam toast thứ 2 trở đi). Đưa card cũ
     ra khỏi flow (nó là absolute đè lên card mới, anchor là position:fixed
     nên làm containing block) → card mới vào ngay đúng cỡ, 2 card cross-fade
     mượt. pointer-events none để không bấm nhầm vào toast đang biến mất. */
  position: absolute;
  right: 0;
  top: 0;
  pointer-events: none;
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

/* Reduced motion — tắt animation vào/ra VÀ cả progress bar (thanh đứng yên
 * full-width, toast vẫn tự đóng theo timer như thường). */
@media (prefers-reduced-motion: reduce) {
  .v-enter-active.toast-card,
  .v-leave-active.toast-card {
    animation: none;
  }
  .toast-progress-bar {
    animation: none;
  }
}
</style>
