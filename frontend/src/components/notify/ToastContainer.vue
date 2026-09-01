<script setup lang="ts">
/**
 * ToastContainer — render hàng đợi toast toàn cục.
 *
 * Design:
 *   - Top-right stack, gap-3, mỗi toast rộng tối đa 380px (mobile full-width).
 *   - Slide-in từ phải + fade-in (CSS transition), dismiss bằng fade-shrink.
 *   - 4 levels với palette khác nhau:
 *       success:  emerald (✓)
 *       info:     sky     (i)
 *       warning:  amber   (!)
 *       error:    rose    (✕)
 *   - Mỗi toast có icon tròn, title (optional), message, close button.
 *   - Có progress bar ngang dưới đáy hiển thị time-to-dismiss.
 *   - Action button (optional) hiện bên phải title.
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
  type LucideIcon,
} from 'lucide-vue-next';
import { useToastStore, type Toast, type ToastLevel } from '@stores/toast';

const toastStore = useToastStore();

/* ============================================================================
 * Style config per level — palette + icon + role.
 * ==========================================================================*/

interface LevelStyle {
  icon: LucideIcon;
  /** Container background gradient (toast body). */
  bodyClass: string;
  /** Icon wrapper background + ring + text. */
  iconWrapClass: string;
  /** Progress bar color. */
  barClass: string;
  /** Border tint. */
  borderClass: string;
  /** ARIA role — alert vs status. */
  role: 'status' | 'alert';
  ariaLive: 'polite' | 'assertive';
}

const LEVEL_STYLES: Record<ToastLevel, LevelStyle> = {
  success: {
    icon: CheckCircle2,
    bodyClass:
      'bg-white text-gray-900 ring-1 ring-emerald-100/80 shadow-lg shadow-emerald-500/10',
    iconWrapClass: 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/60',
    barClass: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
    borderClass: 'before:bg-emerald-500',
    role: 'status',
    ariaLive: 'polite',
  },
  info: {
    icon: Info,
    bodyClass: 'bg-white text-gray-900 ring-1 ring-sky-100/80 shadow-lg shadow-sky-500/10',
    iconWrapClass: 'bg-sky-50 text-sky-600 ring-1 ring-sky-200/60',
    barClass: 'bg-gradient-to-r from-sky-400 to-sky-500',
    borderClass: 'before:bg-sky-500',
    role: 'status',
    ariaLive: 'polite',
  },
  warning: {
    icon: AlertTriangle,
    bodyClass: 'bg-white text-gray-900 ring-1 ring-amber-100/80 shadow-lg shadow-amber-500/15',
    iconWrapClass: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200/60',
    barClass: 'bg-gradient-to-r from-amber-400 to-amber-500',
    borderClass: 'before:bg-amber-500',
    role: 'alert',
    ariaLive: 'assertive',
  },
  error: {
    icon: XCircle,
    bodyClass: 'bg-white text-gray-900 ring-1 ring-rose-100/80 shadow-lg shadow-rose-500/15',
    iconWrapClass: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200/60',
    barClass: 'bg-gradient-to-r from-rose-400 to-rose-500',
    borderClass: 'before:bg-rose-500',
    role: 'alert',
    ariaLive: 'assertive',
  },
};

/* ============================================================================
 * Computeds
 * ==========================================================================*/

const toasts = computed<Toast[]>(() => toastStore.toasts);

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
      class="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-3 px-3 pt-3 sm:px-4 sm:pt-4 sm:items-end"
      aria-label="Thông báo"
    >
      <TransitionGroup
        tag="div"
        class="flex w-full max-w-[380px] flex-col items-stretch gap-3 sm:w-[380px]"
        enter-active-class="transition ease-out duration-300"
        enter-from-class="opacity-0 translate-x-6 sm:translate-x-6"
        enter-to-class="opacity-100 translate-x-0"
        leave-active-class="transition ease-in duration-200"
        leave-from-class="opacity-100 translate-x-0 scale-100"
        leave-to-class="opacity-0 translate-x-6 scale-95"
      >
        <div
          v-for="t in toasts"
          :key="t.id"
          :role="LEVEL_STYLES[t.level].role"
          :aria-live="LEVEL_STYLES[t.level].ariaLive"
          class="pointer-events-auto relative overflow-hidden rounded-2xl backdrop-blur-md"
          :class="LEVEL_STYLES[t.level].bodyClass"
        >
          <!-- Left accent bar (3px) — colored theo level -->
          <span
            aria-hidden="true"
            class="absolute inset-y-0 left-0 w-1"
            :class="LEVEL_STYLES[t.level].borderClass"
          />

          <div class="flex items-start gap-3 p-3.5 pl-4 pr-3">
            <!-- Icon wrapper -->
            <div
              class="shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center"
              :class="LEVEL_STYLES[t.level].iconWrapClass"
              aria-hidden="true"
            >
              <component :is="LEVEL_STYLES[t.level].icon" class="w-5 h-5" />
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <p
                v-if="t.title"
                class="text-sm font-semibold leading-tight text-gray-900 mb-0.5"
              >
                {{ t.title }}
              </p>
              <p
                class="text-sm leading-snug text-gray-700 break-words"
                :class="t.title ? 'text-[13px]' : 'font-medium text-gray-900'"
              >
                {{ t.message }}
              </p>
              <button
                v-if="t.action"
                type="button"
                class="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gray-900 hover:text-gray-700 underline underline-offset-2 decoration-gray-300 hover:decoration-gray-500"
                @click="t.action.onClick(); toastStore.dismiss(t.id)"
              >
                {{ t.action.label }} →
              </button>
            </div>

            <!-- Close button -->
            <button
              type="button"
              class="shrink-0 -mt-0.5 -mr-0.5 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
              :aria-label="'Đóng thông báo'"
              @click="toastStore.dismiss(t.id)"
            >
              <X class="w-4 h-4" />
            </button>
          </div>

          <!-- Progress bar (chỉ hiện nếu có duration > 0) -->
          <div
            v-if="t.duration > 0"
            class="absolute inset-x-0 bottom-0 h-0.5 bg-gray-100/60 overflow-hidden"
            aria-hidden="true"
          >
            <div
              class="h-full origin-left"
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
</style>
