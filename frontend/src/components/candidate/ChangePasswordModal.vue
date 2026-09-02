<script setup lang="ts">
/**
 * ChangePasswordModal — modal đổi mật khẩu cho candidate.
 *
 * Mount từ SettingsView khi user bấm nút "Đổi mật khẩu" ở card Bảo mật.
 * CHỈ mount khi `hasPassword === true` — OAuth-only user không có password cũ
 * để verify → backend /auth/change-password sẽ fail 401 ngay.
 *
 * Form:
 *   - Mật khẩu hiện tại (verify bcrypt ở BE).
 *   - Mật khẩu mới (≥ 8 ký tự, phải khác mật khẩu hiện tại).
 *   - Xác nhận mật khẩu mới (phải khớp).
 *
 * UX:
 *   - Click backdrop hoặc nhấn Esc → đóng modal (KHÔNG reset form ngay, giữ draft).
 *   - Toggle show/hide password cho từng input.
 *   - Disable submit khi invalid + show spinner khi đang submit.
 *   - Sau khi đổi thành công → toast success + reset form + đóng modal.
 *   - Sau khi đóng (cancel), reset form 200ms sau (chờ animation fade-out).
 *
 * Lưu ý bảo mật:
 *   - KHÔNG lưu password vào localStorage / pinia persist.
 *   - KHÔNG log password ra console.
 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Save,
  X,
} from 'lucide-vue-next';
import { useToastStore } from '@stores/toast';
import { userApi } from '@services/user.api';

interface Props {
  /** Bind từ SettingsView: `:open` + `@update:open`. */
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  /** Đóng modal — emit khi user click backdrop, Esc, Hủy, hoặc đóng sau submit. */
  (e: 'update:open', value: boolean): void;
}>();

/* ============================================================================
 Form state
 - showCurrent/showNew/showConfirm: toggle hiện/ẩn cho từng input.
 - submitting: lock form khi đang gọi API.
 - errorMessage: lỗi inline (BE trả 401/400) hoặc lỗi validation FE.
 ==========================================================================*/

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const form = reactive<PasswordForm>({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const showCurrent = ref(false);
const showNew = ref(false);
const showConfirm = ref(false);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

const toast = useToastStore();

/** Reset form + error — dùng khi modal đóng hẳn hoặc sau submit thành công. */
const resetForm = (): void => {
  form.currentPassword = '';
  form.newPassword = '';
  form.confirmPassword = '';
  showCurrent.value = false;
  showNew.value = false;
  showConfirm.value = false;
  errorMessage.value = null;
};

/* ============================================================================
 Validation
 - currentPassword không rỗng.
 - newPassword >= 8 ký tự (đồng bộ backend).
 - confirmPassword === newPassword.
 - newPassword KHÁC currentPassword — tránh "đổi" mà không thay đổi.
 ==========================================================================*/

const isCurrentFilled = computed<boolean>(() => form.currentPassword.length > 0);
const isNewMinLength = computed<boolean>(() => form.newPassword.length >= 8);
const isConfirmMatch = computed<boolean>(
  () => form.confirmPassword === form.newPassword && form.confirmPassword.length > 0,
);
const isDifferentFromCurrent = computed<boolean>(
  () => form.newPassword.length > 0 && form.newPassword !== form.currentPassword,
);

const isValid = computed<boolean>(
  () =>
    isCurrentFilled.value &&
    isNewMinLength.value &&
    isConfirmMatch.value &&
    isDifferentFromCurrent.value,
);

const newPasswordHint = computed<string | null>(() => {
  if (form.newPassword.length === 0) return null;
  if (!isNewMinLength.value) {
    return `Còn ${8 - form.newPassword.length} ký tự nữa`;
  }
  if (!isDifferentFromCurrent.value) {
    return 'Mật khẩu mới phải khác mật khẩu hiện tại';
  }
  return null;
});

const confirmHint = computed<string | null>(() => {
  if (form.confirmPassword.length === 0) return null;
  return isConfirmMatch.value ? null : 'Mật khẩu xác nhận không khớp';
});

/* ============================================================================
 Submit
 ==========================================================================*/

/**
 * Gọi POST /auth/change-password. Backend map lỗi qua field `code`:
 *   - INVALID_PASSWORD (401) — currentPassword sai.
 *   - SAME_PASSWORD (400) — newPassword trùng currentPassword.
 */
const submit = async (): Promise<void> => {
  if (!isValid.value || submitting.value) return;

  errorMessage.value = null;
  submitting.value = true;
  try {
    await userApi.changePassword(form.currentPassword, form.newPassword);
    toast.success('Đổi mật khẩu thành công.');
    resetForm();
    emit('update:open', false);
  } catch (err: unknown) {
    const code = (err as { response?: { data?: { code?: string; message?: string } } })?.response
      ?.data?.code;
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data
      ?.message;
    if (code === 'INVALID_PASSWORD') {
      errorMessage.value = 'Mật khẩu hiện tại không đúng';
    } else if (code === 'SAME_PASSWORD') {
      errorMessage.value = 'Mật khẩu mới phải khác mật khẩu hiện tại';
    } else if (typeof message === 'string' && message.length > 0) {
      errorMessage.value = message;
    } else {
      errorMessage.value = 'Đổi mật khẩu thất bại. Vui lòng thử lại.';
    }
  } finally {
    submitting.value = false;
  }
};

/* ============================================================================
 Close + Esc handling
 ==========================================================================*/

const close = (): void => {
  // Không reset form ngay — để user đóng/mở nhiều lần không mất draft.
  // Reset sau khi modal đóng hẳn (xem watcher dưới).
  emit('update:open', false);
};

const cancel = (): void => {
  // Nút "Hủy" → reset form ngay + đóng (intent rõ ràng là hủy thao tác).
  resetForm();
  emit('update:open', false);
};

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && props.open) {
    e.preventDefault();
    close();
  }
};

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});

/** Reset form khi modal đóng hẳn qua Esc/backdrop (KHÔNG phải qua nút Hủy/Submit).
 *  Cancel/Submit đã tự resetForm trước khi emit, nên watcher chỉ chạy cho
 *  các đường đóng còn lại (Esc, backdrop). */
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen && !submitting.value) {
      window.setTimeout(() => resetForm(), 200);
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="cp-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
        @click.self="close"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-pw-title"
      >
        <Transition name="cp-pop" appear>
          <div
            class="bg-white rounded-2xl shadow-2xl shadow-slate-900/20 w-full max-w-md my-8 overflow-hidden"
          >
            <!-- Header -->
            <div
              class="relative flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white"
            >
              <div
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary-700 shrink-0"
              >
                <KeyRound class="h-5 w-5" />
              </div>
              <div class="flex-1 min-w-0">
                <h2 id="change-pw-title" class="text-base font-semibold text-slate-900">
                  Đổi mật khẩu
                </h2>
                <p class="text-xs text-slate-500 mt-0.5 truncate">
                  Cập nhật mật khẩu cho tài khoản của bạn
                </p>
              </div>
              <button
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
                title="Đóng"
                aria-label="Đóng"
                @click="close"
              >
                <X class="h-4 w-4" />
              </button>
            </div>

            <!-- Body -->
            <div class="px-5 sm:px-6 py-5 max-h-[calc(100vh-12rem)] overflow-y-auto">
              <form class="space-y-3.5" @submit.prevent="submit">
                <!-- Current password -->
                <div>
                  <label
                    for="cp-current-pw"
                    class="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Mật khẩu hiện tại
                  </label>
                  <div class="relative">
                    <input
                      id="cp-current-pw"
                      v-model="form.currentPassword"
                      :type="showCurrent ? 'text' : 'password'"
                      autocomplete="current-password"
                      placeholder="Nhập mật khẩu hiện tại"
                      :disabled="submitting"
                      class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    <button
                      type="button"
                      class="absolute inset-y-0 right-0 flex items-center justify-center w-9 text-slate-400 hover:text-slate-700 transition"
                      :title="showCurrent ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                      :aria-label="showCurrent ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                      @click="showCurrent = !showCurrent"
                    >
                      <EyeOff v-if="showCurrent" class="h-4 w-4" />
                      <Eye v-else class="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <!-- New password -->
                <div>
                  <label
                    for="cp-new-pw"
                    class="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Mật khẩu mới
                  </label>
                  <div class="relative">
                    <input
                      id="cp-new-pw"
                      v-model="form.newPassword"
                      :type="showNew ? 'text' : 'password'"
                      autocomplete="new-password"
                      placeholder="Tối thiểu 8 ký tự"
                      :disabled="submitting"
                      class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                      :class="
                        newPasswordHint && form.newPassword.length > 0
                          ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-500/30'
                          : ''
                      "
                    />
                    <button
                      type="button"
                      class="absolute inset-y-0 right-0 flex items-center justify-center w-9 text-slate-400 hover:text-slate-700 transition"
                      :title="showNew ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                      :aria-label="showNew ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                      @click="showNew = !showNew"
                    >
                      <EyeOff v-if="showNew" class="h-4 w-4" />
                      <Eye v-else class="h-4 w-4" />
                    </button>
                  </div>
                  <p
                    v-if="newPasswordHint"
                    class="mt-1 text-[11px] text-amber-600 leading-tight"
                  >
                    {{ newPasswordHint }}
                  </p>
                </div>

                <!-- Confirm password -->
                <div>
                  <label
                    for="cp-confirm-pw"
                    class="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Xác nhận mật khẩu mới
                  </label>
                  <div class="relative">
                    <input
                      id="cp-confirm-pw"
                      v-model="form.confirmPassword"
                      :type="showConfirm ? 'text' : 'password'"
                      autocomplete="new-password"
                      placeholder="Nhập lại mật khẩu mới"
                      :disabled="submitting"
                      class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                      :class="
                        confirmHint && form.confirmPassword.length > 0
                          ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-500/30'
                          : ''
                      "
                    />
                    <button
                      type="button"
                      class="absolute inset-y-0 right-0 flex items-center justify-center w-9 text-slate-400 hover:text-slate-700 transition"
                      :title="showConfirm ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                      :aria-label="showConfirm ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                      @click="showConfirm = !showConfirm"
                    >
                      <EyeOff v-if="showConfirm" class="h-4 w-4" />
                      <Eye v-else class="h-4 w-4" />
                    </button>
                  </div>
                  <p
                    v-if="confirmHint"
                    class="mt-1 text-[11px] text-amber-600 leading-tight"
                  >
                    {{ confirmHint }}
                  </p>
                </div>

                <!-- Inline error (BE trả 401/400) -->
                <div
                  v-if="errorMessage"
                  class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                  role="alert"
                >
                  <AlertCircle class="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span class="leading-snug">{{ errorMessage }}</span>
                </div>

                <!-- Action buttons -->
                <div class="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    :disabled="submitting"
                    class="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-50 transition"
                    @click="cancel"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    :disabled="!isValid || submitting"
                    class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 transition"
                  >
                    <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
                    <Save v-else class="h-4 w-4" />
                    {{ submitting ? 'Đang lưu...' : 'Đổi mật khẩu' }}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Transition cho backdrop fade-in/out. */
.cp-fade-enter-active,
.cp-fade-leave-active {
  transition: opacity 200ms ease-out;
}
.cp-fade-enter-from,
.cp-fade-leave-to {
  opacity: 0;
}

/* Transition cho card scale-up. */
.cp-pop-enter-active,
.cp-pop-leave-active {
  transition: transform 200ms ease-out, opacity 200ms ease-out;
}
.cp-pop-enter-from,
.cp-pop-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}
</style>