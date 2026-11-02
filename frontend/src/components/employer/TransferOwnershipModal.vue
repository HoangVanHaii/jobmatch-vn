<script setup lang="ts">
/**
 * TransferOwnershipModal — modal xác nhận chuyển quyền sở hữu công ty.
 *
 * UI-only: hiển thị cảnh báo "không thể hoàn tác" + nút xác nhận đỏ.
 * Nghiệm vụ gọi API thuộc View qua event `confirm` (memberStore.transferOwner) —
 * component không biết gì về store/endpoint. Pattern theo InviteMemberModal:
 * khoá cuộn nền khi mở, chặn đóng khi `loading`, cleanup khi unmount giữa chừng.
 */
import { onBeforeUnmount, watch } from 'vue';
import { AlertCircle, AlertTriangle, Loader2, X } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Email thành viên nhận quyền sở hữu — hiển thị trong câu hỏi xác nhận. */
    email: string;
    /** Đang gọi API — disable 2 nút + chặn đóng modal. */
    loading: boolean;
    /** Lỗi API nếu có — hiển thị bên trong modal. */
    error?: string | null;
  }>(),
  {
    error: null,
  },
);

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

/**
 * Khoá cuộn nền khi mở; khôi phục đúng overflow gốc khi đóng. Nếu View bị
 * unmount khi modal đang mở (socket event điều hướng đi), body phải được
 * mở khoá thay vì kẹt overflow:hidden vĩnh viễn.
 */
let savedBodyOverflow = '';
watch(
  () => props.open,
  (open) => {
    if (open) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = savedBodyOverflow;
      savedBodyOverflow = '';
    }
  },
);

onBeforeUnmount(() => {
  if (document.body.style.overflow === 'hidden') {
    document.body.style.overflow = savedBodyOverflow;
  }
  savedBodyOverflow = '';
});

const close = (): void => {
  if (props.loading) return;
  emit('close');
};

const confirm = (): void => {
  if (props.loading) return;
  emit('confirm');
};

/**
 * ESC bắt bằng window listener (không phải @keydown trên div modal): khi mở,
 * focus vẫn có thể nằm ở nút ngoài trang (component không tự focus) — keydown
 * khi đó không target vào div modal và @keydown.escape sẽ không bao giờ fire.
 */
const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') close();
};
let keyHandlerAdded = false;
watch(
  () => props.open,
  (open) => {
    if (open && !keyHandlerAdded) {
      window.addEventListener('keydown', onKeydown);
      keyHandlerAdded = true;
    } else if (!open && keyHandlerAdded) {
      window.removeEventListener('keydown', onKeydown);
      keyHandlerAdded = false;
    }
  },
);
onBeforeUnmount(() => {
  if (keyHandlerAdded) window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-modal-title"
        aria-describedby="transfer-modal-desc"
        @keydown.escape="close"
        @mousedown.self="close"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[1px]" @click.self="close" />

        <!-- Dialog -->
        <div
          class="relative z-10 w-full max-w-[560px] rounded-2xl bg-white p-6 text-slate-900 shadow-2xl ring-1 ring-slate-200 md:p-7"
          @mousedown.stop
        >
          <!-- Header: tiêu đề trái + nút đóng phải -->
          <div class="flex items-start justify-between gap-4">
            <h2 id="transfer-modal-title" class="text-[22px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
              Chuyển quyền sở hữu?
            </h2>
            <button
              v-if="!loading"
              type="button"
              class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 transition duration-150 hover:bg-slate-100 hover:text-red-500 active:scale-95 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40"
              title="Đóng"
              aria-label="Đóng"
              @click="close"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <!-- Mô tả -->
          <p id="transfer-modal-desc" class="mt-2.5 text-[15px] leading-relaxed text-slate-600">
            Bạn có chắc chắn muốn chuyển quyền sở hữu cho
            <span class="font-medium text-slate-900">{{ email }}</span> không?
          </p>

          <!-- Khối cảnh báo -->
          <div class="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
            <AlertTriangle class="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            <div class="min-w-0">
              <p class="text-sm font-semibold text-slate-900">Hành động này không thể hoàn tác.</p>
              <p class="mt-1 text-[13px] leading-relaxed text-slate-600">
                Bạn sẽ mất quyền Owner và trở thành Member sau khi chuyển.
              </p>
            </div>
          </div>

          <!-- Lỗi API — hiển thị ngay trong modal, đồng bộ với InviteMemberModal -->
          <Transition name="error-pop">
            <div
              v-if="error"
              class="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5"
            >
              <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
              <p class="text-xs leading-relaxed text-red-700" role="alert">{{ error }}</p>
            </div>
          </Transition>

          <!-- Footer: 2 nút ngang, căn phải -->
          <div class="mt-6 flex justify-end gap-2.5">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-700 transition duration-150 hover:border-slate-300 hover:text-red-500 active:scale-[0.98] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none"
              :disabled="loading"
              @click="close"
            >
              Hủy
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg border border-transparent bg-red-600 px-4 py-2.5 text-[13px] font-semibold tracking-[0.02em] text-white transition duration-150 hover:bg-red-700 active:scale-[0.98] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 motion-reduce:transition-none"
              :disabled="loading"
              @click="confirm"
            >
              <Loader2 v-if="loading" class="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {{ loading ? 'Đang chuyển...' : 'Chuyển quyền sở hữu' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* =================== Khối lỗi fade-slide (hiện/bị ẩn mượt, ~150ms) =================== */
.error-pop-enter-active,
.error-pop-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.error-pop-enter-from,
.error-pop-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

/* =================== Modal fade-in/out — pattern chung InviteMemberModal =================== */
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
