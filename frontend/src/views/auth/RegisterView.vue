<script setup lang="ts">
/**
 * RegisterView — Trang đăng ký JobMatch.
 *
 * Layout:
 *  - Desktop (>= md): 2 cột — branding trái (45%) + form phải (55%).
 *  - Mobile: 1 cột — form full-width, branding ẩn.
 *
 * Logic giữ NGUYÊN từ bản cũ:
 *  - Gọi `useAuthStore().register({ email, password, fullName, role })`
 *  - Điều hướng `verify-otp` với query email
 *  - Error parsing: `e?.response?.data?.error?.message ?? 'Đăng ký thất bại'`
 *
 * fullName được gửi lên BE qua registerRequestOtp. Backend insert cả users lẫn
 * userProfiles trong cùng một transaction (xem auth.service.requestOtp).
 */
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { UserRound, Building2, Check, Eye, EyeOff, Sparkles } from 'lucide-vue-next';

type Role = 'candidate' | 'employer';

const router = useRouter();
const auth = useAuthStore();

const fullName = ref('');
const email = ref('');
const password = ref('');
const role = ref<Role>('candidate');
const showPassword = ref(false);

const error = ref('');
const loading = ref(false);

// Validation client-side (giữ logic cũ — HTML5 required + minlength 8)
const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value));
const passwordValid = computed(() => password.value.length >= 8);
const nameValid = computed(() => fullName.value.trim().length >= 2);

const canSubmit = computed(
  () => !loading.value && emailValid.value && passwordValid.value && nameValid.value,
);

const selectRole = (r: Role): void => {
  role.value = r;
  error.value = '';
};

const onSubmit = async () => {
  if (!canSubmit.value) {
    // Trường hợp user disable HTML5 validation (autofill, paste, ...) — báo lỗi rõ ràng
    if (!nameValid.value) error.value = 'Vui lòng nhập họ và tên';
    else if (!emailValid.value) error.value = 'Email không hợp lệ';
    else if (!passwordValid.value) error.value = 'Mật khẩu tối thiểu 8 ký tự';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await auth.register({
      email: email.value,
      password: password.value,
      fullName: fullName.value.trim(),
      role: role.value,
    });
    // fullName đã được BE lưu vào userProfiles trong cùng transaction với users
    // (xem auth.service.requestOtp). Onboarding sau này có thể đọc qua auth.me()
    // hoặc profile endpoint — không cần lưu tạm ở FE nữa.
    //
    // Email KHÔNG truyền qua URL nữa (trước đây bị leak vào history, Referer,
    // access log). Lưu vào sessionStorage qua store — VerifyOtpView đọc từ đó.
    auth.setPendingVerifyEmail(email.value);
    await router.push({ name: 'verify-otp' });
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message ?? 'Đăng ký thất bại';
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <!--
    STRUCTURE:
      page (bg-slate-50)
        → centered container max-w-[1180px] mx-auto
            → bg layer (cùng grid proportions, không trôi)
            → header (logo, cùng container)
            → main grid (2 cột, align-items: center, cùng baseline)
    Mọi phần tử hiển thị đều nằm trong container trung tâm — không còn 2 section
    full-viewport tự canh giữa độc lập.
  -->
  <div class="relative min-h-screen overflow-hidden bg-slate-50">
    <!-- Ambient background: gradient mềm chảy từ trái sang, fade về transparent ở giữa —
         KHÔNG có đường viền cứng, KHÔNG có 2 cell tách biệt. Tạo cảm giác liền mạch. -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <!-- Lớp gradient chính: primary-50 → transparent -->
      <div
        class="absolute inset-y-0 left-0 right-1/3 bg-gradient-to-r from-primary-100/55 via-primary-50/30 to-transparent"
      />
      <!-- Lớp gradient phụ từ góc dưới-trái -->
      <div
        class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-primary-50/40 to-transparent"
      />
    </div>

    <!-- Decorative blurred blobs tạo chiều sâu, trải đều 2 bên -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div
        class="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-primary-200/30 blur-3xl"
      />
      <div
        class="absolute top-1/3 left-[18%] h-96 w-96 rounded-full bg-primary-100/35 blur-3xl"
      />
      <div
        class="absolute -bottom-32 left-[8%] h-96 w-96 rounded-full bg-primary-50/60 blur-3xl"
      />
      <!-- Blob nhẹ phía phải để cân đối, tone rất nhạt -->
      <div
        class="absolute top-1/4 right-[10%] h-72 w-72 rounded-full bg-primary-100/15 blur-3xl"
      />
    </div>

    <!-- Centered content container: max-w-[1180px], header + main cùng khung -->
    <div
      class="relative mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-6 lg:px-10 xl:px-12"
    >

      <!-- Logo JobMatch — đặt ở đầu layout, là item riêng trong container.
           Mobile: pt-12 (48px) → logo dịch xuống cho cân đối với content bên dưới.
           Desktop: lg:pt-16 giữ nguyên để đồng bộ với Login. -->
      <RouterLink to="/" class="relative z-10 inline-flex items-center gap-2 pt-12 group lg:pt-16" aria-label="JobMatch">
        <span
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm transition group-hover:bg-primary-700"
        >
          <Sparkles class="h-5 w-5" aria-hidden="true" />
        </span>
        <span class="text-xl font-semibold tracking-tight text-slate-900">JobMatch</span>
      </RouterLink>

      <!-- Main grid: 2 cột, items-start.
           Mobile: pt-10 (40px gap từ logo → content) → content xa logo, có breathing room thoáng.
           Desktop: pt-3 giữ nguyên để đồng bộ gap logo-content với Login. -->
      <main
        class="relative z-10 grid flex-1 grid-cols-1 items-start gap-y-10 pt-10 lg:grid-cols-[1fr_1.3fr] lg:gap-x-10 lg:gap-y-0 lg:pt-3 xl:gap-x-14"
      >
        <!-- ========== CỘT TRÁI — BRANDING ========== -->
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
            Tạo tài khoản<br />JobMatch
          </h2>
          <p class="mt-2 text-sm text-slate-600">
            Kết nối đúng người, đúng cơ hội nghề nghiệp.
          </p>

          <ul class="mt-5 space-y-2.5">
            <li class="flex items-start gap-2.5">
              <span
                class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-600 text-white"
              >
                <Check class="h-3 w-3" aria-hidden="true" />
              </span>
              <span class="text-sm text-slate-700 leading-snug">
                <span class="font-medium text-slate-900">Tìm kiếm cơ hội việc làm</span> phù hợp
              </span>
            </li>
            <li class="flex items-start gap-2.5">
              <span
                class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-600 text-white"
              >
                <Check class="h-3 w-3" aria-hidden="true" />
              </span>
              <span class="text-sm text-slate-700 leading-snug">
                <span class="font-medium text-slate-900">Tạo và quản lý CV</span> chuyên nghiệp
              </span>
            </li>
            <li class="flex items-start gap-2.5">
              <span
                class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary-600 text-white"
              >
                <Check class="h-3 w-3" aria-hidden="true" />
              </span>
              <span class="text-sm text-slate-700 leading-snug">
                <span class="font-medium text-slate-900">Kết nối</span> ứng viên & nhà tuyển dụng
              </span>
            </li>
          </ul>

          <!-- Illustration SVG: rộng ~300-380px, nằm trong flow branding -->
          <div class="mt-5 max-w-[360px]" aria-hidden="true">
            <svg
              viewBox="0 0 480 200"
              class="w-full h-auto max-h-[140px]"
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

        <!-- ========== CỘT PHẢI — FORM ========== -->
        <section class="w-full max-w-[520px] justify-self-start">
          <!-- Heading -->
          <header>
            <h1 class="text-2xl font-bold tracking-tight text-slate-900">Tạo tài khoản</h1>
            <p class="mt-1.5 text-sm text-slate-600">
              Bắt đầu hành trình của bạn cùng JobMatch
            </p>
          </header>

          <!-- Role selector -->
          <fieldset class="mt-5">
            <legend class="text-sm font-medium text-slate-700">
              Bạn muốn sử dụng JobMatch với vai trò nào?
            </legend>

            <div class="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <!-- Ứng viên -->
              <button
                type="button"
                @click="selectRole('candidate')"
                :aria-pressed="role === 'candidate'"
                :class="[
                  'group relative flex items-center gap-3 rounded-xl border bg-white p-3 text-left transition-all',
                  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1',
                  role === 'candidate'
                    ? 'border-primary-600 bg-primary-50 shadow-sm'
                    : 'border-slate-200 hover:border-primary-300 hover:shadow-sm',
                ]"
              >
                <span
                  v-if="role === 'candidate'"
                  class="absolute right-2.5 top-2.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-white shadow-sm"
                  aria-hidden="true"
                >
                  <Check class="h-3 w-3" />
                </span>
                <span
                  :class="[
                    'inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg transition',
                    role === 'candidate'
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-100 text-slate-600 group-hover:bg-primary-100 group-hover:text-primary-700',
                  ]"
                  aria-hidden="true"
                >
                  <UserRound class="h-5 w-5" />
                </span>
                <span class="min-w-0">
                  <span
                    :class="[
                      'block text-sm font-semibold leading-tight',
                      role === 'candidate' ? 'text-primary-700' : 'text-slate-900',
                    ]"
                  >
                    Ứng viên
                  </span>
                  <span class="block text-xs text-slate-500 leading-snug mt-0.5">
                    Tìm công việc phù hợp
                  </span>
                </span>
              </button>

              <!-- Nhà tuyển dụng -->
              <button
                type="button"
                @click="selectRole('employer')"
                :aria-pressed="role === 'employer'"
                :class="[
                  'group relative flex items-center gap-3 rounded-xl border bg-white p-3 text-left transition-all',
                  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1',
                  role === 'employer'
                    ? 'border-primary-600 bg-primary-50 shadow-sm'
                    : 'border-slate-200 hover:border-primary-300 hover:shadow-sm',
                ]"
              >
                <span
                  v-if="role === 'employer'"
                  class="absolute right-2.5 top-2.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-white shadow-sm"
                  aria-hidden="true"
                >
                  <Check class="h-3 w-3" />
                </span>
                <span
                  :class="[
                    'inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg transition',
                    role === 'employer'
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-100 text-slate-600 group-hover:bg-primary-100 group-hover:text-primary-700',
                  ]"
                  aria-hidden="true"
                >
                  <Building2 class="h-5 w-5" />
                </span>
                <span class="min-w-0">
                  <span
                    :class="[
                      'block text-sm font-semibold leading-tight',
                      role === 'employer' ? 'text-primary-700' : 'text-slate-900',
                    ]"
                  >
                    Nhà tuyển dụng
                  </span>
                  <span class="block text-xs text-slate-500 leading-snug mt-0.5">
                    Tìm ứng viên phù hợp
                  </span>
                </span>
              </button>
            </div>
          </fieldset>

          <!-- Form -->
          <form @submit.prevent="onSubmit" class="mt-4 space-y-3" novalidate>
            <!-- Họ và tên -->
            <div>
              <label for="reg-name" class="block text-sm font-medium text-slate-700">
                Họ và tên <span class="text-red-500">*</span>
              </label>
              <input
                id="reg-name"
                v-model="fullName"
                type="text"
                required
                autocomplete="name"
                class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                placeholder="Nhập họ và tên của bạn"
              />
            </div>

            <!-- Email -->
            <div>
              <label for="reg-email" class="block text-sm font-medium text-slate-700">
                Email <span class="text-red-500">*</span>
              </label>
              <input
                id="reg-email"
                v-model="email"
                type="email"
                required
                autocomplete="email"
                class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                placeholder="Nhập email của bạn"
              />
            </div>

            <!-- Mật khẩu -->
            <div>
              <label for="reg-password" class="block text-sm font-medium text-slate-700">
                Mật khẩu <span class="text-red-500">*</span>
              </label>
              <div class="relative mt-1">
                <input
                  id="reg-password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  required
                  minlength="8"
                  autocomplete="new-password"
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
              <p class="mt-1 text-xs text-slate-500">Mật khẩu tối thiểu 8 ký tự</p>
            </div>

            <!-- Error -->
            <p
              v-if="error"
              role="alert"
              class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
            >
              {{ error }}
            </p>

            <!-- Submit -->
            <button
              type="submit"
              :disabled="!canSubmit"
              class="flex w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                v-if="loading"
                class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              {{ loading ? 'Đang tạo tài khoản...' : 'Tạo tài khoản' }}
            </button>
          </form>

          <!-- Login link -->
          <p class="mt-4 text-center text-sm text-slate-600">
            Đã có tài khoản?
            <RouterLink
              to="/login"
              class="font-semibold text-primary-600 hover:text-primary-700 transition"
            >
              Đăng nhập
            </RouterLink>
          </p>
        </section>
      </main>
    </div>
  </div>
</template>
