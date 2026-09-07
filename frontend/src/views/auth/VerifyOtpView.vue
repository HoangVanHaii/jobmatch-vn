<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { authApi } from '@services/auth.api';
import { extractErrorCode, extractErrorMessage } from '@services/http';
import OtpInput from '@components/auth/OtpInput.vue';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

/**
 * Email đang verify — ưu tiên Pinia (auth.pendingVerifyEmail) > query fallback.
 *
 * W3 + Bug 2 FIX:
 * - Trước đây chỉ đọc từ Pinia → user từ LoginView có Pinia rỗng → vòng lặp.
 * - Sau đó ưu tiên query → nhưng lộ email ra URL (history, Referer, logs).
 * - Giờ: LoginView lưu email vào Pinia TRƯỚC khi navigate (không lộ URL).
 *   VerifyOtpView đọc từ Pinia trước, fallback query cho legacy support.
 */
const email = computed(() => {
  if (auth.pendingVerifyEmail) return auth.pendingVerifyEmail;
  const queryEmail = route.query.email;
  if (typeof queryEmail === 'string' && queryEmail.trim()) {
    return queryEmail.trim();
  }
  return '';
});

/**
 * Source đến từ flow nào — đọc từ URL query (?from=login|register) để F5-safe
 * (Pinia state mất khi reload). Fallback Pinia nếu URL không có.
 *
 * Dùng cho:
 * - Auto-resend OTP khi đến từ LoginView (OTP cũ đã expired)
 * - Hiển thị link "← Quay lại" phù hợp (đăng nhập vs đăng ký)
 */
const verifySource = computed<'register' | 'login' | null>(() => {
  const queryFrom = route.query.from;
  if (queryFrom === 'login' || queryFrom === 'register') return queryFrom;
  return auth.pendingVerifySource ?? null;
});

// D6 FIX: KHÔNG gọi router.replace synchronously trong script setup (Vue3 anti-pattern).
// Có thể chạy trước khi router init xong, hoặc 2 lần trong HMR mode → bug khó debug.
// Move vào onMounted lifecycle hook bên dưới.
onMounted(async () => {
  if (!email.value) {
    // Email rỗng → không thể verify. Redirect theo source để user biết đường back.
    // - 'login': quay về /login (user có thể thử lại)
    // - 'register' / null: quay về /register (user phải đăng ký lại)
    if (verifySource.value === 'login') {
      router.replace({ name: 'login' });
    } else {
      router.replace({ name: 'register' });
    }
    return;
  }

  // W3 EXTENSION FIX: Dùng verifySource (URL query ưu tiên, fallback Pinia) làm signal.
  // - 'login': user bấm "Xác thực ngay" từ LoginView → OTP cũ đã expired → auto-resend.
  // - 'register' / null: user từ RegisterView → OTP đã được gửi → chỉ start cooldown.
  const cameFromLogin = verifySource.value === 'login';
  if (cameFromLogin) {
    try {
      await authApi.resendOtp(email.value);
      startCooldown();
    } catch (err) {
      // Resend fail → phân tích error code để xử lý thông minh.
      const code = extractErrorCode(err);
      if (code === 'ALREADY_VERIFIED') {
        // User đã verify từ trước (test lại flow hoặc verify ở tab khác) →
        // redirect về /login thay vì show error. User có thể login bình thường.
        error.value = 'Email này đã được xác thực trước đó. Đang chuyển đến trang đăng nhập...';
        setTimeout(() => {
          auth.clearPendingVerifyEmail();
          router.push({ name: 'login' });
        }, 1500);
        return;
      }
      // Resend fail vì lý do khác (rate limit, etc.) → vẫn start cooldown
      // để user có thể bấm "Gửi lại" thủ công sau.
      error.value = extractErrorMessage(err, 'Không thể gửi lại mã OTP. Vui lòng bấm "Gửi lại mã".');
      startCooldown();
    }
  } else {
    // Đến từ RegisterView → OTP đã được gửi ở đó, chỉ start cooldown cho nút resend
    startCooldown();
  }
});

const otp = ref('');
const otpInput = ref<InstanceType<typeof OtpInput> | null>(null);
const error = ref('');
const loading = ref(false);
const resending = ref(false);
const cooldown = ref(0);
/**
 * Khi verify thành công → hiển thị success state (ẩn OTP form + resend button).
 * Tránh user bấm "Gửi lại mã" sau khi đã verify → BE trả ALREADY_VERIFIED
 * → user confused vì "tưởng OTP chưa gửi".
 */
const verified = ref(false);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

const maskedEmail = computed(() => {
  const e = email.value;
  const at = e.indexOf('@');
  if (at < 1) return e;
  const head = e.slice(0, at).slice(0, 2);
  const domain = e.slice(at);
  return `${head}${'•'.repeat(4)}${domain}`;
});

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

const onSubmit = async (): Promise<void> => {
  error.value = '';
  if (otp.value.length !== 6) {
    error.value = 'Vui lòng nhập đủ 6 chữ số';
    return;
  }
  loading.value = true;
  try {
    await auth.verifyOtp(email.value, otp.value);
    auth.clearPendingVerifyEmail();
    // Verify thành công → redirect thẳng về /login (không hiển thị màn hình success).
    router.push({ name: 'login' });
  } catch (e: any) {
    // F4 FIX: dùng helper đọc đúng HttpError.
    error.value = extractErrorMessage(e, 'Xác thực thất bại');
    otpInput.value?.reset();
  } finally {
    loading.value = false;
  }
};

const onResend = async (): Promise<void> => {
  // Tránh gửi lại OTP nếu user đã verify thành công (BE sẽ trả ALREADY_VERIFIED).
  if (verified.value) return;
  error.value = '';
  resending.value = true;
  try {
    await authApi.resendOtp(email.value);
    startCooldown();
    otpInput.value?.reset();
  } catch (e: any) {
    // F4 FIX: dùng helper đọc đúng HttpError.
    error.value = extractErrorMessage(e, 'Gửi lại mã thất bại');
  } finally {
    resending.value = false;
  }
};

// onMounted đã được move lên đầu file (W3 extension) — startCooldown được gọi
// theo context (RegisterView → startCooldown; LoginView → resend OTP + startCooldown).
onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer);
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
    <div class="card w-full max-w-md">
      <!-- Success state: ẩn OTP form + resend button khi đã verify thành công.
           Tránh user click "Gửi lại mã" sau verify → BE trả ALREADY_VERIFIED confusing. -->
      <template v-if="verified">
        <div class="text-center py-6">
          <div class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-emerald-100 mb-3">
            <svg class="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 class="text-xl font-bold text-gray-900 mb-1">Email đã được xác thực</h1>
          <p class="text-sm text-gray-500">Đang chuyển đến trang đăng nhập...</p>
        </div>
      </template>

      <template v-else>
      <h1 class="text-2xl font-bold text-center mb-2">Xác thực email</h1>
      <p class="text-center text-gray-500 text-sm mb-6">
        Nhập mã 6 chữ số đã gửi tới<br />
        <span class="font-medium text-gray-700">{{ maskedEmail }}</span>
      </p>

      <form @submit.prevent="onSubmit" class="space-y-6">
        <OtpInput ref="otpInput" v-model="otp" />

        <p v-if="error" class="text-red-500 text-sm text-center">{{ error }}</p>

        <button type="submit" :disabled="loading || otp.length !== 6" class="btn-primary w-full">
          {{ loading ? 'Đang xác thực...' : 'Xác thực' }}
        </button>
      </form>

      <div class="text-center mt-6 text-sm">
        <span class="text-gray-500">Không nhận được mã? </span>
        <button
          v-if="cooldown <= 0"
          type="button"
          :disabled="resending"
          @click="onResend"
          class="text-primary-600 font-medium disabled:opacity-50"
        >
          {{ resending ? 'Đang gửi...' : 'Gửi lại mã' }}
        </button>
        <span v-else class="text-gray-400">Gửi lại sau {{ cooldown }}s</span>
      </div>

      <p class="text-center mt-4 text-sm">
        <!-- D7 FIX: clear pending email TRƯỚC khi navigate để tránh trigger D1
             (khi user back → register lại cùng email → BE throw EMAIL_TAKEN).
             Chỉ hiện link relevant: đến từ Login → "đăng nhập", đến từ Register → "đăng ký".
             Dùng verifySource (URL query ưu tiên, Pinia fallback) để F5-safe. -->
        <RouterLink
          v-if="verifySource === 'login'"
          to="/login"
          class="text-gray-500 hover:text-primary-600"
          @click="auth.clearPendingVerifyEmail()"
        >← Quay lại đăng nhập</RouterLink>
        <RouterLink
          v-else
          to="/register"
          class="text-gray-500 hover:text-primary-600"
          @click="auth.clearPendingVerifyEmail()"
        >← Quay lại đăng ký</RouterLink>
      </p>
      </template>
    </div>
  </div>
</template>
