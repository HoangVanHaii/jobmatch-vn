<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { authApi } from '@services/auth.api';
import OtpInput from '@components/auth/OtpInput.vue';

const router = useRouter();

const step = ref<'request' | 'reset'>('request');
const email = ref('');
const otp = ref('');
const otpInput = ref<InstanceType<typeof OtpInput> | null>(null);
const newPassword = ref('');
const confirm = ref('');
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

// Bước 1: gửi mã về email
const sendCode = async (): Promise<void> => {
  error.value = '';
  loading.value = true;
  try {
    await authApi.forgotPassword(email.value);
    step.value = 'reset';
    startCooldown();
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message ?? 'Gửi mã thất bại';
  } finally {
    loading.value = false;
  }
};

// Gửi lại mã (cùng endpoint forgot-password)
const resend = async (): Promise<void> => {
  error.value = '';
  resending.value = true;
  try {
    await authApi.forgotPassword(email.value);
    startCooldown();
    otpInput.value?.reset();
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message ?? 'Gửi lại mã thất bại';
  } finally {
    resending.value = false;
  }
};

// Bước 2: verify OTP + đặt mật khẩu mới
const submitReset = async (): Promise<void> => {
  error.value = '';
  if (otp.value.length !== 6) {
    error.value = 'Vui lòng nhập đủ 6 chữ số';
    return;
  }
  if (newPassword.value.length < 8) {
    error.value = 'Mật khẩu phải có ít nhất 8 ký tự';
    return;
  }
  if (newPassword.value !== confirm.value) {
    error.value = 'Mật khẩu xác nhận không khớp';
    return;
  }
  loading.value = true;
  try {
    await authApi.resetPassword(email.value, otp.value, newPassword.value);
    router.push({ name: 'login' });
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message ?? 'Đặt lại mật khẩu thất bại';
    otpInput.value?.reset();
    newPassword.value = '';
    confirm.value = '';
  } finally {
    loading.value = false;
  }
};

const backToRequest = (): void => {
  step.value = 'request';
  error.value = '';
  otp.value = '';
  newPassword.value = '';
  confirm.value = '';
};

onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer);
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
    <div class="card w-full max-w-md">
      <!-- Bước 1: nhập email -->
      <template v-if="step === 'request'">
        <h1 class="text-2xl font-bold text-center mb-2">Quên mật khẩu</h1>
        <p class="text-center text-gray-500 text-sm mb-6">
          Nhập email đăng ký, chúng tôi sẽ gửi mã đặt lại mật khẩu.
        </p>
        <form @submit.prevent="sendCode" class="space-y-4">
          <input v-model="email" type="email" required class="input" placeholder="Email" />
          <p v-if="error" class="text-red-500 text-sm">{{ error }}</p>
          <button type="submit" :disabled="loading" class="btn-primary w-full">
            {{ loading ? 'Đang gửi...' : 'Gửi mã' }}
          </button>
        </form>
      </template>

      <!-- Bước 2: nhập OTP + mật khẩu mới -->
      <template v-else>
        <h1 class="text-2xl font-bold text-center mb-2">Đặt lại mật khẩu</h1>
        <p class="text-center text-gray-500 text-sm mb-6">
          Nhập mã 6 chữ số gửi tới<br />
          <span class="font-medium text-gray-700">{{ maskedEmail }}</span>
        </p>
        <form @submit.prevent="submitReset" class="space-y-4">
          <OtpInput ref="otpInput" v-model="otp" />
          <input
            v-model="newPassword"
            type="password"
            required
            minlength="8"
            class="input"
            placeholder="Mật khẩu mới (≥ 8 ký tự)"
          />
          <input
            v-model="confirm"
            type="password"
            required
            class="input"
            placeholder="Nhập lại mật khẩu mới"
          />
          <p v-if="error" class="text-red-500 text-sm text-center">{{ error }}</p>
          <button type="submit" :disabled="loading" class="btn-primary w-full">
            {{ loading ? 'Đang đặt lại...' : 'Đặt lại mật khẩu' }}
          </button>
        </form>

        <div class="text-center mt-4 text-sm">
          <span class="text-gray-500">Không nhận được mã? </span>
          <button
            v-if="cooldown <= 0"
            type="button"
            :disabled="resending"
            @click="resend"
            class="text-primary-600 font-medium disabled:opacity-50"
          >
            {{ resending ? 'Đang gửi...' : 'Gửi lại mã' }}
          </button>
          <span v-else class="text-gray-400">Gửi lại sau {{ cooldown }}s</span>
        </div>
        <p class="text-center mt-4 text-sm">
          <button type="button" class="text-gray-500" @click="backToRequest">← Đổi email</button>
        </p>
      </template>

      <p class="text-center mt-6 text-sm">
        <RouterLink to="/login" class="text-primary-600 font-medium">Về đăng nhập</RouterLink>
      </p>
    </div>
  </div>
</template>
