<script setup lang="ts">
import { ref } from 'vue';

defineEmits<{
  (e: 'select', provider: 'google' | 'facebook' | 'github'): void;
}>();

/**
 * F1 FIX: Local loading flag — chặn click nút OAuth thứ 2 trong khi nút thứ 1
 * đang initiate (gọi BE → nhận authorization URL → redirect).
 *
 * Flow gốc có race condition: giữa lúc `loginWith` đang await `oauthApi.initiate`
 * (vài trăm ms), user click nút OAuth khác → fire thêm 1 POST initiate → có thể
 * redirect tới provider khác lúc nào không biết.
 *
 * Set `loading = true` ngay khi click bất kỳ nút nào (trước khi emit) → disable
 * cả 3 nút → chỉ 1 request initiate được phép bay cho tới khi redirect xong.
 * Reset onUnmounted nếu user navigate đi trước khi redirect fire.
 */
const loading = ref(false);

const onSelect = (provider: 'google' | 'facebook' | 'github'): void => {
  if (loading.value) return;
  loading.value = true;
  // emit không cần await — parent tự xử lý async + redirect.
  // Loading state giữ true tới khi component unmount (window.location.href navigate).
};
</script>

<style scoped>
/* OAuth button stagger — 3 nút lần lượt fade-up khi mount.
   Delay tăng dần 50ms giữa mỗi nút → cảm giác "lần lượt vào".
   Trigger từ bên ngoài (parent delay form fade-up 160ms + 350ms buffer). */
.oauth-btn-stagger {
  animation: oauth-fade-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.oauth-btn-stagger:nth-child(1) { animation-delay: 0.20s; }
.oauth-btn-stagger:nth-child(2) { animation-delay: 0.25s; }
.oauth-btn-stagger:nth-child(3) { animation-delay: 0.30s; }
@keyframes oauth-fade-up {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .oauth-btn-stagger {
    animation: none !important;
    transform: none !important;
  }
}
</style>

<template>
  <!--
    Layout 3 cột ngang, icon + label ngắn → hài hòa với nút Đăng nhập full-width ở trên.
    Mỗi nút chiếm đều 1/3 chiều ngang, canh giữa, gap đồng nhất.
  -->
  <div data-testid="oauth-buttons" class="grid grid-cols-1 sm:grid-cols-3 gap-2">
    <button type="button" data-testid="oauth-button-google" :disabled="loading"
      @click="onSelect('google'); $emit('select', 'google')"
      class="oauth-btn-stagger flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white disabled:hover:border-slate-200">
      <svg class="h-4 w-4 flex-none" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      <span>Google</span>
    </button>

    <button type="button" data-testid="oauth-button-github" :disabled="loading"
      @click="onSelect('github'); $emit('select', 'github')"
      class="oauth-btn-stagger flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-900 hover:text-white hover:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white disabled:hover:border-slate-200">
      <svg class="h-4 w-4 flex-none" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
      </svg>
      <span>GitHub</span>
    </button>

    <button type="button" data-testid="oauth-button-facebook" :disabled="loading"
      @click="onSelect('facebook'); $emit('select', 'facebook')"
      class="oauth-btn-stagger flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-blue-600 hover:text-white hover:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white disabled:hover:border-slate-200">
      <svg class="h-4 w-4 flex-none" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385h-3.047v-3.47h3.047v-2.642c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953h-1.513c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385c5.738-.9 10.125-5.864 10.125-11.854z"/>
      </svg>
      <span>Facebook</span>
    </button>
  </div>
</template>