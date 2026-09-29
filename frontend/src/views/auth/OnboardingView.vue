<style scoped>
/* Page enter: fade-up + slide-up nhẹ. Stagger qua animation-delay (0/80/160ms). */
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

/* Blob float — ambient motion rất nhẹ cho 4 blob trang trí. */
@keyframes blob {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%      { transform: translate(15px, -20px) scale(1.05); }
  66%      { transform: translate(-10px, 15px) scale(0.95); }
}
.animate-blob {
  animation: blob 14s ease-in-out infinite;
}

/* Respect prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
  .animate-fade-up,
  .animate-pulse-logo,
  .animate-grow-bar,
  .animate-blob,
  .benefit-line::before {
    animation: none !important;
    transform: none !important;
  }
}
</style>

<script setup lang="ts">
/**
 * OnboardingView — Trang Select Role cho OAuth user mới.
 *
 * Flow:
 *   Login → bấm Google/GitHub/Facebook → OAuth callback trả status=NEW_USER
 *     → redirect tới /select-role → user chọn Role → gọi completeOAuthRegistration
 *     → backend tạo user với role đã chọn + trả tokens → redirect về home.
 *
 * Guard nội bộ:
 *   - Nếu không có pendingToken (user gõ /select-role trực tiếp, không qua OAuth)
 *     → redirect về /login.
 *   - Nếu complete fail (token hết hạn, email đã claim) → clear pending + redirect /login.
 *
 * UI:
 *   - Desktop (>= lg): 2 cột — branding trái (heading + benefits + stats) + form phải (role cards).
 *   - Mobile: 1 cột — branding ẩn, chỉ logo + role cards stack.
 *   - Logo hiện trên cả mobile + desktop (đồng bộ 4 trang auth).
 *   - Mobile: cards stack dọc. Desktop: cards 2 cột.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useOAuth } from '@composables/useOAuth';
import { useAnimatedCount } from '@composables/useAnimatedCount';
import { useOAuthStore } from '@stores/oauth';
import { useAuthStore } from '@stores/auth';
import { extractErrorCode, extractErrorMessage } from '@services/http';
import { Check, Briefcase, UserRound, Building2 } from 'lucide-vue-next';

type Role = 'candidate' | 'employer';

const router = useRouter();
const oauthStore = useOAuthStore();
const authStore = useAuthStore();
const { pendingToken, pendingProfile } = storeToRefs(oauthStore);
const { completeOAuthRegistration } = useOAuth();

const selectedRole = ref<Role | null>(null);
const submitting = ref(false);
const errorMsg = ref('');

const canContinue = computed(() => selectedRole.value !== null && !submitting.value);

/* ============================================================================
 * Stats counter animation — đếm từ 0 → target khi mount (đồng bộ 4 trang auth).
 * Stagger 60ms giữa 3 số. Duration 700ms.
 * M2+V2+M1 FIX: dùng composable useAnimatedCount để:
 *   - Dọn duplicate code (trước đây copy-paste ở 3 file).
 *   - Cleanup requestAnimationFrame khi unmount.
 * ==========================================================================*/
const { jobsCount, companiesCount, satisfactionCount } = useAnimatedCount();

onMounted(() => {
  if (!pendingToken.value) {
    // Không có pending OAuth state → user gõ URL trực tiếp. Redirect về Login.
    router.replace('/login');
  }
});

const selectRole = (r: Role): void => {
  selectedRole.value = r;
  errorMsg.value = '';
};

const onContinue = async (): Promise<void> => {
  if (!selectedRole.value) return;
  submitting.value = true;
  errorMsg.value = '';
  try {
    await completeOAuthRegistration(selectedRole.value);
    // Redirect theo role — candidate hoặc employer workspace.
    const target = selectedRole.value === 'candidate' ? '/candidate' : '/employer';
    router.replace(target);
  } catch (e: any) {
    // F4 FIX: dùng helper đọc đúng HttpError.
    const code = extractErrorCode(e);
    if (code === 'INVALID_PENDING_TOKEN') {
      errorMsg.value = 'Phiên đăng ký đã hết hạn. Vui lòng đăng nhập lại.';
      oauthStore.clearPending();
      scheduleRedirectToLogin();
    } else if (code === 'EMAIL_TAKEN') {
      errorMsg.value = extractErrorMessage(e, 'Email đã được đăng ký.');
      oauthStore.clearPending();
      scheduleRedirectToLogin();
    } else if (code === 'EMAIL_NOT_VERIFIED') {
      // Audit 2026-09-28 follow-up (A5 FIX): OAuth provider không verify email
      // (Facebook/GitHub unverified primary) → user pending → BE không cấp
      // token, trigger OTP, throw 403 EMAIL_NOT_VERIFIED. FE redirect user sang
      // /verify-otp?from=register để xác thực email → sau đó login bình thường.
      // Lưu pending email vào Pinia + clear OAuth pending state.
      const profile = oauthStore.pendingProfile;
      const verifyEmail = profile?.email;
      if (verifyEmail) {
        authStore.setPendingVerifyEmail(verifyEmail, 'register');
      }
      oauthStore.clearPending();
      errorMsg.value = '';
      try {
        await router.replace({
          name: 'verify-otp',
          query: { from: 'register', oauth: 'pending' },
        });
      } catch (navErr) {
        console.error('[Onboarding] Navigation to /verify-otp failed:', navErr);
        errorMsg.value = extractErrorMessage(e, 'Vui lòng xác thực email.');
        scheduleRedirectToLogin();
      }
    } else {
      // Fallback: error code không match 2 case phổ biến (vd INTERNAL_ERROR 500,
      // network timeout, ECONNREFUSED). Vẫn clear pending + redirect /login
      // sau 2s để user không kẹt — phải click thủ công như trước.
      errorMsg.value = extractErrorMessage(e, 'Đăng ký thất bại. Vui lòng thử lại.');
      oauthStore.clearPending();
      scheduleRedirectToLogin();
    }
  } finally {
    submitting.value = false;
  }
};

/**
 * ML-1 FIX: Cleanup setTimeout để tránh memory leak + Vue warning
 * "Set operation on key ... failed: target is readonly" khi user navigate đi
 * trong khi timer vẫn pending.
 *
 * 3 nhánh catch (INVALID_PENDING_TOKEN / EMAIL_TAKEN / fallback) loại trừ lẫn
 * nhau (if/else if/else) — chỉ 1 timer chạy tại 1 thời điểm. Dùng chung 1 biến id.
 *
 * clearTimeout trước khi set mới để handle edge case user click nút "Tiếp tục"
 * nhiều lần liên tiếp (sau khi submitting=false, button enable lại) → chỉ giữ
 * timer cuối cùng.
 */
let redirectTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleRedirectToLogin = (): void => {
  if (redirectTimer) clearTimeout(redirectTimer);
  redirectTimer = setTimeout(() => router.replace('/login'), 2000);
};

onUnmounted(() => {
  if (redirectTimer) {
    clearTimeout(redirectTimer);
    redirectTimer = null;
  }
});
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-slate-50">
    <!-- Ambient background + decorative blobs (đồng bộ 4 trang auth) -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div
        class="absolute inset-y-0 left-0 right-1/3 bg-gradient-to-r from-primary-100/55 via-primary-50/30 to-transparent"
      />
      <div
        class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-primary-50/40 to-transparent"
      />
    </div>
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div class="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-primary-200/30 blur-3xl animate-blob" />
      <div class="absolute top-1/3 left-[18%] h-96 w-96 rounded-full bg-primary-100/35 blur-3xl animate-blob" style="animation-delay: 2s;" />
      <div class="absolute -bottom-32 left-[8%] h-96 w-96 rounded-full bg-primary-50/60 blur-3xl animate-blob" style="animation-delay: 4s;" />
      <div class="absolute top-1/4 right-[10%] h-72 w-72 rounded-full bg-primary-100/15 blur-3xl animate-blob" style="animation-delay: 6s;" />
    </div>

    <div
      class="relative mx-auto flex min-h-screen w-full max-w-[1200px] flex-col px-6 lg:px-10 xl:px-12"
    >
      <!-- Logo JobMatch — dùng div thuần, không bọc RouterLink (user không muốn click logo nhảy trang).
           Layout ngang hàng với branding trái và form phải. -->
      <div
        class="relative z-10 inline-flex items-center gap-2 pt-8 lg:pt-10 animate-fade-up"
        style="animation-delay: 0ms;"
        aria-label="JobMatch"
      >
        <span
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm animate-pulse-logo"
        >
          <Briefcase class="h-5 w-5" aria-hidden="true" />
        </span>
        <span class="text-xl font-semibold tracking-tight text-slate-900">JobMatch</span>
      </div>

      <!-- Main grid 2-cột: branding trái (≥lg) + form phải (mọi size) -->
      <main
        class="relative z-10 grid flex-1 grid-cols-1 items-start gap-y-3 pt-10 lg:grid-cols-2 lg:gap-x-14 lg:gap-y-0 lg:pt-14"
      >
        <!-- ========== CỘT TRÁI — BRANDING (≥lg) ========== -->
        <section
          class="hidden lg:block w-full max-w-[440px] animate-fade-up"
          style="animation-delay: 80ms;"
        >
          <div class="inline-flex items-center gap-2">
            <span class="h-px w-4 bg-slate-900 animate-grow-bar" aria-hidden="true"></span>
            <p class="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
              Bắt đầu hành trình
            </p>
          </div>

          <h2
            class="mt-3 text-2xl xl:text-[26px] font-bold tracking-tight text-slate-900 leading-tight"
          >
            Hãy chọn<br />vai trò của bạn
          </h2>
          <p class="mt-2 text-sm text-slate-600 leading-snug">
            JobMatch giúp bạn tìm đúng hướng — dù bạn đang tìm việc hay tìm người.
          </p>

          <ul class="mt-5 space-y-3">
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Ứng viên</span> tìm cơ hội việc làm phù hợp kỹ năng
            </li>
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Nhà tuyển dụng</span> đăng tin, lọc hồ sơ AI, hire hiệu quả
            </li>
            <li class="benefit-line pl-3 text-sm text-slate-700 leading-relaxed">
              <span class="font-semibold text-slate-900">Kết nối</span> đúng người, đúng thời điểm
            </li>
          </ul>

          <dl class="mt-7 grid grid-cols-3 gap-4 border-t border-slate-200/70 pt-5">
            <div>
              <dt class="text-2xl font-bold text-slate-900 tabular-nums leading-none">{{ jobsCount }}K+</dt>
              <dd class="mt-1.5 text-xs text-slate-600 leading-tight">Việc làm<br />đang tuyển</dd>
            </div>
            <div>
              <dt class="text-2xl font-bold text-slate-900 tabular-nums leading-none">{{ companiesCount }}+</dt>
              <dd class="mt-1.5 text-xs text-slate-600 leading-tight">Doanh nghiệp<br />đối tác</dd>
            </div>
            <div>
              <dt class="text-2xl font-bold text-slate-900 tabular-nums leading-none">{{ satisfactionCount }}%</dt>
              <dd class="mt-1.5 text-xs text-slate-600 leading-tight">Ứng viên<br />hài lòng</dd>
            </div>
          </dl>
        </section>

        <!-- ========== CỘT PHẢI — ROLE SELECTION ========== -->
        <section
          class="w-full max-w-[440px] justify-self-center lg:justify-self-start animate-fade-up"
          style="animation-delay: 160ms;"
        >
          <header>
            <h1 class="text-2xl xl:text-[26px] font-bold tracking-tight text-slate-900">
              Chào mừng đến với JobMatch!
            </h1>
            <p v-if="pendingProfile?.name" class="mt-1.5 text-sm text-slate-600 leading-snug">
              Xin chào <span class="font-semibold text-slate-900">{{ pendingProfile.name }}</span> —
              bạn muốn sử dụng JobMatch với vai trò nào?
            </p>
            <p v-else class="mt-1.5 text-sm text-slate-600 leading-snug">
              Bạn muốn sử dụng JobMatch với vai trò nào?
            </p>
          </header>

          <!-- Role cards -->
          <fieldset class="mt-6">
            <legend class="sr-only">Chọn vai trò</legend>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <!-- Ứng viên -->
              <button
                type="button"
                @click="selectRole('candidate')"
                :aria-pressed="selectedRole === 'candidate'"
                :class="[
                  'group relative flex flex-col items-center rounded-2xl border bg-white p-6 text-center transition-all',
                  selectedRole === 'candidate'
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-slate-200 hover:border-primary-300 hover:shadow-sm',
                ]"
              >
                <span
                  v-if="selectedRole === 'candidate'"
                  class="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-white shadow-sm"
                  aria-hidden="true"
                >
                  <Check class="h-3.5 w-3.5" />
                </span>
                <span
                  :class="[
                    'inline-flex h-14 w-14 items-center justify-center rounded-2xl transition',
                    selectedRole === 'candidate'
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-100 text-slate-600 group-hover:bg-primary-100 group-hover:text-primary-700',
                  ]"
                  aria-hidden="true"
                >
                  <UserRound class="h-7 w-7" />
                </span>
                <span class="mt-3 block text-base font-semibold text-slate-900">Ứng viên</span>
                <span class="mt-1 block text-sm text-slate-500 leading-snug">
                  Tìm kiếm cơ hội việc làm phù hợp
                </span>
              </button>

              <!-- Nhà tuyển dụng -->
              <button
                type="button"
                @click="selectRole('employer')"
                :aria-pressed="selectedRole === 'employer'"
                :class="[
                  'group relative flex flex-col items-center rounded-2xl border bg-white p-6 text-center transition-all',
                  selectedRole === 'employer'
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-slate-200 hover:border-primary-300 hover:shadow-sm',
                ]"
              >
                <span
                  v-if="selectedRole === 'employer'"
                  class="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-white shadow-sm"
                  aria-hidden="true"
                >
                  <Check class="h-3.5 w-3.5" />
                </span>
                <span
                  :class="[
                    'inline-flex h-14 w-14 items-center justify-center rounded-2xl transition',
                    selectedRole === 'employer'
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-100 text-slate-600 group-hover:bg-primary-100 group-hover:text-primary-700',
                  ]"
                  aria-hidden="true"
                >
                  <Building2 class="h-7 w-7" />
                </span>
                <span class="mt-3 block text-base font-semibold text-slate-900">Nhà tuyển dụng</span>
                <span class="mt-1 block text-sm text-slate-500 leading-snug">
                  Tìm kiếm ứng viên phù hợp cho doanh nghiệp
                </span>
              </button>
            </div>
          </fieldset>

          <!-- Error -->
          <p
            v-if="errorMsg"
            role="alert"
            class="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 text-center"
          >
            {{ errorMsg }}
          </p>

          <!-- Submit -->
          <button
            type="button"
            @click="onContinue"
            :disabled="!canContinue"
            class="mt-6 flex w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-700 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              v-if="submitting"
              class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-hidden="true"
            />
            {{ submitting ? 'Đang hoàn tất...' : 'Tiếp tục' }}
          </button>
        </section>
      </main>
    </div>
  </div>
</template>
