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

/* Benefit line grow */
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

/* OTP box pulse — đánh dấu ô đang được focus khi user lỗi (re-trigger feedback) */
@keyframes otp-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgb(239 68 68 / 0); }
  50%      { box-shadow: 0 0 0 4px rgb(239 68 68 / 0.18); }
}
.animate-otp-pulse {
  animation: otp-pulse 0.5s ease-out;
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
  .animate-otp-pulse,
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
 * VerifyOtpView — Trang nhập mã OTP 6 số xác thực email.
 *
 * Layout (đồng bộ Login/Register):
 *  - Desktop (>= lg): 2 cột — branding trái + form phải, cùng container max-w-[1200px].
 *  - Mobile: 1 cột — branding ẩn, form full-width.
 *
 * Luồng nghiệp vụ giữ NGUYÊN:
 *  - Ưu tiên `auth.pendingVerifyEmail` (Pinia) → fallback `route.query.email`
 *    (để F5 an toàn + không leak PII qua URL).
 *  - `verifySource` ('login' | 'register') điều khiển:
 *      + Auto-resend OTP khi đến từ Login (OTP cũ đã expired).
 *      + Hiển thị link "← Quay lại" phù hợp.
 *  - Verify thành công → router.push('/login') để user đăng nhập lại
 *    (BE không cấp token ở bước verify, phải login lần nữa).
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { authApi } from '@services/auth.api';
import { extractErrorCode, extractErrorMessage } from '@services/http';
import OtpInput from '@components/auth/OtpInput.vue';
import { Briefcase } from 'lucide-vue-next';
import { decideF5RedirectTarget } from '@views/auth/verifyOtpRedirect';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

// Email đang verify — Pinia ưu tiên (không leak qua URL), query làm fallback.
const email = computed(() => {
  if (auth.pendingVerifyEmail) return auth.pendingVerifyEmail;
  const queryEmail = route.query.email;
  if (typeof queryEmail === 'string' && queryEmail.trim()) {
    return queryEmail.trim();
  }
  return '';
});

// Source đến từ flow nào — đọc query (F5-safe), fallback Pinia.
const verifySource = computed<'register' | 'login' | null>(() => {
  const queryFrom = route.query.from;
  if (queryFrom === 'login' || queryFrom === 'register') return queryFrom;
  return auth.pendingVerifySource ?? null;
});

// Mask email hiển thị: hiện 2 ký tự đầu + 4 dấu chấm + domain.
// VD: "nguyenvana@gmail.com" → "ng••••@gmail.com"
const maskedEmail = computed(() => {
  const e = email.value;
  const at = e.indexOf('@');
  if (at < 1) return e;
  const head = e.slice(0, at).slice(0, 2);
  const domain = e.slice(at);
  return `${head}${'•'.repeat(4)}${domain}`;
});

const otp = ref('');
const otpInput = ref<InstanceType<typeof OtpInput> | null>(null);
const error = ref('');
const errorCode = ref('');
const loading = ref(false);
const resending = ref(false);
const cooldown = ref(0);
// Re-trigger cho pulse OTP box khi OTP sai → highlight 6 ô để user biết cần nhập lại.
const otpShakeKey = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;
// Dùng cho 3 setTimeout redirect: T4 session-expired (2 branches: →/login và
// →/register) + ALREADY_VERIFIED (→/login). Lưu id để clear trong onUnmounted
// khi component bị huỷ — tránh memory leak / redirect sau khi user đã rời trang.
// (Submit-error path KHÔNG có setTimeout/redirect — chỉ shake input + reset.)
let redirectTimer: ReturnType<typeof setTimeout> | null = null;
// Guard cho async callback trong onMounted — nếu component unmount trước khi
// await resolve, set state sau đó sẽ warning "set state on unmounted component".
let isMounted = true;

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

// D6 FIX: KHÔNG gọi router.replace synchronously trong script setup — move vào onMounted.
onMounted(async () => {
  if (!email.value) {
    // Email rỗng — xảy ra khi:
    //   1. User F5 / reload trang /verify-otp (Pinia reset, email mất).
    //   2. User dán URL /verify-otp vào tab mới (Pinia fresh, không có pending email).
    //   3. pendingVerifyEmail hết hạn / bị clear trước khi user nhập OTP.
    //
    // Theo quyết định thiết kế PII-no-persist tại stores/auth.ts:55-74, email
    // CHỈ lưu trong Pinia memory (không sessionStorage / localStorage / URL query
    // để tránh leak PII vào history/Referer). Nên F5/tab-restart sẽ mất context.
    //
    // Phân biệt 2 flow qua `route.query.oauth` (non-PII flag, F5-safe):
    //   - oauth=pending (Google OAuth pending OTP) → /login vì user đã có account;
    //     recovery path = login (password hoặc Google button).
    //   - from=register mà KHÔNG có oauth=pending (Password registration OTP) → /register
    //     vì user đang giữa form đăng ký; F5 làm mất email → re-register là đúng UX.
    //   - Fallback (`from=login` hoặc paste bare URL) → /login (session expired).
    //
    // Decision tree đặt ở `verifyOtpRedirect.ts` (pure function, đã unit-test).
    //
    // UX (audit 2026-09-28 follow-up): KHÔNG hiển thị message, KHÔNG setTimeout
    // delay — redirect NGAY LẬP TỨC. Lý do:
    //   - Không có gì user có thể làm tại /verify-otp khi email context đã mất
    //     (OTP form không render được) → giữ user ở trang này thêm 2s chỉ thêm
    //     nhấp nháy flash-error vô nghĩa.
    //   - Redirect tức thì giúp user đến nơi có thể hành động (/register form
    //     hoặc /login form) nhanh hơn.
    //   - onMounted chạy sau khi component đã mount → router.replace ở đây
    //     không bị Vue cảnh báo navigation-during-setup.
    const target = decideF5RedirectTarget({
      oauth: typeof route.query.oauth === 'string' ? route.query.oauth : null,
      from: typeof route.query.from === 'string' ? route.query.from : null,
    });
    router.replace({ name: target });
    return;
  }

  // Từ Login → OTP cũ đã expired → auto-resend ngay khi mount.
  // Từ Register → OTP vừa được gửi ở form đăng ký → chỉ start cooldown.
  const cameFromLogin = verifySource.value === 'login';
  if (cameFromLogin) {
    try {
      await authApi.resendOtp(email.value);
      // Guard: user có thể navigate đi trước khi await resolve — tránh warning
      // "set state on unmounted component".
      if (!isMounted) return;
      startCooldown();
    } catch (err) {
      const code = extractErrorCode(err);
      if (code === 'ALREADY_VERIFIED') {
        error.value = 'Email này đã được xác thực trước đó. Đang chuyển đến trang đăng nhập...';
        redirectTimer = setTimeout(() => {
          // Guard lần 2: timer fire nhưng component có thể đã unmount.
          if (!isMounted) return;
          auth.clearPendingVerifyEmail();
          router.push({ name: 'login' });
        }, 1500);
        return;
      }
      if (!isMounted) return;
      // B2 FIX: riêng RESEND_COOLDOWN + OTP_RATE_LIMITED → startCooldown để user
      // thấy countdown 60s + nút "Gửi lại mã" bị disable. Trước đây message chung
      // qua extractErrorMessage → user không biết khi nào được retry.
      if (code === 'RESEND_COOLDOWN' || code === 'OTP_RATE_LIMITED') {
        error.value = 'Bạn đã yêu cầu gửi mã quá nhiều lần. Vui lòng đợi 60 giây trước khi thử lại.';
        startCooldown();
      } else {
        error.value = extractErrorMessage(err, 'Không thể gửi lại mã OTP. Vui lòng bấm "Gửi lại mã".');
        startCooldown();
      }
    }
  } else {
    startCooldown();
  }
});

const onSubmit = async (): Promise<void> => {
  error.value = '';
  errorCode.value = '';
  if (otp.value.length !== 6) {
    error.value = 'Vui lòng nhập đủ 6 chữ số';
    otpShakeKey.value++;
    return;
  }
  loading.value = true;
  try {
    await auth.verifyOtp(email.value, otp.value);
    auth.clearPendingVerifyEmail();
    // Verify thành công → redirect thẳng về /login (BE không auto-login sau verify).
    router.push({ name: 'login' });
  } catch (e: any) {
    error.value = extractErrorMessage(e, 'Xác thực thất bại');
    errorCode.value = extractErrorCode(e);
    otpShakeKey.value++;
    otpInput.value?.reset();
  } finally {
    loading.value = false;
  }
};

const onResend = async (): Promise<void> => {
  // Defensive guard: chặn double-call nếu user bypass UI (devtools, Enter key,
  // hoặc <script> gọi programmatically). Button :disabled đã chặn click bình
  // thường nhưng không cover tất cả attack vector.
  if (resending.value || cooldown.value > 0) return;
  error.value = '';
  resending.value = true;
  try {
    await authApi.resendOtp(email.value);
    startCooldown();
    otpInput.value?.reset();
  } catch (e: any) {
    // B2 FIX: switch theo code — RESEND_COOLDOWN + OTP_RATE_LIMITED → startCooldown
    // để hiển thị countdown thay vì chỉ show message chung.
    const code = extractErrorCode(e);
    if (code === 'RESEND_COOLDOWN' || code === 'OTP_RATE_LIMITED') {
      error.value = 'Bạn đã yêu cầu gửi mã quá nhiều lần. Vui lòng đợi 60 giây trước khi thử lại.';
      startCooldown();
    } else {
      error.value = extractErrorMessage(e, 'Gửi lại mã thất bại');
    }
  } finally {
    resending.value = false;
  }
};

onUnmounted(() => {
  // Single cleanup point — clear mọi timer + set cờ isMounted để chặn
  // async callback set state trên component đã unmount.
  isMounted = false;
  if (cooldownTimer) clearInterval(cooldownTimer);
  if (redirectTimer) clearTimeout(redirectTimer);
});
</script>

<template>
  <!--
    STRUCTURE (đồng bộ Login/Register):
      page (bg-slate-50)
        → centered container max-w-[1200px]
            → ambient bg + decorative blobs
            → header (logo, cùng container)
            → main grid (2 cột, items-start, cùng baseline)
  -->
  <div class="fixed inset-0 overflow-hidden bg-slate-50">
    <!-- Ambient background + blobs (đồng bộ Login/Register) -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div
        class="absolute inset-y-0 left-0 right-1/3 bg-gradient-to-r from-primary-100/55 via-primary-50/30 to-transparent"
      />
      <div
        class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-primary-50/40 to-transparent"
      />
    </div>

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

    <!-- Content container — header + main cùng khung -->
    <div
      class="relative mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-6 lg:px-10 xl:px-12"
    >
      <!-- Logo JobMatch (đồng bộ Login/Register) -->
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

      <!-- Main grid: 2 cột items-start, compact để fit 1 viewport -->
      <main
        class="relative z-10 grid flex-1 grid-cols-1 items-start gap-y-3 pt-10 lg:grid-cols-2 lg:gap-x-14 lg:gap-y-0 lg:pt-14"
      >
        <!-- ========== CỘT TRÁI — BRANDING ========== -->
        <section data-testid="branding-section" class="hidden lg:block w-full max-w-[440px] animate-fade-up" style="animation-delay: 80ms;">
          <div class="inline-flex items-center gap-2">
            <span class="h-px w-4 bg-slate-900 animate-grow-bar" aria-hidden="true"></span>
            <p class="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
              Bảo mật tài khoản
            </p>
          </div>

          <h2
            class="mt-3 text-2xl xl:text-[26px] font-bold tracking-tight text-slate-900 leading-tight"
          >
            Xác thực email<br />của bạn
          </h2>
          <p class="mt-2 text-sm text-slate-600 leading-snug">
            Nhập mã 6 chữ số đã gửi tới email để hoàn tất đăng ký hoặc đăng nhập.
          </p>

          <ul class="mt-5 space-y-3">
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Bảo mật tài khoản</span> với xác thực email
            </li>
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Chống truy cập</span> trái phép hiệu quả
            </li>
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Khôi phục tài khoản</span> dễ dàng qua email
            </li>
          </ul>

          <dl data-testid="stats-list" class="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-200/70 pt-5">
            <div data-testid="stat-0">
              <dt class="text-2xl font-bold text-slate-900 tabular-nums leading-none">1p</dt>
              <dd class="mt-1.5 text-xs text-slate-600 leading-tight">Mã sẽ hết hạn<br />sau 1 phút</dd>
            </div>
            <div data-testid="stat-1">
              <dt class="text-2xl font-bold text-slate-900 tabular-nums leading-none">3×</dt>
              <dd class="mt-1.5 text-xs text-slate-600 leading-tight">Tối đa thử<br />mỗi phiên</dd>
            </div>
            <div data-testid="stat-2">
              <dt class="text-2xl font-bold text-slate-900 tabular-nums leading-none">60s</dt>
              <dd class="mt-1.5 text-xs text-slate-600 leading-tight">Đợi trước khi<br />gửi lại mã</dd>
            </div>
          </dl>
        </section>

        <!-- ========== CỘT PHẢI — FORM ========== -->
        <section data-testid="form-section" class="w-full max-w-[440px] justify-self-center lg:justify-self-start animate-fade-up" style="animation-delay: 160ms;">
          <header>
            <h1 class="text-xl font-bold tracking-tight text-slate-900">Xác thực email</h1>
            <p class="mt-1 text-sm text-slate-600 leading-snug">
              Mã 6 chữ số đã được gửi tới
              <span class="font-semibold text-slate-900">{{ maskedEmail || 'email của bạn' }}</span>
            </p>
          </header>

          <form
            @submit.prevent="onSubmit"
            class="mt-3 space-y-3"
            novalidate
          >
            <!-- OTP input: OtpInput component tự handle focus/paste/keyboard nav.
                 :key buộc remount → re-fire animate-otp-pulse khi user submit fail. -->
            <div
              :key="`otp-${otpShakeKey}`"
              :class="otpShakeKey > 0 ? 'animate-otp-pulse rounded-lg' : ''"
            >
              <OtpInput ref="otpInput" v-model="otp" />
            </div>

            <!-- Error banner slide-down -->
            <Transition name="error">
              <p
                v-if="error"
                role="alert"
                class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
              >
                {{ error }}
              </p>
            </Transition>

            <button
              type="submit"
              :disabled="loading || otp.length !== 6"
              class="flex w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-700 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                v-if="loading"
                class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              {{ loading ? 'Đang xác thực...' : 'Xác thực' }}
            </button>
          </form>

          <!-- Resend row -->
          <div class="mt-4 flex items-center justify-center gap-1.5 text-sm">
            <span class="text-slate-500">Không nhận được mã?</span>
            <button
              v-if="cooldown <= 0"
              type="button"
              :disabled="resending"
              @click="onResend"
              class="link-underline font-semibold text-primary-600 hover:text-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ resending ? 'Đang gửi...' : 'Gửi lại mã' }}
            </button>
            <span v-else class="font-medium text-slate-400 tabular-nums">
              Gửi lại sau {{ cooldown }}s
            </span>
          </div>

          <!-- Quay lại link — chỉ hiện link relevant theo source.
               D7 FIX: clear pending email TRƯỚC khi navigate để tránh D1 loop
               (register lại cùng email → BE throw EMAIL_TAKEN). -->
          <p class="mt-2 text-center text-sm text-slate-600">
            <RouterLink
              v-if="verifySource === 'login'"
              to="/login"
              class="link-underline font-medium hover:text-primary-700 transition"
              @click="auth.clearPendingVerifyEmail()"
            >
              ← Quay lại đăng nhập
            </RouterLink>
            <RouterLink
              v-else
              to="/register"
              class="link-underline font-medium hover:text-primary-700 transition"
              @click="auth.clearPendingVerifyEmail()"
            >
              ← Quay lại đăng ký
            </RouterLink>
          </p>
        </section>
      </main>
    </div>
  </div>
</template>
