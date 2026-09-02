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
  User,
  GraduationCap,
  Briefcase,
  Sparkles,
  Award,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-vue-next';
import { usePlanStore } from '@stores/plan';
import { useSkillsStore } from '@stores/skills';
import { useCvStore } from '@stores/cv';
import { useUploadStore } from '@stores/upload';
import { useToastStore } from '@stores/toast';
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue';
import type { Skill } from '@/types/skills';
import type { CvRenderData, CreateDirectCvInput, CvSource } from '@/types/cv';

/* ============================================================================
 * Form interfaces (direct mode) — giữ nguyên từ bản cũ, không đổi shape.
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
 * Quota — Upload CV (parse worker) tốn lượt `ai_cv_parsed`.
 * Direct mode KHÔNG qua worker → không tốn quota, vẫn cho lưu bình thường.
 * BE quota middleware đang là STUB → chỉ disable ở FE, BE vẫn pass.
 * ==========================================================================*/
const planStore = usePlanStore();
const skillsStore = useSkillsStore();
const cvStore = useCvStore();
const uploadStore = useUploadStore();
const toast = useToastStore();
const hasUploadQuota = computed<boolean>(() => planStore.hasQuota('ai_cv_parsed'));
const uploadQuotaTooltip = computed<string>(() =>
  hasUploadQuota.value
    ? 'Upload CV (sẽ tốn 1 lượt parse AI)'
    : 'Đã hết lượt parse AI — nâng cấp gói để tiếp tục',
);

/** Error từ cv store — message BE đã được dịch qua cvStore.setError. */
const cvStoreError = computed<string | null>(() => cvStore.error);

onMounted(() => {
  void planStore.fetchMyUsage();
});

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
const uploaded = ref<{ url: string; key: string; mime: string; size: number } | null>(null);
const isDragging = ref(false);
const uploadInput = ref<HTMLInputElement | null>(null);
const openFilePicker = (): void => {
  uploadInput.value?.click();
};

const handleSelectFile = (file: File) => {
  if (!ACCEPTED_MIME.includes(file.type)) {
    toast.error('Định dạng không hỗ trợ. Chỉ chấp nhận PDF, DOCX, JPG, PNG.', {
      title: 'File không hợp lệ',
    });
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast.error('File vượt quá 10MB.', {
      title: 'File quá lớn',
    });
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
};

/* ============================================================================
 * Avatar upload — chọn file (image/, ≤5MB, folder='avatars').
 * BE đã nhận `contact.avatarUrl`, lưu vào parsedData.avatarUrl.
 *
 * Quy ước:
 *  - API call đi qua `uploadStore.uploadImage()` — không gọi trực tiếp uploadApi
 *    (view → store → service).
 *  - FE guard vẫn giữ ở view cho fail-fast + message tiếng Việt cụ thể (store
 *    cũng có guard nhưng error chung chung).
 *  - `avatarUploading` mirror từ `uploadStore.loading` để UI reactivity; nếu
 *    caller khác cũng upload cùng lúc, loading vẫn đúng trạng thái.
 *  - `avatarError` ưu tiên local validation, nếu trống thì lấy từ store.
 * ==========================================================================*/
const avatarInput = ref<HTMLInputElement | null>(null);

const avatarUploading = computed<boolean>(() => uploadStore.loading);
const avatarError = computed<string | null>(() => uploadStore.error);

const pickAvatar = (): void => avatarInput.value?.click();

const handleAvatarChange = async (e: Event): Promise<void> => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  // View-level guard: fail-fast với message tiếng Việt cụ thể. Nếu pass,
  // uploadStore sẽ chạy guard lần 2 + gọi uploadApi.
  if (!file.type.startsWith('image/')) {
    uploadStore.clearError();
    uploadStore.error = 'Vui lòng chọn file ảnh (JPG, PNG, WEBP, GIF).';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    uploadStore.clearError();
    uploadStore.error = 'Ảnh tối đa 5MB.';
    return;
  }
  const result = await uploadStore.uploadImage(file, 'avatars');
  if (result) {
    personal.value.avatarUrl = result.url;
  }
  // Reset input value để chọn lại cùng file cũ vẫn trigger change event.
  if (target) target.value = '';
};

const clearAvatar = (): void => {
  personal.value.avatarUrl = '';
  uploadStore.clearError();
};

/* ============================================================================
 * Skills dropdown — fetch từ GET /skills qua `skillsStore.fetchList()`.
 * Chỉ load khi ở direct mode; view không giữ state riêng, đọc thẳng từ store.
 * ==========================================================================*/
const skillOptions = computed<Skill[]>(() => skillsStore.items);
const skillOptionsLoading = computed<boolean>(() => skillsStore.loading);
const skillOptionsError = computed<string | null>(() => skillsStore.error);

const fetchSkillOptions = async () => {
  if (mode.value !== 'direct') return;
  await skillsStore.fetchList();
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

const addCertificate = () =>
  certificates.value.push({ name: '', issuer: '', date: '' });
const removeCertificate = (i: number) => certificates.value.splice(i, 1);

/* ============================================================================
 * cvData dùng chung cho cả 3 template render — giữ nguyên 100%.
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
 * Build direct payload — giữ nguyên 100%, không đổi shape.
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
 * Submit — chỉ trigger ở bước cuối của wizard.
 *
 * UX: thay vì hiện banner inline (cồng kềnh, tốn chỗ), toàn bộ feedback
 * (validate fail / API fail / success) đi qua `useToastStore` để hiện toast
 * góc trên-phải. Tham khảo components/notify/ToastContainer.vue.
 *
 * Vì `toast` store là GLOBAL (singleton), toast vẫn hiển thị sau khi
 * navigate đi — user có feedback dù trang kế tiếp mount ngay.
 * ==========================================================================*/

const isSaving = ref(false);

const handleSave = async () => {
  if (mode.value === 'direct') {
    // Validate: position là trường bắt buộc duy nhất trên cả form. Nếu
    // user đang ở step 7 (template) mà thiếu position thì auto-jump về
    // step 2 để không phải tự quay lại.
    if (!personal.value.position.trim()) {
      toast.warning('Vui lòng nhập tiêu đề CV.', {
        title: 'Thiếu thông tin',
      });
      goToStep(2);
      return;
    }
    isSaving.value = true;
    try {
      const created = await cvStore.create(buildDirectPayload());
      if (created) {
        toast.success('Đã tạo CV thành công!');
        router.push('/candidate/resumes');
      } else {
        toast.error(cvStoreError.value ?? 'Không lưu được CV. Vui lòng thử lại.');
      }
    } finally {
      isSaving.value = false;
    }
    return;
  }

  // mode === 'upload'
  if (!uploadFile.value) {
    toast.warning('Vui lòng chọn file CV trước khi lưu.', {
      title: 'Chưa có file',
    });
    return;
  }
  isSaving.value = true;
  try {
    // 1) Upload file lên MinIO qua uploadStore.
    const upResult = await uploadStore.uploadFile(uploadFile.value, 'cvs');
    if (!upResult) {
      toast.error(uploadStore.error ?? 'Upload file thất bại.', {
        title: 'Lỗi upload',
      });
      return;
    }
    uploaded.value = {
      url: upResult.url,
      key: upResult.key,
      mime: upResult.mime,
      size: upResult.size,
    };
    // 2) Tạo CV row với source='upload' qua cvStore.
    const created = await cvStore.upload({
      // Dùng filename gốc (không extension) làm title để listCV dễ nhận biết.
      title: stripExtension(uploadFile.value.name),
      fileUrl: upResult.url,
      fileType: upResult.mime,
    });
    if (created) {
      toast.success('Đã upload và tạo CV thành công!');
      router.push('/candidate/resumes');
    } else {
      toast.error(cvStoreError.value ?? 'Upload hoặc tạo CV thất bại.', {
        title: 'Lỗi',
      });
    }
  } finally {
    isSaving.value = false;
  }
};

/* ============================================================================
 * Preview modal — overlay trên viewport (giữ nguyên 100%).
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
 * Nội dung demo ĐA NGÀNH: Marketing/Sales trung tính, không thiên về IT.
 * Mục đích là giúp user nhìn ra PHONG CÁCH THIẾT KẾ của template, không
 * định hướng theo ngành. Sản phẩm hỗ trợ mọi ngành nghề.
 *
 * Avatar để trống để template tự fallback về chữ cái đầu — tránh phụ thuộc
 * external URL (CSP/CORS có thể chặn).
 * ==========================================================================*/
const templatePreviewData: CvRenderData = {
  title: 'Chuyên viên Marketing — Nguyễn Văn A',
  personalInfo: {
    fullName: 'Nguyễn Văn A',
    position: 'Chuyên viên Marketing',
    email: 'nguyenvana@example.com',
    phone: '+84 912 345 678',
    address: 'Hà Nội, Việt Nam',
    dob: '24/08/1997',
    gender: 'Nam',
    facebook: 'facebook.com/nguyenvana',
    linkedin: 'linkedin.com/in/nguyenvana',
    portfolio: 'nguyenvana.com.vn',
    github: '',
    avatarUrl: '',
  },
  summary:
    'Chuyên viên Marketing với 3 năm kinh nghiệm xây dựng và triển khai chiến lược ' +
    'digital marketing đa kênh. Thành thạo content, social media, performance ads ' +
    'và phân tích dữ liệu. Đam mê kể chuyện thương hiệu qua nội dung sáng tạo.',
  educations: [
    {
      school: 'Đại học Kinh tế Quốc dân',
      major: 'Quản trị Marketing',
      degree: 'Bằng Giỏi',
      startYear: '2018',
      endYear: '2022',
      description:
        '• GPA: 3.6/4.0\n' +
        '• Đồ án tốt nghiệp: Chiến lược ra mắt sản phẩm FMCG cho Gen Z\n' +
        '• Trưởng nhóm CLB Truyền thông & Sự kiện',
    },
  ],
  experiences: [
    {
      company: 'Công ty TNHH ABC Media',
      position: 'Marketing Executive',
      startDate: '06/2022',
      endDate: '',
      description:
        '• Lên kế hoạch & triển khai campaign đa kênh (Facebook, TikTok, Google) cho 5+ thương hiệu\n' +
        '• Tăng 45% engagement và giảm 30% CPL trong 6 tháng\n' +
        '• Phối hợp team content thiết kế 200+ bài viết/tháng',
    },
    {
      company: 'Công ty CP XYZ Retail',
      position: 'Marketing Intern → Full-time',
      startDate: '01/2021',
      endDate: '05/2022',
      description:
        '• Hỗ trợ vận hành fanpage 200K follower, lên lịch 30 bài/tuần\n' +
        '• Phân tích dữ liệu Meta Ads & Google Analytics, báo cáo tuần\n' +
        '• Đề xuất A/B test tăng 18% conversion rate',
    },
  ],
  skills: [
    { name: 'Digital Marketing', level: 5 },
    { name: 'Content', level: 5 },
    { name: 'Communication', level: 4 },
    { name: 'Project Management', level: 4 },
    { name: 'Data Analysis', level: 3 },
  ],
  projects: [
    {
      name: 'Chiến dịch ra mắt sản phẩm FMCG',
      role: 'Project Lead',
      time: '2023 — 2024',
      description:
        'Dẫn dắt chiến dịch ra mắt sản phẩm mới đạt 2M+ reach trong 1 tháng, ' +
        'phụ trách 4 kênh: social, KOL, PR, performance ads.',
      link: 'nguyenvana.com.vn/case-study-fmcg',
    },
    {
      name: 'Chuỗi Workshop Content Marketing',
      role: 'Solo Organizer',
      time: '2022',
      description:
        'Tổ chức chuỗi 6 workshop online cho 500+ marketers mới, tổng view 50K+.',
      link: 'nguyenvana.com.vn/workshop',
    },
  ],
  certificates: [
    {
      name: 'Google Analytics Individual Qualification',
      issuer: 'Google',
      date: '2024',
    },
  ],
  activities: [],
  interests: [],
};

/* ============================================================================
 * Wizard — chỉ áp dụng cho mode='direct'. Upload giữ flow cũ.
 *
 * Step state: giữ currentStep là 1-based (1..7) cho dễ đọc, đồng thời map
 * sang index 0-based khi truy cập `steps[currentStep - 1]`.
 *
 * Wizard KHÔNG reset state form khi chuyển step — toàn bộ personal/summary/
 * educations/... đều là reactive refs đã khai báo phía trên, render có điều
 * kiện theo step. User click "Quay lại" / click vào step đã hoàn thành để
 * sửa → dữ liệu vẫn còn vì cùng share 1 ref.
 *
 * KHÔNG gọi API khi chuyển step. Chỉ gọi handleSave() ở step cuối.
 * ==========================================================================*/
interface WizardStep {
  id: number;
  title: string;
  description: string;
  icon: LucideIcon;
}

const steps: WizardStep[] = [
  {
    id: 1,
    title: 'Thông tin cá nhân',
    description: 'Cho nhà tuyển dụng biết bạn là ai',
    icon: User,
  },
  {
    id: 2,
    title: 'Giới thiệu',
    description: 'Tiêu đề CV và mục tiêu nghề nghiệp',
    icon: FileText,
  },
  {
    id: 3,
    title: 'Học vấn',
    description: 'Quá trình đào tạo và bằng cấp',
    icon: GraduationCap,
  },
  {
    id: 4,
    title: 'Kinh nghiệm',
    description: 'Công ty và vị trí đã làm việc',
    icon: Briefcase,
  },
  {
    id: 5,
    title: 'Kỹ năng',
    description: 'Những kỹ năng nổi bật của bạn',
    icon: Sparkles,
  },
  {
    id: 6,
    title: 'Dự án & Chứng chỉ',
    description: 'Các dự án cá nhân và chứng chỉ chuyên môn',
    icon: Award,
  },
  {
    id: 7,
    title: 'Chọn mẫu',
    description: 'Chọn mẫu CV và hoàn tất',
    icon: LayoutGrid,
  },
];

const TOTAL_STEPS = steps.length;
const currentStep = ref<number>(1);

const currentStepMeta = computed<WizardStep>(() => steps[currentStep.value - 1]);
const isFirstStep = computed<boolean>(() => currentStep.value === 1);
const isLastStep = computed<boolean>(() => currentStep.value === TOTAL_STEPS);

/** Cho phép click vào step để quay lại. Không giới hạn (user có thể sửa bất kỳ
 *  step nào đã qua). KHÔNG cho nhảy tới step chưa đến nếu user chưa "đi qua" nó
 *  — nhưng vì wizard không gate progress, để UX đơn giản ta cho phép click bất
 *  kỳ step nào. Dữ liệu các step sau sẽ trống nếu user nhảy tới mà chưa nhập. */
const canGoToStep = (stepId: number): boolean => stepId >= 1 && stepId <= TOTAL_STEPS;

const goToStep = (stepId: number): void => {
  if (!canGoToStep(stepId)) return;
  currentStep.value = stepId;
};

const nextStep = (): void => {
  if (currentStep.value < TOTAL_STEPS) currentStep.value += 1;
};

const previousStep = (): void => {
  if (currentStep.value > 1) currentStep.value -= 1;
};

/** Cancel — user bấm "Hủy" ở bước đầu → quay về list CV. */
const cancelWizard = (): void => {
  router.push('/candidate/resumes');
};
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
    <!-- ==================== Page Header ==================== -->
    <header class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Tạo CV mới</h1>
        <p class="text-gray-600 mt-1 text-sm">
          {{
            mode === 'direct'
              ? 'Tạo CV trực tiếp theo từng bước, không cần nhập một lần.'
              : 'Upload CV có sẵn, hệ thống sẽ tự động phân tích.'
          }}
        </p>
      </div>
      <!-- Mode toggle -->
      <div class="inline-flex rounded-lg border border-gray-300 bg-white p-1 shrink-0">
        <button
          type="button"
          class="px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md flex items-center gap-1.5 sm:gap-2 transition"
          :class="mode === 'direct' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'"
          @click="mode = 'direct'"
        >
          <FileText class="w-4 h-4 shrink-0" />
          <span class="hidden sm:inline">Tạo trực tiếp</span>
          <span class="sm:hidden">Tạo</span>
        </button>
        <button
          type="button"
          class="px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md flex items-center gap-1.5 sm:gap-2 transition"
          :class="mode === 'upload' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'"
          @click="mode = 'upload'"
        >
          <Upload class="w-4 h-4 shrink-0" />
          <span>Upload CV</span>
        </button>
      </div>
    </header>

    <!-- ============================================================
         MODE 1: DIRECT — Wizard 7 bước
         ============================================================ -->
    <template v-if="mode === 'direct'">
      <!-- ============ Progress stepper ============ -->
      <nav
        class="card !p-4 sm:!p-5"
        aria-label="Wizard progress"
      >
        <!-- Desktop: full stepper với circles + connecting lines -->
        <ol class="hidden md:flex items-start gap-1.5">
          <li
            v-for="(step, idx) in steps"
            :key="step.id"
            class="flex-1 flex flex-col items-center min-w-0"
          >
            <div class="flex items-center w-full">
              <!-- Connector line bên trái (skip ở step đầu) -->
              <div
                v-if="idx > 0"
                class="flex-1 h-0.5 -mt-0 transition-colors"
                :class="step.id <= currentStep ? 'bg-gray-900' : 'bg-gray-200'"
              />
              <!-- Circle -->
              <button
                type="button"
                class="shrink-0 w-8 h-8 rounded-full inline-flex items-center justify-center text-xs font-semibold transition-all"
                :class="[
                  step.id < currentStep
                    ? 'bg-gray-900 text-white hover:bg-gray-700'
                    : step.id === currentStep
                    ? 'bg-gray-900 text-white ring-4 ring-gray-200'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                ]"
                :aria-current="step.id === currentStep ? 'step' : undefined"
                :aria-label="`Bước ${step.id}: ${step.title}`"
                @click="goToStep(step.id)"
              >
                <Check v-if="step.id < currentStep" class="w-4 h-4" />
                <span v-else>{{ step.id }}</span>
              </button>
              <!-- Connector line bên phải (skip ở step cuối) -->
              <div
                v-if="idx < steps.length - 1"
                class="flex-1 h-0.5 -mt-0 transition-colors"
                :class="step.id < currentStep ? 'bg-gray-900' : 'bg-gray-200'"
              />
            </div>
            <button
              type="button"
              class="mt-2 text-[11px] font-medium text-center leading-tight transition-colors max-w-full px-0.5"
              :class="step.id === currentStep
                ? 'text-gray-900'
                : step.id < currentStep
                ? 'text-gray-700 hover:text-gray-900'
                : 'text-gray-400'"
              @click="goToStep(step.id)"
            >
              {{ step.title }}
            </button>
          </li>
        </ol>

        <!-- Mobile: compact "Bước X / Y — Title" + progress bar -->
        <div class="md:hidden">
          <div class="flex items-center justify-between gap-3 mb-2">
            <p class="text-xs text-gray-500 font-medium tabular-nums">
              Bước {{ currentStep }} / {{ TOTAL_STEPS }}
            </p>
            <p class="text-sm font-semibold text-gray-900 truncate">
              {{ currentStepMeta.title }}
            </p>
          </div>
          <div class="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              class="h-full bg-gray-900 rounded-full transition-all duration-300"
              :style="{ width: `${(currentStep / TOTAL_STEPS) * 100}%` }"
            />
          </div>
        </div>
      </nav>

      <!-- ============ Current step content ============ -->
      <section class="card space-y-5" :aria-labelledby="`step-${currentStep}-title`">
        <!-- Step header: icon + title + description -->
        <header class="flex items-start gap-3 pb-4 border-b border-gray-200">
          <div class="w-10 h-10 rounded-xl bg-gray-900 text-white inline-flex items-center justify-center shrink-0">
            <component :is="currentStepMeta.icon" class="w-5 h-5" />
          </div>
          <div class="min-w-0">
            <h2 :id="`step-${currentStep}-title`" class="text-lg font-semibold text-gray-900">
              {{ currentStepMeta.title }}
            </h2>
            <p class="text-sm text-gray-500 mt-0.5">{{ currentStepMeta.description }}</p>
          </div>
        </header>

        <!-- ====================== STEP 1: Thông tin cá nhân ====================== -->
        <div v-if="currentStep === 1" class="space-y-4">
          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <label class="block sm:col-span-2 lg:col-span-3">
              <span class="text-sm text-gray-700">GitHub</span>
              <input v-model="personal.github" class="input mt-1" placeholder="https://github.com/..." />
            </label>
            <label class="block sm:col-span-2 lg:col-span-3">
              <span class="text-sm text-gray-700">Ảnh đại diện</span>
              <div class="flex items-center gap-3 mt-1 flex-wrap">
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
        </div>

        <!-- ====================== STEP 2: Giới thiệu ====================== -->
        <div v-else-if="currentStep === 2" class="space-y-4">
          <label class="block">
            <span class="text-sm text-gray-700">
              Tiêu đề CV / Vị trí ứng tuyển <span class="text-red-500">*</span>
            </span>
            <input
              v-model="personal.position"
              class="input mt-1"
              placeholder="Chuyên viên Marketing / Lập trình viên Backend / Kế toán tổng hợp ..."
            />
          </label>
          <label class="block">
            <span class="text-sm text-gray-700">Giới thiệu bản thân / Mục tiêu nghề nghiệp</span>
            <textarea
              v-model="summary"
              rows="6"
              class="input mt-1"
              placeholder="Một vài dòng tóm tắt về bạn, mục tiêu nghề nghiệp, điểm mạnh nổi bật..."
            />
          </label>
        </div>

        <!-- ====================== STEP 3: Học vấn ====================== -->
        <div v-else-if="currentStep === 3" class="space-y-4">
          <div class="flex items-center justify-between">
            <p class="text-sm text-gray-500">
              Thêm quá trình đào tạo của bạn. Có thể bỏ trống nếu chưa phù hợp.
            </p>
            <button @click="addEducation" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
              <Plus class="w-4 h-4" /> Thêm học vấn
            </button>
          </div>
          <div v-for="(edu, i) in educations" :key="i" class="border border-gray-200 rounded-lg p-4 space-y-3">
            <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                <input v-model="edu.endYear" class="input mt-1" placeholder="2022 hoặc để trống" />
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
        </div>

        <!-- ====================== STEP 4: Kinh nghiệm ====================== -->
        <div v-else-if="currentStep === 4" class="space-y-4">
          <div class="flex items-center justify-between">
            <p class="text-sm text-gray-500">
              Thêm kinh nghiệm làm việc. Bỏ trống nếu bạn là sinh viên / mới ra trường.
            </p>
            <button @click="addExperience" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
              <Plus class="w-4 h-4" /> Thêm kinh nghiệm
            </button>
          </div>
          <div v-for="(exp, i) in experiences" :key="i" class="border border-gray-200 rounded-lg p-4 space-y-3">
            <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label class="block">
                <span class="text-sm text-gray-700">Công ty / Tổ chức</span>
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
                <input v-model="exp.endDate" class="input mt-1" placeholder="2024-06 hoặc để trống" />
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
        </div>

        <!-- ====================== STEP 5: Kỹ năng ====================== -->
        <div v-else-if="currentStep === 5" class="space-y-4">
          <div class="flex items-center justify-between">
            <p class="text-sm text-gray-500">
              Thêm các kỹ năng nổi bật và đánh giá mức độ thành thạo.
            </p>
            <span class="text-xs text-gray-500">{{ visibleSkills.length }} kỹ năng</span>
          </div>

          <!-- Quick-add input -->
          <div class="flex gap-2">
            <input
              v-model="skillDraft"
              type="text"
              class="input flex-1 min-w-0"
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
              <Plus class="w-4 h-4" /> <span class="hidden sm:inline">Thêm</span>
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
        </div>

        <!-- ====================== STEP 6: Dự án & Chứng chỉ ====================== -->
        <div v-else-if="currentStep === 6" class="space-y-6">
          <!-- Card Dự án -->
          <div class="border border-gray-200 rounded-xl p-4 sm:p-5 space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-semibold text-gray-900 text-base">Dự án</h3>
                <p class="text-xs text-gray-500 mt-0.5">
                  Các dự án cá nhân / freelance / nghiên cứu nổi bật.
                </p>
              </div>
              <button @click="addProject" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
                <Plus class="w-4 h-4" /> Thêm dự án
              </button>
            </div>
            <div v-for="(proj, i) in projects" :key="i" class="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50/40">
              <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label class="block">
                  <span class="text-sm text-gray-700">Tên dự án</span>
                  <input v-model="proj.name" class="input mt-1" />
                </label>
                <label class="block">
                  <span class="text-sm text-gray-700">Vai trò</span>
                  <input v-model="proj.role" class="input mt-1" placeholder="Tech Lead / Founder / Freelancer ..." />
                </label>
                <label class="block">
                  <span class="text-sm text-gray-700">Thời gian</span>
                  <input v-model="proj.time" class="input mt-1" placeholder="2023 — 2024" />
                </label>
                <label class="block">
                  <span class="text-sm text-gray-700">Link dự án</span>
                  <input v-model="proj.link" class="input mt-1" placeholder="https://..." />
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
          </div>

          <!-- Card Chứng chỉ -->
          <div class="border border-gray-200 rounded-xl p-4 sm:p-5 space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-semibold text-gray-900 text-base">Chứng chỉ</h3>
                <p class="text-xs text-gray-500 mt-0.5">
                  Chứng chỉ chuyên môn, chứng nhận nghề nghiệp.
                </p>
              </div>
              <button @click="addCertificate" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
                <Plus class="w-4 h-4" /> Thêm chứng chỉ
              </button>
            </div>
            <div v-for="(c, i) in certificates" :key="i" class="border border-gray-100 rounded-lg p-4 space-y-3 bg-gray-50/40">
              <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <label class="block sm:col-span-2 lg:col-span-2">
                  <span class="text-sm text-gray-700">Tên chứng chỉ</span>
                  <input v-model="c.name" class="input mt-1" />
                </label>
                <label class="block sm:col-span-2 lg:col-span-1">
                  <span class="text-sm text-gray-700">Năm</span>
                  <input v-model="c.date" class="input mt-1" placeholder="2023" />
                </label>
                <label class="block sm:col-span-2 lg:col-span-3">
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
          </div>
        </div>

        <!-- ====================== STEP 7: Chọn mẫu & Hoàn tất ====================== -->
        <div v-else-if="currentStep === 7" class="space-y-5">
          <p class="text-sm text-gray-500">
            Chọn mẫu CV phù hợp với phong cách của bạn. Có thể xem trước trước khi tạo.
          </p>

          <!-- Template picker — giữ nguyên logic 5 template -->
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
              <div
                class="relative aspect-[210/297] overflow-hidden border-2 rounded-xl transition-colors"
                :class="templateId === tpl.id
                  ? 'border-gray-900'
                  : 'border-stone-200 group-hover:border-stone-400'"
                style="background: linear-gradient(135deg, #f5f5f4 0%, #fafaf9 50%, #fef3c7 140%)"
              >
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

                <div
                  v-if="templateId === tpl.id"
                  class="absolute top-2 right-2 w-7 h-7 bg-gray-900 text-white rounded-full inline-flex items-center justify-center shadow-lg ring-2 ring-white z-10 pointer-events-none"
                >
                  <Check class="w-3.5 h-3.5" />
                </div>
              </div>

              <div class="px-1 pt-2 pb-1">
                <p class="font-semibold text-xs text-gray-900">{{ tpl.label }}</p>
                <p class="text-[10px] text-gray-500 mt-0.5 line-clamp-2 leading-tight">
                  {{ tpl.desc }}
                </p>
              </div>
            </button>
          </div>

          <!-- Action row: Xem trước + Tạo CV -->
          <div class="flex flex-col sm:flex-row gap-2.5 pt-2">
            <button
              type="button"
              class="btn-secondary inline-flex items-center justify-center gap-2 h-11 px-4 text-sm font-medium"
              @click="openPreview"
            >
              <Eye class="w-4 h-4" /> Xem trước CV
            </button>
          </div>
        </div>

        <!-- ============ Navigation footer (Back / Next / Create) ============ -->
        <footer class="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-gray-200">
          <!-- Back / Cancel -->
          <button
            v-if="!isFirstStep"
            type="button"
            class="btn-secondary inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium"
            @click="previousStep"
          >
            <ChevronLeft class="w-4 h-4" /> Quay lại
          </button>
          <button
            v-else
            type="button"
            class="btn-secondary inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium"
            @click="cancelWizard"
          >
            <X class="w-4 h-4" /> Hủy
          </button>

          <!-- Next / Submit -->
          <button
            v-if="!isLastStep"
            type="button"
            class="inline-flex items-center gap-1.5 h-10 px-5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition text-sm font-semibold"
            @click="nextStep"
          >
            Tiếp tục <ChevronRight class="w-4 h-4" />
          </button>
          <button
            v-else
            type="button"
            class="inline-flex items-center gap-1.5 h-10 px-5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isSaving"
            @click="handleSave"
          >
            <Loader2 v-if="isSaving" class="w-4 h-4 animate-spin" />
            <Check v-else class="w-4 h-4" />
            {{ isSaving ? 'Đang tạo CV...' : 'Tạo CV' }}
          </button>
        </footer>
      </section>
    </template>

    <!-- ============================================================
         MODE 2: UPLOAD — KHÔNG áp dụng wizard, giữ nguyên flow cũ
         ============================================================ -->
    <template v-else>
      <section class="card">
        <header class="pb-4 mb-5 border-b border-gray-200">
          <h2 class="font-semibold text-gray-900 text-base sm:text-lg">Upload CV của bạn</h2>
          <p class="text-sm text-gray-500 mt-1">
            Hỗ trợ PDF, DOCX, DOC, JPG, PNG. Tối đa 10MB.
          </p>
        </header>

        <!-- Drop zone — bigger padding ở lg+ để fill card rộng -->
        <div
          v-if="!uploadFile"
          class="relative border-2 border-dashed rounded-xl p-8 sm:p-12 lg:p-16 text-center transition cursor-pointer"
          :class="isDragging ? 'border-gray-400 bg-gray-100' : 'border-gray-300 hover:border-gray-400 bg-gradient-to-b from-gray-50/60 to-white'"
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
          <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white ring-1 ring-gray-200 shadow-sm inline-flex items-center justify-center mx-auto mb-4">
            <FileUp class="w-7 h-7 sm:w-8 sm:h-8 text-gray-500" />
          </div>
          <p class="text-sm sm:text-base text-gray-700">
            <span class="text-gray-900 font-semibold">Chọn file</span> hoặc kéo thả vào đây
          </p>
          <p class="text-xs text-gray-500 mt-1.5">PDF, DOCX, DOC, JPG, PNG — tối đa 10MB</p>
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

        <!-- Format chips + processing steps — fill khoảng trống phía dưới
             card để trang không bị trống trên màn rộng. -->
        <div class="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <!-- Định dạng hỗ trợ -->
          <div class="rounded-xl bg-gray-50/70 ring-1 ring-gray-200/70 p-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
              Định dạng hỗ trợ
            </p>
            <div class="flex flex-wrap gap-1.5">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white ring-1 ring-gray-200 text-xs font-medium text-gray-700">
                <FileText class="w-3.5 h-3.5 text-red-500" /> PDF
              </span>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white ring-1 ring-gray-200 text-xs font-medium text-gray-700">
                <FileText class="w-3.5 h-3.5 text-blue-500" /> DOCX
              </span>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white ring-1 ring-gray-200 text-xs font-medium text-gray-700">
                <FileText class="w-3.5 h-3.5 text-blue-400" /> DOC
              </span>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white ring-1 ring-gray-200 text-xs font-medium text-gray-700">
                <FileText class="w-3.5 h-3.5 text-emerald-500" /> JPG
              </span>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white ring-1 ring-gray-200 text-xs font-medium text-gray-700">
                <FileText class="w-3.5 h-3.5 text-emerald-500" /> PNG
              </span>
            </div>
            <p class="text-[11px] text-gray-500 mt-3 leading-relaxed">
              File PDF/DOCX cho kết quả parse tốt nhất. Ảnh CV (JPG/PNG) chỉ nên dùng khi không có bản text.
            </p>
          </div>

          <!-- Các bước xử lý sau upload -->
          <div class="rounded-xl bg-gray-50/70 ring-1 ring-gray-200/70 p-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
              Sau khi upload sẽ có
            </p>
            <ol class="space-y-2.5">
              <li class="flex items-start gap-2.5">
                <span class="shrink-0 w-5 h-5 rounded-full bg-gray-900 text-white inline-flex items-center justify-center text-[10px] font-bold">1</span>
                <p class="text-xs text-gray-700 leading-relaxed">
                  File được lưu an toàn trên storage.
                </p>
              </li>
              <li class="flex items-start gap-2.5">
                <span class="shrink-0 w-5 h-5 rounded-full bg-gray-900 text-white inline-flex items-center justify-center text-[10px] font-bold">2</span>
                <p class="text-xs text-gray-700 leading-relaxed">
                  AI phân tích nội dung và chấm điểm CV (có thể mất 5–30 giây).
                </p>
              </li>
              <li class="flex items-start gap-2.5">
                <span class="shrink-0 w-5 h-5 rounded-full bg-gray-900 text-white inline-flex items-center justify-center text-[10px] font-bold">3</span>
                <p class="text-xs text-gray-700 leading-relaxed">
                  CV xuất hiện trong danh sách, sẵn sàng để ứng tuyển.
                </p>
              </li>
            </ol>
          </div>
        </div>

        <!-- Footer: quota info + actions. Button đưa VÀO card footer thay vì tách rời -->
        <footer class="mt-6 pt-4 border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <p
            class="text-xs inline-flex items-center gap-1.5"
            :class="hasUploadQuota ? 'text-gray-500' : 'text-amber-700'"
          >
            <span class="w-1.5 h-1.5 rounded-full" :class="hasUploadQuota ? 'bg-emerald-500' : 'bg-amber-500'" />
            <span>{{ hasUploadQuota
              ? 'Bạn còn lượt upload CV trong tháng này.'
              : 'Đã hết lượt upload — nâng cấp gói để tiếp tục.' }}</span>
          </p>
          <div class="flex items-center gap-2 justify-end">
            <button
              type="button"
              class="btn-secondary h-10 px-4 text-sm font-medium"
              @click="cancelWizard"
            >
              Hủy
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-2 h-10 px-4 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isSaving || !hasUploadQuota"
              :title="!hasUploadQuota ? uploadQuotaTooltip : undefined"
              @click="handleSave"
            >
              <Loader2 v-if="isSaving" class="w-4 h-4 animate-spin" />
              {{ isSaving ? 'Đang lưu...' : 'Upload & Lưu' }}
            </button>
          </div>
        </footer>
      </section>
    </template>
  </div>

  <!-- ============================================================
       PREVIEW MODAL — overlay full màn hình (giữ nguyên 100%)
       ============================================================ -->
  <Teleport to="body">
    <div
      v-if="previewOpen"
      class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2 sm:p-4"
      @click.self="closePreview"
    >
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[95vh] sm:max-h-[90vh] flex flex-col">
        <header class="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex items-center justify-between gap-2 sm:gap-4 flex-wrap">
          <h2 class="font-semibold text-gray-900 text-sm sm:text-base shrink-0">Xem trước CV</h2>
          <!-- Switch template trong modal preview (chỉ direct mode). Trên mobile
               chỉ hiện số (1..5) để vừa 5 nút trong 1 hàng ngang. -->
          <div class="inline-flex rounded-lg border border-gray-300 p-0.5 sm:p-1 overflow-x-auto">
            <button
              v-for="tpl in TEMPLATES"
              :key="tpl.id"
              type="button"
              @click="previewTemplateId = tpl.id"
              class="px-2.5 sm:px-3 py-1 text-xs rounded-md transition shrink-0"
              :class="previewTemplateId === tpl.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'"
            >
              <span class="sm:hidden">{{ tpl.id }}</span>
              <span class="hidden sm:inline">{{ tpl.label }}</span>
            </button>
          </div>
          <button class="text-gray-400 hover:text-gray-600 p-1 shrink-0" @click="closePreview" aria-label="Đóng">
            <X class="w-5 h-5" />
          </button>
        </header>
        <div class="flex-1 overflow-y-auto bg-gray-100 p-3 sm:p-6">
          <div class="bg-white max-w-[820px] mx-auto shadow">
            <CVTemplateRenderer :template-id="previewTemplateId" :data="cvData" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
