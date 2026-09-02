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
 *   - Logo JobMatch + heading + 2 role cards (Ứng viên / Nhà tuyển dụng)
 *   - Không chọn mặc định. Phải chọn 1 role mới enable "Tiếp tục".
 *   - Mobile: cards stack dọc. Desktop: cards 2 cột.
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useOAuth } from '@composables/useOAuth';
import { useOAuthStore } from '@stores/oauth';
import { Check, Sparkles, UserRound, Building2 } from 'lucide-vue-next';

type Role = 'candidate' | 'employer';

const router = useRouter();
const oauthStore = useOAuthStore();
const { pendingToken, pendingProfile } = storeToRefs(oauthStore);
const { completeOAuthRegistration } = useOAuth();

const selectedRole = ref<Role | null>(null);
const submitting = ref(false);
const errorMsg = ref('');

const canContinue = computed(() => selectedRole.value !== null && !submitting.value);

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
    const code = e?.response?.data?.error?.code ?? '';
    if (code === 'INVALID_PENDING_TOKEN') {
      errorMsg.value = 'Phiên đăng ký đã hết hạn. Vui lòng đăng nhập lại.';
      oauthStore.clearPending();
      setTimeout(() => router.replace('/login'), 2000);
    } else if (code === 'EMAIL_TAKEN') {
      errorMsg.value = e?.response?.data?.error?.message ?? 'Email đã được đăng ký.';
      oauthStore.clearPending();
      setTimeout(() => router.replace('/login'), 2000);
    } else {
      errorMsg.value = e?.response?.data?.error?.message ?? 'Đăng ký thất bại. Vui lòng thử lại.';
    }
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <div class="relative min-h-screen overflow-hidden bg-slate-50">
    <!-- Ambient background + decorative blobs (đồng bộ Login/Register) -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div
        class="absolute inset-y-0 left-0 right-1/3 bg-gradient-to-r from-primary-100/55 via-primary-50/30 to-transparent"
      />
      <div
        class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-primary-50/40 to-transparent"
      />
    </div>
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div class="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-primary-200/30 blur-3xl" />
      <div class="absolute top-1/3 left-[18%] h-96 w-96 rounded-full bg-primary-100/35 blur-3xl" />
      <div class="absolute -bottom-32 left-[8%] h-96 w-96 rounded-full bg-primary-50/60 blur-3xl" />
      <div class="absolute top-1/4 right-[10%] h-72 w-72 rounded-full bg-primary-100/15 blur-3xl" />
    </div>

    <div
      class="relative mx-auto flex min-h-screen w-full max-w-[860px] flex-col px-6 lg:px-10 xl:px-12"
    >
      <!-- Logo — chỉ hiện trên mobile. Desktop bỏ logo để focus vào role cards. -->
      <RouterLink
        to="/"
        class="relative z-10 inline-flex items-center gap-2 pt-12 group lg:hidden"
        aria-label="JobMatch"
      >
        <span
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm"
        >
          <Sparkles class="h-5 w-5" aria-hidden="true" />
        </span>
        <span class="text-xl font-semibold tracking-tight text-slate-900">JobMatch</span>
      </RouterLink>

      <!-- Main content — card form center theo chiều dọc -->
      <main class="relative z-10 flex flex-1 items-center justify-center py-8 lg:py-12">
        <section class="w-full max-w-[640px]">
          <!-- Heading + greeting (nếu có profile preview) -->
          <header class="text-center">
            <h1 class="text-2xl xl:text-[26px] font-bold tracking-tight text-slate-900">
              Chào mừng đến với JobMatch!
            </h1>
            <p v-if="pendingProfile?.name" class="mt-1.5 text-sm text-slate-600">
              Xin chào <span class="font-semibold text-slate-900">{{ pendingProfile.name }}</span> —
              bạn muốn sử dụng JobMatch với vai trò nào?
            </p>
            <p v-else class="mt-1.5 text-sm text-slate-600">
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
                  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1',
                  selectedRole === 'candidate'
                    ? 'border-primary-600 bg-primary-50 shadow-sm'
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
                  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1',
                  selectedRole === 'employer'
                    ? 'border-primary-600 bg-primary-50 shadow-sm'
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
            class="mt-6 flex w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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