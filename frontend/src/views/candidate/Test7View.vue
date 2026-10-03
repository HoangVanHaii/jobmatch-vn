<script setup lang="ts">
/**
 * Test7View — Trang test xem trước Template 7 (Ocean Teal Executive).
 * Đường dẫn: /test7
 */
import { ref } from 'vue';
import { ArrowLeft, Sparkles } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import CVTemplate7 from '@/components/cv/templates/CVTemplate7.vue';
import type { CvRenderData } from '@/types/cv';

const router = useRouter();

// Dữ liệu mẫu chuẩn khớp 100% với ảnh thiết kế John Smith (media_1790817803155.jpg)
const testData = ref<CvRenderData>({
  title: 'Hồ sơ Business Development Executive — John Smith',
  personalInfo: {
    fullName: 'JOHN SMITH',
    position: 'Business Development Executive',
    email: 'yourname@gmail.com',
    phone: '+123 456 789',
    address: '123, New York, USA',
    facebook: '',
    linkedin: '',
    portfolio: 'yourwebsite.com',
    github: '',
    avatarUrl: '',
  },
  summary:
    "Lorem ipsum is simply dummy text of the printing and typesetting industry. Lorem ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged. Lorem ipsum is simply dummy text of the printing and typesetting industry. Lorem ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer.",
  educations: [
    {
      school: 'University Name 03',
      degree: 'Diploma in Business Administration',
      startYear: '2016',
      endYear: '2018',
    },
    {
      school: 'University Name 02',
      degree: 'Bachelor in Business Administration',
      startYear: '2012',
      endYear: '2016',
    },
    {
      school: 'University Name 03',
      degree: 'Master in Business Administration',
      startYear: '2016',
      endYear: '2018',
    },
  ],
  experiences: [
    {
      position: 'Sr. Business Development Executive',
      company: 'Accenture',
      startDate: '05/2024',
      endDate: 'Present',
      description:
        "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s.\nLorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s.\nLorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled.",
    },
    {
      position: 'Business Development Executive',
      company: 'Apple',
      startDate: '01/2023',
      endDate: '05/2024',
      description:
        "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s.\nLorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s.\nLorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled.\nLorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s.",
    },
  ],
  skills: [
    { name: 'Leadership' },
    { name: 'Marketing' },
    { name: 'Sales' },
    { name: 'Negotiation' },
    { name: 'Business Intelligence' },
    { name: 'Lead generation' },
    { name: 'Adaptability' },
    { name: 'Decision-making' },
    { name: 'Strategic planning' },
  ],
  projects: [],
  certificates: [],
  activities: [],
  interests: [],
});
</script>

<template>
  <div class="min-h-screen bg-slate-100 py-8 px-4 font-sans text-slate-800">
    <div class="mx-auto max-w-[860px]">
      <!-- Top Bar -->
      <div class="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white p-4 shadow-sm">
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            @click="router.back()"
          >
            <ArrowLeft :size="14" />
            Quay lại
          </button>
          <div>
            <h1 class="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <span>Template 7 — Ocean Teal Executive</span>
              <span class="rounded bg-[#3f96a0]/15 px-2 py-0.5 text-[10px] font-semibold text-[#3f96a0]">
                Mẫu 7 mới
              </span>
            </h1>
            <p class="text-xs text-slate-500">
              Kiểm tra hiển thị A4 chuẩn và dữ liệu thực tế
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-lg bg-[#3f96a0] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#327e87]"
            @click="router.push({ name: 'candidate-resumes' })"
          >
            <Sparkles :size="13" />
            Về Danh Sách CV
          </button>
        </div>
      </div>

      <!-- Khung A4 Template Preview -->
      <div class="overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-900/10">
        <CVTemplate7 :data="testData" />
      </div>
    </div>
  </div>
</template>
