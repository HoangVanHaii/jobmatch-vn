<script setup lang="ts">
/**
 * CompanyProfilePage.vue — Giao diện hồ sơ doanh nghiệp (Editorial Corporate).
 * Component cha quản lý trạng thái view/edit và chuyển cảnh.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import CompanyProfileView from '@/components/employer/CompanyProfileView.vue';
import CompanyProfileForm from '@/components/employer/CompanyProfileForm.vue';
import { useCompanyStore } from '@stores/company';
import type { CompanyProfile } from '@/utils/companyProfileUtils';

const companyStore = useCompanyStore();
const {
  company: profile,
  companyLoading,
  companySaving,
  companyLoadError,
  companySaveError,
  companyFieldErrors,
} = storeToRefs(companyStore);
const hasProfile = computed(() => profile.value !== null);

const isEditing = ref(false);
const savedNotice = ref(false);
let savedNoticeTimer: ReturnType<typeof setTimeout> | null = null;
const rootEl = ref<HTMLElement | null>(null);

function startEdit(): void {
  savedNotice.value = false;
  isEditing.value = true;
}

async function onSave(updatedProfile: CompanyProfile, logoFile: File | null): Promise<void> {
  const saved = await companyStore.updateCompany(updatedProfile, logoFile);
  if (!saved) return;
  isEditing.value = false;
  savedNotice.value = true;
  if (savedNoticeTimer) clearTimeout(savedNoticeTimer);
  savedNoticeTimer = setTimeout(() => {
    savedNotice.value = false;
  }, 3000);
}

/** Transition view↔edit: reset cuộn trước khi vào mode mới, focus tiêu đề sau. */
function onModeBeforeEnter(): void {
  window.scrollTo(0, 0);
}

function onModeAfterEnter(): void {
  rootEl.value
    ?.querySelector<HTMLElement>('.c3-page-title')
    ?.focus({ preventScroll: true });
}

onBeforeUnmount(() => {
  if (savedNoticeTimer) clearTimeout(savedNoticeTimer);
});

onMounted(() => {
  void companyStore.fetchCompany();
});
</script>

<template>
  <div ref="rootEl" class="min-h-screen bg-white font-poppins text-slate-900 antialiased">
    <Transition name="c3-mode" mode="out-in" @before-enter="onModeBeforeEnter" @after-enter="onModeAfterEnter">
      <div v-if="companyLoading" class="mx-auto max-w-[1240px] px-6 py-10 text-sm text-slate-500">
        Đang tải hồ sơ doanh nghiệp…
      </div>
      <div v-else-if="companyLoadError" class="mx-auto max-w-[1240px] px-6 py-10">
        <p class="text-sm text-red-600" role="alert">{{ companyLoadError }}</p>
        <button
          type="button"
          class="mt-3 inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 motion-reduce:transition-none"
          @click="companyStore.fetchCompany()"
        >
          Thử lại
        </button>
      </div>
      <CompanyProfileView
        v-else-if="hasProfile && !isEditing"
        :profile="profile!"
        :saved-notice="savedNotice"
        @edit="startEdit"
      />
      <CompanyProfileForm
        v-else-if="hasProfile"
        :profile="profile!"
        :saving="companySaving"
        :server-errors="companyFieldErrors"
        :save-error="companySaveError"
        @save="onSave"
        @cancel="isEditing = false"
      />
      <div v-else class="mx-auto max-w-[1240px] px-6 py-10 text-sm text-slate-500">
        Bạn chưa có hồ sơ doanh nghiệp.
      </div>
    </Transition>
  </div>
</template>

<style>
/* CSS không dùng scoped để áp dụng xuyên suốt component con mà không nhân bản:
   transition classes cho notice, keyframes stagger c3-fade và transition view/edit. */
.notice-enter-active,
.notice-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.notice-enter-from,
.notice-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Stagger fade-up khi trang xuất hiện — CSS thuần nên không phụ thuộc JS,
   nội dung không bao giờ bị kẹt ở trạng thái ẩn. */
.c3-fade {
  animation: c3-fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.c3-d1 {
  animation-delay: 60ms;
}
.c3-d2 {
  animation-delay: 120ms;
}
.c3-d3 {
  animation-delay: 180ms;
}
@keyframes c3-fade-up {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    /* `none` (không phải translateY(0)) để fill-mode `both` không giữ lại một
       transform vĩnh viễn — transform tồn dư trên header/aside/form tạo
       containing block và làm lệch hành vi sticky bên trong chúng. */
    transform: none;
  }
}

/* Chuyển đổi view <-> edit: fade + translateY nhẹ, out-in để không nhảy layout */
.c3-mode-enter-active,
.c3-mode-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.c3-mode-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.c3-mode-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .c3-fade {
    animation: none;
  }
  .c3-mode-enter-active,
  .c3-mode-leave-active,
  .notice-enter-active,
  .notice-leave-active {
    transition: none;
  }
}
</style>
