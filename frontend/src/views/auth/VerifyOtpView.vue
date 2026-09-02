<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { authApi } from '@services/auth.api';
import OtpInput from '@components/auth/OtpInput.vue';

const router = useRouter();
const auth = useAuthStore();

/**
 * Email đang verify — chỉ đọc từ auth store (in-memory). KHÔNG từ URL.
 * F5 / refresh sẽ reset store về null → redirect về /register (yêu cầu user đăng
 * ký lại, BE gửi OTP mới). Đánh đổi chấp nhận được để giữ email khỏi bị persist
 * vào disk/browser storage.
 */
const email = computed(() => auth.pendingVerifyEmail ?? '');
if (!email.value) router.replace({ name: 'register' }); // F5 hoặc direct nav → về register

const otp = ref('');
const otpInput = ref<InstanceType<typeof OtpInput> | null>(null);
const error = ref('');
const loading = ref(false);
const resending = ref(false);
const cooldown = ref(0);
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
    auth.clearPendingVerifyEmail(); // OTP thành công → xóa pending, kết thúc flow
    router.push({ name: 'login' });
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message ?? 'Xác thực thất bại';
    otpInput.value?.reset();
  } finally {
    loading.value = false;
  }
};

const onResend = async (): Promise<void> => {
  error.value = '';
  resending.value = true;
  try {
    await authApi.resendOtp(email.value);
    startCooldown();
    otpInput.value?.reset();
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message ?? 'Gửi lại mã thất bại';
  } finally {
    resending.value = false;
  }
};

onMounted(() => startCooldown()); // vừa đăng ký → OTP mới gửi, cooldown 60s cho resend
onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer);
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
    <div class="card w-full max-w-md">
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
        <RouterLink to="/register" class="text-gray-500">← Quay lại đăng ký</RouterLink>
      </p>
    </div>
  </div>
</template>
