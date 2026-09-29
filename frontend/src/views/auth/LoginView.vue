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

/* Editorial accent bar grow — thanh đen ngắn trước label */
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

/* Blob float: ambient motion rất nhẹ cho 4 blob trang trí. */
@keyframes blob {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(15px, -20px) scale(1.05); }
  66% { transform: translate(-10px, 15px) scale(0.95); }
}
.animate-blob {
  animation: blob 14s ease-in-out infinite;
}

/* Respect prefers-reduced-motion */
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

/* Shake input khi validation fail — biên độ 6-8px, nhiều mốc rung, dứt khoát */
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

/* Divider line draw — 2 đường kẻ ngang vẽ từ ngoài vào giữa */
.divider-line {
  transform: scaleX(0);
  animation: draw-line 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.4s forwards;
}
.divider-line-left { transform-origin: left center; }
.divider-line-right { transform-origin: right center; }
@keyframes draw-line {
  to { transform: scaleX(1); }
}
</style>

<script setup lang="ts">
/**
 * LoginView — Trang đăng nhập JobMatch.
 *
 * Layout (đồng bộ với Register, gọn hơn):
 *  - Desktop (>= lg): 2 cột — branding trái + form phải, cùng container max-w-[1200px].
 *  - Mobile: 1 cột — branding ẩn, form full-width.
 *
 * Logic giữ NGUYÊN:
 *  - Gọi `useAuthStore().login(email, password)`
 *  - Điều hướng `redirect` query hoặc `/`
 *  - Error parsing: `e?.response?.data?.error?.message ?? 'Đăng nhập thất bại'`
 *  - OAuth flow qua `useOAuth().loginWith(provider)`
 *  - EMAIL_NOT_VERIFIED → link tới verify-otp
 *
 * Khác biệt so với Register:
 *  - KHÔNG có Role Selector (role đã gắn với tài khoản).
 *  - Form gọn hơn: chỉ Email + Password.
 *  - Branding nhẹ hơn: 1 badge + heading + description + 3 benefits + illustration.
 */
import { ref, computed, nextTick, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { useOAuth } from '@composables/useOAuth';
import { useAnimatedCount } from '@composables/useAnimatedCount';
import { extractErrorCode, extractErrorMessage } from '@services/http';
import OAuthButtons from '@components/auth/OAuthButtons.vue';
import { Briefcase, Eye, EyeOff } from 'lucide-vue-next';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const { loginWith } = useOAuth();

const email = ref('');
const password = ref('');
const showPassword = ref(false);
const error = ref('');
const errorCode = ref('');
const loading = ref(false);

/**
 * Per-field shake counter — tăng để remount :key và trigger lại CSS `animate-shake`
 * cho từng field sai. Mỗi field có counter RIÊNG nên field hợp lệ không bị destroy,
 * không giật focus, không rung "oan" khi người dùng chỉ sai 1 ô.
 *
 * Thứ tự key khớp thứ tự hiển thị form: email → password.
 */
const shake = ref<{ email: number; password: number }>({
  email: 0,
  password: 0,
});

/* ============================================================================
 * Stats counter animation
 * Số đếm từ 0 → target khi mount, dùng requestAnimationFrame cho mượt.
 * Stagger 60ms giữa 3 số. Duration 700ms cho cảm giác snappy.
 * M2+V2+M1 FIX: dùng composable useAnimatedCount (cleanup RAF tự động).
 * ==========================================================================*/
const { jobsCount, companiesCount, satisfactionCount } = useAnimatedCount();

// Template refs để focus input đầu tiên bị lỗi (UX nhất quán với RegisterView).
const emailInputRef = ref<HTMLInputElement | null>(null);
const passwordInputRef = ref<HTMLInputElement | null>(null);

// Client-side validation để hiển thị message VN trước khi gửi BE.
// BE trả "Invalid input" EN nếu FE không validate — UX kém.
const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value));
const passwordValid = computed(() => password.value.length > 0);

const onSubmit = async () => {
  // Validate đồng thời cả 2 field (không early-return). Field nào sai thì:
  //  1) tăng counter shake riêng của nó → rung ĐỒNG THỜI cả 2 ô khi cả 2 sai.
  //  2) chỉ hiện message LỖI ĐẦU TIÊN theo thứ tự form (email → password) — user
  //     sửa xong ô đó, submit lại sẽ thấy message của ô kế tiếp.
  type FieldKey = 'email' | 'password';
  let firstInvalid: FieldKey | null = null;

  if (!emailValid.value) {
    shake.value.email++;
    if (firstInvalid === null) firstInvalid = 'email';
  }
  if (!passwordValid.value) {
    shake.value.password++;
    if (firstInvalid === null) firstInvalid = 'password';
  }

  if (firstInvalid !== null) {
    const messages: Record<FieldKey, string> = {
      email: 'Email không hợp lệ. Vui lòng kiểm tra lại (vd: ten@example.com).',
      password: 'Vui lòng nhập mật khẩu.',
    };
    error.value = messages[firstInvalid];
    errorCode.value = '';
    await nextTick();
    if (firstInvalid === 'email') emailInputRef.value?.focus();
    else if (firstInvalid === 'password') passwordInputRef.value?.focus();
    return;
  }

  error.value = '';
  errorCode.value = '';
  loading.value = true;
  try {
    await auth.login(email.value, password.value);
    await auth.fetchMe();
    // D2 FIX: sanitize redirect — chỉ cho phép relative path, block external URL
    // để chặn open redirect attack (vd ?redirect=https://evil-phishing.com).
    // F1 FIX: route.query.redirect có thể là string | string[] (vd ?redirect=/a&redirect=/b).
    // Phải handle array case để tránh TypeError.
    const q = route.query.redirect;
    const rawRedirect = typeof q === 'string' ? q : Array.isArray(q) ? String(q[0] ?? '') : '';
    const isSafeRedirect = (url: string): boolean => {
      if (!url) return false;
      if (!url.startsWith('/')) return false; // Phải bắt đầu bằng /
      if (url.startsWith('//')) return false;       // //evil.com → protocol-relative
      if (url.includes('://')) return false;        // /path@evil.com
      return true;
    };
    const safeRedirect = isSafeRedirect(rawRedirect) ? rawRedirect : null;

    if (safeRedirect) {
      router.push(safeRedirect);
    } else if (auth.user?.role === 'admin') {
      // Admin role → AdminLayout (Dashboard) — fix từ "redirect /forbidden"
      // (cũ vì /admin route chưa tồn tại) sang dùng route mới.
      router.push('/admin');
    } else if (auth.user?.role === 'employer') {
      router.push('/employer');
    } else {
      router.push('/candidate');
    }
  } catch (e: any) {
    // F4 FIX: dùng extractErrorMessage/Code helper để đọc đúng HttpError envelope
    // (BE đã localize). Trước đây đọc axios cũ → user không thấy message VN.
    error.value = extractErrorMessage(e, 'Đăng nhập thất bại');
    errorCode.value = extractErrorCode(e);
  } finally {
    loading.value = false;
  }
};

const onOAuth = async (provider: 'google' | 'facebook' | 'github') => {
  await loginWith(provider);
};

/**
 * Bug 2 FIX: Navigate tới /verify-otp với ?from=login (không truyền email — PII).
 * - Email lưu vào Pinia (memory, OK cho in-tab flow).
 * - Source 'login' truyền qua URL ?from=login → F5-safe, không cần sessionStorage.
 * VerifyOtpView đọc source từ URL query để:
 *   1. Auto-resend OTP (vì OTP cũ có thể đã expired khi user click "Xác thực ngay")
 *   2. Hiển thị link "← Quay lại đăng nhập" thay vì đăng ký
 */
const goToVerifyOtp = (): void => {
  auth.setPendingVerifyEmail(email.value, 'login');
  router.push({ name: 'verify-otp', query: { from: 'login' } });
};
</script>

<template>
  <!--
    STRUCTURE (đồng bộ Register):
      page (bg-slate-50)
        → centered container max-w-[1200px] mx-auto
            → ambient bg layer + decorative blobs
            → header (logo, cùng container)
            → main grid (2 cột, items-center, cùng baseline)
    Hai phần Branding + Form nằm chung 1 grid → cùng trục thị giác, không có
    khoảng trắng lớn ở giữa.
  -->
  <div class="fixed inset-0 overflow-hidden bg-slate-50">
    <!-- Ambient background: gradient mềm từ trái → transparent (giống Register, không có hard divider) -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div
        class="absolute inset-y-0 left-0 right-1/3 bg-gradient-to-r from-primary-100/55 via-primary-50/30 to-transparent"
      />
      <div
        class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-primary-50/40 to-transparent"
      />
    </div>

    <!-- Decorative blurred blobs — tone nhẹ hơn Register để nhường "sân khấu" cho form -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div class="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-primary-200/30 blur-3xl animate-blob" />
      <div class="absolute top-1/3 left-[18%] h-96 w-96 rounded-full bg-primary-100/35 blur-3xl animate-blob" style="animation-delay: 2s;" />
      <div class="absolute -bottom-32 left-[8%] h-96 w-96 rounded-full bg-primary-50/60 blur-3xl animate-blob" style="animation-delay: 4s;" />
      <div class="absolute top-1/4 right-[10%] h-72 w-72 rounded-full bg-primary-100/15 blur-3xl animate-blob" style="animation-delay: 6s;" />
    </div>

    <!-- Centered content container — header + main cùng khung
         max-w-[1200px]: 2 cột bằng nhau (grid-cols-2), branding 440 + form 440 + gap 56 = 936, mỗi cột 524. -->
    <div
      class="relative mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-6 lg:px-10 xl:px-12"
    >
      <!-- Logo JobMatch — không bọc RouterLink (user không muốn click logo nhảy trang).
           Dùng div thuần, giữ nguyên layout & styling. -->
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

      <!-- Main grid: 2 cột, items-start (content dính đỉnh, không center).
           Logo pt-8 lg:pt-10 → content pt-10 lg:pt-14 (đồng bộ với 3 trang kia). -->
      <main
        class="relative z-10 grid flex-1 grid-cols-1 items-start gap-y-3 pt-10 lg:grid-cols-2 lg:gap-x-14 lg:gap-y-0 lg:pt-14"
      >
        <!-- ========== CỘT TRÁI — BRANDING (nhẹ hơn Register) ==========
             Bỏ justify-self-center để branding thẳng hàng với logo (cùng ở 48px từ container left).
             Default justify-self (start) → section 440px ở đầu trái của cột 524px. -->
        <section data-testid="branding-section" class="hidden lg:block w-full max-w-[440px] animate-fade-up" style="animation-delay: 80ms;">
          <div class="inline-flex items-center gap-2">
            <span class="h-px w-4 bg-slate-900 animate-grow-bar" aria-hidden="true"></span>
            <p class="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
              Dành cho ứng viên & nhà tuyển dụng
            </p>
          </div>

          <h2
            class="mt-3 text-2xl xl:text-[26px] font-bold tracking-tight text-slate-900 leading-tight"
          >
            Chào mừng bạn<br />quay trở lại
          </h2>
          <p class="mt-2 text-sm text-slate-600 leading-snug">
            Đăng nhập để tiếp tục hành trình tìm việc hoặc tuyển dụng cùng JobMatch.
          </p>

          <ul class="mt-5 space-y-3">
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Tìm cơ hội việc làm</span> phù hợp với bạn
            </li>
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Quản lý CV & hồ sơ</span> chuyên nghiệp, an toàn
            </li>
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Kết nối</span> đúng ứng viên & nhà tuyển dụng
            </li>
          </ul>

          <!-- Trust indicators — số liệu thực tế về nền tảng (không phải icon AI).
               Số đếm từ 0 → target khi mount (stagger 60ms). -->
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

        <!-- ========== CỘT PHẢI — LOGIN FORM ==========
             Default justify-self (start) → form 440px ở đầu trái cột 524px.
             Logo top-left + branding + form đều ở đầu trái → thẳng hàng với logo. -->
        <section data-testid="form-section" class="w-full max-w-[440px] justify-self-center lg:justify-self-start animate-fade-up" style="animation-delay: 160ms;">
          <header>
            <h1 class="text-xl font-bold tracking-tight text-slate-900">Đăng nhập JobMatch</h1>
            <p class="mt-1 text-sm text-slate-600 leading-snug">
              Tiếp tục hành trình nghề nghiệp của bạn
            </p>
          </header>

          <!-- Form -->
          <form @submit.prevent="onSubmit" class="mt-3 space-y-3" novalidate>
            <!-- Email -->
            <div>
              <label for="login-email" class="block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="login-email"
                name="email"
                ref="emailInputRef"
                v-model="email"
                type="email"
                required
                autocomplete="email"
                :key="`email-${shake.email}`"
                :aria-invalid="shake.email > 0 && !emailValid ? 'true' : 'false'"
                :aria-describedby="shake.email > 0 && !emailValid ? 'login-email-err' : undefined"
                class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/40"
                :class="!emailValid && shake.email > 0 ? 'animate-shake !border-red-400 focus:!border-red-500 focus:!ring-red-500/40' : ''"
                placeholder="Nhập email của bạn"
              />
              <!-- A11Y-1: per-field error message với id trùng aria-describedby ở trên -->
              <p
                v-if="shake.email > 0 && !emailValid"
                id="login-email-err"
                role="alert"
                class="mt-1 text-xs text-red-600"
              >
                Email không hợp lệ. Vui lòng kiểm tra lại (vd: ten@example.com).
              </p>
            </div>

            <!-- Mật khẩu + Quên mật khẩu? -->
            <div>
              <label for="login-password" class="block text-sm font-medium text-slate-700">
                Mật khẩu
              </label>
              <div class="relative mt-1">
                <input
                  id="login-password"
                  name="password"
                  ref="passwordInputRef"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  required
                  autocomplete="current-password"
                  :key="`password-${shake.password}`"
                  :aria-invalid="shake.password > 0 && !passwordValid ? 'true' : 'false'"
                  :aria-describedby="shake.password > 0 && !passwordValid ? 'login-password-err' : undefined"
                  class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/40"
                  :class="!passwordValid && shake.password > 0 ? 'animate-shake !border-red-400 focus:!border-red-500 focus:!ring-red-500/40' : ''"
                  placeholder="Nhập mật khẩu"
                />
                <button
                  type="button"
                  @click="showPassword = !showPassword"
                  :aria-label="showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                  class="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 transition"
                  tabindex="-1"
                >
                  <EyeOff v-if="showPassword" :size="18" />
                  <Eye v-else :size="18" />
                </button>
              </div>
              <!-- A11Y-1: per-field error message với id trùng aria-describedby ở trên -->
              <p
                v-if="shake.password > 0 && !passwordValid"
                id="login-password-err"
                role="alert"
                class="mt-1 text-xs text-red-600"
              >
                Vui lòng nhập mật khẩu.
              </p>
              <div class="mt-1.5 flex justify-end">
                <RouterLink
                  :to="{ name: 'forgot-password' }"
                  class="link-underline text-xs font-medium text-primary-600 hover:text-primary-700 transition"
                >
                  Quên mật khẩu?
                </RouterLink>
              </div>
            </div>

            <!-- Error: gộp 3 trường hợp vào 1 box, wrap trong Transition để slide-down. -->
            <Transition name="error">
              <p
                v-if="errorCode === 'EMAIL_NOT_VERIFIED'"
                role="alert"
                class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
              >
                {{ error }}
                <button
                  type="button"
                  @click="goToVerifyOtp"
                  class="mt-1 block font-semibold underline hover:no-underline"
                >
                  Xác thực email ngay →
                </button>
              </p>

              <p
                v-else-if="error && errorCode !== 'OAUTH_ONLY_ACCOUNT'"
                role="alert"
                class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
              >
                {{ error }}
              </p>

              <p
                v-else-if="errorCode === 'OAUTH_ONLY_ACCOUNT'"
                role="alert"
                class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 text-center"
              >
                Tài khoản này đã đăng ký qua mạng xã hội.<br />
                Vui lòng dùng nút Google / Facebook / GitHub bên dưới.
              </p>
            </Transition>

            <!-- Submit -->
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
              {{ loading ? 'Đang đăng nhập...' : 'Đăng nhập' }}
            </button>
          </form>

          <!-- Divider: "Hoặc đăng nhập với" — line 2 bên vẽ từ ngoài vào giữa -->
          <div class="my-4 flex items-center" aria-hidden="true">
            <div class="divider-line divider-line-left flex-1 border-t border-slate-200"></div>
            <span class="px-3 text-xs font-medium uppercase tracking-wider text-slate-400">
              Hoặc đăng nhập với
            </span>
            <div class="divider-line divider-line-right flex-1 border-t border-slate-200"></div>
          </div>

          <!-- Social login: Google / GitHub / Facebook (stagger fade-up lần lượt) -->
          <OAuthButtons @select="onOAuth" />

          <!-- Register link -->
          <p class="mt-4 text-center text-sm text-slate-600">
            Chưa có tài khoản?
            <RouterLink
              to="/register"
              class="link-underline font-semibold text-primary-600 hover:text-primary-700 transition"
            >
              Đăng ký
            </RouterLink>
          </p>
        </section>
      </main>
    </div>
  </div>
</template>