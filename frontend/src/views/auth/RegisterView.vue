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

/* Compact mode cho viewport thấp (≤700px) — tiết kiệm ~85px để fit form ở 600h.
   Áp dụng class .compact trên root element khi viewport ≤ 700px (computed trong
   script). Chỉ override spacing — KHÔNG đổi typography weight/colors/layout structure.
   Tailwind classes gốc (lg:pt-14, mt-4, mt-3, space-y-2, etc.) vẫn dùng cho viewport
   bình thường; .compact chỉ áp dụng khi cần. */
.compact main {
  padding-top: 1.5rem !important; /* 24px thay vì 56px */
}
.compact h1 {
  font-size: 1.125rem !important; /* text-lg thay vì text-xl */
  line-height: 1.4 !important;
}
.compact header > p {
  font-size: 0.8125rem !important; /* nhỏ hơn text-sm */
  margin-top: 0.25rem !important;
}
.compact fieldset {
  margin-top: 0.5rem !important; /* thay vì mt-4 (16px) */
}
.compact fieldset > div {
  gap: 0.5rem !important; /* thay vì gap-2.5 (10px) */
}
.compact form.space-y-2 > * + * {
  margin-top: 0.25rem !important; /* 4px thay vì 8px (space-y-2) */
}
.compact p.mt-4 {
  margin-top: 0.75rem !important; /* mt-3 thay vì mt-4 */
}
/* Tighter role selector cards trong compact mode */
.compact fieldset button {
  padding: 0.5rem !important; /* p-2 thay vì p-2.5 */
  gap: 0.5rem !important;
}
.compact fieldset button > span:first-child {
  /* icon container h-8 w-8 → nhỏ hơn */
  height: 1.75rem !important;
  width: 1.75rem !important;
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
 * RegisterView — Trang đăng ký JobMatch.
 *
 * Layout:
 *  - Desktop (>= md): 2 cột — branding trái (45%) + form phải (55%).
 *  - Mobile: 1 cột — form full-width, branding ẩn.
 *
 * Compact mode (MỚI):
 *  - @media (max-height: 700px) áp dụng spacing nhỏ hơn cho header, role selector,
 *    form fields và main pt → tiết kiệm ~85px để login link visible ở viewport 600h.
 *  - Bình thường (viewport >= 700px) KHÔNG bị ảnh hưởng (chỉ apply khi thật sự
 *    cần). Tailwind classes gốc vẫn được dùng cho mọi viewport > 700px.
 *  - Chỉ áp dụng cho /register (không lan sang 4 trang auth khác).
 *
 * Logic giữ NGUYÊN từ bản cũ:
 *  - Gọi `useAuthStore().register({ email, password, fullName, role })`
 *  - Điều hướng `verify-otp` với query email
 *  - Error parsing: `e?.response?.data?.error?.message ?? 'Đăng ký thất bại'`
 *
 * fullName được gửi lên BE qua registerRequestOtp. Backend insert cả users lẫn
 * userProfiles trong cùng một transaction (xem auth.service.requestOtp).
 */
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { useAnimatedCount } from '@composables/useAnimatedCount';
import { extractErrorCode, extractErrorMessage } from '@services/http';
import { UserRound, Building2, Eye, EyeOff, Briefcase } from 'lucide-vue-next';

type Role = 'candidate' | 'employer';

const router = useRouter();
const auth = useAuthStore();

// Compact mode cho viewport thấp (≤700px) — apply class .compact lên root để CSS
// override spacing, giúp form fit trong viewport 600h. Default false (SSR-safe).
// Update trên resize event để re-evaluate khi user thay đổi kích thước cửa sổ.
const isCompact = ref(false);
const updateCompact = (): void => {
  isCompact.value = typeof window !== 'undefined' && window.innerHeight <= 700;
};
updateCompact();
onMounted(() => {
  window.addEventListener('resize', updateCompact);
});
onUnmounted(() => {
  window.removeEventListener('resize', updateCompact);
});

const fullName = ref('');
const email = ref('');
const password = ref('');
const role = ref<Role>('candidate');
const showPassword = ref(false);
// T19 FIX: ToS/Privacy consent — bắt buộc đồng ý trước khi đăng ký
// (tuân thủ Nghị định 13/2023 về bảo vệ dữ liệu cá nhân VN).
const agreedToTerms = ref(false);

const error = ref('');
const errorCode = ref('');
const loading = ref(false);

/**
 * Per-field shake counter — tăng để remount :key và trigger lại CSS `animate-shake`
 * cho từng field sai. Mỗi field có counter RIÊNG nên field hợp lệ không bị destroy,
 * không giật focus, không rung "oan" khi người dùng chỉ sai 1–2 ô.
 *
 * Thứ tự key khớp thứ tự hiển thị form: name → email → password → tos.
 */
const shake = ref<{ name: number; email: number; password: number; tos: number }>({
  name: 0,
  email: 0,
  password: 0,
  tos: 0,
});

/* ============================================================================
 * Stats counter animation — đếm từ 0 → target khi mount.
 * Stagger 60ms. Duration 700ms.
 * M2+V2+M1 FIX: dùng composable useAnimatedCount.
 * ==========================================================================*/
const { jobsCount, companiesCount, satisfactionCount } = useAnimatedCount();

// Template refs để focus input đầu tiên bị lỗi khi submit.
const fullNameInputRef = ref<HTMLInputElement | null>(null);
const emailInputRef = ref<HTMLInputElement | null>(null);
const passwordInputRef = ref<HTMLInputElement | null>(null);
const tosCheckboxRef = ref<HTMLInputElement | null>(null);

// Validation client-side (giữ logic cũ — HTML5 required + minlength 8)
const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value));
// T7 FIX: password complexity check — đồng bộ với BE passwordSchema.
// Yêu cầu: min 8 ký tự, có chữ hoa, chữ thường, số.
const passwordValid = computed(() => {
  const p = password.value;
  return p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p);
});
const nameValid = computed(() => fullName.value.trim().length >= 2);

const selectRole = (r: Role): void => {
  role.value = r;
  error.value = '';
};

const onSubmit = async () => {
  // Validate đồng thời cả 4 field (không early-return). Field nào sai thì:
  //  1) tăng counter shake riêng của nó → rung ĐỒNG THỜI tất cả field đang sai
  //     (giữ nguyên feedback trực quan cho mọi ô lỗi).
  //  2) chỉ hiện message LỖI ĐẦU TIÊN theo thứ tự hiển thị form
  //     (name → email → password → tos) — user sửa xong ô đó, submit lại
  //     sẽ thấy message của ô kế tiếp.
  // Field hợp lệ KHÔNG bị tăng counter → không remount, không mất focus, không rung.
  type FieldKey = 'name' | 'email' | 'password' | 'tos';
  let firstInvalid: FieldKey | null = null;

  if (!nameValid.value) {
    shake.value.name++;
    if (firstInvalid === null) firstInvalid = 'name';
  }
  if (!emailValid.value) {
    shake.value.email++;
    if (firstInvalid === null) firstInvalid = 'email';
  }
  if (!passwordValid.value) {
    shake.value.password++;
    if (firstInvalid === null) firstInvalid = 'password';
  }
  if (!agreedToTerms.value) {
    shake.value.tos++;
    if (firstInvalid === null) firstInvalid = 'tos';
  }

  if (firstInvalid !== null) {
    // Chỉ hiển thị message của lỗi đầu tiên (bám sát thứ tự hiển thị form).
    const messages: Record<FieldKey, string> = {
      name: 'Vui lòng nhập họ và tên',
      email: 'Email không hợp lệ',
      password: 'Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường và số',
      tos: 'Vui lòng đồng ý với Điều khoản sử dụng và Chính sách bảo mật',
    };
    error.value = messages[firstInvalid];
    await nextTick();
    // Focus ô lỗi đầu tiên (cùng thứ tự với message).
    if (firstInvalid === 'name') fullNameInputRef.value?.focus();
    else if (firstInvalid === 'email') emailInputRef.value?.focus();
    else if (firstInvalid === 'password') passwordInputRef.value?.focus();
    else if (firstInvalid === 'tos') tosCheckboxRef.value?.focus();
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
      // F5 FIX: gửi consent lên BE để validate + audit trail.
      agreedToTerms: true,
    });
    // fullName đã được BE lưu vào userProfiles trong cùng transaction với users
    // (xem auth.service.requestOtp). Onboarding sau này có thể đọc qua auth.me()
    // hoặc profile endpoint — không cần lưu tạm ở FE nữa.
    //
    // D5 FIX: comment cũ nói "Lưu vào sessionStorage qua store" nhưng thực tế
    // chỉ lưu trong Pinia memory (xem stores/auth.ts: pendingVerifyEmail ref).
    // F5 sẽ mất email → user phải register lại (chấp nhận đánh đổi để tránh
    // persist PII ra disk/browser storage).
    auth.setPendingVerifyEmail(email.value, 'register');
    // Pass source qua URL query → VerifyOtpView biết "← Quay lại đăng ký" là link phù hợp
    await router.push({ name: 'verify-otp', query: { from: 'register' } });
  } catch (e: any) {
    // F4 FIX: dùng helper đọc đúng HttpError envelope.
    error.value = extractErrorMessage(e, 'Đăng ký thất bại');
    errorCode.value = extractErrorCode(e);
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
  <div class="fixed inset-0 overflow-hidden bg-slate-50" :class="{ compact: isCompact }">
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
      <!-- Blob nhẹ phía phải để cân đối, tone rất nhạt -->
      <div
        class="absolute top-1/4 right-[10%] h-72 w-72 rounded-full bg-primary-100/15 blur-3xl animate-blob"
        style="animation-delay: 6s;"
      />
    </div>

    <!-- Centered content container: max-w-[1200px], header + main cùng khung
         Đồng bộ với Login — form 560px + branding 440px + gap 96px = 1096px. -->
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
           Logo pt-8 lg:pt-10 → content pt-10 lg:pt-14 (đồng bộ với 3 trang kia).
           Right column dùng auto để vừa khít form, không kéo giãn. -->
      <main
        class="relative z-10 grid flex-1 grid-cols-1 items-start gap-y-3 pt-10 lg:grid-cols-2 lg:gap-x-14 lg:gap-y-0 lg:pt-14"
      >
        <!-- ========== CỘT TRÁI — BRANDING ========== -->
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
            Tạo tài khoản<br />JobMatch
          </h2>
          <p class="mt-2 text-sm text-slate-600 leading-snug">
            Kết nối đúng người, đúng cơ hội nghề nghiệp.
          </p>

          <ul class="mt-5 space-y-3">
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Tìm kiếm cơ hội việc làm</span> phù hợp với bạn
            </li>
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Tạo và quản lý CV</span> chuyên nghiệp, an toàn
            </li>
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Kết nối</span> đúng ứng viên & nhà tuyển dụng
            </li>
          </ul>

          <!-- Trust indicators — số liệu thực tế về nền tảng (đồng bộ Login) -->
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

        <!-- ========== CỘT PHẢI — FORM ==========
             Default justify-self (start) → form 440px ở đầu trái cột 524px. -->
        <section data-testid="form-section" class="w-full max-w-[440px] justify-self-center lg:justify-self-start animate-fade-up" style="animation-delay: 160ms;">
          <!-- Heading -->
          <header>
            <h1 class="text-xl font-bold tracking-tight text-slate-900">Tạo tài khoản</h1>
            <p class="mt-1 text-sm text-slate-600 leading-snug">
              Bắt đầu hành trình của bạn cùng JobMatch
            </p>
          </header>

          <!-- Role selector — 2 button stagger fade-up sau form -->
          <fieldset class="mt-4">
            <legend class="text-sm font-medium text-slate-700">
              Bạn muốn sử dụng JobMatch với vai trò nào?
            </legend>

            <div class="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <!-- Ứng viên -->
              <button
                type="button"
                @click="selectRole('candidate'); ($event.currentTarget as HTMLButtonElement)?.blur()"
                :aria-pressed="role === 'candidate'"
                :class="[
                  'group relative flex items-center gap-3 rounded-xl border bg-white p-2.5 text-left transition-colors',
                  'focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
                  role === 'candidate'
                    ? 'border-blue-600 bg-blue-100'
                    : 'border-blue-200 hover:border-blue-400',
                ]"
              >
                <span
                  :class="[
                    'inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg transition-colors',
                    role === 'candidate'
                      ? 'bg-blue-200 text-blue-700'
                      : 'bg-slate-100 text-slate-600 group-hover:bg-blue-50 group-hover:text-blue-700',
                  ]"
                  aria-hidden="true"
                >
                  <UserRound class="h-4 w-4" />
                </span>
                <span class="min-w-0">
                  <span
                    :class="[
                      'block text-sm font-semibold leading-tight',
                      role === 'candidate' ? 'text-blue-700' : 'text-slate-900',
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
                @click="selectRole('employer'); ($event.currentTarget as HTMLButtonElement)?.blur()"
                :aria-pressed="role === 'employer'"
                :class="[
                  'group relative flex items-center gap-3 rounded-xl border bg-white p-2.5 text-left transition-colors',
                  'focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
                  role === 'employer'
                    ? 'border-blue-600 bg-blue-100'
                    : 'border-blue-200 hover:border-blue-400',
                ]"
              >
                <span
                  :class="[
                    'inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg transition-colors',
                    role === 'employer'
                      ? 'bg-blue-200 text-blue-700'
                      : 'bg-slate-100 text-slate-600 group-hover:bg-blue-50 group-hover:text-blue-700',
                  ]"
                  aria-hidden="true"
                >
                  <Building2 class="h-4 w-4" />
                </span>
                <span class="min-w-0">
                  <span
                    :class="[
                      'block text-sm font-semibold leading-tight',
                      role === 'employer' ? 'text-blue-700' : 'text-slate-900',
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
          <form @submit.prevent="onSubmit" class="mt-3 space-y-2" novalidate>
            <!-- Họ và tên -->
            <div>
              <label for="reg-name" class="block text-sm font-medium text-slate-700">
                Họ và tên <span class="text-red-500">*</span>
              </label>
              <input
                id="reg-name"
                name="fullName"
                ref="fullNameInputRef"
                v-model="fullName"
                type="text"
                required
                autocomplete="name"
                :key="`name-${shake.name}`"
                :aria-invalid="shake.name > 0 && !nameValid ? 'true' : 'false'"
                :aria-describedby="shake.name > 0 && !nameValid ? 'reg-name-err' : undefined"
                class="mt-0.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/40"
                :class="!nameValid && shake.name > 0 ? 'animate-shake !border-red-400 focus:!border-red-500 focus:!ring-red-500/40' : ''"
                placeholder="Nhập họ và tên của bạn"
              />
              <!-- A11Y-1: per-field error message với id trùng aria-describedby ở trên -->
              <p
                v-if="shake.name > 0 && !nameValid"
                id="reg-name-err"
                role="alert"
                class="mt-0.5 text-xs text-red-600"
              >
                Vui lòng nhập họ và tên (ít nhất 2 ký tự).
              </p>
            </div>

            <!-- Email -->
            <div>
              <label for="reg-email" class="block text-sm font-medium text-slate-700">
                Email <span class="text-red-500">*</span>
              </label>
              <input
                id="reg-email"
                name="email"
                ref="emailInputRef"
                v-model="email"
                type="email"
                required
                autocomplete="email"
                :key="`email-${shake.email}`"
                :aria-invalid="shake.email > 0 && !emailValid ? 'true' : 'false'"
                :aria-describedby="shake.email > 0 && !emailValid ? 'reg-email-err' : undefined"
                class="mt-0.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/40"
                :class="!emailValid && shake.email > 0 ? 'animate-shake !border-red-400 focus:!border-red-500 focus:!ring-red-500/40' : ''"
                placeholder="Nhập email của bạn"
              />
              <!-- A11Y-1: per-field error message với id trùng aria-describedby ở trên -->
              <p
                v-if="shake.email > 0 && !emailValid"
                id="reg-email-err"
                role="alert"
                class="mt-0.5 text-xs text-red-600"
              >
                Email không hợp lệ.
              </p>
            </div>

            <!-- Mật khẩu -->
            <div>
              <label for="reg-password" class="block text-sm font-medium text-slate-700">
                Mật khẩu <span class="text-red-500">*</span>
              </label>
              <div class="relative mt-0.5">
                <input
                  id="reg-password"
                  name="new-password"
                  ref="passwordInputRef"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  required
                  minlength="8"
                  autocomplete="new-password"
                  :key="`password-${shake.password}`"
                  :aria-invalid="shake.password > 0 && !passwordValid ? 'true' : 'false'"
                  :aria-describedby="shake.password > 0 && !passwordValid ? 'reg-password-err' : 'reg-password-hint'"
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
                id="reg-password-err"
                role="alert"
                class="mt-0.5 text-xs text-red-600"
              >
                Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường và số.
              </p>
              <!-- Hint (chỉ hiện khi chưa có lỗi) — aria-describedby fallback -->
              <p
                v-else
                id="reg-password-hint"
                class="mt-0.5 text-xs text-slate-500"
              >
                Mật khẩu tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số
              </p>
            </div>

            <!-- Error: gộp 2 trường hợp, wrap trong Transition để slide-down. -->
            <Transition name="error">
              <p
                v-if="error && errorCode && errorCode !== 'OAUTH_ONLY_ACCOUNT'"
                role="alert"
                class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
              >
                {{ error }}
              </p>

              <!-- OAUTH_ONLY_ACCOUNT: banner riêng + link đến /login -->
              <p
                v-else-if="errorCode === 'OAUTH_ONLY_ACCOUNT'"
                role="alert"
                class="rounded-lg bg-red-50 border border-red-200 px-3 py-3 text-sm text-red-700 text-center"
              >
                Email này đã đăng ký qua Google/Facebook/GitHub.<br />
                <RouterLink to="/login" class="link-underline font-semibold underline">
                  → Vào trang đăng nhập
                </RouterLink>
                và dùng nút mạng xã hội.
              </p>
            </Transition>

            <!-- T19 FIX: ToS / Privacy consent checkbox (bắt buộc) -->
            <label class="flex items-start gap-2 mt-1 text-xs text-slate-600 cursor-pointer">
              <input
                ref="tosCheckboxRef"
                v-model="agreedToTerms"
                type="checkbox"
                required
                :key="`tos-${shake.tos}`"
                class="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-blue-200 hover:border-blue-300 text-blue-400 checked:border-blue-400 checked:hover:border-blue-400 checked:bg-blue-500 checked:hover:bg-blue-500 focus:ring-0 focus:ring-offset-0 focus:outline-none"
                :class="[
                  !agreedToTerms && shake.tos > 0 ? '!border-red-500' : '',
                  // FIX: tách animate-shake khỏi `!agreedToTerms`. Trước đây cả 2 class
                  // đều phụ thuộc vào checkbox value → user tích rồi bỏ tích lại → class
                  // `animate-shake` được re-add → browser replay animation (SAI).
                  //
                  // Cách fix: animate-shake CHỈ phụ thuộc `shake.tos > 0` (chỉ true sau
                  // submit thất bại). Cộng với :key remount element khi shake.tos tăng,
                  // animation chỉ chạy đúng 1 lần per submit failure. Sau đó user
                  // toggle checkbox chỉ đổi border class — KHÔNG re-trigger animation.
                  //
                  // Border đỏ `!border-red-500` vẫn giữ reactive với !agreedToTerms
                  // → vẫn tự động biến mất khi user tích, xuất hiện lại khi bỏ tích.
                  shake.tos > 0 ? 'animate-shake' : '',
                ]"
                @change="($event.target as HTMLInputElement)?.blur()"
              />
              <span class="leading-snug">
                Tôi đồng ý với
                <RouterLink to="/terms" target="_blank" class="text-primary-600 underline hover:text-primary-700 focus:outline-none focus-visible:outline-none">Điều khoản sử dụng</RouterLink>
                và
                <RouterLink to="/privacy" target="_blank" class="text-primary-600 underline hover:text-primary-700 focus:outline-none focus-visible:outline-none">Chính sách bảo mật</RouterLink>
                của JobMatch VN.
              </span>
            </label>

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
              {{ loading ? 'Đang tạo tài khoản...' : 'Tạo tài khoản' }}
            </button>
          </form>

          <!-- Login link -->
          <p class="mt-2 text-center text-sm text-slate-600">
            Đã có tài khoản?
            <RouterLink
              to="/login"
              class="link-underline font-semibold text-primary-600 hover:text-primary-700 transition"
            >
              Đăng nhập
            </RouterLink>
          </p>
        </section>
      </main>
    </div>
  </div>
</template>
