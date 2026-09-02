<script setup lang="ts">
/**
 * LoginView — Trang đăng nhập JobMatch.
 *
 * Layout (đồng bộ với Register, gọn hơn):
 *  - Desktop (>= lg): 2 cột — branding trái + form phải, cùng container max-w-[1180px].
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
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { useOAuth } from '@composables/useOAuth';
import OAuthButtons from '@components/auth/OAuthButtons.vue';
import { Check, Eye, EyeOff, Sparkles } from 'lucide-vue-next';

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

const onSubmit = async () => {
  loading.value = true;
  error.value = '';
  errorCode.value = '';
  try {
    await auth.login(email.value, password.value);
    await auth.fetchMe();
    const redirect = route.query.redirect as string;
    if (redirect) {
      router.push(redirect);
    } else if (auth.user?.role === 'employer') {
      router.push('/employer');
    } else {
      router.push('/candidate');
    }
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message ?? 'Đăng nhập thất bại';
    errorCode.value = e?.response?.data?.error?.code ?? '';
  } finally {
    loading.value = false;
  }
};

const onOAuth = async (provider: 'google' | 'facebook' | 'github') => {
  await loginWith(provider);
};
</script>

<template>
  <!--
    STRUCTURE (đồng bộ Register):
      page (bg-slate-50)
        → centered container max-w-[1180px] mx-auto
            → ambient bg layer + decorative blobs
            → header (logo, cùng container)
            → main grid (2 cột, items-center, cùng baseline)
    Hai phần Branding + Form nằm chung 1 grid → cùng trục thị giác, không có
    khoảng trắng lớn ở giữa.
  -->
  <div class="relative min-h-screen overflow-hidden bg-slate-50">
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
      <div class="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-primary-200/30 blur-3xl" />
      <div class="absolute top-1/3 left-[18%] h-96 w-96 rounded-full bg-primary-100/35 blur-3xl" />
      <div class="absolute -bottom-32 left-[8%] h-96 w-96 rounded-full bg-primary-50/60 blur-3xl" />
      <div class="absolute top-1/4 right-[10%] h-72 w-72 rounded-full bg-primary-100/15 blur-3xl" />
    </div>

    <!-- Centered content container — header + main cùng khung -->
    <div
      class="relative mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-6 lg:px-10 xl:px-12"
    >
      <!-- Logo JobMatch — đặt cùng container, pt GIỐNG Register để cùng trục.
           Mobile: pt-12 (48px) → logo dịch xuống cho cân đối với content bên dưới.
           Desktop: lg:pt-16 giữ nguyên để đồng bộ 2 trang. -->
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

      <!-- Main grid: 2 cột. items-start để branding + form cùng top-align.
           Mobile: pt-10 (40px gap từ logo → content) → content xa logo, có breathing room thoáng.
           Desktop: pt-3 + section lg:pt-10 giống Register → vị trí content đồng nhất 2 trang. -->
      <main
        class="relative z-10 grid flex-1 grid-cols-1 items-start gap-y-8 pt-10 lg:grid-cols-[1fr_1.3fr] lg:gap-x-10 lg:gap-y-0 lg:pt-3 xl:gap-x-14"
      >
        <!-- ========== CỘT TRÁI — BRANDING (nhẹ hơn Register) ==========
             lg:pt-10 giống Register → branding content bắt đầu ở cùng vị trí dọc. -->
        <section class="hidden lg:block w-full max-w-[440px] lg:pt-10">
          <p
            class="inline-flex items-center gap-2 text-[11px] font-medium tracking-wide text-primary-700 bg-primary-100/70 rounded-full px-3 py-1"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-primary-600" />
            Dành cho ứng viên & nhà tuyển dụng
          </p>

          <h2
            class="mt-3 text-2xl xl:text-[26px] font-bold tracking-tight text-slate-900 leading-tight"
          >
            Chào mừng bạn<br />quay trở lại
          </h2>
          <p class="mt-2 text-sm text-slate-600 leading-snug">
            Đăng nhập để tiếp tục hành trình tìm việc hoặc tuyển dụng cùng JobMatch.
          </p>

          <ul class="mt-5 space-y-2.5">
            <li class="flex items-start gap-2.5">
              <span
                class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-600 text-white"
              >
                <Check class="h-3 w-3" aria-hidden="true" />
              </span>
              <span class="text-sm text-slate-700 leading-snug">
                <span class="font-medium text-slate-900">Tìm cơ hội việc làm</span> phù hợp
              </span>
            </li>
            <li class="flex items-start gap-2.5">
              <span
                class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-600 text-white"
              >
                <Check class="h-3 w-3" aria-hidden="true" />
              </span>
              <span class="text-sm text-slate-700 leading-snug">
                <span class="font-medium text-slate-900">Quản lý CV & hồ sơ</span> chuyên nghiệp
              </span>
            </li>
            <li class="flex items-start gap-2.5">
              <span
                class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-600 text-white"
              >
                <Check class="h-3 w-3" aria-hidden="true" />
              </span>
              <span class="text-sm text-slate-700 leading-snug">
                <span class="font-medium text-slate-900">Kết nối</span> đúng ứng viên & nhà tuyển dụng
              </span>
            </li>
          </ul>

          <!-- Illustration SVG — compact, nằm gọn trong cột branding -->
          <div class="mt-5 max-w-[320px]" aria-hidden="true">
            <svg
              viewBox="0 0 480 200"
              class="w-full h-auto max-h-[120px]"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
            >
              <rect x="40" y="30" width="400" height="140" rx="16" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" />
              <circle cx="100" cy="80" r="20" fill="#DBEAFE" />
              <circle cx="100" cy="74" r="7" fill="#2563EB" />
              <path d="M84 94 C 84 84, 116 84, 116 94 L 116 100 L 84 100 Z" fill="#2563EB" />
              <rect x="135" y="68" width="170" height="8" rx="4" fill="#E2E8F0" />
              <rect x="135" y="84" width="110" height="6" rx="3" fill="#EFF6FF" />
              <rect x="60" y="118" width="180" height="42" rx="8" fill="#F8FAFC" stroke="#E2E8F0" />
              <rect x="74" y="130" width="110" height="6" rx="3" fill="#CBD5E1" />
              <rect x="74" y="142" width="70" height="5" rx="3" fill="#E2E8F0" />
              <rect x="260" y="118" width="160" height="42" rx="8" fill="#EFF6FF" stroke="#BFDBFE" />
              <circle cx="280" cy="139" r="9" fill="#2563EB" />
              <path d="M275 139 l4 4 l7 -8" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <rect x="296" y="129" width="100" height="5" rx="3" fill="#1E3A8A" />
              <rect x="296" y="142" width="74" height="5" rx="3" fill="#3B82F6" opacity="0.6" />
              <path d="M240 139 C 250 139, 250 139, 260 138" stroke="#2563EB" stroke-width="1.5" stroke-dasharray="3 3" />
              <path d="M420 50 l 3 -6 l 3 6 l 6 3 l -6 3 l -3 6 l -3 -6 l -6 -3 z" fill="#2563EB" opacity="0.7" />
              <path d="M70 40 l 2 -4 l 2 4 l 4 2 l -4 2 l -2 4 l -2 -4 l -4 -2 z" fill="#3B82F6" opacity="0.5" />
            </svg>
          </div>
        </section>

        <!-- ========== CỘT PHẢI — LOGIN FORM ========== -->
        <section class="w-full max-w-[480px] justify-self-start">
          <header>
            <h1 class="text-2xl font-bold tracking-tight text-slate-900">Đăng nhập JobMatch</h1>
            <p class="mt-1.5 text-sm text-slate-600">
              Tiếp tục hành trình nghề nghiệp của bạn
            </p>
          </header>

          <!-- Social login: Google / GitHub / Facebook -->
          <div class="mt-5">
            <OAuthButtons @select="onOAuth" />
          </div>

          <!-- Divider: "Hoặc" -->
          <div class="my-4 flex items-center" aria-hidden="true">
            <div class="flex-1 border-t border-slate-200"></div>
            <span class="px-3 text-xs font-medium uppercase tracking-wider text-slate-400">Hoặc</span>
            <div class="flex-1 border-t border-slate-200"></div>
          </div>

          <!-- Form -->
          <form @submit.prevent="onSubmit" class="space-y-3" novalidate>
            <!-- Email -->
            <div>
              <label for="login-email" class="block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="login-email"
                v-model="email"
                type="email"
                required
                autocomplete="email"
                class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                placeholder="Nhập email của bạn"
              />
            </div>

            <!-- Mật khẩu + Quên mật khẩu? -->
            <div>
              <label for="login-password" class="block text-sm font-medium text-slate-700">
                Mật khẩu
              </label>
              <div class="relative mt-1">
                <input
                  id="login-password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  required
                  autocomplete="current-password"
                  class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
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
              <div class="mt-1.5 flex justify-end">
                <RouterLink
                  :to="{ name: 'forgot-password' }"
                  class="text-xs font-medium text-primary-600 hover:text-primary-700 transition"
                >
                  Quên mật khẩu?
                </RouterLink>
              </div>
            </div>

            <!-- Error -->
            <p
              v-if="error"
              role="alert"
              class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
            >
              {{ error }}
            </p>

            <!-- EMAIL_NOT_VERIFIED: link tới verify-otp -->
            <p v-if="errorCode === 'EMAIL_NOT_VERIFIED'" class="text-sm text-center">
              <RouterLink
                :to="{ name: 'verify-otp', query: { email } }"
                class="font-semibold text-primary-600 hover:text-primary-700 transition"
              >
                Xác thực email ngay →
              </RouterLink>
            </p>

            <!-- Submit -->
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
              {{ loading ? 'Đang đăng nhập...' : 'Đăng nhập' }}
            </button>
          </form>

          <!-- Register link -->
          <p class="mt-4 text-center text-sm text-slate-600">
            Chưa có tài khoản?
            <RouterLink
              to="/register"
              class="font-semibold text-primary-600 hover:text-primary-700 transition"
            >
              Đăng ký
            </RouterLink>
          </p>
        </section>
      </main>
    </div>
  </div>
</template>