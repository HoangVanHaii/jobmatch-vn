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
 *   - Cùng ambient gradient bg-slate-50 + decorative blobs + container max-w-[1180px].
 *   - 2 cột desktop (branding trái + form phải); mobile ẩn branding.
 *   - Form max-w-[480px], input/button/error style y hệt Login.
 *   - Step indicator 2 dots ngang trên đầu form.
 *   - Transition mượt giữa các step (mode="out-in").
 */
import { ref, computed, onUnmounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Check,
  Eye,
  EyeOff,
  Sparkles,
  Mail,
  KeyRound,
  ShieldCheck,
  Clock,
  RefreshCw,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-vue-next';
import { authApi } from '@services/auth.api';
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
 *  để tránh error đỏ hiện ra ngay khi page mount. */
const emailTouched = ref(false);
const newPasswordTouched = ref(false);
const confirmTouched = ref(false);

/** API submit error (BE trả về) — KHÁC với client-side inline error.
 *  submitError hiện trên banner đỏ phía trên button submit. */
const submitError = ref('');

/** Step success — email đã được verify thành công, dùng để navigate back to login. */

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
  if (newPassword.value.length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự';
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
    newPassword.value === confirmPassword.value,
);

/* ============================================================================
 * Masked email cho step 2 subtitle
 *
 * Ví dụ:
 *   "huytest@gmail.com"     → "hu***@gmail.com"
 *   "ab@example.com"        → "ab***@example.com"
 *   "no-at-sign"            → "no-at-sign" (không có @ → trả nguyên)
 * ==========================================================================*/

const maskedEmail = computed(() => {
  const e = email.value;
  const at = e.indexOf('@');
  if (at < 1) return e;
  const head = e.slice(0, at).slice(0, 2);
  const domain = e.slice(at);
  return `${head}***${domain}`;
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
  if (!emailValid.value) return;

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
    // BE chỉ throw khi rate-limit IP (429) hoặc lỗi mạng. Không nêu email tồn tại.
    submitError.value =
      e?.response?.data?.error?.message ??
      'Không thể gửi mã OTP. Vui lòng thử lại sau.';
  } finally {
    loading.value = false;
  }
};

/** Gửi lại OTP — cùng endpoint forgot-password. */
const resend = async (): Promise<void> => {
  if (cooldown.value > 0) return;
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
    const code = e?.response?.data?.error?.code;
    if (code === 'RESEND_COOLDOWN') {
      submitError.value = 'Vui lòng đợi thêm vài giây trước khi gửi lại.';
    } else {
      submitError.value =
        e?.response?.data?.error?.message ?? 'Gửi lại mã thất bại. Vui lòng thử lại.';
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
    const code = e?.response?.data?.error?.code as string | undefined;
    if (code === 'OTP_INVALID') {
      submitError.value = 'Mã OTP không chính xác. Vui lòng kiểm tra lại.';
    } else if (code === 'OTP_EXPIRED') {
      submitError.value = 'Mã OTP đã hết hạn. Vui lòng gửi lại mã mới.';
    } else if (code === 'OTP_TOO_MANY_ATTEMPTS') {
      submitError.value = 'Bạn đã nhập sai quá nhiều lần. Vui lòng gửi lại mã mới.';
    } else if (code === 'RESEND_COOLDOWN') {
      submitError.value = 'Vui lòng đợi thêm vài giây trước khi gửi lại.';
    } else {
      submitError.value =
        e?.response?.data?.error?.message ?? 'Đặt lại mật khẩu thất bại. Vui lòng thử lại.';
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
        → centered container max-w-[1180px] mx-auto
            → ambient bg layer + decorative blobs
            → header (logo, cùng container)
            → main grid (2 cột)
  -->
  <div class="relative min-h-screen overflow-hidden bg-slate-50">
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
      <div class="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-primary-200/30 blur-3xl" />
      <div class="absolute top-1/3 left-[18%] h-96 w-96 rounded-full bg-primary-100/35 blur-3xl" />
      <div class="absolute -bottom-32 left-[8%] h-96 w-96 rounded-full bg-primary-50/60 blur-3xl" />
      <div class="absolute top-1/4 right-[10%] h-72 w-72 rounded-full bg-primary-100/15 blur-3xl" />
    </div>

    <!-- Centered container -->
    <div
      class="relative mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-6 lg:px-10 xl:px-12"
    >
      <!-- Logo JobMatch — đồng bộ Login/Register -->
      <RouterLink
        to="/"
        class="relative z-10 inline-flex items-center gap-2 pt-12 group lg:pt-16"
        aria-label="JobMatch"
      >
        <span
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm transition group-hover:bg-primary-700"
        >
          <Sparkles class="h-5 w-5" aria-hidden="true" />
        </span>
        <span class="text-xl font-semibold tracking-tight text-slate-900">JobMatch</span>
      </RouterLink>

      <!-- Main grid -->
      <main
        class="relative z-10 grid flex-1 grid-cols-1 items-start gap-y-10 pt-10 lg:grid-cols-[1fr_1.3fr] lg:gap-x-10 lg:gap-y-0 lg:pt-3 xl:gap-x-14"
      >
        <!-- ========== CỘT TRÁI — BRANDING ========== -->
        <section class="hidden lg:block w-full max-w-[440px] lg:pt-10">
          <p
            class="inline-flex items-center gap-2 text-[11px] font-medium tracking-wide text-primary-700 bg-primary-100/70 rounded-full px-3 py-1"
          >
            <ShieldCheck class="h-3.5 w-3.5" aria-hidden="true" />
            Bảo mật &amp; an toàn
          </p>

          <h2
            class="mt-3 text-2xl xl:text-[26px] font-bold tracking-tight text-slate-900 leading-tight"
          >
            Đặt lại<br />mật khẩu
          </h2>
          <p class="mt-2 text-sm text-slate-600 leading-snug">
            Tạo mật khẩu mới để tiếp tục hành trình của bạn cùng JobMatch.
          </p>

          <ul class="mt-5 space-y-2.5">
            <li class="flex items-start gap-2.5">
              <span
                class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-600 text-white"
              >
                <Check class="h-3 w-3" aria-hidden="true" />
              </span>
              <span class="text-sm text-slate-700 leading-snug">
                <span class="font-medium text-slate-900">Mã OTP</span> gửi qua email trong vài giây
              </span>
            </li>
            <li class="flex items-start gap-2.5">
              <span
                class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-600 text-white"
              >
                <Check class="h-3 w-3" aria-hidden="true" />
              </span>
              <span class="text-sm text-slate-700 leading-snug">
                <span class="font-medium text-slate-900">Mã 6 số</span> có thời hạn 5 phút
              </span>
            </li>
            <li class="flex items-start gap-2.5">
              <span
                class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-600 text-white"
              >
                <Check class="h-3 w-3" aria-hidden="true" />
              </span>
              <span class="text-sm text-slate-700 leading-snug">
                <span class="font-medium text-slate-900">Mật khẩu mới</span> được mã hoá an toàn
              </span>
            </li>
          </ul>

          <!-- Illustration SVG — dùng lại pattern từ Login/Register cho visual rhythm đồng nhất -->
          <div class="mt-5 max-w-[360px]" aria-hidden="true">
            <svg
              viewBox="0 0 480 200"
              class="w-full h-auto max-h-[140px]"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
            >
              <!-- Card backdrop -->
              <rect x="40" y="30" width="400" height="140" rx="16" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" />
              <!-- Lock icon left -->
              <rect x="68" y="78" width="44" height="44" rx="8" fill="#DBEAFE" />
              <rect x="80" y="92" width="20" height="20" rx="3" fill="#2563EB" />
              <path d="M84 92 v -6 a 6 6 0 0 1 12 0 v 6" stroke="#2563EB" stroke-width="2.5" fill="none" stroke-linecap="round" />
              <!-- OTP cells right -->
              <rect x="135" y="68" width="170" height="8" rx="4" fill="#E2E8F0" />
              <rect x="135" y="84" width="110" height="6" rx="3" fill="#EFF6FF" />
              <g>
                <rect x="140" y="108" width="38" height="44" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
                <text x="159" y="137" font-family="ui-sans-serif" font-size="20" font-weight="700" fill="#2563EB" text-anchor="middle">1</text>
              </g>
              <g>
                <rect x="184" y="108" width="38" height="44" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
                <text x="203" y="137" font-family="ui-sans-serif" font-size="20" font-weight="700" fill="#2563EB" text-anchor="middle">2</text>
              </g>
              <g>
                <rect x="228" y="108" width="38" height="44" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
                <text x="247" y="137" font-family="ui-sans-serif" font-size="20" font-weight="700" fill="#2563EB" text-anchor="middle">3</text>
              </g>
              <g>
                <rect x="272" y="108" width="38" height="44" rx="6" fill="#EFF6FF" stroke="#BFDBFE" />
                <text x="291" y="137" font-family="ui-sans-serif" font-size="20" font-weight="700" fill="#1E3A8A" text-anchor="middle">4</text>
              </g>
              <g>
                <rect x="316" y="108" width="38" height="44" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
                <text x="335" y="137" font-family="ui-sans-serif" font-size="20" font-weight="700" fill="#2563EB" text-anchor="middle">5</text>
              </g>
              <g>
                <rect x="360" y="108" width="38" height="44" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
                <text x="379" y="137" font-family="ui-sans-serif" font-size="20" font-weight="700" fill="#2563EB" text-anchor="middle">6</text>
              </g>
              <!-- Sparkles -->
              <path d="M420 50 l 3 -6 l 3 6 l 6 3 l -6 3 l -3 6 l -3 -6 l -6 -3 z" fill="#2563EB" opacity="0.7" />
              <path d="M70 40 l 2 -4 l 2 4 l 4 2 l -4 2 l -2 4 l -2 -4 l -4 -2 z" fill="#3B82F6" opacity="0.5" />
            </svg>
          </div>
        </section>

        <!-- ========== CỘT PHẢI — FORM ========== -->
        <section class="w-full max-w-[480px] justify-self-start">
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
                <h1 class="text-2xl font-bold tracking-tight text-slate-900">
                  Quên mật khẩu?
                </h1>
                <p class="mt-1.5 text-sm text-slate-600">
                  Nhập email tài khoản để nhận mã OTP đặt lại mật khẩu.
                </p>
              </header>

              <form @submit.prevent="sendCode" class="mt-5 space-y-3" novalidate>
                <div>
                  <label for="forgot-email" class="block text-sm font-medium text-slate-700">
                    Email
                  </label>
                  <div class="relative mt-1">
                    <input
                      id="forgot-email"
                      v-model="email"
                      type="email"
                      required
                      autocomplete="email"
                      :aria-invalid="emailError ? 'true' : 'false'"
                      :aria-describedby="emailError ? 'forgot-email-err' : undefined"
                      class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                      :class="emailError ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30' : ''"
                      placeholder="Nhập email của bạn"
                      @blur="emailTouched = true"
                      @input="emailTouched = true; submitError = ''"
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
                <p
                  v-if="submitError"
                  role="alert"
                  class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
                >
                  {{ submitError }}
                </p>

                <button
                  type="submit"
                  :disabled="loading"
                  class="flex w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
                  class="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700 transition"
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
                <h1 class="text-2xl font-bold tracking-tight text-slate-900">
                  Đặt lại mật khẩu
                </h1>
                <p class="mt-1.5 text-sm text-slate-600">
                  Mã OTP đã được gửi đến
                  <span class="font-semibold text-slate-900">{{ maskedEmail }}</span>
                </p>
              </header>

              <form @submit.prevent="submitReset" class="mt-5 space-y-4" novalidate>
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
                      v-model="newPassword"
                      :type="showNewPassword ? 'text' : 'password'"
                      required
                      minlength="8"
                      autocomplete="new-password"
                      :aria-invalid="newPasswordError ? 'true' : 'false'"
                      :aria-describedby="newPasswordError ? 'new-password-err' : 'new-password-hint'"
                      class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                      :class="newPasswordError ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30' : ''"
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
                    Mật khẩu tối thiểu 8 ký tự
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
                      class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                      :class="confirmError ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30' : ''"
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
                <p
                  v-if="submitError"
                  role="alert"
                  class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
                >
                  {{ submitError }}
                </p>

                <button
                  type="submit"
                  :disabled="loading || !canSubmitVerify"
                  class="flex w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
                    class="inline-flex items-center gap-1 font-medium text-slate-500 hover:text-slate-700 transition"
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
                class="mt-6 flex w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
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
