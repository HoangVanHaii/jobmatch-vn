<script setup lang="ts">
/**
 * Test6View — Trang test nhanh cho Template 6 và Lightbox Modal xem mẫu không cuộn.
 * Đường dẫn: /test6
 */
import { ref } from 'vue';
import { Eye, ArrowLeft, Sparkles, Check } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import CVTemplate6 from '@/components/cv/templates/CVTemplate6.vue';
import CvDetailView from '@/components/cv/CvDetailView.vue';
import type { Cv, CvRenderData } from '@/types/cv';

const router = useRouter();

// Dữ liệu mẫu chuẩn khớp 100% với ảnh thiết kế Edward Smith
const testData = ref<CvRenderData>({
  title: 'Hồ sơ UI/UX Designer — Edward Smith',
  personalInfo: {
    fullName: 'EDWARD SMITH',
    position: 'UI/UX DESIGNER',
    email: 'info@email.com',
    phone: '+112 456 890099',
    address: 'Company Name\n1234, Address, 4rd/ New york Street, New York City 4560',
    facebook: '',
    linkedin: 'linkedin.com/in/edward-smith',
    portfolio: 'www.example.com',
    github: '',
    avatarUrl: '/avatars/template1-portrait.jpg',
  },
  summary:
    "I'm Edward Smith, Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. Vivamus volutpat amet dolor elitubus sit consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor. Vivamus volutpat sit id. Lorem ipsum dolor sit amet, consectetur adipiscing elit vivamus. Volutpat sit id.\n\nAutem dolor consectetur adipiscing elit vivamus. Mauris sit amet adipiscing elit vivamus. Volutpat libero lorem ipsum dolor vivamus.",
  educations: [
    {
      school: 'University Name / Location',
      degree: 'DEGREE NAME HERE',
      startYear: '2015',
      endYear: '2016',
    },
    {
      school: 'University Name / Location',
      degree: 'DEGREE NAME HERE',
      startYear: '2010',
      endYear: '2015',
    },
    {
      school: 'University Name / Location',
      degree: 'DEGREE NAME HERE',
      startYear: '2008',
      endYear: '2010',
    },
  ],
  experiences: [
    {
      position: 'JOB POSITION TITLE HERE',
      company: 'Company Name / Location',
      startDate: '2024',
      endDate: '2029',
      description:
        'Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. Vivamus volutpat amet dolor sit id. Consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor. Vivamus volutpat sit id. Lorem ipsum dolor sit amet, consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor sit.\n- Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus volutpat sit idolor\n- Amet dolor elit dolor sit amet. Consectetur adipiscing elit vivamus.\n- Lorem ipsum dolor volutpat lorem consectetur adipiscing elit vivamus.',
    },
    {
      position: 'JOB POSITION TITLE HERE',
      company: 'Company Name / Location',
      startDate: '2020',
      endDate: '2024',
      description:
        'Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. Vivamus volutpat amet dolor sit id. Consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor. Vivamus volutpat sit id. Lorem ipsum dolor sit amet, consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor sit.\n- Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus volutpat sit idolor\n- Amet dolor elit dolor sit amet. Consectetur adipiscing elit vivamus.\n- Lorem ipsum dolor volutpat lorem consectetur adipiscing elit vivamus.',
    },
    {
      position: 'JOB POSITION TITLE HERE',
      company: 'Company Name / Location',
      startDate: '2016',
      endDate: '2020',
      description:
        'Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. Vivamus volutpat amet dolor sit id. Consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor. Vivamus volutpat sit id. Lorem ipsum dolor sit amet, consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor sit.\n- Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus volutpat sit idolor\n- Amet dolor elit dolor sit amet. Consectetur adipiscing elit vivamus.\n- Lorem ipsum dolor volutpat lorem consectetur adipiscing elit vivamus.',
    },
  ],
  skills: [
    { name: 'Graphic Design' },
    { name: 'Project Management' },
    { name: 'Market Research' },
    { name: 'Branding' },
    { name: 'UI/UX Design' },
    { name: 'Web Design' },
    { name: 'Web Development' },
    { name: 'Team Development' },
    { name: 'Adobe Photoshop' },
    { name: 'Adobe Illustrator' },
    { name: 'Adobe InDesign' },
    { name: 'Microsoft Word' },
    { name: 'Microsoft Excel' },
    { name: 'Figma' },
    { name: 'HTML' },
  ],
  projects: [],
  certificates: [
    {
      name: 'JOSEPH DANIEL',
      issuer: 'Position Here / Company Name',
      date: '+112 456 8900995 | name@email.com',
    },
    {
      name: 'JOSEPH DANIEL',
      issuer: 'Position Here / Company Name',
      date: '+112 456 8900995 | name@email.com',
    },
  ],
  activities: [],
  interests: [],
});

// Mock Cv object để test CvDetailView
const mockCv = ref<Cv>({
  id: 'test-cv-template-6',
  candidateId: 'test-candidate',
  title: 'Mẫu 6 — Mustard Editorial',
  fileUrl: null,
  fileType: null,
  isPrimary: false,
  status: 'ready',
  source: 'direct',
  templateId: 6,
  parsedData: {
    name: testData.value.personalInfo.fullName,
    email: testData.value.personalInfo.email,
    phone: testData.value.personalInfo.phone,
    address: testData.value.personalInfo.address,
    portfolio: testData.value.personalInfo.portfolio,
    linkedin: testData.value.personalInfo.linkedin,
    avatarUrl: testData.value.personalInfo.avatarUrl,
    summary: testData.value.summary,
    education: testData.value.educations,
    experience: testData.value.experiences,
    skills: testData.value.skills,
    certifications: testData.value.certificates,
  },
  ai_analysis: null,
  failureReason: null,
  scoreUpdatedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// State mở modal xem mẫu
const showLightbox = ref<boolean>(false);

const onUseTemplate = (cv: Cv) => {
  showLightbox.value = false;
  router.push({
    name: 'create-resume',
    query: { templateId: String(cv.templateId ?? 6) },
  });
};
</script>

<template>
  <div class="min-h-screen bg-slate-100 text-slate-800">

    <!-- Khu vực hiển thị CV trực tiếp dạng bản in A4 -->
    <main class="py-8 px-4 flex justify-center">
      <div class="w-full max-w-[794px] rounded-lg shadow-xl overflow-hidden bg-white ring-1 ring-slate-900/5">
        <CVTemplate6 :data="testData" :disable-links="false" />
      </div>
    </main>
  </div>
</template>
