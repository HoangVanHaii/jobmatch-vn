<style scoped>
/* Page enter: fade + slide-up nhẹ. Stagger qua animation-delay (0/80/160ms). */
@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.animate-fade-up {
  animation: fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* Logo box "thở nhẹ" — scale 1 → 1.06 → 1, chu kỳ 3s. */
@keyframes pulse-logo {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
.animate-pulse-logo {
  animation: pulse-logo 3s ease-in-out infinite;
  transform-origin: center center;
}

/* Editorial accent bar grow */
@keyframes grow-bar {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
.animate-grow-bar {
  animation: grow-bar 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
  transform-origin: left center;
}

/* Benefit line grow — đường kẻ dọc 2px bên trái mỗi benefit */
.benefit-line {
  position: relative;
}
.benefit-line::before {
  content: '';
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 2px;
  background-color: rgb(147 197 253 / 0.7);
  transform: scaleY(0);
  transform-origin: top center;
  animation: grow-line 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes grow-line {
  to { transform: scaleY(1); }
}
.benefit-line:nth-child(1)::before { animation-delay: 100ms; }
.benefit-line:nth-child(2)::before { animation-delay: 180ms; }
.benefit-line:nth-child(3)::before { animation-delay: 260ms; }

/* Blob float */
@keyframes blob {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(15px, -20px) scale(1.05); }
  66% { transform: translate(-10px, 15px) scale(0.95); }
}
.animate-blob {
  animation: blob 14s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .animate-fade-up,
  .animate-blob,
  .animate-pulse-logo,
  .animate-grow-bar,
  .benefit-line::before {
    animation: none !important;
    transform: none !important;
  }
}

/* Shake input khi validation fail — biên độ 6-8px, nhiều mốc rung, dứt khoát.
   Đồng bộ với @keyframes shake + .animate-shake trong Login/Register/VerifyOtp. */
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%      { transform: translateX(-7px); }
  20%      { transform: translateX(7px); }
  30%      { transform: translateX(-6px); }
  40%      { transform: translateX(6px); }
  50%      { transform: translateX(-4px); }
  60%      { transform: translateX(4px); }
  70%      { transform: translateX(-2px); }
  80%      { transform: translateX(2px); }
  90%      { transform: translateX(-1px); }
}
.animate-shake {
  animation: shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

/* Error box slide-down (Vue Transition) */
.error-enter-active {
  transition: all 0.2s ease-out;
}
.error-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
@media (prefers-reduced-motion: reduce) {
  .animate-shake,
  .error-enter-active {
    animation: none !important;
  }
}

/* Underline animation cho link auth */
.link-underline {
  position: relative;
}
.link-underline::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 0.25s ease-out;
}
.link-underline:hover::after {
  transform: scaleX(1);
}
</style>

<script setup lang="ts">
/**
 * ForgotPasswordView — Quên mật khẩu / Đặt lại mật khẩu JobMatch.
 *
 * Flow 3 bước trong CÙNG 1 page (không navigate):
 *   1. 'request' — nhập email → gọi authApi.forgotPassword(email) → chuyển bước 2
 *   2. 'verify'  — nhập OTP + mật khẩu mới + xác nhận → authApi.resetPassword(...)
 *   3. 'success' — state tĩnh, nút "Đăng nhập" → router.push({ name: 'login' })
 *
 * Tại sao không navigate giữa các bước:
 *   - UX liền mạch (user vẫn giữ context email đã nhập).
 *   - Không cần pass state qua query/route.
 *   - Cùng brand visual system với Login/Register.
 *
 * Bảo mật:
 *   - BE `forgotPassword` LUÔN trả 200 với message generic (không enumeration).
 *     Do đó FE không phân biệt được email tồn tại hay không — chỉ cần hiển thị
 *     bước tiếp theo, không leak qua error message.
 *   - OTP 6 số, TTL 5 phút (BE side), resend cooldown 60s (BE rate-limit).
 *   - Mật khẩu mới phải ≥ 8 ký tự (khớp resetPasswordSchema).
 *
 * UI/UX (đồng bộ Login/Register):
 *   - Cùng ambient gradient bg-slate-50 + decorative blobs + container max-w-[1200px].
 *   - 2 cột desktop (branding trái + form phải); mobile ẩn branding.
 *   - Form max-w-[440px], input/button/error style y hệt Login.
 *   - Step indicator 2 dots ngang trên đầu form.
 *   - Transition mượt giữa các step (mode="out-in").
 */
import { ref, computed, onUnmounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Eye,
  EyeOff,
  Briefcase,
  KeyRound,
  Clock,
  RefreshCw,
  CheckCircle2,
  ArrowLeft,
  Mail,
} from 'lucide-vue-next';
import { authApi } from '@services/auth.api';
import { extractErrorCode, extractErrorMessage } from '@services/http';
import { useAnimatedCount } from '@composables/useAnimatedCount';
import OtpInput from '@components/auth/OtpInput.vue';
import { useToastStore } from '@stores/toast';

type Step = 'request' | 'verify' | 'success';

const router = useRouter();
const toast = useToastStore();

/* ============================================================================
 * Form state
 * ==========================================================================*/

const step = ref<Step>('request');

/** Step 1: email người dùng nhập. Giữ nguyên khi chuyển step để hiển thị masked. */
const email = ref('');

/** Step 2 */
const otp = ref('');
const otpInputRef = ref<InstanceType<typeof OtpInput> | null>(null);
/** Ref cho email input step 1 — focus khi shake-on-submit fail. */
const forgotEmailInputRef = ref<HTMLInputElement | null>(null);
const newPassword = ref('');
const confirmPassword = ref('');
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);

/** UX state */
const loading = ref(false);
const resending = ref(false);
const cooldown = ref(0);

let cooldownTimer: ReturnType<typeof setInterval> | null = null;

/** Touched flags — chỉ show inline error sau khi user đã tương tác với field
 *  để tránn error đỏ hiện ra ngay khi page mount. */
const emailTouched = ref(false);
const newPasswordTouched = ref(false);
const confirmTouched = ref(false);

/** Email shake counter — bump để remount :key và trigger lại CSS `animate-shake`
 *  khi user click "Gửi mã OTP" với email invalid. Pattern đồng bộ với Login/Register.
 *
 *  Audit 2026-09-28: trước fix, input thiếu `:key` → chỉ bind :class. CSS animation
 *  chỉ trigger khi class được ADD lần đầu → spam submit không re-trigger shake.
 *  Thêm `:key="`forgot-email-${emailShake}`"` để mỗi lần counter đổi → Vue unmount
 *  + mount lại element → animation reset và chạy lại từ đầu. */
const emailShake = ref(0);

/** API submit error (BE trả về) — KHÁC với client-side inline error.
 *  submitError hiện trên banner đỏ phía trên button submit. */
const submitError = ref('');

/* ============================================================================
 * Stats counter animation — đếm từ 0 → target khi mount.
 * M2+V2+M1 FIX: dùng composable useAnimatedCount (đồng bộ với 3 trang kia).
 * Trước đây ForgotPasswordView hiển thị số tĩnh "12K+", "850+", "96%" → lệch pattern.
 * ==========================================================================*/
const { jobsCount, companiesCount, satisfactionCount } = useAnimatedCount();

/* ============================================================================
 * Step indicator mapping
 * ==========================================================================*/

/** step number hiện tại trong indicator 2-dot (1 = request, 2 = verify; success ẩn indicator). */
const currentStepNumber = computed<1 | 2 | null>(() => {
  if (step.value === 'request') return 1;
  if (step.value === 'verify') return 2;
  return null;
});

/* ============================================================================
 * Validation — chỉ áp dụng khi field đã touched (UX đỡ noise)
 * ==========================================================================*/

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value));

const emailError = computed(() => {
  if (!emailTouched.value) return '';
  if (!email.value) return 'Vui lòng nhập email';
  if (!emailValid.value) return 'Email không hợp lệ';
  return '';
});

const newPasswordError = computed(() => {
  if (!newPasswordTouched.value) return '';
  if (!newPassword.value) return 'Vui lòng nhập mật khẩu mới';
  // BUG #5 FIX: check password complexity — đồng bộ với BE passwordSchema (T7).
  if (newPassword.value.length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự';
  if (!/[A-Z]/.test(newPassword.value)) return 'Mật khẩu phải có ít nhất 1 chữ hoa';
  if (!/[a-z]/.test(newPassword.value)) return 'Mật khẩu phải có ít nhất 1 chữ thường';
  if (!/[0-9]/.test(newPassword.value)) return 'Mật khẩu phải có ít nhất 1 chữ số';
  return '';
});

/** Confirm error chỉ check khi user đã nhập confirm HOẶC đã submit form. */
const confirmError = computed(() => {
  if (!confirmTouched.value) return '';
  if (!confirmPassword.value) return 'Vui lòng xác nhận mật khẩu';
  if (newPassword.value !== confirmPassword.value) return 'Mật khẩu xác nhận không khớp';
  return '';
});

/** Check form Step 2 có thể submit — chỉ cần OTP 6 số + password hợp lệ. */
const canSubmitVerify = computed(
  () =>
    otp.value.length === 6 &&
    newPassword.value.length >= 8 &&
    /[A-Z]/.test(newPassword.value) &&
    /[a-z]/.test(newPassword.value) &&
    /[0-9]/.test(newPassword.value) &&
    newPassword.value === confirmPassword.value,
);

/* ============================================================================
 * Masked email cho step 2 subtitle
 *
 * Ví dụ:
 *   "huytest@gmail.com"     → "hu••••@gmail.com"
 *   "ab@example.com"        → "ab••••@example.com"
 *   "no-at-sign"            → "no-at-sign" (không có @ → trả nguyên)
 * ==========================================================================*/

const maskedEmail = computed(() => {
  const e = email.value;
  const at = e.indexOf('@');
  if (at < 1) return e;
  const head = e.slice(0, at).slice(0, 2);
  const domain = e.slice(at);
  return `${head}${'•'.repeat(4)}${domain}`;
});

/* ============================================================================
 * Cooldown cho resend OTP — 60s (mirror với BE RESEND_COOLDOWN_SECONDS).
 *
 * Lưu ý: timer KHÔNG chạy khi ở step 'request' hoặc 'success' — chỉ chạy ở
 * step 'verify'. onUnmounted dọn để tránh leak interval khi user navigate đi.
 * ==========================================================================*/

const startCooldown = (): void => {
  cooldown.value = 60;
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  }, 1000);
};

/* ============================================================================
 * Handlers
 * ==========================================================================*/

/** Step 1 → Step 2. */
const sendCode = async (): Promise<void> => {
  emailTouched.value = true;
  submitError.value = '';
  if (!emailValid.value) {
    // Email invalid → shake input giống pattern Login/Register, focus ô để user sửa ngay.
    emailShake.value++;
    await nextTick();
    forgotEmailInputRef.value?.focus();
    return;
  }

  loading.value = true;
  try {
    await authApi.forgotPassword(email.value);
    // BE luôn trả 200 generic — không phân biệt email có tồn tại hay không.
    // Chuyển step + start countdown cho resend.
    step.value = 'verify';
    startCooldown();
    // Reset OTP field khi mount lại step 2.
    await nextTick();
    otp.value = '';
    otpInputRef.value?.reset();
  } catch (e: any) {
    // F4 FIX: dùng helper đọc đúng HttpError. BE chỉ throw khi rate-limit IP (429)
    // hoặc lỗi mạng. Không nêu email tồn tại.
    submitError.value = extractErrorMessage(
      e,
      'Không thể gửi mã OTP. Vui lòng thử lại sau.',
    );
  } finally {
    loading.value = false;
  }
};

/** Gửi lại OTP — cùng endpoint forgot-password. */
const resend = async (): Promise<void> => {
  // Defensive: chặn double-call khi user bypass UI (Enter key, devtools,
  // programmatic call) — button :disabled đã chặn click chuột nhưng không
  // cover toàn bộ attack vector.
  if (resending.value || cooldown.value > 0) return;
  submitError.value = '';
  resending.value = true;
  try {
    await authApi.forgotPassword(email.value);
    startCooldown();
    otpInputRef.value?.reset();
    otp.value = '';
    // Toast thông báo đã gửi lại — không thay step vẫn ở verify.
    toast.info(`Đã gửi lại mã OTP đến ${maskedEmail.value}`);
  } catch (e: any) {
    // F4 FIX: dùng helper đọc đúng HttpError.
    const code = extractErrorCode(e);
    if (code === 'RESEND_COOLDOWN') {
      submitError.value = 'Vui lòng đợi thêm vài giây trước khi gửi lại.';
      // ERR-1 FIX: riêng RESEND_COOLDOWN + OTP_RATE_LIMITED → startCooldown để hiển thị
      // countdown 60s + disable nút "Gửi lại". Đồng bộ với pattern VerifyOtpView (B-2 fix)
      // để user trên /forgot-password cũng thấy countdown khi hit rate limit, không phải
      // tự đoán khi nào retry.
      startCooldown();
    } else {
      submitError.value = extractErrorMessage(e, 'Gửi lại mã thất bại. Vui lòng thử lại.');
    }
  } finally {
    resending.value = false;
  }
};

/** Step 2 → Step 3 success. */
const submitReset = async (): Promise<void> => {
  // Đánh dấu touch để hiện inline error nếu có.
  newPasswordTouched.value = true;
  confirmTouched.value = true;
  submitError.value = '';

  if (!canSubmitVerify.value) {
    if (otp.value.length !== 6) submitError.value = 'Vui lòng nhập đủ 6 chữ số OTP';
    else if (newPassword.value.length < 8) submitError.value = 'Mật khẩu phải có ít nhất 8 ký tự';
    else if (newPassword.value !== confirmPassword.value)
      submitError.value = 'Mật khẩu xác nhận không khớp';
    return;
  }

  loading.value = true;
  try {
    await authApi.resetPassword(email.value, otp.value, newPassword.value);
    step.value = 'success';
  } catch (e: any) {
    // F4 FIX: dùng helper đọc đúng HttpError + switch error code.
    const code = extractErrorCode(e);
    if (code === 'OTP_INVALID') {
      submitError.value = 'Mã OTP không chính xác. Vui lòng kiểm tra lại.';
    } else if (code === 'OTP_EXPIRED') {
      submitError.value = 'Mã OTP đã hết hạn. Vui lòng gửi lại mã mới.';
    } else if (code === 'OTP_TOO_MANY_ATTEMPTS') {
      submitError.value = 'Bạn đã nhập sai quá nhiều lần. Vui lòng gửi lại mã mới.';
    } else if (code === 'RESEND_COOLDOWN') {
      submitError.value = 'Vui lòng đợi thêm vài giây trước khi gửi lại.';
    } else if (code === 'OAUTH_ONLY_ACCOUNT') {
      submitError.value = 'Tài khoản này dùng Google/Facebook/GitHub. Không thể đặt lại mật khẩu qua email.';
    } else {
      submitError.value = extractErrorMessage(e, 'Đặt lại mật khẩu thất bại. Vui lòng thử lại.');
    }
    // KHÔNG reset toàn bộ form khi OTP sai — chỉ clear OTP để user nhập lại.
    // BE đã lock OTP sau MAX_ATTEMPTS=5 lần sai, lúc đó errorCode sẽ là
    // OTP_TOO_MANY_ATTEMPTS và user buộc phải resend.
    if (code === 'OTP_INVALID' || code === 'OTP_EXPIRED' || code === 'OTP_TOO_MANY_ATTEMPTS') {
      otpInputRef.value?.reset();
      otp.value = '';
    }
  } finally {
    loading.value = false;
  }
};

/** Bước 3 — về trang login. */
const goToLogin = (): void => {
  router.push({ name: 'login' });
};

/** Cho phép user back lại step 1 để đổi email (giữ UX linh hoạt). */
const backToRequest = (): void => {
  step.value = 'request';
  submitError.value = '';
  // Reset OTP + password để tránh stale state khi quay lại step 2 sau.
  otp.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
  newPasswordTouched.value = false;
  confirmTouched.value = false;
};

/* ============================================================================
 * Lifecycle
 * ==========================================================================*/

onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer);
});

/** Khi chuyển sang step 'verify', tự động clear submitError cũ để layout
 *  không nhảy khi component re-render. */
watch(step, (s) => {
  if (s === 'verify') submitError.value = '';
});
</script>

<template>
  <!--
    STRUCTURE (đồng bộ Login/Register):
      page (bg-slate-50)
        → centered container max-w-[1200px] mx-auto
            → ambient bg layer + decorative blobs
            → header (logo, cùng container)
            → main grid (2 cột)
  -->
  <div class="fixed inset-0 overflow-hidden bg-slate-50">
    <!-- Ambient background: gradient mềm từ trái → transparent -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div
        class="absolute inset-y-0 left-0 right-1/3 bg-gradient-to-r from-primary-100/55 via-primary-50/30 to-transparent"
      />
      <div
        class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-primary-50/40 to-transparent"
      />
    </div>

    <!-- Decorative blurred blobs -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div
        class="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-primary-200/30 blur-3xl animate-blob"
      />
      <div
        class="absolute top-1/3 left-[18%] h-96 w-96 rounded-full bg-primary-100/35 blur-3xl animate-blob"
        style="animation-delay: 2s;"
      />
      <div
        class="absolute -bottom-32 left-[8%] h-96 w-96 rounded-full bg-primary-50/60 blur-3xl animate-blob"
        style="animation-delay: 4s;"
      />
      <div
        class="absolute top-1/4 right-[10%] h-72 w-72 rounded-full bg-primary-100/15 blur-3xl animate-blob"
        style="animation-delay: 6s;"
      />
    </div>

    <!-- Centered container: max-w-[1200px], đồng bộ Login/Register -->
    <div
      class="relative mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-6 lg:px-10 xl:px-12"
    >
      <!-- Logo JobMatch — không bọc RouterLink, dùng div thuần (đồng bộ Login/Register) -->
      <div
        class="relative z-10 inline-flex items-center gap-2 pt-8 lg:pt-10 animate-fade-up"
        style="animation-delay: 0ms;"
      >
        <span
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm animate-pulse-logo"
        >
          <Briefcase class="h-5 w-5" aria-hidden="true" />
        </span>
        <span class="text-xl font-semibold tracking-tight text-slate-900">JobMatch</span>
      </div>

      <!-- Main grid: 2 cột đối xứng (grid-cols-2) -->
      <main
        class="relative z-10 grid flex-1 grid-cols-1 items-start gap-y-3 pt-10 lg:grid-cols-2 lg:gap-x-14 lg:gap-y-0 lg:pt-14"
      >
        <!-- ========== CỘT TRÁI — BRANDING ========== -->
        <section data-testid="branding-section" class="hidden lg:block w-full max-w-[440px] animate-fade-up" style="animation-delay: 80ms;">
          <div class="inline-flex items-center gap-2">
            <span class="h-px w-4 bg-slate-900 animate-grow-bar" aria-hidden="true"></span>
            <p class="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
              Bảo mật &amp; an toàn
            </p>
          </div>

          <h2
            class="mt-3 text-2xl xl:text-[26px] font-bold tracking-tight text-slate-900 leading-tight"
          >
            Đặt lại<br />mật khẩu
          </h2>
          <p class="mt-2 text-sm text-slate-600 leading-snug">
            Tạo mật khẩu mới để tiếp tục hành trình của bạn cùng JobMatch.
          </p>

          <ul class="mt-5 space-y-3">
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Mã OTP</span> gửi qua email trong vài giây
            </li>
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Mã 6 số</span> có thời hạn 5 phút
            </li>
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Mật khẩu mới</span> được mã hoá an toàn
            </li>
          </ul>

          <!-- Trust indicators — đồng bộ Login/Register (animated via useAnimatedCount) -->
          <dl data-testid="stats-list" class="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-200/70 pt-5">
            <div data-testid="stat-0">
              <dt class="text-2xl font-bold text-slate-900 tabular-nums leading-none">{{ jobsCount }}K+</dt>
              <dd class="mt-1.5 text-xs text-slate-600 leading-tight">Việc làm<br />đang tuyển</dd>
            </div>
            <div data-testid="stat-1">
              <dt class="text-2xl font-bold text-slate-900 tabular-nums leading-none">{{ companiesCount }}+</dt>
              <dd class="mt-1.5 text-xs text-slate-600 leading-tight">Doanh nghiệp<br />đối tác</dd>
            </div>
            <div data-testid="stat-2">
              <dt class="text-2xl font-bold text-slate-900 tabular-nums leading-none">{{ satisfactionCount }}%</dt>
              <dd class="mt-1.5 text-xs text-slate-600 leading-tight">Ứng viên<br />hài lòng</dd>
            </div>
          </dl>
        </section>

        <!-- ========== CỘT PHẢI — FORM ========== -->
        <section data-testid="form-section" class="w-full max-w-[440px] justify-self-center lg:justify-self-start animate-fade-up" style="animation-delay: 160ms;">
          <!-- Step indicator (đồng bộ design system) — ẩn ở step success -->
          <div
            v-if="currentStepNumber !== null"
            class="mb-5 flex items-center gap-2"
            aria-label="Tiến trình đặt lại mật khẩu"
          >
            <div class="flex items-center gap-2">
              <span
                :class="[
                  'inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition',
                  currentStepNumber >= 1
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-200 text-slate-500',
                ]"
              >
                1
              </span>
              <span
                :class="[
                  'text-xs font-medium',
                  currentStepNumber === 1 ? 'text-slate-900' : 'text-slate-500',
                ]"
              >
                Nhập email
              </span>
            </div>

            <span
              class="mx-1 h-px flex-1 bg-slate-200"
              :class="{ 'bg-primary-500': currentStepNumber >= 2 }"
              aria-hidden="true"
            />

            <div class="flex items-center gap-2">
              <span
                :class="[
                  'inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition',
                  currentStepNumber >= 2
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-200 text-slate-500',
                ]"
              >
                2
              </span>
              <span
                :class="[
                  'text-xs font-medium',
                  currentStepNumber === 2 ? 'text-slate-900' : 'text-slate-500',
                ]"
              >
                Đặt lại mật khẩu
              </span>
            </div>
          </div>

          <!-- Transition giữa 3 step — fade + slide ngang nhẹ để UX mượt -->
          <Transition
            mode="out-in"
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 translate-x-2"
            enter-to-class="opacity-100 translate-x-0"
            leave-active-class="transition-all duration-150 ease-in"
            leave-from-class="opacity-100 translate-x-0"
            leave-to-class="opacity-0 -translate-x-2"
          >
            <!-- ================================================================
                 STEP 1 — NHẬP EMAIL
                 ================================================================ -->
            <div v-if="step === 'request'" key="request">
              <header>
                <h1 class="text-xl font-bold tracking-tight text-slate-900">
                  Quên mật khẩu?
                </h1>
                <p class="mt-1 text-sm text-slate-600 leading-snug">
                  Nhập email tài khoản để nhận mã OTP đặt lại mật khẩu.
                </p>
              </header>

              <form @submit.prevent="sendCode" class="mt-3 space-y-3" novalidate>
                <div>
                  <label for="forgot-email" class="block text-sm font-medium text-slate-700">
                    Email
                  </label>
                  <div class="relative mt-1">
                    <input
                      id="forgot-email"
                      ref="forgotEmailInputRef"
                      :key="`forgot-email-${emailShake}`"
                      name="email"
                      v-model="email"
                      type="email"
                      required
                      autocomplete="email"
                      :aria-invalid="emailError ? 'true' : 'false'"
                      :aria-describedby="emailError ? 'forgot-email-err' : undefined"
                      class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/40"
                      :class="[
                        emailError ? '!border-red-400 focus:!border-red-500 focus:!ring-red-500/30' : '',
                        emailShake > 0 ? 'animate-shake' : '',
                      ]"
                      placeholder="Nhập email của bạn"
                      @blur="emailTouched = true"
                      @input="emailTouched = true; submitError = ''; emailShake = 0"
                    />
                    <span
                      class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400"
                      aria-hidden="true"
                    >
                      <Mail class="h-4 w-4" />
                    </span>
                  </div>
                  <p
                    v-if="emailError"
                    id="forgot-email-err"
                    class="mt-1 text-xs text-red-600"
                  >
                    {{ emailError }}
                  </p>
                </div>

                <!-- Submit error (BE) — banner đỏ phía trên button -->
                <Transition name="error">
                  <p
                    v-if="submitError"
                    role="alert"
                    class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
                  >
                    {{ submitError }}
                  </p>
                </Transition>

                <button
                  type="submit"
                  :disabled="loading"
                  class="flex w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-700 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    v-if="loading"
                    class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    aria-hidden="true"
                  />
                  {{ loading ? 'Đang gửi mã OTP...' : 'Gửi mã OTP' }}
                </button>
              </form>

              <p class="mt-5 text-center text-sm text-slate-600">
                <RouterLink
                  to="/login"
                  class="link-underline inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700 transition"
                >
                  <ArrowLeft class="h-3.5 w-3.5" />
                  Quay lại đăng nhập
                </RouterLink>
              </p>
            </div>

            <!-- ================================================================
                 STEP 2 — OTP + MẬT KHẨU MỚI
                 ================================================================ -->
            <div v-else-if="step === 'verify'" key="verify">
              <header>
                <h1 class="text-xl font-bold tracking-tight text-slate-900">
                  Đặt lại mật khẩu
                </h1>
                <p class="mt-1 text-sm text-slate-600 leading-snug">
                  Mã OTP đã được gửi đến
                  <span class="font-semibold text-slate-900">{{ maskedEmail }}</span>
                </p>
              </header>

              <form @submit.prevent="submitReset" class="mt-3 space-y-3" novalidate>
                <!-- OTP -->
                <div>
                  <label class="block text-sm font-medium text-slate-700">Mã OTP</label>
                  <div class="mt-2">
                    <OtpInput ref="otpInputRef" v-model="otp" />
                  </div>

                  <!-- Resend row -->
                  <div class="mt-2 flex items-center justify-end text-sm">
                    <span class="text-slate-500">Chưa nhận được mã?</span>
                    <button
                      v-if="cooldown <= 0"
                      type="button"
                      :disabled="resending"
                      @click="resend"
                      class="ml-1.5 inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700 transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw
                        v-if="!resending"
                        class="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      <span
                        v-else
                        class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-300 border-t-primary-600"
                        aria-hidden="true"
                      />
                      {{ resending ? 'Đang gửi...' : 'Gửi lại' }}
                    </button>
                    <span v-else class="ml-1.5 inline-flex items-center gap-1 text-slate-400">
                      <Clock class="h-3.5 w-3.5" aria-hidden="true" />
                      Gửi lại sau {{ cooldown }}s
                    </span>
                  </div>
                </div>

                <!-- Password mới -->
                <div>
                  <label for="new-password" class="block text-sm font-medium text-slate-700">
                    Mật khẩu mới
                  </label>
                  <div class="relative mt-1">
                    <input
                      id="new-password"
                      name="new-password"
                      v-model="newPassword"
                      :type="showNewPassword ? 'text' : 'password'"
                      required
                      minlength="8"
                      autocomplete="new-password"
                      :aria-invalid="newPasswordError ? 'true' : 'false'"
                      :aria-describedby="newPasswordError ? 'new-password-err' : 'new-password-hint'"
                      class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/40"
                      :class="newPasswordError ? '!border-red-400 focus:!border-red-500 focus:!ring-red-500/30' : ''"
                      placeholder="Nhập mật khẩu mới"
                      @blur="newPasswordTouched = true"
                      @input="newPasswordTouched = true; submitError = ''"
                    />
                    <button
                      type="button"
                      @click="showNewPassword = !showNewPassword"
                      :aria-label="showNewPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                      class="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 transition"
                      tabindex="-1"
                    >
                      <EyeOff v-if="showNewPassword" :size="18" />
                      <Eye v-else :size="18" />
                    </button>
                  </div>
                  <p
                    v-if="newPasswordError"
                    id="new-password-err"
                    class="mt-1 text-xs text-red-600"
                  >
                    {{ newPasswordError }}
                  </p>
                  <p
                    v-else
                    id="new-password-hint"
                    class="mt-1 text-xs text-slate-500"
                  >
                    Mật khẩu tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số
                  </p>
                </div>

                <!-- Confirm password -->
                <div>
                  <label for="confirm-password" class="block text-sm font-medium text-slate-700">
                    Xác nhận mật khẩu
                  </label>
                  <div class="relative mt-1">
                    <input
                      id="confirm-password"
                      v-model="confirmPassword"
                      :type="showConfirmPassword ? 'text' : 'password'"
                      required
                      autocomplete="new-password"
                      :aria-invalid="confirmError ? 'true' : 'false'"
                      :aria-describedby="confirmError ? 'confirm-password-err' : undefined"
                      class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/40"
                      :class="confirmError ? '!border-red-400 focus:!border-red-500 focus:!ring-red-500/30' : ''"
                      placeholder="Nhập lại mật khẩu"
                      @blur="confirmTouched = true"
                      @input="confirmTouched = true; submitError = ''"
                    />
                    <button
                      type="button"
                      @click="showConfirmPassword = !showConfirmPassword"
                      :aria-label="showConfirmPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                      class="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 transition"
                      tabindex="-1"
                    >
                      <EyeOff v-if="showConfirmPassword" :size="18" />
                      <Eye v-else :size="18" />
                    </button>
                  </div>
                  <p
                    v-if="confirmError"
                    id="confirm-password-err"
                    class="mt-1 text-xs text-red-600"
                  >
                    {{ confirmError }}
                  </p>
                </div>

                <!-- Submit error (BE) — banner đỏ phía trên button -->
                <Transition name="error">
                  <p
                    v-if="submitError"
                    role="alert"
                    class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
                  >
                    {{ submitError }}
                  </p>
                </Transition>

                <button
                  type="submit"
                  :disabled="loading || !canSubmitVerify"
                  class="flex w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-700 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    v-if="loading"
                    class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    aria-hidden="true"
                  />
                  {{ loading ? 'Đang cập nhật...' : 'Xác nhận đổi mật khẩu' }}
                </button>

                <!-- Back to step 1: cho phép đổi email -->
                <p class="text-center text-xs text-slate-500">
                  <button
                    type="button"
                    @click="backToRequest"
                    class="link-underline inline-flex items-center gap-1 font-medium text-slate-500 hover:text-slate-700 transition"
                  >
                    <ArrowLeft class="h-3 w-3" />
                    Đổi email
                  </button>
                </p>
              </form>
            </div>

            <!-- ================================================================
                 STEP 3 — SUCCESS
                 ================================================================ -->
            <div v-else key="success" class="text-center">
              <div class="mx-auto flex items-center justify-center">
                <span
                  class="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-4 ring-emerald-100"
                  aria-hidden="true"
                >
                  <CheckCircle2 class="h-9 w-9 text-emerald-600" />
                </span>
              </div>

              <h1 class="mt-5 text-2xl font-bold tracking-tight text-slate-900">
                Đổi mật khẩu thành công
              </h1>
              <p class="mt-2 text-sm text-slate-600 leading-relaxed">
                Mật khẩu của bạn đã được cập nhật.<br />
                Bạn có thể đăng nhập bằng mật khẩu mới.
              </p>

              <button
                type="button"
                @click="goToLogin"
                class="mt-6 flex w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-700 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                Đăng nhập
              </button>

              <p class="mt-4 text-xs text-slate-400">
                <KeyRound class="inline h-3 w-3 mr-1 -mt-0.5" aria-hidden="true" />
                Mật khẩu đã được mã hoá an toàn
              </p>
            </div>
          </Transition>
        </section>
      </main>
    </div>
  </div>
</template>
