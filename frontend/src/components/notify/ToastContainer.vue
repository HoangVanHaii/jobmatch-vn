<script setup lang="ts">
/**
 * ToastContainer — render hàng đợi toast toàn cục (simple form).
 *
 * Design v2 — modern SaaS aesthetic:
 *   - Top-right stack, gap-3, mỗi toast rộng tối đa 420px (mobile full-width).
 *   - Glassmorphism: white body 96% + backdrop-blur-md + subtle gradient tint
 *     theo level.
 *   - Left accent bar gradient (3px) + colored top border highlight để phân
 *     biệt level ngay cả khi chỉ liếc qua.
 *   - Icon container: gradient bg + soft glow shadow, kích thước 10×10 (to hơn
 *     v1 9×9) + inner highlight để có cảm giác nổi 3D nhẹ.
 *   - Typography: title 14px bold tight-tracking, message 13px regular + độ
 *     tương phản vừa phải (slate-600 thay vì gray-700 cứng).
 *   - Progress bar: gradient ngang dưới đáy + soft glow + height 2px (to hơn
 *     v1 0.5px) để dễ nhìn.
 *   - Stacking animation: mỗi toast cũ hơn dịch nhẹ sang trái + scale nhỏ
 *     hơn (0.96) khi có toast mới đẩy lên — tạo cảm giác "queue" tự nhiên.
 *   - Action button: pill-style với colored border-bottom hover underline.
 *
 * Mount 1 lần ở App.vue. Teleport sang body để tránh stacking-context
 * issue với parent có overflow/transform.
 *
 * Accessibility:
 *   - role="status" cho info/success (ít urgent).
 *   - role="alert" cho warning/error (urgent, screen-reader announce ngay).
 *   - aria-live="polite"/"assertive" tương ứng.
 *   - Close button có aria-label="Đóng thông báo".
 */
import { computed } from 'vue';
import {
  CheckCircle2,
  Info,
  AlertTriangle,
  XCircle,
  X,
  Sparkles,
  ArrowRight,
  type LucideIcon,
} from 'lucide-vue-next';
import { useToastStore, type Toast, type ToastLevel } from '@stores/toast';

const toastStore = useToastStore();

/* ============================================================================
 * Style config per level — palette + icon + role.
 *
 * Mỗi level có 6 lớp class:
 *   - body       : container background + ring + shadow chính
 *   - accentBar  : gradient thanh dọc trái
 *   - iconWrap   : gradient bg icon container + ring + text
 *   - iconGlow   : colored soft glow cho icon
 *   - titleText  : màu tiêu đề (gradient text thường nặng → dùng solid đậm)
 *   - bar        : progress bar gradient
 * ==========================================================================*/

interface LevelStyle {
  icon: LucideIcon;
  /** Decorative icon (vd Sparkles) — optional, hiển thị cạnh title cho success. */
  decoIcon?: LucideIcon;
  /** Container background + ring + shadow. */
  bodyClass: string;
  /** Thanh accent dọc trái — gradient ngắn 2 màu. */
  accentBarClass: string;
  /** Icon wrapper background + ring + text. */
  iconWrapClass: string;
  /** Icon wrapper glow shadow (colored). */
  iconGlowClass: string;
  /** Title color. */
  titleClass: string;
  /** Progress bar gradient. */
  barClass: string;
  /** ARIA role — alert vs status. */
  role: 'status' | 'alert';
  ariaLive: 'polite' | 'assertive';
}

const LEVEL_STYLES: Record<ToastLevel, LevelStyle> = {
  success: {
    icon: CheckCircle2,
    decoIcon: Sparkles,
    bodyClass:
      'bg-white/95 ring-1 ring-emerald-200/60 shadow-xl shadow-emerald-500/15 backdrop-blur-md',
    accentBarClass: 'bg-gradient-to-b from-emerald-400 via-emerald-500 to-teal-500',
    iconWrapClass:
      'bg-gradient-to-br from-emerald-400 to-teal-500 text-white ring-2 ring-white/80',
    iconGlowClass: 'shadow-lg shadow-emerald-500/40',
    titleClass: 'text-emerald-900',
    barClass: 'bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500',
    role: 'status',
    ariaLive: 'polite',
  },
  info: {
    icon: Info,
    bodyClass:
      'bg-white/95 ring-1 ring-sky-200/60 shadow-xl shadow-sky-500/15 backdrop-blur-md',
    accentBarClass: 'bg-gradient-to-b from-sky-400 via-sky-500 to-blue-500',
    iconWrapClass:
      'bg-gradient-to-br from-sky-400 to-blue-500 text-white ring-2 ring-white/80',
    iconGlowClass: 'shadow-lg shadow-sky-500/40',
    titleClass: 'text-sky-900',
    barClass: 'bg-gradient-to-r from-sky-400 via-sky-500 to-blue-500',
    role: 'status',
    ariaLive: 'polite',
  },
  warning: {
    icon: AlertTriangle,
    bodyClass:
      'bg-white/95 ring-1 ring-amber-200/60 shadow-xl shadow-amber-500/20 backdrop-blur-md',
    accentBarClass: 'bg-gradient-to-b from-amber-400 via-amber-500 to-orange-500',
    iconWrapClass:
      'bg-gradient-to-br from-amber-400 to-orange-500 text-white ring-2 ring-white/80',
    iconGlowClass: 'shadow-lg shadow-amber-500/40',
    titleClass: 'text-amber-900',
    barClass: 'bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500',
    role: 'alert',
    ariaLive: 'assertive',
  },
  error: {
    icon: XCircle,
    bodyClass:
      'bg-white/95 ring-1 ring-rose-200/60 shadow-xl shadow-rose-500/20 backdrop-blur-md',
    accentBarClass: 'bg-gradient-to-b from-rose-400 via-rose-500 to-pink-600',
    iconWrapClass:
      'bg-gradient-to-br from-rose-500 to-pink-600 text-white ring-2 ring-white/80',
    iconGlowClass: 'shadow-lg shadow-rose-500/40',
    titleClass: 'text-rose-900',
    barClass: 'bg-gradient-to-r from-rose-400 via-rose-500 to-pink-600',
    role: 'alert',
    ariaLive: 'assertive',
  },
};

/* ============================================================================
 * Computeds
 * ==========================================================================*/

/**
 * ToastContainer chỉ render các toast SIMPLE (success/info/warning/error) —
 * tức là những toast được push qua `toast.success/error/info/warning()`
 * (không có `variant='chat'`).
 *
 * Chat variant (`variant: 'chat'`) do `<ToastHost />` đảm nhiệch riêng để có
 * UI riêng (avatar + click → navigate /chat). Nếu cả 2 cùng render sẽ hiện
 * 2 toast trùng nội dung → user thấy phiền.
 *
 * Filter `variant !== 'chat'` thay vì check `!variant` để future-proof: nếu
 * sau này có variant khác (vd 'invoice', 'system') → chỉ cần ToastHost hoặc
 * component mới filter riêng, ToastContainer không cần đụng.
 */
const toasts = computed<Toast[]>(() =>
  toastStore.toasts.filter((t) => t.variant !== 'chat'),
);

/** Progress bar percent — animated via CSS giảm dần theo duration. */
const progressStyle = (toast: Toast): Record<string, string> => {
  if (toast.duration <= 0) return {};
  return {
    animation: `toast-progress ${toast.duration}ms linear forwards`,
  };
};
</script>

<template>
  <!-- Teleport ra body để thoát khỏi parent stacking-context + overflow. -->
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-3 px-3 pt-3 sm:px-4 sm:pt-5 sm:items-end"
      aria-label="Thông báo"
    >
      <TransitionGroup
        tag="div"
        class="flex w-full max-w-[420px] flex-col items-stretch gap-3 sm:w-[420px]"
        enter-active-class="transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]"
        enter-from-class="opacity-0 translate-x-12 scale-95"
        enter-to-class="opacity-100 translate-x-0 scale-100"
        leave-active-class="transition-all duration-200 ease-in"
        leave-from-class="opacity-100 translate-x-0 scale-100"
        leave-to-class="opacity-0 translate-x-8 scale-95"
        move-class="transition-transform duration-300 ease-out"
      >
        <div
          v-for="(t, idx) in toasts"
          :key="t.id"
          :role="LEVEL_STYLES[t.level].role"
          :aria-live="LEVEL_STYLES[t.level].ariaLive"
          :style="idx > 0 ? { transform: `translateY(0) scale(${1 - idx * 0.02})` } : undefined"
          class="pointer-events-auto relative overflow-hidden rounded-2xl transition-transform duration-300 ease-out group"
          :class="LEVEL_STYLES[t.level].bodyClass"
        >
          <!-- Top edge highlight (1px gradient) — subtle 3D feel -->
          <span
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent"
          />

          <!-- Left accent bar (3px) — colored theo level, gradient đứng -->
          <span
            aria-hidden="true"
            class="absolute inset-y-0 left-0 w-[3px]"
            :class="LEVEL_STYLES[t.level].accentBarClass"
          />

          <div class="flex items-start gap-3 p-4 pl-5 pr-3">
            <!-- Icon wrapper — gradient bg + soft glow + ring -->
            <div
              class="shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center relative"
              :class="[LEVEL_STYLES[t.level].iconWrapClass, LEVEL_STYLES[t.level].iconGlowClass]"
              aria-hidden="true"
            >
              <!-- Inner highlight để icon nổi 3D -->
              <span
                class="absolute inset-x-1 top-1 h-2 rounded-full bg-white/30 blur-[2px]"
                aria-hidden="true"
              />
              <component :is="LEVEL_STYLES[t.level].icon" class="relative w-5 h-5 drop-shadow-sm" />
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0 pt-0.5">
              <!-- Title (optional) + deco icon cho success -->
              <div v-if="t.title" class="flex items-center gap-1.5 mb-0.5">
                <component
                  v-if="LEVEL_STYLES[t.level].decoIcon"
                  :is="LEVEL_STYLES[t.level].decoIcon"
                  class="w-3.5 h-3.5 shrink-0 opacity-80"
                  :class="LEVEL_STYLES[t.level].titleClass"
                  aria-hidden="true"
                />
                <p
                  class="text-[14px] font-bold leading-tight tracking-tight truncate"
                  :class="LEVEL_STYLES[t.level].titleClass"
                >
                  {{ t.title }}
                </p>
              </div>
              <p
                class="text-[13px] leading-relaxed break-words text-slate-600"
                :class="t.title ? '' : 'font-medium text-slate-900 text-[13.5px]'"
              >
                {{ t.message }}
              </p>

              <!-- Action button — pill với arrow + hover gradient bg -->
              <button
                v-if="t.action"
                type="button"
                class="mt-2.5 inline-flex items-center gap-1 h-7 px-2.5 -ml-1 rounded-lg text-[12px] font-semibold text-slate-700 hover:text-slate-900 bg-slate-900/[0.04] hover:bg-slate-900/[0.08] ring-1 ring-slate-900/5 hover:ring-slate-900/10 transition-all duration-150 group/btn"
                @click="t.action.onClick?.(); toastStore.dismiss(t.id)"
              >
                {{ t.action.label }}
                <ArrowRight class="w-3 h-3 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
              </button>
            </div>

            <!-- Close button — subtle, hover xoay nhẹ -->
            <button
              type="button"
              class="shrink-0 -mt-0.5 -mr-1 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-900/[0.06] transition-all duration-150"
              :aria-label="'Đóng thông báo'"
              @click="toastStore.dismiss(t.id)"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <!-- Progress bar (chỉ hiện nếu có duration > 0) — gradient + soft glow -->
          <div
            v-if="t.duration > 0"
            class="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
            aria-hidden="true"
          >
            <div
              class="h-full origin-left shadow-[0_0_8px_currentColor]"
              :class="LEVEL_STYLES[t.level].barClass"
              :style="progressStyle(t)"
            />
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
/**
 * Keyframes cho progress bar — width 100% → 0% trong `duration` ms.
 * `forwards` giữ final state (=0) để không reset về 100 khi animation xong.
 *
 * Why scoped: chỉ dùng cho progress, không ảnh hưởng global.
 */
@keyframes toast-progress {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}

/**
 * Subtle pulse cho progress bar — nhẹ nhàng để user cảm nhận toast đang
 * đếm ngược (không gây mất tập trung).
 */
@keyframes toast-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.85; }
}
</style>
