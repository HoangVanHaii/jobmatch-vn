<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Plus,
  Trash2,
  Eye,
  Loader2,
  Check,
  Upload,
  FileUp,
  X,
  FileText,
  AlertCircle,
} from 'lucide-vue-next';
import { skillsApi } from '@services/skills.api';
import { cvApi } from '@services/cv.api';
import { uploadApi } from '@services/upload.api';
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue';
import type { Skill } from '@/types/skills';
import type { CvRenderData, CreateDirectCvInput, CvSource } from '@/types/cv';

/* ============================================================================
 * Form interfaces (direct mode)
 * ==========================================================================*/

interface Education {
  school: string;
  major: string;
  startYear: string;
  endYear: string;
  description: string;
}

interface Experience {
  company: string;
  position: string;
  startDate: string;
  endDate: string;
  description: string;
}

interface SkillRow {
  name: string;
  level: number;
}

interface Project {
  name: string;
  role: string;
  time: string;
  description: string;
  link: string;
}

interface Certificate {
  name: string;
  issuer: string;
  date: string;
}

const router = useRouter();
const route = useRoute();

/* ============================================================================
 * Mode — 'direct' | 'upload'
 * Mặc định lấy từ query param `?mode=upload` (deep-link từ MyResumesView).
 * ==========================================================================*/
type CreateMode = CvSource;
const initialMode: CreateMode = route.query.mode === 'upload' ? 'upload' : 'direct';
const mode = ref<CreateMode>(initialMode);

/* ============================================================================
 * Direct-mode state
 * ==========================================================================*/

const personal = ref({
  fullName: '',
  position: '',
  email: '',
  phone: '',
  facebook: '',
  linkedin: '',
  portfolio: '',
  github: '',
  avatarUrl: '',
});
const templateId = ref<number>(1);

const summary = ref('');

const educations = ref<Education[]>([
  { school: '', major: '', startYear: '', endYear: '', description: '' },
]);
const experiences = ref<Experience[]>([
  { company: '', position: '', startDate: '', endDate: '', description: '' },
]);
const skills = ref<SkillRow[]>([]);
/** Tên kỹ năng user đang gõ trong ô quick-add. */
const skillDraft = ref('');
const projects = ref<Project[]>([
  { name: '', role: '', time: '', description: '', link: '' },
]);
const certificates = ref<Certificate[]>([{ name: '', issuer: '', date: '' }]);

/* ============================================================================
 * Upload-mode state
 * Backend: POST /uploads/file (multipart, field `file`, ≤10MB, PDF/DOCX/image)
 * ==========================================================================*/

const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/jpeg',
  'image/png',
];

const uploadFile = ref<File | null>(null);
const uploadPreviewUrl = ref<string | null>(null);
const uploadUploading = ref(false);
const uploadError = ref<string | null>(null);
const uploaded = ref<{ url: string; key: string; mime: string; size: number } | null>(null);
const isDragging = ref(false);
const uploadInput = ref<HTMLInputElement | null>(null);
const openFilePicker = (): void => {
  uploadInput.value?.click();
};

const handleSelectFile = (file: File) => {
  uploadError.value = null;
  if (!ACCEPTED_MIME.includes(file.type)) {
    uploadError.value = 'Định dạng không hỗ trợ. Chỉ chấp nhận PDF, DOCX, JPG, PNG.';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    uploadError.value = 'File vượt quá 10MB.';
    return;
  }
  uploadFile.value = file;
  // Tạo preview URL cho ảnh; PDF thì để trống (modal dùng iframe blob).
  if (uploadPreviewUrl.value) URL.revokeObjectURL(uploadPreviewUrl.value);
  uploadPreviewUrl.value = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
  uploaded.value = null; // reset nếu đổi file
};

const handleFileInput = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) handleSelectFile(file);
};

const handleDrop = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) handleSelectFile(file);
};

const removeUploadFile = () => {
  if (uploadPreviewUrl.value) URL.revokeObjectURL(uploadPreviewUrl.value);
  uploadFile.value = null;
  uploadPreviewUrl.value = null;
  uploaded.value = null;
  uploadError.value = null;
};

/* ============================================================================
 * Avatar upload — chọn file (image/, ≤5MB, folder='avatars').
 * BE đã nhận `contact.avatarUrl`, lưu vào parsedData.avatarUrl.
 * ==========================================================================*/
const avatarInput = ref<HTMLInputElement | null>(null);
const avatarUploading = ref(false);
const avatarError = ref<string | null>(null);

const pickAvatar = (): void => avatarInput.value?.click();

const handleAvatarChange = async (e: Event): Promise<void> => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    avatarError.value = 'Vui lòng chọn file ảnh (JPG, PNG).';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    avatarError.value = 'Ảnh tối đa 5MB.';
    return;
  }
  avatarError.value = null;
  avatarUploading.value = true;
  try {
    const { data } = await uploadApi.uploadFile(file, 'avatars');
    personal.value.avatarUrl = data.data.url;
  } catch (err) {
    console.error('[CreateResume] avatar upload failed', err);
    avatarError.value = 'Upload ảnh thất bại. Vui lòng thử lại.';
  } finally {
    avatarUploading.value = false;
    if (target) target.value = '';
  }
};

const clearAvatar = (): void => {
  personal.value.avatarUrl = '';
  avatarError.value = null;
};

/* ============================================================================
 * Skills dropdown — fetch từ GET /skills, load 1 lần khi mount (chỉ direct).
 * ==========================================================================*/
const skillOptions = ref<Skill[]>([]);
const skillOptionsLoading = ref(false);
const skillOptionsError = ref<string | null>(null);

const fetchSkillOptions = async () => {
  if (mode.value !== 'direct') return;
  skillOptionsLoading.value = true;
  skillOptionsError.value = null;
  try {
    const { data } = await skillsApi.list();
    skillOptions.value = data.data;
  } catch (err) {
    console.error('[CreateResume] load skills failed', err);
    skillOptionsError.value = 'Không tải được danh sách kỹ năng.';
  } finally {
    skillOptionsLoading.value = false;
  }
};
onMounted(fetchSkillOptions);
watch(mode, fetchSkillOptions);

/* ============================================================================
 * Array helpers
 * ==========================================================================*/

const addEducation = () =>
  educations.value.push({ school: '', major: '', startYear: '', endYear: '', description: '' });
const removeEducation = (i: number) => educations.value.splice(i, 1);

const addExperience = () =>
  experiences.value.push({ company: '', position: '', startDate: '', endDate: '', description: '' });
const removeExperience = (i: number) => experiences.value.splice(i, 1);

/* ============================================================================
 * Skills — chip-style picker (compact hơn form row dài).
 * - Quick-add: gõ tên + Enter (hoặc nút Thêm / click chip gợi ý).
 * - Level: 5 dots clickable trên từng chip.
 * - Suggestions: lọc ra các kỹ năng từ DB chưa được chọn (case-insensitive).
 * ==========================================================================*/

const addSkill = (name: string): void => {
  const trimmed = name.trim();
  if (!trimmed) return;
  // Dedup theo name (case-insensitive) — tránh user gõ 2 lần cùng 1 kỹ năng.
  const exists = skills.value.some(
    (s) => s.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (exists) return;
  skills.value.push({ name: trimmed, level: 3 });
};

const addSkillFromDraft = (): void => {
  addSkill(skillDraft.value);
  skillDraft.value = '';
};

const setSkillLevel = (name: string, level: number): void => {
  const skill = skills.value.find((s) => s.name === name);
  if (skill) skill.level = Math.max(1, Math.min(5, level));
};

const removeSkillByName = (name: string): void => {
  const i = skills.value.findIndex((s) => s.name === name);
  if (i >= 0) skills.value.splice(i, 1);
};

/** Suggestions từ DB — ẩn những kỹ năng đã có trong list (case-insensitive). */
const availableSuggestions = computed<Skill[]>(() => {
  const used = new Set(skills.value.map((s) => s.name.trim().toLowerCase()));
  return skillOptions.value.filter(
    (o) => !used.has(o.name.trim().toLowerCase()),
  );
});

/** List đã loại bỏ row trống (ban đầu state là [] nên không cần, nhưng defensive). */
const visibleSkills = computed<SkillRow[]>(() =>
  skills.value.filter((s) => s.name.trim()),
);

const addProject = () =>
  projects.value.push({ name: '', role: '', time: '', description: '', link: '' });
const removeProject = (i: number) => projects.value.splice(i, 1);

/* addCertificate / addActivity / removeCertificate / removeActivity — đã bỏ UI,
 * giữ comment làm placeholder để tránh gãy cvData computation. */
const addCertificate = () =>
  certificates.value.push({ name: '', issuer: '', date: '' });
const removeCertificate = (i: number) => certificates.value.splice(i, 1);

/* ============================================================================
 * cvData dùng chung cho cả 3 template render
 * ==========================================================================*/

const cvData = computed<CvRenderData>(() => ({
  title: personal.value.position.trim(),
  personalInfo: {
    fullName: personal.value.fullName.trim(),
    position: personal.value.position.trim(),
    email: personal.value.email.trim(),
    phone: personal.value.phone.trim(),
    /* address / dob / gender / avatar — BE chưa nhận, để rỗng cho template
     * tự skip qua v-if. */
    address: '',
    dob: '',
    gender: '',
    facebook: personal.value.facebook.trim(),
    linkedin: personal.value.linkedin.trim(),
    portfolio: personal.value.portfolio.trim(),
    github: personal.value.github.trim(),
    avatarUrl: personal.value.avatarUrl.trim(),
  },
  summary: summary.value.trim(),
  educations: educations.value
    .filter(e => e.school.trim())
    .map(e => ({
      school: e.school.trim(),
      major: e.major.trim() || undefined,
      startYear: e.startYear.trim() || undefined,
      endYear: e.endYear.trim() || undefined,
      description: e.description.trim() || undefined,
    })),
  experiences: experiences.value
    .filter(e => e.company.trim() && e.position.trim())
    .map(e => ({
      company: e.company.trim(),
      position: e.position.trim(),
      startDate: e.startDate.trim() || undefined,
      endDate: e.endDate.trim() || undefined,
      description: e.description.trim() || undefined,
    })),
  skills: skills.value
    .filter(s => s.name.trim())
    .map(s => ({ name: s.name.trim(), level: s.level })),
  projects: projects.value
    .filter(p => p.name.trim())
    .map(p => ({
      name: p.name.trim(),
      role: p.role.trim() || undefined,
      time: p.time.trim() || undefined,
      description: p.description.trim() || undefined,
      link: p.link.trim() || undefined,
    })),
  certificates: certificates.value
    .filter(c => c.name.trim())
    .map(c => ({
      name: c.name.trim(),
      issuer: c.issuer.trim() || undefined,
      date: c.date.trim() || undefined,
    })),
  activities: [],
  interests: [],
}));

/* ============================================================================
 * Build direct payload
 * ==========================================================================*/

const buildDirectPayload = (): CreateDirectCvInput => {
  const cleanSkills = Array.from(
    new Set(skills.value.map(s => s.name.trim()).filter(Boolean)),
  );

  const cleanProjects = projects.value
    .filter(p => p.name.trim())
    .map(p => ({
      name: p.name.trim(),
      description: p.description.trim() || undefined,
      link: p.link.trim() || undefined,
    }));

  return {
    title: personal.value.position.trim(),
    templateId: templateId.value,
    summary: summary.value.trim() || undefined,
    contact: {
      name: personal.value.fullName.trim() || undefined,
      email: personal.value.email.trim() || undefined,
      phone: personal.value.phone.trim() || undefined,
      portfolio: personal.value.portfolio.trim() || undefined,
      github: personal.value.github.trim() || undefined,
      linkedin: personal.value.linkedin.trim() || undefined,
      facebook: personal.value.facebook.trim() || undefined,
      avatarUrl: personal.value.avatarUrl.trim() || undefined,
    },
    education: educations.value
      .filter(e => e.school.trim())
      .map(e => ({
        school: e.school.trim(),
        major: e.major.trim() || undefined,
        startYear: e.startYear ? Number(e.startYear) : undefined,
        endYear: e.endYear ? Number(e.endYear) : undefined,
        description: e.description.trim() || undefined,
      })),
    experience: experiences.value
      .filter(e => e.company.trim() && e.position.trim())
      .map(e => ({
        company: e.company.trim(),
        position: e.position.trim(),
        startDate: e.startDate.trim() || undefined,
        endDate: e.endDate.trim() || null,
        description: e.description.trim() || undefined,
      })),
    skills: cleanSkills.length ? cleanSkills : undefined,
    projects: cleanProjects.length ? cleanProjects : undefined,
    certifications: certificates.value
      .filter(c => c.name.trim())
      .map(c => ({
        name: c.name.trim(),
        issuer: c.issuer.trim() || undefined,
        date: c.date.trim() || undefined,
      })),
  };
};

/* ============================================================================
 * Submit
 * ==========================================================================*/

const isSaving = ref(false);
const saveError = ref<string | null>(null);

const handleSave = async () => {
  saveError.value = null;

  if (mode.value === 'direct') {
    if (!personal.value.position.trim()) {
      saveError.value = 'Vui lòng nhập tiêu đề CV.';
      return;
    }
    isSaving.value = true;
    try {
      const { data } = await cvApi.create(buildDirectPayload());
      router.push(`/candidate/resumes`);
    } catch (err) {
      console.error('[CreateResume] save direct failed', err);
      saveError.value = 'Không lưu được CV. Vui lòng thử lại.';
    } finally {
      isSaving.value = false;
    }
    return;
  }

  // mode === 'upload'
  if (!uploadFile.value) {
    saveError.value = 'Vui lòng chọn file CV.';
    return;
  }
  isSaving.value = true;
  try {
    // 1) Upload file lên MinIO qua /uploads/file
    const { data: upData } = await uploadApi.uploadFile(uploadFile.value, 'cvs');
    uploaded.value = upData.data;
    // 2) Tạo CV row với source='upload'
    const { data } = await cvApi.upload({
      // Dùng filename gốc (không extension) làm title để listCV dễ nhận biết.
      title: stripExtension(uploadFile.value.name),
      fileUrl: upData.data.url,
      fileType: upData.data.mime,
    });
    router.push(`/candidate/resumes`);
  } catch (err) {
    console.error('[CreateResume] save upload failed', err);
    saveError.value = 'Upload hoặc tạo CV thất bại. Vui lòng thử lại.';
  } finally {
    isSaving.value = false;
  }
};

/* ============================================================================
 * Preview modal — overlay trên viewport
 * ==========================================================================*/

const previewOpen = ref(false);
const previewTemplateId = ref<number>(1);

const openPreview = () => {
  previewTemplateId.value = templateId.value;
  previewOpen.value = true;
};
const closePreview = () => {
  previewOpen.value = false;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

/** Strip extension để dùng làm title CV (vd. "CV-Backend.pdf" → "CV-Backend"). */
const stripExtension = (filename: string): string => filename.replace(/\.[^.]+$/, '');

const TEMPLATES = [
  { id: 1, label: 'Mẫu 1', desc: '2 cột, sidebar xám, thanh lịch' },
  { id: 2, label: 'Mẫu 2', desc: 'Header gradient, 2 cột, màu cam' },
  { id: 3, label: 'Mẫu 3', desc: '1 cột, font serif, học thuật' },
  { id: 4, label: 'Mẫu 4', desc: 'Header navy, 2 cột, timeline cam' },
  { id: 5, label: 'Mẫu 5', desc: '1 cột, minimalist, editorial' },
] as const;

/** Style cho mỗi template card: width cố định để scroll ngang không xuống hàng. */
const TEMPLATE_CARD_WIDTH = 180;

/* ============================================================================
 * templatePreviewData — bộ dữ liệu CỐ ĐỊNH dùng RIÊNG cho thumbnail picker.
 *
 * Tại sao tách riêng:
 *  - Trước khi user nhập form, `cvData` trống → thumbnail trắng/xám, user
 *    không nhìn ra đặc trưng của từng template.
 *  - Thumbnail phải là CV hoàn chỉnh render bằng chính template thật, chỉ
 *    scale nhỏ — KHÔNG dùng skeleton/placeholder giả.
 *
 * Phạm vi áp dụng:
 *  - ✅ Template picker (card "Chọn mẫu CV")
 *  - ❌ KHÔNG dùng cho preview modal "Xem trước CV" (vẫn dùng cvData thật)
 *  - ❌ KHÔNG dùng cho save CV (vẫn dùng refs personal/skills/...)
 *
 * Avatar để trống để template tự fallback về chữ cái đầu — tránh phụ thuộc
 * external URL (CSP/CORS có thể chặn).
 * ==========================================================================*/
const templatePreviewData: CvRenderData = {
  title: 'CV Backend Developer — Nguyễn Văn A',
  personalInfo: {
    fullName: 'Nguyễn Văn A',
    position: 'Backend Developer',
    email: 'nguyenvana@example.com',
    phone: '+84 912 345 678',
    address: 'Hà Nội, Việt Nam',
    dob: '24/08/1997',
    gender: 'Nam',
    facebook: 'facebook.com/nguyenvana',
    linkedin: 'linkedin.com/in/nguyenvana',
    portfolio: 'nguyenvana.dev',
    github: 'github.com/nguyenvana',
    avatarUrl: '',
  },
  summary:
    'Backend Developer với 3 năm kinh nghiệm thiết kế và vận hành hệ thống phân tán ' +
    'quy mô lớn. Thành thạo Node.js, TypeScript, PostgreSQL, Docker và AWS. ' +
    'Đam mê xây dựng kiế trn sạch, code có test, và tối ưu hiệu năng.',
  educations: [
    {
      school: 'Đại học Bách Khoa Hà Nội',
      major: 'Khoa học Máy tính',
      degree: 'Bằng Giỏi',
      startYear: '2018',
      endYear: '2022',
      description:
        '• GPA: 3.6/4.0\n' +
        '• Đồ án tốt nghiệp: Xây dựng hệ thống phân tán xử lý log real-time\n' +
        '• Trưởng nhóm CLB Lập trình Competitive Programming',
    },
  ],
  experiences: [
    {
      company: 'Công ty TNHH ABC Tech',
      position: 'Backend Developer',
      startDate: '06/2022',
      endDate: '',
      description:
        '• Thiết kế & phát triển API REST + GraphQL cho hệ thống e-commerce (>100K MAU)\n' +
        '• Tối ưu truy vấn PostgreSQL, giảm 40% thời gian response\n' +
        '• Xây dựng pipeline CI/CD với GitHub Actions + Docker',
    },
    {
      company: 'Công ty CP XYZ Solutions',
      position: 'Backend Engineer (Intern → Full-time)',
      startDate: '01/2021',
      endDate: '05/2022',
      description:
        '• Phát triển microservice xử lý thanh toán với NestJS + PostgreSQL\n' +
        '• Viết unit test & integration test, đạt coverage 85%\n' +
        '• Mentor 2 intern mời về full-time',
    },
  ],
  skills: [
    { name: 'Node.js', level: 5 },
    { name: 'TypeScript', level: 5 },
    { name: 'PostgreSQL', level: 4 },
    { name: 'Docker', level: 4 },
    { name: 'AWS', level: 3 },
  ],
  projects: [
    {
      name: 'Nền tảng E-commerce Microservices',
      role: 'Tech Lead Backend',
      time: '2023 — 2024',
      description:
        'Thiết kế kiến trn microservice với NestJS, PostgreSQL, Redis, RabbitMQ. ' +
        'Phụ trách 4 service: catalog, order, payment, notification.',
      link: 'github.com/nguyenvana/ecommerce',
    },
    {
      name: 'Real-time Chat Application',
      role: 'Solo Developer',
      time: '2022',
      description:
        'Xây dựng ứng dụng chat thời gian thực với Socket.IO, lưu trữ MongoDB, ' +
        'deploy trên AWS EC2 + S3.',
      link: 'github.com/nguyenvana/realtime-chat',
    },
  ],
  /* certificates / activities / interests — BE không nhận, bỏ luôn khỏi
   * thumbnail demo data để khỏi gây hiểu nhầm "CV có sẵn mấy mục này". */
  certificates: [
    {
      name: 'AWS Certified Developer — Associate',
      issuer: 'Amazon Web Services',
      date: '2024',
    },
  ],
  activities: [],
  interests: [],
};
</script>

<template>
  <div class="max-w-5xl mx-auto px-6 py-8 space-y-8">
    <header class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Tạo CV mới</h1>
        <p class="text-gray-600 mt-1 text-sm">Chọn cách tạo CV phù hợp với bạn.</p>
      </div>
      <!-- Mode toggle -->
      <div class="inline-flex rounded-lg border border-gray-300 bg-white p-1">
        <button
          type="button"
          class="px-4 py-2 text-sm rounded-md flex items-center gap-2 transition"
          :class="mode === 'direct' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'"
          @click="mode = 'direct'"
        >
          <FileText class="w-4 h-4" /> Tạo trực tiếp
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm rounded-md flex items-center gap-2 transition"
          :class="mode === 'upload' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'"
          @click="mode = 'upload'"
        >
          <Upload class="w-4 h-4" /> Upload CV
        </button>
      </div>
    </header>

    <!-- ============================================================
         MODE 1: DIRECT — form nhập tay + chọn template + preview
         ============================================================ -->
    <template v-if="mode === 'direct'">
      <!-- CV title + template selector -->
      <section class="card space-y-4">
        <h2 class="font-semibold text-gray-900">Thông tin CV</h2>
        <div class="grid sm:grid-cols-1 gap-4">
          <label class="block">
            <span class="text-sm text-gray-700">Tiêu đề CV <span class="text-red-500">*</span></span>
            <input v-model="personal.position" class="input mt-1" placeholder="Lập trình viên Backend" />
          </label>
        </div>

        <div class="pt-2">
          <p class="text-sm font-medium text-gray-700 mb-3">Chọn mẫu CV</p>
          <!-- Horizontal scroll: width cố định 5 card nên trên mobile scroll ngang,
               không xuống hàng. -->
          <div class="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 scrollbar-thin">
            <button
              v-for="tpl in TEMPLATES"
              :key="tpl.id"
              type="button"
              @click="templateId = tpl.id"
              class="group relative rounded-xl overflow-hidden text-left transition-all shrink-0 hover:-translate-y-0.5"
              :class="templateId === tpl.id
                ? 'ring-4 ring-gray-200 shadow-xl'
                : 'shadow-md hover:shadow-xl'"
              :style="{ width: `${TEMPLATE_CARD_WIDTH}px` }"
            >
              <!-- Card "tờ giấy CV" — A4 aspect, gradient nền, CV render cover-fit-width -->
              <div
                class="relative aspect-[210/297] overflow-hidden border-2 rounded-xl transition-colors"
                :class="templateId === tpl.id
                  ? 'border-gray-900'
                  : 'border-stone-200 group-hover:border-stone-400'"
                style="background: linear-gradient(135deg, #f5f5f4 0%, #fafaf9 50%, #fef3c7 140%)"
              >
                <!-- CV render scale 0.3025 — width 595 → 180 full card (cover-fit-width).
                     Transform-origin: top left → header + tên + position hiển thị đầy đủ
                     ở đầu card (quan trọng để nhận diện template). Phần dưới CV
                     (experience/projects) crop ~79px — chấp nhận được cho thumbnail. -->
                <div
                  class="absolute top-0 left-0"
                  :style="{
                    width: '595px',
                    transform: 'scale(0.3025)',
                    transformOrigin: 'top left',
                  }"
                >
                  <CVTemplateRenderer :template-id="tpl.id" :data="templatePreviewData" />
                </div>

                <!-- Selected check icon — absolute góc trên-phải, ngoài vùng CV -->
                <div
                  v-if="templateId === tpl.id"
                  class="absolute top-2 right-2 w-7 h-7 bg-gray-900 text-white rounded-full inline-flex items-center justify-center shadow-lg ring-2 ring-white z-10 pointer-events-none"
                >
                  <Check class="w-3.5 h-3.5" />
                </div>
              </div>

              <!-- Label dưới card -->
              <div class="px-1 pt-2 pb-1">
                <p
                  class="font-semibold text-xs transition-colors"
                  :class="templateId === tpl.id ? 'text-gray-900' : 'text-gray-900'"
                >
                  {{ tpl.label }}
                </p>
                <p class="text-[10px] text-gray-500 mt-0.5 line-clamp-2 leading-tight">
                  {{ tpl.desc }}
                </p>
              </div>
            </button>
          </div>
        </div>
      </section>

      <!-- Personal info -->
      <section class="card space-y-4">
        <h2 class="font-semibold text-gray-900">Thông tin cá nhân</h2>
        <div class="grid sm:grid-cols-2 gap-4">
          <label class="block">
            <span class="text-sm text-gray-700">Họ và tên</span>
            <input v-model="personal.fullName" class="input mt-1" placeholder="Nguyễn Văn A" />
          </label>
          <label class="block">
            <span class="text-sm text-gray-700">Email</span>
            <input v-model="personal.email" type="email" class="input mt-1" placeholder="email@example.com" />
          </label>
          <label class="block">
            <span class="text-sm text-gray-700">Số điện thoại</span>
            <input v-model="personal.phone" class="input mt-1" placeholder="+84 ..." />
          </label>
          <label class="block">
            <span class="text-sm text-gray-700">Facebook</span>
            <input v-model="personal.facebook" class="input mt-1" placeholder="https://facebook.com/..." />
          </label>
          <label class="block">
            <span class="text-sm text-gray-700">LinkedIn</span>
            <input v-model="personal.linkedin" class="input mt-1" placeholder="https://linkedin.com/in/..." />
          </label>
          <label class="block">
            <span class="text-sm text-gray-700">Portfolio</span>
            <input v-model="personal.portfolio" class="input mt-1" placeholder="https://..." />
          </label>
          <label class="block">
            <span class="text-sm text-gray-700">GitHub</span>
            <input v-model="personal.github" class="input mt-1" placeholder="https://github.com/..." />
          </label>
          <label class="block sm:col-span-2">
            <span class="text-sm text-gray-700">Ảnh đại diện</span>
            <div class="flex items-center gap-3 mt-1">
              <div
                v-if="personal.avatarUrl"
                class="w-14 h-14 rounded-full overflow-hidden border border-gray-200 shrink-0 bg-gray-50"
              >
                <img :src="personal.avatarUrl" alt="Avatar" class="w-full h-full object-cover" />
              </div>
              <div
                v-else
                class="w-14 h-14 rounded-full border border-dashed border-gray-300 shrink-0 flex items-center justify-center text-gray-400 text-xs"
              >
                Chưa có
              </div>
              <button
                type="button"
                class="btn-secondary text-sm inline-flex items-center gap-2"
                :disabled="avatarUploading"
                @click="pickAvatar"
              >
                <Loader2 v-if="avatarUploading" class="w-4 h-4 animate-spin" />
                <Upload v-else class="w-4 h-4" />
                {{ avatarUploading ? 'Đang tải...' : (personal.avatarUrl ? 'Đổi ảnh' : 'Chọn ảnh') }}
              </button>
              <button
                v-if="personal.avatarUrl && !avatarUploading"
                type="button"
                class="text-sm text-red-600 hover:text-red-700"
                @click="clearAvatar"
              >
                Xóa
              </button>
              <input
                ref="avatarInput"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                class="hidden"
                @change="handleAvatarChange"
              />
            </div>
            <p v-if="avatarError" class="text-xs text-red-600 mt-1">{{ avatarError }}</p>
            <p v-else class="text-xs text-gray-500 mt-1">JPG, PNG, WEBP — tối đa 5MB.</p>
          </label>
        </div>
      </section>

      <!-- Summary -->
      <section class="card space-y-4">
        <h2 class="font-semibold text-gray-900">Giới thiệu bản thân / Mục tiêu nghề nghiệp</h2>
        <textarea v-model="summary" rows="5" class="input"
          placeholder="Một vài dòng tóm tắt về bạn, mục tiêu nghề nghiệp, điểm mạnh nổi bật..." />
      </section>

      <!-- Education -->
      <section class="card space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-gray-900">Học vấn</h2>
          <button @click="addEducation" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
            <Plus class="w-4 h-4" /> Thêm học vấn
          </button>
        </div>
        <div v-for="(edu, i) in educations" :key="i" class="border border-gray-200 rounded-lg p-4 space-y-3">
          <div class="grid sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="text-sm text-gray-700">Trường</span>
              <input v-model="edu.school" class="input mt-1" />
            </label>
            <label class="block">
              <span class="text-sm text-gray-700">Chuyên ngành</span>
              <input v-model="edu.major" class="input mt-1" />
            </label>
            <label class="block">
              <span class="text-sm text-gray-700">Bắt đầu (YYYY)</span>
              <input v-model="edu.startYear" class="input mt-1" placeholder="2018" />
            </label>
            <label class="block">
              <span class="text-sm text-gray-700">Kết thúc (YYYY)</span>
              <input v-model="edu.endYear" class="input mt-1" placeholder="2022 hoặc để trống nếu đang học" />
            </label>
          </div>
          <label class="block">
            <span class="text-sm text-gray-700">Mô tả</span>
            <textarea v-model="edu.description" rows="3" class="input mt-1" />
          </label>
          <div class="text-right">
            <button v-if="educations.length > 1" @click="removeEducation(i)" type="button"
              class="text-sm text-red-600 hover:text-red-700 inline-flex items-center gap-1">
              <Trash2 class="w-4 h-4" /> Xóa
            </button>
          </div>
        </div>
      </section>

      <!-- Experience -->
      <section class="card space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-gray-900">Kinh nghiệm</h2>
          <button @click="addExperience" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
            <Plus class="w-4 h-4" /> Thêm kinh nghiệm
          </button>
        </div>
        <div v-for="(exp, i) in experiences" :key="i" class="border border-gray-200 rounded-lg p-4 space-y-3">
          <div class="grid sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="text-sm text-gray-700">Công ty</span>
              <input v-model="exp.company" class="input mt-1" />
            </label>
            <label class="block">
              <span class="text-sm text-gray-700">Vị trí</span>
              <input v-model="exp.position" class="input mt-1" />
            </label>
            <label class="block">
              <span class="text-sm text-gray-700">Bắt đầu</span>
              <input v-model="exp.startDate" class="input mt-1" placeholder="2022-01" />
            </label>
            <label class="block">
              <span class="text-sm text-gray-700">Kết thúc</span>
              <input v-model="exp.endDate" class="input mt-1" placeholder="2024-06 hoặc để trống nếu đang làm" />
            </label>
          </div>
          <label class="block">
            <span class="text-sm text-gray-700">Mô tả</span>
            <textarea v-model="exp.description" rows="3" class="input mt-1" />
          </label>
          <div class="text-right">
            <button v-if="experiences.length > 1" @click="removeExperience(i)" type="button"
              class="text-sm text-red-600 hover:text-red-700 inline-flex items-center gap-1">
              <Trash2 class="w-4 h-4" /> Xóa
            </button>
          </div>
        </div>
      </section>

      <!-- Skills — chip picker -->
      <section class="card space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-gray-900">Kỹ năng</h2>
          <span class="text-xs text-gray-500">{{ visibleSkills.length }} kỹ năng</span>
        </div>

        <!-- Quick-add input -->
        <div class="flex gap-2">
          <input
            v-model="skillDraft"
            type="text"
            class="input flex-1"
            placeholder="Gõ tên kỹ năng rồi nhấn Enter..."
            :disabled="skillOptionsLoading"
            @keydown.enter.prevent="addSkillFromDraft"
          />
          <button
            type="button"
            class="btn-secondary inline-flex items-center gap-1 text-sm shrink-0"
            :disabled="!skillDraft.trim()"
            @click="addSkillFromDraft"
          >
            <Plus class="w-4 h-4" /> Thêm
          </button>
        </div>

        <!-- Suggestions từ DB (chỉ hiện cái chưa chọn) -->
        <div v-if="availableSuggestions.length" class="flex flex-wrap gap-1.5 items-center">
          <span class="text-xs text-gray-500 mr-1">Gợi ý:</span>
          <button
            v-for="opt in availableSuggestions"
            :key="opt.id"
            type="button"
            class="px-2.5 py-0.5 text-xs rounded-full border border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:text-gray-900 hover:bg-gray-100 transition"
            @click="addSkill(opt.name)"
          >
            + {{ opt.name }}
          </button>
        </div>

        <!-- Loading / error / empty DB -->
        <p v-if="skillOptionsLoading" class="text-xs text-gray-500 inline-flex items-center gap-2">
          <Loader2 class="w-3.5 h-3.5 animate-spin" /> Đang tải gợi ý...
        </p>
        <p v-else-if="skillOptionsError" class="text-xs text-red-600">{{ skillOptionsError }}</p>

        <!-- Skill chips: tên + 5 dots level + nút xóa -->
        <ul v-if="visibleSkills.length" class="flex flex-wrap gap-2">
          <li
            v-for="s in visibleSkills"
            :key="s.name"
            class="inline-flex items-center gap-2 pl-3 pr-1 py-1 rounded-full bg-gray-100 border border-gray-200 text-sm"
          >
            <span class="font-medium text-gray-900">{{ s.name }}</span>

            <!-- 5 dots level clickable -->
            <div class="inline-flex items-center gap-0.5">
              <button
                v-for="n in 5"
                :key="n"
                type="button"
                class="w-4 h-4 inline-flex items-center justify-center hover:scale-110 transition"
                :title="`Mức ${n}/5`"
                @click="setSkillLevel(s.name, n)"
              >
                <span
                  class="block w-2 h-2 rounded-full transition-colors"
                  :class="n <= s.level ? 'bg-gray-700' : 'bg-gray-300'"
                />
              </button>
            </div>

            <button
              type="button"
              class="ml-1 w-5 h-5 inline-flex items-center justify-center rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50"
              :title="`Xóa ${s.name}`"
              @click="removeSkillByName(s.name)"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </li>
        </ul>
        <p v-else class="text-xs text-gray-500">
          Chưa có kỹ năng nào. Gõ tên vào ô phía trên hoặc chọn từ gợi ý.
        </p>
      </section>

      <!-- Projects -->
      <section class="card space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-gray-900">Dự án</h2>
          <button @click="addProject" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
            <Plus class="w-4 h-4" /> Thêm dự án
          </button>
        </div>
        <div v-for="(proj, i) in projects" :key="i" class="border border-gray-200 rounded-lg p-4 space-y-3">
          <div class="grid sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="text-sm text-gray-700">Tên dự án</span>
              <input v-model="proj.name" class="input mt-1" />
            </label>
            <label class="block">
              <span class="text-sm text-gray-700">Vai trò</span>
              <input v-model="proj.role" class="input mt-1" placeholder="Backend Dev / Tech Lead ..." />
            </label>
            <label class="block">
              <span class="text-sm text-gray-700">Thời gian</span>
              <input v-model="proj.time" class="input mt-1" placeholder="2023 — 2024" />
            </label>
            <label class="block">
              <span class="text-sm text-gray-700">Link dự án</span>
              <input v-model="proj.link" class="input mt-1" placeholder="https://github.com/..." />
            </label>
          </div>
          <label class="block">
            <span class="text-sm text-gray-700">Mô tả</span>
            <textarea v-model="proj.description" rows="3" class="input mt-1" />
          </label>
          <div class="text-right">
            <button v-if="projects.length > 1" @click="removeProject(i)" type="button"
              class="text-sm text-red-600 hover:text-red-700 inline-flex items-center gap-1">
              <Trash2 class="w-4 h-4" /> Xóa
            </button>
          </div>
        </div>
      </section>

      <!-- Certificates -->
      <section class="card space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-gray-900">Chứng chỉ</h2>
          <button @click="addCertificate" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
            <Plus class="w-4 h-4" /> Thêm chứng chỉ
          </button>
        </div>
        <div v-for="(c, i) in certificates" :key="i" class="border border-gray-200 rounded-lg p-4 space-y-3">
          <div class="grid sm:grid-cols-3 gap-3">
            <label class="block sm:col-span-2">
              <span class="text-sm text-gray-700">Tên chứng chỉ</span>
              <input v-model="c.name" class="input mt-1" />
            </label>
            <label class="block">
              <span class="text-sm text-gray-700">Năm</span>
              <input v-model="c.date" class="input mt-1" placeholder="2023" />
            </label>
            <label class="block sm:col-span-3">
              <span class="text-sm text-gray-700">Đơn vị cấp</span>
              <input v-model="c.issuer" class="input mt-1" />
            </label>
          </div>
          <div class="text-right">
            <button v-if="certificates.length > 1" @click="removeCertificate(i)" type="button"
              class="text-sm text-red-600 hover:text-red-700 inline-flex items-center gap-1">
              <Trash2 class="w-4 h-4" /> Xóa
            </button>
          </div>
        </div>
      </section>

      </template>

    <!-- ============================================================
         MODE 2: UPLOAD — chọn file PDF/DOCX/ảnh, xem trước
         ============================================================ -->
    <template v-else>
      <section class="card space-y-4">
        <h2 class="font-semibold text-gray-900">Upload CV của bạn</h2>
        <p class="text-sm text-gray-600">
          Hỗ trợ PDF, DOCX, DOC, JPG, PNG. Tối đa 10MB.
        </p>

        <!-- Drop zone -->
        <div
          v-if="!uploadFile"
          class="relative border-2 border-dashed rounded-xl p-10 text-center transition cursor-pointer"
          :class="isDragging ? 'border-gray-400 bg-gray-100' : 'border-gray-300 hover:border-gray-400 bg-gray-50'"
          @dragenter.prevent="isDragging = true"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop="handleDrop"
          @click="openFilePicker"
        >
          <input
            ref="uploadInput"
            type="file"
            class="hidden"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
            @change="handleFileInput"
          />
          <FileUp class="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p class="text-sm text-gray-700">
            <span class="text-gray-900 font-medium">Chọn file</span> hoặc kéo thả vào đây
          </p>
          <p class="text-xs text-gray-500 mt-1">PDF, DOCX, DOC, JPG, PNG — tối đa 10MB</p>
        </div>

        <!-- File đã chọn -->
        <div v-else class="flex items-center gap-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
          <div class="w-12 h-12 rounded-lg bg-white flex items-center justify-center shrink-0 border border-gray-200">
            <img v-if="uploadPreviewUrl" :src="uploadPreviewUrl" class="w-full h-full object-cover rounded-lg" />
            <FileText v-else class="w-6 h-6 text-gray-700" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-gray-900 truncate">{{ uploadFile.name }}</p>
            <p class="text-xs text-gray-500 mt-0.5">
              {{ uploadFile.type || '—' }} · {{ formatBytes(uploadFile.size) }}
              <span v-if="uploaded" class="text-green-600"> · Uploaded</span>
            </p>
          </div>
          <button
            type="button"
            class="text-gray-400 hover:text-red-600"
            @click="removeUploadFile"
            title="Xoá"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div v-if="uploadError" class="flex items-center gap-2 p-3 border border-red-200 rounded-lg bg-red-50">
          <AlertCircle class="w-4 h-4 text-red-500" />
          <p class="text-sm text-red-700">{{ uploadError }}</p>
        </div>

        <p class="text-xs text-gray-500">
          CV sau khi upload sẽ được hệ thống phân tích tự động (CV score) và lưu vào danh sách CV của bạn.
        </p>
      </section>
    </template>

    <!-- Actions -->
    <div class="flex items-center justify-between gap-3 pt-2">
      <p v-if="saveError" class="text-sm text-red-600">{{ saveError }}</p>
      <span v-else />
      <div class="flex gap-3">
        <button
          v-if="mode === 'direct'"
          @click="openPreview"
          type="button"
          class="btn-secondary inline-flex items-center gap-2"
        >
          <Eye class="w-4 h-4" /> Xem trước
        </button>
        <button
          @click="handleSave"
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition disabled:opacity-50"
          :disabled="isSaving"
        >
          <Loader2 v-if="isSaving" class="w-4 h-4 animate-spin" />
          {{ isSaving ? 'Đang lưu...' : (mode === 'direct' ? 'Lưu CV' : 'Upload & Lưu') }}
        </button>
      </div>
    </div>
  </div>

  <!-- ============================================================
       PREVIEW MODAL — overlay full màn hình
       ============================================================ -->
  <Teleport to="body">
    <div
      v-if="previewOpen"
      class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      @click.self="closePreview"
    >
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <header class="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-4">
          <h2 class="font-semibold text-gray-900">Xem trước CV</h2>
          <!-- Switch template trong modal preview (chỉ direct mode) -->
          <div class="inline-flex rounded-lg border border-gray-300 p-1">
            <button
              v-for="tpl in TEMPLATES"
              :key="tpl.id"
              type="button"
              @click="previewTemplateId = tpl.id"
              class="px-3 py-1 text-xs rounded-md transition"
              :class="previewTemplateId === tpl.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'"
            >
              {{ tpl.label }}
            </button>
          </div>
          <button class="text-gray-400 hover:text-gray-600 p-1" @click="closePreview" aria-label="Đóng">
            <X class="w-5 h-5" />
          </button>
        </header>
        <div class="flex-1 overflow-y-auto bg-gray-100 p-6">
          <div class="bg-white max-w-[820px] mx-auto shadow">
            <CVTemplateRenderer :template-id="previewTemplateId" :data="cvData" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
