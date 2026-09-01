<script setup lang="ts">
/**
 * ConfirmModal — dialog xác nhận chung (delete, destructive actions, ...).
 *
 * Vì sao không dùng `window.confirm`:
 *  - Style native của browser không nhất quán giữa các platform (Chrome / Safari /
 *    Firefox trên Mac/Win/Linux render khác nhau, đặc biệt dark mode trên Safari).
 *  - Không tùy chỉnh được nội dung (chỉ text thuần).
 *  - Không support i18n tốt (nút "OK"/"Cancel" bị lock theo locale của browser).
 *  - Không animate, không control được z-index khi nhiều layer.
 *  - Một số browser (Safari 14 cũ) block liên tục main thread khi show.
 *
 * Cách dùng:
 *  ```vue
 *  <ConfirmModal
 *    v-model:open="confirmOpen"
 *    title="Xóa phiên?"
 *    message="Toàn bộ hội thoại sẽ bị xóa vĩnh viễn."
 *    confirm-text="Xóa"
 *    variant="danger"
 *    :loading="deleting"
 *    @confirm="onConfirmDelete"
 *  />
 *  ```
 *
 * - Teleport to body để tránh stacking context của ancestor (vd sidebar có
 *   `overflow:hidden` + transform sẽ che modal).
 * - Trap focus bên trong modal (Tab/Shift+Tab không thoát ra ngoài).
 * - Backdrop click = cancel (trừ khi `dismissible: false`).
 * - ESC = cancel.
 */
import { nextTick, onBeforeUnmount, ref, watch as watchDeep } from 'vue';
import { AlertTriangle, X } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    /** 'danger' = nút confirm đỏ (xóa, hủy, ...). Default = primary đen. */
    variant?: 'default' | 'danger';
    /** Disable backdrop click + ESC (khi đang loading, không cho đóng giữa chừng). */
    dismissible?: boolean;
    /** Disable cả 2 nút + backdrop khi đang xử lý async. */
    loading?: boolean;
  }>(),
  {
    confirmText: 'Xác nhận',
    cancelText: 'Hủy',
    variant: 'default',
    dismissible: true,
    loading: false,
  },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const dialogEl = ref<HTMLDivElement | null>(null);
const confirmBtnEl = ref<HTMLButtonElement | null>(null);

const close = (): void => {
  if (!props.dismissible || props.loading) return;
  emit('update:open', false);
  emit('cancel');
};

const onConfirm = (): void => {
  if (props.loading) return;
  emit('confirm');
};

/**
 * Focus trap + auto-focus nút confirm khi mở (UX: user có thể Enter ngay
 * để confirm — đặc biệt với action destructive thì nên focus nút cancel
 * để user phải chủ động chọn, NHƯNG ở đây chọn confirm cho nhanh — caller
 * vẫn có thể custom bằng cách đặt `confirmText` rõ ràng).
 */
const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

watchDeep(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    confirmBtnEl.value?.focus();
  },
);

const onKeydown = (e: KeyboardEvent): void => {
  if (!props.open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (e.key !== 'Tab' || !dialogEl.value) return;
  const focusables = Array.from(
    dialogEl.value.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((el) => !el.hasAttribute('data-focus-skip'));
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
};

// Cleanup keydown listener khi unmount (defensive — global listener).
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
watchDeep(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      keyHandler = onKeydown;
      window.addEventListener('keydown', keyHandler);
    } else if (keyHandler) {
      window.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
  },
);
onBeforeUnmount(() => {
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
});
</script>

<template>
  <Teleport to="body">
    <!--
      Backdrop + dialog. Dùng Transition `modal` (custom) để fade backdrop
      + scale dialog. Chỉ mount inner khi open=true để có thể unmount hoàn
      toàn, giải phóng focus + scroll lock.
    -->
    <Transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`confirm-modal-title`"
        :aria-describedby="`confirm-modal-desc`"
        @mousedown.self="close"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />

        <!-- Dialog -->
        <div
          ref="dialogEl"
          class="relative z-10 w-full max-w-md rounded-xl bg-white p-5 shadow-2xl ring-1 ring-gray-200"
          @mousedown.stop
        >
          <!-- Close button (góc phải) — chỉ show khi dismissible và không loading -->
          <button
            v-if="dismissible && !loading"
            type="button"
            class="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
            title="Đóng"
            aria-label="Đóng"
            data-focus-skip
            @click="close"
          >
            <X class="h-4 w-4" />
          </button>

          <div class="flex gap-4">
            <!-- Icon (chỉ khi variant=danger để draw attention) -->
            <div
              v-if="variant === 'danger'"
              class="shrink-0"
            >
              <div class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle class="h-5 w-5 text-red-600" />
              </div>
            </div>

            <!-- Content -->
            <div class="min-w-0 flex-1">
              <h2
                id="confirm-modal-title"
                class="text-base font-semibold text-gray-900"
              >
                {{ title }}
              </h2>
              <p
                id="confirm-modal-desc"
                class="mt-2 text-sm leading-relaxed text-gray-600"
              >
                {{ message }}
              </p>
            </div>
          </div>

          <!-- Action row -->
          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="loading"
              data-focus-skip
              @click="close"
            >
              {{ cancelText }}
            </button>
            <button
              ref="confirmBtnEl"
              type="button"
              class="inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
              :class="
                variant === 'danger'
                  ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                  : 'bg-gray-900 hover:bg-gray-800 focus:ring-gray-700'
              "
              :disabled="loading"
              @click="onConfirm"
            >
              <span v-if="loading" class="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/*
 * Fade backdrop + scale dialog khi enter/leave. Total ~200ms — đủ nhanh để
 * không cảm thấy chậm, đủ chậm để user nhận ra có dialog (đặc biệt với
 * destructive action).
 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-active > div:last-child,
.modal-leave-active > div:last-child {
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from > div:last-child,
.modal-leave-to > div:last-child {
  transform: scale(0.96);
  opacity: 0;
}
</style>