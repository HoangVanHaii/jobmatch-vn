<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useOAuth } from '@composables/useOAuth';
import { useAuthStore } from '@stores/auth';

type Provider = 'google' | 'facebook' | 'github';
const VALID_PROVIDERS: readonly Provider[] = ['google', 'facebook', 'github'] as const;

const route = useRoute();
const router = useRouter();
const { handleOAuthCallback } = useOAuth();
const authStore = useAuthStore();
const error = ref('');

/** Map backend error code → user-friendly tiếng Việt. Tránh user đọc raw
 *  English từ BE (vd "INVALID_CALLBACK") và bối rối. */
const mapError = (e: any): string => {
  const code = e?.response?.data?.error?.code ?? e?.code ?? '';
  switch (code) {
    case 'INVALID_STATE':
    case 'INVALID_CALLBACK':
    case 'MISSING_PKCE_VERIFIER':
      return 'Phiên đăng nhập đã hết hạn hoặc bị gián đoạn. Vui lòng thử lại.';
    case 'OAUTH_PROVIDER_ERROR':
      return 'Nhà cung cấp (Google/Facebook/GitHub) từ chối đăng nhập. Vui lòng thử lại sau.';
    case 'EMAIL_TAKEN':
      return 'Email đã được đăng ký bằng cách khác. Vui lòng đăng nhập bằng tài khoản hiện có.';
    case 'RATE_LIMITED':
      return 'Bạn thao tác quá nhanh. Vui lòng chờ một chút rồi thử lại.';
    default:
      return e?.message || 'Đăng nhập thất bại. Vui lòng thử lại.';
  }
};

/** Redirect an toàn cho error path. Nếu user đã authenticated (vd token cũ
 *  trong localStorage chưa clear), /login có meta.guest sẽ bị guard đẩy về
 *  /jobs — exact bug đã được report. Để tránh đó, force-logout trước rồi
 *  dùng window.location để bypass guard hoàn toàn. */
const safeRedirectToLogin = (): void => {
  try {
    authStore.logout();
  } catch {
    /* logout failure không quan trọng — đã đi tới đây nghĩa là auth đã hỏng */
  }
  // Dùng window.location thay vì router để bypass guard:
  // - Không bị "guest + authenticated" đẩy lại /jobs.
  // - Clear toàn bộ Vue state + reload sạch sessionStorage.
  window.location.href = '/login';
};

onMounted(async () => {
  const provider = String(route.params.provider ?? '') as Provider;

  // Validate provider ngay từ đầu — tránh user gõ /auth/callback/bat-cu-thu
  // → backend văng lỗi → trang treo vô thời hạn.
  if (!VALID_PROVIDERS.includes(provider)) {
    error.value = 'Đường dẫn đăng nhập không hợp lệ.';
    setTimeout(safeRedirectToLogin, 1500);
    return;
  }

  // Cần `code` từ provider redirect — nếu thiếu → fail nhanh.
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code) {
    error.value = 'Thiếu mã xác thực từ nhà cung cấp.';
    setTimeout(safeRedirectToLogin, 1500);
    return;
  }

  try {
    const result = await handleOAuthCallback(provider);
    // Dispatch theo status:
    //   - EXISTING_USER → đã login, redirect theo role.
    //   - NEW_USER → chưa tạo user, cần user chọn Role trước.
    if (result.status === 'EXISTING_USER') {
      // Dùng named route (string path '/employer' hay '/candidate' dễ vô
      // tình match các child relative redirect nếu sau này refactor router).
      const target =
        result.user.role === 'employer' ? 'employer-jobs' : 'candidate-jobs';
      router.replace({ name: target });
    } else {
      router.replace({ name: 'select-role' });
    }
  } catch (e: any) {
    error.value = mapError(e);
    // Auto-redirect sau 3s để user không kẹt ở trang callback.
    setTimeout(safeRedirectToLogin, 3000);
  }
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <div class="text-center">
      <div v-if="!error" class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
      <p class="mt-4 text-gray-600">{{ error || 'Đang xử lý đăng nhập...' }}</p>
      <RouterLink v-if="error" to="/login" class="btn-primary mt-4 inline-block">Về trang đăng nhập</RouterLink>
    </div>
  </div>
</template>