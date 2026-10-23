<script setup lang="ts">
/**
 * Company3Mockup.vue — Mockup giao diện hồ sơ doanh nghiệp (Editorial Corporate).
 * Component cha: quản lý trạng thái view/edit, mock data ban đầu và chuyển cảnh.
 */
import { onBeforeUnmount, ref } from 'vue';
import Company3ProfileView from '@/components/employer/Company3ProfileView.vue';
import Company3ProfileForm from '@/components/employer/Company3ProfileForm.vue';
import { cloneProfile, type CompanyProfile } from '@/utils/company3Utils';

const initialProfile: CompanyProfile = {
  name: 'Công ty Cổ phần Minh An',
  industry: 'Thương mại và Dịch vụ',
  size: '51–200 nhân viên',
  website: 'https://example.com',
  province: 'TP. Hồ Chí Minh',
  district: 'Quận 1',
  address: '123 Nguyễn Huệ, phường Bến Nghé, Quận 1',
  description:
    'Minh An là doanh nghiệp hoạt động trong lĩnh vực thương mại và dịch vụ, kết nối các thương hiệu tiêu dùng hàng đầu Việt Nam với hệ thống phân phối trên toàn quốc. Với hơn một thập kỷ phát triển, chúng tôi xây dựng mạng lưới đối tác đa ngành và đội ngũ nhân sự giàu kinh nghiệm, đặt sự tin cậy và chất lượng dịch vụ làm nền tảng cho mọi hoạt động.',
  logoUrl: null,
  social: {
    linkedin: 'https://www.linkedin.com/company/minh-an',
    facebook: 'https://www.facebook.com/minhan.official',
    youtube: 'https://www.youtube.com/@minhan',
  },
};

/* Dữ liệu hiển thị (đã lưu) */
const profile = ref<CompanyProfile>(cloneProfile(initialProfile));

const isEditing = ref(false);
const savedNotice = ref(false);
let savedNoticeTimer: ReturnType<typeof setTimeout> | null = null;
const rootEl = ref<HTMLElement | null>(null);

function startEdit(): void {
  savedNotice.value = false;
  isEditing.value = true;
}

function onSave(updatedProfile: CompanyProfile): void {
  const oldLogo = profile.value.logoUrl;
  const newLogo = updatedProfile.logoUrl;
  if (oldLogo && oldLogo.startsWith('blob:') && oldLogo !== newLogo) {
    URL.revokeObjectURL(oldLogo);
  }
  profile.value = updatedProfile;
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
  if (profile.value.logoUrl && profile.value.logoUrl.startsWith('blob:')) {
    URL.revokeObjectURL(profile.value.logoUrl);
  }
});
</script>

<template>
  <div ref="rootEl" class="min-h-screen bg-white font-poppins text-slate-900 antialiased">
    <Transition name="c3-mode" mode="out-in" @before-enter="onModeBeforeEnter" @after-enter="onModeAfterEnter">
      <Company3ProfileView
        v-if="!isEditing"
        :profile="profile"
        :saved-notice="savedNotice"
        @edit="startEdit"
      />
      <Company3ProfileForm
        v-else
        :profile="profile"
        @save="onSave"
        @cancel="isEditing = false"
      />
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
