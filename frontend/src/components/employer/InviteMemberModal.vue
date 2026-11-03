<script setup lang="ts">
/**
 * InviteMemberModal — modal mời thành viên bằng email.
 *
 * UI-only: tự quản lý giá trị email/role trong form (reset mỗi lần mở,
 * pre-fill từ `initialEmail` khi "Mời lại"), focus input khi mở và khoá
 * cuộn nền. Nghiệm vụ submit (validate API-side, gọi store, toast) thuộc
 * View qua event `submit`.
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { AlertCircle, Info, Loader2, UserPlus, X } from 'lucide-vue-next';
import type { CompanyMemberRole } from '@/types/companyMember';

const props = defineProps<{
  open: boolean;
  saving: boolean;
  error: string | null;
  /** Email pre-fill khi mở (flow "Mời lại"); rỗng khi mở từ nút Mời. */
  initialEmail: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: { email: string; role: CompanyMemberRole }];
}>();

const email = ref('');
const role = ref<CompanyMemberRole>('member');
const emailEl = ref<HTMLInputElement | null>(null);
let returnFocusEl: HTMLElement | null = null;

/**
 * Reset form mỗi lần mở: pre-fill email (Mời lại) hoặc rỗng, focus input,
 * khoá cuộn nền. Đóng: mở khoá cuộn (focus trả về do View giữ nút gốc).
 * Lưu overflow trước khi khoá để khôi phục đúng trạng thái ban đầu
 * (pattern chung với CreateJobModal / CvPreview), và cleanup khi unmount:
 * nếu View bị unmount khi modal đang mở (vd socket event điều hướng đi),
 * body phải được mở khoá thay vì kẹt overflow:hidden vĩnh viễn.
 */
let savedBodyOverflow = '';
watch(
  () => props.open,
  (open) => {
    if (open) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      email.value = props.initialEmail;
      role.value = 'member';
      void nextTick(() => emailEl.value?.focus());
    } else {
      document.body.style.overflow = savedBodyOverflow;
      savedBodyOverflow = '';
      email.value = '';
      role.value = 'member';
    }
  },
);

onBeforeUnmount(() => {
  // Modal unmount khi đang mở (route change giữa chừng) → trả scroll cho body.
  if (document.body.style.overflow === 'hidden') {
    document.body.style.overflow = savedBodyOverflow;
  }
  savedBodyOverflow = '';
});

const close = (): void => {
  if (props.saving) return;
  emit('close');
};

const submit = (): void => {
  if (props.saving) return;
  emit('submit', { email: email.value.trim().toLowerCase(), role: role.value });
};

/**
 * ESC bắt bằng window listener (không phải @keydown trên div modal): khi mở,
 * focus vẫn có thể nằm ở nút ngoài trang — keydown khi đó không target vào
 * div modal và @keydown.escape trên template sẽ không bao giờ fire.
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
        aria-labelledby="invite-modal-title"
        @keydown.escape="close"
        @mousedown.self="close"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[1px]" @click.self="close" />

        <!-- Dialog — compact (480px), cùng ngôn ngữ thiết kế hệ thống modal -->
        <div
          class="relative z-10 w-full max-w-[480px] rounded-2xl bg-white p-5 text-slate-900 shadow-xl ring-1 ring-slate-200 md:p-6"
          @mousedown.stop
        >
          <!-- Header: icon trái + tiêu đề/mô tả phải, nút X góc phải -->
          <div class="flex items-start gap-3.5">
            <div class="shrink-0">
              <div class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#5b4eea]/10">
                <UserPlus class="h-[18px] w-[18px] text-[#5b4eea]" aria-hidden="true" />
              </div>
            </div>
            <div class="min-w-0 flex-1 pt-0.5">
              <h2 id="invite-modal-title" class="text-[19px] font-semibold leading-snug tracking-[-0.01em] text-slate-900">
                Mời thành viên
              </h2>
              <p class="mt-0.5 text-sm leading-relaxed text-slate-500">
                Gửi lời mời tham gia công ty qua email.
              </p>
            </div>
            <button
              v-if="!saving"
              type="button"
              class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 transition duration-150 hover:bg-slate-100 hover:text-red-500 active:scale-95 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40"
              title="Đóng"
              aria-label="Đóng"
              @click="close"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <!-- Form email -->
          <div class="mt-4">
            <label for="invite-email" class="mb-1.5 block text-[13px] font-medium text-slate-700">
              Email <span class="text-red-500">*</span>
            </label>
            <input
              id="invite-email"
              ref="emailEl"
              v-model="email"
              type="email"
              placeholder="email@example.com"
              autocomplete="off"
              spellcheck="false"
              class="h-11 w-full rounded-xl border bg-white px-3.5 text-sm transition focus:outline-none focus:ring-1"
              :class="error ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : 'border-slate-200 focus:border-[#5b4eea] focus:ring-[#5b4eea]/20'"
              :disabled="saving"
              :aria-invalid="error ? 'true' : undefined"
              :aria-describedby="error ? 'invite-email-err' : 'invite-email-hint'"
              @keyup.enter="submit"
            />
            <p id="invite-email-hint" class="mt-1.5 text-xs text-slate-500">
              Nhập email đã đăng ký tài khoản JobMatch.
            </p>

            <!-- Lỗi API — giữ nguyên vị trí + hành vi hiển thị, thêm fade-slide -->
            <Transition name="error-pop">
              <div
                v-if="error"
                class="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
              >
                <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                <p id="invite-email-err" class="text-xs text-red-700" role="alert">{{ error }}</p>
              </div>
            </Transition>
          </div>

          <!-- Khối thông tin — accent tím cực nhạt, gọn -->
          <div class="mt-3 flex items-start gap-2.5 rounded-xl border border-[#5b4eea]/15 bg-[#5b4eea]/[0.05] px-3.5 py-2.5">
            <Info class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5b4eea]" aria-hidden="true" />
            <div class="min-w-0">
              <p class="text-xs font-semibold text-slate-900">Lưu ý</p>
              <p class="mt-0.5 text-xs leading-relaxed text-slate-600">
                Người được mời cần chấp nhận lời mời trước khi trở thành thành viên chính thức của công ty.
              </p>
            </div>
          </div>

          <!-- Footer: 2 nút ngang, căn phải -->
          <div class="mt-5 flex justify-end gap-2.5">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-[11px] text-[13px] font-medium text-slate-700 transition duration-150 hover:border-slate-300 hover:text-red-500 active:scale-[0.98] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none"
              :disabled="saving"
              @click="close"
            >
              Hủy
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg border border-transparent bg-[#5b4eea] px-4 py-[11px] text-[13px] font-semibold tracking-[0.02em] text-white transition duration-150 hover:bg-[#4839d8] active:scale-[0.98] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 motion-reduce:transition-none"
              :disabled="saving"
              @click="submit"
            >
              <Loader2 v-if="saving" class="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {{ saving ? 'Đang gửi...' : 'Gửi lời mời' }}
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

/* =================== Modal fade-in/out — pattern chung hệ thống modal =================== */
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
