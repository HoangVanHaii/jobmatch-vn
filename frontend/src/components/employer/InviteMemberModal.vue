<script setup lang="ts">
/**
 * InviteMemberModal — modal mời thành viên bằng email.
 *
 * UI-only: tự quản lý giá trị email/role trong form (reset mỗi lần mở,
 * pre-fill từ `initialEmail` khi "Mời lại"), focus input khi mở và khoá
 * cuộn nền. Nghiệm vụ submit (validate API-side, gọi store, toast) thuộc
 * View qua event `submit`.
 */
import { nextTick, ref, watch } from 'vue';
import { AlertCircle, Loader2, UserPlus, X } from 'lucide-vue-next';
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
 */
watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      email.value = props.initialEmail;
      role.value = 'member';
      void nextTick(() => emailEl.value?.focus());
    }
  },
);

const close = (): void => {
  if (props.saving) return;
  emit('close');
};

const submit = (): void => {
  if (props.saving) return;
  emit('submit', { email: email.value.trim().toLowerCase(), role: role.value });
};
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
      >
        <!-- Click backdrop (div con che toàn màn) → đóng; .self chỉ với click trực tiếp -->
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[1px]" @click.self="close" />
        <div
          class="relative z-10 w-full max-w-md rounded-xl bg-white p-5 text-slate-900 shadow-2xl ring-1 ring-slate-200"
          @mousedown.stop
        >
          <button
            v-if="!saving"
            type="button"
            class="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40"
            title="Đóng"
            aria-label="Đóng"
            @click="close"
          >
            <X class="h-4 w-4" />
          </button>

          <div class="flex gap-4">
            <div class="shrink-0">
              <div class="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#5b4eea]/10">
                <UserPlus class="h-5 w-5 text-[#5b4eea]" />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <h2 id="invite-modal-title" class="text-base font-semibold text-slate-900">
                Mời thành viên
              </h2>
              <p class="mt-1 text-sm text-slate-500">
                Thêm một thành viên vào công ty bằng email.
              </p>
            </div>
          </div>

          <div class="mt-4 space-y-3">
            <div>
              <label for="invite-email" class="mb-1.5 block text-xs font-medium text-slate-700">
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
                class="w-full rounded-lg border bg-white px-3 py-2 text-sm transition focus:outline-none focus:ring-1"
                :class="error ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : 'border-slate-200 focus:border-[#5b4eea] focus:ring-[#5b4eea]/20'"
                :disabled="saving"
                :aria-invalid="error ? 'true' : undefined"
                :aria-describedby="error ? 'invite-email-err' : 'invite-email-hint'"
                @keyup.enter="submit"
              />
              <p id="invite-email-hint" class="mt-1 text-[11px] text-slate-500">
                Email của user đã đăng ký tài khoản trên JobMatch. Hệ thống sẽ gửi thông báo mời.
              </p>
            </div>

            <div
              v-if="error"
              class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
            >
              <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <p id="invite-email-err" class="text-xs text-red-700" role="alert">{{ error }}</p>
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              :disabled="saving"
              @click="close"
            >
              Hủy
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-lg border border-transparent bg-[#5b4eea] px-3.5 py-2 text-[13px] font-semibold tracking-[0.04em] text-white transition-colors duration-150 hover:bg-[#4839d8] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
              :disabled="saving"
              @click="submit"
            >
              <Loader2 v-if="saving" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
              {{ saving ? 'Đang gửi...' : 'Gửi lời mời' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* =================== Modal fade-in/out =================== */
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
