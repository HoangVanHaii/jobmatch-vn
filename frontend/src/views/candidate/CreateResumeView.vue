<script setup lang="ts">
/**
 * CreateResumeView — view mỏng bọc [CvBuilderEditor](../../components/cv/builder/CvBuilderEditor.vue)
 * cho 2 route:
 *   - `create-resume` (/candidate/resumes/new)         → create mode
 *   - `edit-resume`   (/candidate/resumes/:cvId/edit)  → edit mode (props: true)
 *
 * View chỉ lo: đọc route (params + query deep-link từ lightbox "Dùng mẫu này"
 * `?templateId=` + `?lang=`) và điều hướng sau khi lưu/hủy. Toàn bộ UI + logic
 * editor nằm trong component (split-view: preview trái + form phải) — không
 * còn tab Tạo trực tiếp/Upload (upload CV đi qua UploadFilesDialog ở list).
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CvBuilderEditor from '@components/cv/builder/CvBuilderEditor.vue';
import { clampTemplateId } from '@/utils/cvTemplates';
import type { CvLanguage } from '@/utils/cvLabels';

const route = useRoute();
const router = useRouter();

const cvIdParam = computed<string | null>(() => {
  const raw = route.params.cvId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

/** Deep-link từ lightbox: mẫu + ngôn ngữ đang chọn → editor khởi tạo đúng. */
const initialTemplateId = computed(() => clampTemplateId(route.query.templateId));
const initialLanguage = computed<CvLanguage>(() =>
  route.query.lang === 'vi' ? 'vi' : 'en',
);

/** Lưu thành công hoặc user hủy → về list CV. */
const goToList = (): void => {
  router.push('/candidate/resumes');
};
</script>

<template>
  <div class="font-poppins min-h-screen bg-white px-4 text-slate-700 sm:px-6 lg:px-10">
    <CvBuilderEditor
      :cv-id="cvIdParam"
      :initial-template-id="initialTemplateId"
      :initial-language="initialLanguage"
      @saved="goToList"
      @cancel="goToList"
    />
  </div>
</template>
