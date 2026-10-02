<script setup lang="ts">
/**
 * CvBuilderEditor — component editor CV dạng split-view (không phụ thuộc route).
 *
 * Layout: trái = live preview sticky (CvPreviewPane — switch 7 mẫu + toggle
 * EN/VI), phải = form 1 trang cuộn theo mục + save bar sticky bottom.
 * Dùng chung cho CREATE lẫn EDIT:
 *   - create: `cvId` không truyền → form trống, save = POST /cvs/direct.
 *   - edit:   `cvId` truyền vào → GET /cvs/:cvId + prefill, save = PATCH.
 *
 * Component KHÔNG đụng router/store-nav: điều hướng qua events
 *   - `saved`  : lưu thành công (create hoặc update) — view tự navigate.
 *   - `cancel` : user bấm "Quay lại danh sách".
 * Toast (global store) vẫn emit trực tiếp để feedback xuyên navigation.
 *
 * Deep-link "Dùng mẫu này" (lightbox MyResumesView): view parse query
 * `?templateId=` + `?lang=` rồi truyền qua props `initialTemplateId` /
 * `initialLanguage` — watch để cover component-reuse giữa 2 URL.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  Plus,
  Trash2,
  Eye,
  Loader2,
  Check,
  Upload,
  X,
  ChevronDown,
} from 'lucide-vue-next';
import { useSkillsStore } from '@stores/skills';
import { useCvStore } from '@stores/cv';
import { useUploadStore } from '@stores/upload';
import { useToastStore } from '@stores/toast';
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue';
import CvPreviewPane from '@components/cv/builder/CvPreviewPane.vue';
import CvFormSection from '@components/cv/builder/CvFormSection.vue';
import { clampTemplateId, CV_TEMPLATE_META } from '@/utils/cvTemplates';
import type { CvLanguage } from '@/utils/cvLabels';
import type { Skill } from '@/types/skills';
import type {
  Cv,
  CvRenderData,
  CreateDirectCvInput,
  UpdateDirectCvInput,
} from '@/types/cv';

/* ============================================================================
 * Form interfaces (direct mode) — giữ nguyên, không đổi shape.
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

const props = withDefaults(
  defineProps<{
    /** CV đang sửa (edit mode). Null/undefined/rỗng = create mode. */
    cvId?: string | null;
    /** Mẫu khởi tạo ở create mode — từ query `?templateId=` của luồng
     *  "Dùng mẫu này". Bỏ qua khi edit (prefill theo cv.templateId). */
    initialTemplateId?: number;
    /** Ngôn ngữ tiêu đề khởi tạo — từ query `?lang=` của lightbox. */
    initialLanguage?: CvLanguage;
  }>(),
  {
    cvId: null,
    initialTemplateId: 1,
    initialLanguage: 'en',
  },
);

const emit = defineEmits<{
  /** Lưu thành công (create hoặc update) — view điều hướng về list. */
  saved: [];
  /** User bấm "Quay lại danh sách". */
  cancel: [];
}>();

const skillsStore = useSkillsStore();
const cvStore = useCvStore();
const uploadStore = useUploadStore();
const toast = useToastStore();

/** Error từ cv store — message BE đã được dịch qua cvStore.setError. */
const cvStoreError = computed<string | null>(() => cvStore.error);

/* ============================================================================
 * Dual-mode: 'create' | 'edit' — theo prop cvId.
 * Edit: GET /cvs/:cvId + prefill; save = PATCH (BE chỉ accept source='direct'
 * qua PATCH — xem cv.service.ts update()).
 * ==========================================================================*/
const isEditMode = computed<boolean>(() => !!props.cvId);

/** CV đang edit (loaded từ API). Null cho tới khi fetch xong hoặc nếu lỗi. */
const editingCv = ref<Cv | null>(null);
/** Lỗi khi load CV (CV không tồn tại / không phải direct / network). */
const loadError = ref<string | null>(null);

/* ============================================================================
 * Edit-mode load + prefill
 *
 * Abort guard — AbortController per fetch → abort request cũ trước khi tạo
 * mới (race fix khi cvId đổi nhanh); isComponentMounted + onUnmounted →
 * response trả về SAU unmount không set state lên component đã destroy.
 * ==========================================================================*/
const isLoadingCv = ref(false);

/** Race + leak state — KHÔNG exposed ra ngoài. */
let activeController: AbortController | null = null;
let isComponentMounted = true;
onUnmounted(() => {
  isComponentMounted = false;
  activeController?.abort();
});

const prefillFromCv = (cv: Cv): void => {
  const data = (cv.parsedData ?? {}) as Record<string, unknown>;
  // personal
  personal.value = {
    fullName: stringField(data, 'name'),
    position: titleFor(data, cv),
    email: stringField(data, 'email'),
    phone: stringField(data, 'phone'),
    address: stringField(data, 'address'),
    facebook: stringField(data, 'facebook'),
    linkedin: stringField(data, 'linkedin'),
    portfolio: stringField(data, 'portfolio'),
    github: stringField(data, 'github'),
    avatarUrl: stringField(data, 'avatarUrl'),
  };
  templateId.value = cv.templateId ?? 1;
  summary.value = stringField(data, 'summary');
  // education
  const edu = (data.education as Education[] | undefined) ?? [];
  educations.value = edu.length
    ? edu.map((e) => ({
        school: e.school ?? '',
        major: e.major ?? '',
        startYear: e.startYear !== undefined && e.startYear !== null ? String(e.startYear) : '',
        endYear: e.endYear !== undefined && e.endYear !== null ? String(e.endYear) : '',
        description: e.description ?? '',
      }))
    : [{ school: '', major: '', startYear: '', endYear: '', description: '' }];
  // experience
  const exp = (data.experience as Experience[] | undefined) ?? [];
  experiences.value = exp.length
    ? exp.map((e) => ({
        company: e.company ?? '',
        position: e.position ?? '',
        startDate: e.startDate ?? '',
        endDate: e.endDate ?? '',
        description: e.description ?? '',
      }))
    : [{ company: '', position: '', startDate: '', endDate: '', description: '' }];
  // skills — đọc CẢ 2 shape để tương thích data cũ (string[]) và mới ({name, level}[]).
  // Data cũ: BE lưu string[], level hiện mặc định 3 — chấp nhận mất level cho CV
  // cũ (không có nguồn để recover). Data mới: level 1-5 được giữ nguyên.
  const rawSkills = data.skills as Array<string | { name?: string; level?: number }> | undefined;
  skills.value = (rawSkills ?? []).map((s) => {
    if (typeof s === 'string') return { name: s, level: 3 };
    return { name: s.name ?? '', level: clampLevel(s.level) };
  });
  // projects — đọc role/time (BE lưu từ form). CV cũ thiếu → rỗng (form có default row trống).
  const proj = (data.projects as Project[] | undefined) ?? [];
  projects.value = proj.length
    ? proj.map((p) => ({
        name: p.name ?? '',
        role: p.role ?? '',
        time: p.time ?? '',
        description: p.description ?? '',
        link: p.link ?? '',
      }))
    : [{ name: '', role: '', time: '', description: '', link: '' }];
  // certifications
  const cert = (data.certifications as Certificate[] | undefined) ?? [];
  certificates.value = cert.length
    ? cert.map((c) => ({
        name: c.name ?? '',
        issuer: c.issuer ?? '',
        date: c.date ?? '',
      }))
    : [{ name: '', issuer: '', date: '' }];
  // interests — string[] (CV cũ có thể chứa phần tử non-string → filter).
  const rawInterests = data.interests as unknown;
  interests.value = Array.isArray(rawInterests)
    ? rawInterests.filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
    : [];
};

/** Clamp skill level 1-5 (defensive — DB có thể có giá trị ngoài range do migration). */
const clampLevel = (lvl: number | undefined): number => {
  if (typeof lvl !== 'number' || Number.isNaN(lvl)) return 3;
  return Math.max(1, Math.min(5, Math.round(lvl)));
};

const stringField = (data: Record<string, unknown>, key: string): string => {
  const v = data[key];
  return typeof v === 'string' ? v : '';
};

/** Lấy title ưu tiên parsedData.title (user-typed), fallback root cv.title. */
const titleFor = (data: Record<string, unknown>, cv: Cv): string =>
  stringField(data, 'title') || cv.title || '';

const loadCvForEdit = async (cvId: string): Promise<void> => {
  // Abort request cũ (nếu có) — race fix khi cvId đổi nhanh A → B.
  activeController?.abort();
  const ctrl = new AbortController();
  activeController = ctrl;

  // Guard unmount ngay đầu hàm — phòng edge case prop đổi giữa lúc resolve.
  if (!isComponentMounted) return;
  isLoadingCv.value = true;
  loadError.value = null;
  try {
    const cv = await cvStore.fetchDetail(cvId, { signal: ctrl.signal });
    // Guard unmount + abort SAU await — response có thể về sau unmount/abort.
    if (!isComponentMounted || ctrl.signal.aborted) return;
    if (!cv) {
      loadError.value = cvStoreError.value ?? 'Không tải được CV. Vui lòng thử lại.';
      return;
    }
    if (cv.source !== 'direct') {
      loadError.value =
        'CV upload từ file không thể chỉnh sửa trực tiếp. Vui lòng upload lại.';
      return;
    }
    editingCv.value = cv;
    prefillFromCv(cv);
  } catch (e) {
    // Filter cancel — axios throw CanceledError khi abort. KHÔNG set error state.
    const errAny = e as { name?: string; code?: string };
    if (
      errAny?.name === 'AbortError' ||
      errAny?.name === 'CanceledError' ||
      errAny?.code === 'ERR_CANCELED'
    ) {
      return;
    }
    if (!isComponentMounted || ctrl.signal.aborted) return;
    loadError.value = cvStoreError.value ?? 'Không tải được CV. Vui lòng thử lại.';
  } finally {
    // Chỉ clear loading nếu đây vẫn là request active — tránh flash loading=false
    // giữa 2 request liên tiếp (request mới sẽ set loading=true ngay).
    if (activeController === ctrl && isComponentMounted) {
      isLoadingCv.value = false;
    }
  }
};

/* ============================================================================
 * Form state — PHẢI khai báo TRƯỚC watch(cvId) (immediate fire trong setup →
 * ref chưa declare sẽ TDZ crash — xem CreateResumeView cũ).
 *
 * Create mode điền sẵn DATA MẪU — dùng chính bộ demo "Edward Smith / UI-UX
 * Designer" của các template (aiParsedData ở MyResumesView) để preview giống
 * hệt thumbnail/lightbox user vừa xem. User tự xóa/sửa thay vì gõ từ trắng.
 * Edit mode KHÔNG dùng mẫu: watch(cvId) reset về form TRỐNG rồi prefill data
 * thật từ CV — tránh lỡ lưu data mẫu vào CV có sẵn.
 * ==========================================================================*/

const createSamplePersonal = () => ({
  fullName: 'Edward Smith',
  position: 'UI/UX Designer',
  email: 'info@email.com',
  phone: '+112 456 890099',
  address: '1234, Address, 4rd/New york Street, New York City 4560',
  facebook: '',
  linkedin: 'linkedin.com/in/edwardsmith',
  portfolio: 'www.example.com',
  github: '',
  // Avatar demo — đường dẫn LOCAL (public/avatars) chỉ dùng cho PREVIEW cho
  // đỡ trống trải; payload KHÔNG gửi nó (buildDirectPayload chỉ gửi URL tuyệt
  // đối http/https, đường dẫn tương đối → undefined → nhánh .optional() BE).
  // User đổi/xóa bằng nút Chọn ảnh/Xóa như bình thường.
  avatarUrl: '/avatars/template1-portrait.jpg',
});

const createEmptyPersonal = () => ({
  fullName: '',
  position: '',
  email: '',
  phone: '',
  address: '',
  facebook: '',
  linkedin: '',
  portfolio: '',
  github: '',
  avatarUrl: '',
});

const personal = ref(isEditMode.value ? createEmptyPersonal() : createSamplePersonal());
// Create mode: khởi tạo từ prop `initialTemplateId` (deep-link "Dùng mẫu này").
// Edit mode: bỏ qua — prefillFromCv set theo cv.templateId.
const templateId = ref<number>(
  isEditMode.value ? 1 : clampTemplateId(props.initialTemplateId),
);

const previewLanguage = ref<CvLanguage>(props.initialLanguage);

const summary = ref(
  isEditMode.value
    ? ''
    : "I'm Edward Smith, Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. " +
      'Vivamus volutpat amet dolor sit id. Consectetur adipiscing elit vivamus volutpat ' +
      'libero lorem ipsum dolor. Vivamus volutpat sit id.',
);

const educations = ref<Education[]>(
  isEditMode.value
    ? [{ school: '', major: '', startYear: '', endYear: '', description: '' }]
    : [
        {
          school: 'University Name / Location',
          major: 'Degree name here',
          startYear: '2015',
          endYear: '2016',
          description: '',
        },
        {
          school: 'University Name / Location',
          major: 'Degree name here',
          startYear: '2010',
          endYear: '2015',
          description: '',
        },
      ],
);
const experiences = ref<Experience[]>(
  isEditMode.value
    ? [{ company: '', position: '', startDate: '', endDate: '', description: '' }]
    : [
        {
          company: 'Company Name / Location',
          position: 'Job position title here',
          startDate: '2024',
          endDate: '2029',
          description:
            'Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. Vivamus volutpat amet dolor sit id.\n' +
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus volutpat sit idolor.\n' +
            'Amet dolor elit dolor sit amet. Consectetur adipiscing elit vivamus.',
        },
        {
          company: 'Company Name / Location',
          position: 'Job position title here',
          startDate: '2020',
          endDate: '2024',
          description:
            'Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. Vivamus volutpat amet dolor sit id.\n' +
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus volutpat sit idolor.',
        },
      ],
);
const skills = ref<SkillRow[]>(
  isEditMode.value
    ? []
    : [
        { name: 'Graphic Design', level: 4 },
        { name: 'Project Management', level: 4 },
        { name: 'Market Research', level: 3 },
        { name: 'Branding', level: 4 },
        { name: 'UI/UX Design', level: 5 },
        { name: 'Web Design', level: 4 },
        { name: 'Web Development', level: 3 },
        { name: 'Team Development', level: 4 },
      ],
);
/** Tên kỹ năng user đang gõ trong ô quick-add. */
const skillDraft = ref('');

/** Sở thích — list string đơn giản (template render section INTERESTS). */
const interests = ref<string[]>(
  isEditMode.value
    ? []
    : ['Graphic Design', 'Project Management', 'Market Research', 'Branding', 'UI/UX Design', 'Photography'],
);
/** Tên sở thích user đang gõ trong ô quick-add. */
const interestDraft = ref('');
const projects = ref<Project[]>(
  isEditMode.value
    ? [{ name: '', role: '', time: '', description: '', link: '' }]
    : [
        {
          name: 'JobMatch VN',
          role: 'Frontend Lead',
          time: '2023 — 2024',
          description: 'Nền tảng matching việc làm cho thị trường Việt Nam.',
          link: '',
        },
      ],
);
const certificates = ref<Certificate[]>(
  isEditMode.value
    ? [{ name: '', issuer: '', date: '' }]
    : [{ name: 'Joseph Daniel', issuer: 'Position Here / Company Name', date: '2024' }],
);

/** Reset form refs về initial state (dùng khi cvId đổi để tránh dính data cũ). */
const resetFormToInitial = (): void => {
  personal.value = {
    fullName: '',
    position: '',
    email: '',
    phone: '',
    address: '',
    facebook: '',
    linkedin: '',
    portfolio: '',
    github: '',
    avatarUrl: '',
  };
  templateId.value = 1;
  summary.value = '';
  educations.value = [
    { school: '', major: '', startYear: '', endYear: '', description: '' },
  ];
  experiences.value = [
    { company: '', position: '', startDate: '', endDate: '', description: '' },
  ];
  skills.value = [];
  projects.value = [
    { name: '', role: '', time: '', description: '', link: '' },
  ];
  certificates.value = [{ name: '', issuer: '', date: '' }];
  interests.value = [];
  editingCv.value = null;
  loadError.value = null;
};

/**
 * Watch cvId — cover cả initial mount lẫn nav giữa các edit URLs (component
 * reuse). Reset form trước khi load CV mới → tránh hiện data cũ trong lúc fetch.
 *
 * ⚠️ PHẢI đặt SAU khi tất cả form refs đã khai báo (TDZ — xem comment trên).
 */
watch(
  () => props.cvId,
  (id) => {
    if (id) {
      resetFormToInitial();
      void loadCvForEdit(id);
    }
  },
  { immediate: true },
);

/**
 * Watch initial props — cover component-reuse giữa 2 URL create
 * (`/resumes/new?templateId=2` → `?templateId=5`). KHÔNG ghi đè templateId
 * khi edit mode (tránh đè giá trị vừa prefill từ cv.templateId).
 */
watch(
  () => props.initialTemplateId,
  (v) => {
    if (isEditMode.value) return;
    templateId.value = clampTemplateId(v);
  },
);
watch(
  () => props.initialLanguage,
  (v) => {
    previewLanguage.value = v;
  },
);

/* ============================================================================
 * Avatar upload — chọn file (image/, ≤5MB, folder='avatars').
 * API đi qua `uploadStore.uploadImage()` (view-layer guard fail-fast với
 * message tiếng Việt cụ thể; store guard lần 2).
 * ==========================================================================*/
const avatarInput = ref<HTMLInputElement | null>(null);

const avatarUploading = computed<boolean>(() => uploadStore.loading);
const avatarError = computed<string | null>(() => uploadStore.error);

const pickAvatar = (): void => avatarInput.value?.click();

const handleAvatarChange = async (e: Event): Promise<void> => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
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
 * View không giữ state riêng, đọc thẳng từ store.
 * ==========================================================================*/
const skillOptions = computed<Skill[]>(() => skillsStore.items);
const skillOptionsLoading = computed<boolean>(() => skillsStore.loading);
const skillOptionsError = computed<string | null>(() => skillsStore.error);

onMounted(() => {
  void skillsStore.fetchList();
});

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
 * Skills — chip-style picker.
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
 * Sở thích — chip quick-add (giống skills nhưng không có level).
 * ==========================================================================*/

const addInterest = (name: string): void => {
  const trimmed = name.trim();
  if (!trimmed) return;
  // Dedup case-insensitive — tránh user thêm 2 lần cùng 1 sở thích.
  const exists = interests.value.some(
    (i) => i.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (exists) return;
  interests.value.push(trimmed);
};

const addInterestFromDraft = (): void => {
  addInterest(interestDraft.value);
  interestDraft.value = '';
};

const removeInterest = (i: number): void => {
  interests.value.splice(i, 1);
};

/* ============================================================================
 * cvData dùng chung cho preview pane + preview modal.
 * ==========================================================================*/

const cvData = computed<CvRenderData>(() => ({
  title: personal.value.position.trim(),
  personalInfo: {
    fullName: personal.value.fullName.trim(),
    position: personal.value.position.trim(),
    email: personal.value.email.trim(),
    phone: personal.value.phone.trim(),
    /* address: template 1/6 render khối "Address / Location". dob / gender
     * BE chưa lưu → rỗng cho template tự skip qua v-if. */
    address: personal.value.address.trim(),
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
  interests: interests.value.map(i => i.trim()).filter(Boolean),
}));

/* ============================================================================
 * Build direct payload (create) — giữ nguyên, không đổi shape.
 * ==========================================================================*/

/**
 * Chuẩn hoá URL contact trước khi gửi BE — thêm `https://` nếu thiếu scheme.
 * BE validate `z.string().url()` (middleware/cv.ts) nên giá trị kiểu
 * "linkedin.com/in/edward-smith" không có scheme sẽ bị 400 INVALID_INPUT.
 * Empty → undefined (không gửi field). Đã có http(s):// → giữ nguyên.
 */
const withHttps = (url: string): string | undefined => {
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const buildDirectPayload = (): CreateDirectCvInput => {
  // Skill dedup theo name (case-insensitive) — giữ level của row xuất hiện
  // ĐẦU TIÊN. Gửi object {name, level} để BE preserve level qua round-trip.
  const seen = new Set<string>();
  const cleanSkills: Array<{ name: string; level: number }> = [];
  for (const s of skills.value) {
    const name = s.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleanSkills.push({ name, level: clampLevel(s.level) });
  }

  const cleanProjects = projects.value
    .filter(p => p.name.trim())
    .map(p => ({
      name: p.name.trim(),
      role: p.role.trim() || undefined,
      time: p.time.trim() || undefined,
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
      address: personal.value.address.trim() || undefined,
      portfolio: withHttps(personal.value.portfolio),
      github: withHttps(personal.value.github),
      linkedin: withHttps(personal.value.linkedin),
      facebook: withHttps(personal.value.facebook),
      // Avatar: chỉ gửi khi là URL TUYỆT ĐỐI (http/https) — BE zod `.url()`
      // từ chối đường dẫn tương đối (vd sample '/avatars/...' chỉ dùng cho
      // preview). Empty / relative → undefined → nhánh .optional() của BE.
      avatarUrl: /^https?:\/\//i.test(personal.value.avatarUrl.trim())
        ? personal.value.avatarUrl.trim()
        : undefined,
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
    interests: interests.value.map(i => i.trim()).filter(Boolean).length
      ? interests.value.map(i => i.trim()).filter(Boolean)
      : undefined,
  };
};

/* ============================================================================
 * Build update payload (edit) — chỉ gồm field BE PATCH nhận (xem
 * UpdateDirectCvInput). KHÔNG gửi templateId — BE update() chưa hỗ trợ
 * (xem cv.service.ts update() chỉ set title + parsedData).
 * ==========================================================================*/

const buildUpdatePayload = (): UpdateDirectCvInput => {
  const fullPayload = buildDirectPayload();
  // Tách phần parsedData (BE merge vào parsedData hiện có qua deepMerge).
  return {
    title: fullPayload.title,
    parsedData: {
      summary: fullPayload.summary,
      contact: fullPayload.contact,
      education: fullPayload.education,
      experience: fullPayload.experience,
      skills: fullPayload.skills,
      languages: fullPayload.languages,
      projects: fullPayload.projects,
      certifications: fullPayload.certifications,
      interests: fullPayload.interests,
    },
  };
};

/* ============================================================================
 * Submit — validate → create/update. Feedback qua `useToastStore` (global
 * singleton → toast vẫn hiện sau khi view navigate). Thành công → emit
 * `saved`, việc navigate là của view.
 * ==========================================================================*/

const isSaving = ref(false);

const handleSave = async () => {
  // Validate các trường bắt buộc. 4 field bắt buộc:
  //   - Họ tên, Email (đúng format), SĐT (10–15 digits) — section Thông tin cá nhân
  //   - Tiêu đề CV — section Giới thiệu
  // Thứ tự: bắt buộc trước (rỗng), format sau. Mỗi lỗi dừng ngay + scroll tới
  // đúng section + focus + select input.
  const fullName = (personal.value.fullName || '').trim();
  if (!fullName) {
    toast.warning('Vui lòng nhập họ và tên.', { title: 'Thiếu thông tin' });
    await focusSection('personal', fullNameInputRef);
    return;
  }
  const email = (personal.value.email || '').trim();
  // Regex email đơn giản — đủ dùng cho UX, không cần RFC 5322 strict.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email) {
    toast.warning('Vui lòng nhập email.', { title: 'Thiếu thông tin' });
    await focusSection('personal', emailInputRef);
    return;
  }
  if (!EMAIL_RE.test(email)) {
    toast.warning('Email chưa đúng định dạng (VD: ten@example.com).', {
      title: 'Email không hợp lệ',
    });
    await focusSection('personal', emailInputRef);
    return;
  }
  const phoneDigits = (personal.value.phone || '').replace(/[^0-9]/g, '');
  if (!phoneDigits) {
    toast.warning('Vui lòng nhập số điện thoại.', { title: 'Thiếu thông tin' });
    await focusSection('personal', phoneInputRef);
    return;
  }
  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    toast.warning(
      `Số điện thoại phải có 10–15 chữ số (hiện tại: ${phoneDigits.length}).`,
      { title: 'Số điện thoại chưa đúng' },
    );
    await focusSection('personal', phoneInputRef);
    return;
  }
  if (!personal.value.position.trim()) {
    toast.warning('Vui lòng nhập tiêu đề CV.', {
      title: 'Thiếu thông tin',
    });
    await focusSection('summary', positionInputRef);
    return;
  }
  // Avatar bắt buộc cho các mẫu có vị trí avatar trong layout (id 1, 4, 5, 6 —
  // grep avatarUrl trong templates/: T2/T3/T7 không render ảnh).
  if (templateRequiresAvatar.value && !personal.value.avatarUrl.trim()) {
    toast.warning('Mẫu CV này có vị trí ảnh đại diện. Vui lòng tải ảnh lên.', {
      title: 'Thiếu ảnh đại diện',
    });
    await focusSection('personal', avatarButtonRef);
    return;
  }
  isSaving.value = true;
  try {
    if (isEditMode.value && props.cvId) {
      // Edit flow — PATCH /cvs/:cvId. Build payload riêng (đúng shape BE).
      const updated = await cvStore.update(props.cvId, buildUpdatePayload());
      if (updated) {
        toast.success('Đã lưu thay đổi. AI đang phân tích lại CV...', {
          title: 'Cập nhật thành công',
        });
        emit('saved');
      } else {
        toast.error(cvStoreError.value ?? 'Không lưu được CV. Vui lòng thử lại.');
      }
      return;
    }
    // Create flow — POST /cvs/direct.
    const created = await cvStore.create(buildDirectPayload());
    if (created) {
      toast.success('Đã tạo CV thành công!');
      emit('saved');
    } else {
      toast.error(cvStoreError.value ?? 'Không lưu được CV. Vui lòng thử lại.');
    }
  } finally {
    isSaving.value = false;
  }
};

/* ============================================================================
 * Preview modal — overlay full màn hình (full-size 794px, không scale).
 * Pane bên trái bị scale nên nút Eye trên pane mở modal này để xem 1:1.
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

/* ============================================================================
 * Avatar-required set + focus refs cho validation.
 * ==========================================================================*/

// Template refs cho input cần focus khi validation fail. Split-view render
// mọi section cùng lúc → refs luôn mounted.
const fullNameInputRef = ref<HTMLInputElement | null>(null);
const emailInputRef = ref<HTMLInputElement | null>(null);
const phoneInputRef = ref<HTMLInputElement | null>(null);
const positionInputRef = ref<HTMLInputElement | null>(null);
const avatarButtonRef = ref<HTMLButtonElement | null>(null);

/**
 * Mẫu CV nào BẮT BUỘC có avatar. Grep `avatarUrl` trong templates/ cho thấy
 * chỉ T1/T4/T5/T6 render ảnh chân dung; T2/T3/T7 không có vị trí avatar →
 * optional. (Set cũ [1,2,4,5] sai theo cả 2 chiều.)
 */
const TEMPLATES_REQUIRING_AVATAR = new Set([1, 4, 5, 6]);
const templateRequiresAvatar = computed<boolean>(() =>
  TEMPLATES_REQUIRING_AVATAR.has(templateId.value),
);

/* ============================================================================
 * Validation — scroll tới section + flash highlight.
 * ==========================================================================*/
const SECTION_IDS = {
  personal: 'cv-section-personal',
  summary: 'cv-section-summary',
  education: 'cv-section-education',
  experience: 'cv-section-experience',
  skills: 'cv-section-skills',
  projects: 'cv-section-projects',
} as const;
type SectionKey = keyof typeof SECTION_IDS;

/* ============================================================================
 * Tabs — form dài nên chia 5 tab (nội dung v-show, refs luôn mounted nên
 * focus/select khi validate vẫn hoạt động sau khi bật đúng tab).
 * ==========================================================================*/
const FORM_TABS = [
  { id: 'profile', label: 'Cá nhân' },
  { id: 'summary', label: 'Giới thiệu' },
  { id: 'career', label: 'Học vấn & Kinh nghiệm' },
  { id: 'skills', label: 'Kỹ năng & Sở thích' },
  { id: 'projects', label: 'Dự án & Chứng chỉ' },
] as const;
type FormTabId = (typeof FORM_TABS)[number]['id'];

const activeTab = ref<FormTabId>('profile');

/** Section nào thuộc tab nào — dùng khi validate lỗi cần bật đúng tab. */
const SECTION_TAB: Record<SectionKey, FormTabId> = {
  personal: 'profile',
  summary: 'summary',
  education: 'career',
  experience: 'career',
  skills: 'skills',
  projects: 'projects',
};

const highlightSection = ref<SectionKey | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

const focusSection = async (
  key: SectionKey,
  // HTMLElement (input, button, textarea…) — avatar "Chọn ảnh" là <button>.
  refToFocus?: { value: HTMLElement | null } | null,
): Promise<void> => {
  // Section nằm trong 1 tab — phải bật đúng tab TRƯỚC rồi mới scroll
  // (display:none thì scrollIntoView vô hiệu).
  activeTab.value = SECTION_TAB[key];
  await nextTick();
  document.getElementById(SECTION_IDS[key])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Flash viền section — tự tắt sau 1.6s (timer reset nếu lỗi kế tiếp đến sớm).
  highlightSection.value = key;
  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    highlightSection.value = null;
  }, 1600);
  await nextTick();
  // Đợi thêm 1 frame cho scroll settle trước khi focus.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const el = refToFocus?.value;
  if (el) {
    el.focus({ preventScroll: true });
    // `select()` chỉ tồn tại trên input/textarea — optional chain skip cho button.
    (el as HTMLInputElement).select?.();
  }
};

/** Mobile <lg: preview stack trên form — toggle đóng/mở (default mở). */
const mobilePreviewOpen = ref(true);
</script>

<template>
  <!-- KHÔNG đặt overflow-auto ở root: sticky preview phụ thuộc window scroll.
       Không có padding-bottom: save bar sticky bottom-0 phải ăn sát mép dưới
       viewport (kể cả khi cuộn hết nội dung). -->
  <Transition name="builder-page bg-blue-500" appear>
    <div>
      <!-- ==================== Loading state khi đang load CV để edit ==================== -->
      <div
        v-if="isEditMode && isLoadingCv"
        class="card flex items-center justify-center gap-3 py-16"
        role="status"
        aria-live="polite"
      >
        <Loader2 class="w-5 h-5 text-[#5b4eea] animate-spin" />
        <p class="text-sm text-gray-600">Đang tải CV...</p>
      </div>

      <!-- ==================== Load error ==================== -->
      <div
        v-else-if="isEditMode && loadError"
        class="card border-red-200 bg-red-50/50 text-center py-10 space-y-3"
        role="alert"
      >
        <p class="text-sm text-red-700 font-medium">{{ loadError }}</p>
        <button
          type="button"
          class="btn-secondary text-sm"
          @click="emit('cancel')"
        >
          Quay lại danh sách CV
        </button>
      </div>

      <!-- ==================== GRID: preview (trái, sticky) + form (phải, cuộn) ==================== -->
      <div v-else class="grid items-start gap-5 lg:grid-cols-[minmax(480px,65fr)_minmax(0,35fr)]">
        <!-- C1 — PREVIEW: DOM trước để mobile stack lên trên form -->
        <aside class="min-w-0">
          <!-- Mobile: nút toggle preview (chỉ <lg) -->
          <button
            type="button"
            class="btn-secondary mb-3 inline-flex w-full items-center justify-center gap-1.5 text-sm font-medium lg:hidden"
            :aria-expanded="mobilePreviewOpen"
            @click="mobilePreviewOpen = !mobilePreviewOpen"
          >
            <Eye class="h-4 w-4" />
            {{ mobilePreviewOpen ? 'Ẩn xem trước' : 'Xem trước CV' }}
            <ChevronDown class="h-4 w-4 transition-transform" :class="mobilePreviewOpen ? 'rotate-180' : ''" />
          </button>

          <div :class="mobilePreviewOpen ? 'block' : 'hidden'" class="lg:block">
            <div class="lg:sticky lg:top-6">
              <div class="max-h-[60vh] overflow-y-auto lg:max-h-none">
                <CvPreviewPane
                  v-model:template-id="templateId"
                  v-model:language="previewLanguage"
                  :data="cvData"
                  @expand="openPreview"
                />
              </div>
            </div>
          </div>
        </aside>

        <!-- C2 — FORM: tab bar nền trong suốt (nổi trên backdrop dim), nội dung
             các tab giữ card trắng -->
        <div class="cv-form-compact min-w-0">
          <!-- ============ Tab bar (trong suốt) ============ -->
          <div id="cv-form-tabs" class="scrollbar-hide mb-2 flex items-center gap-1 overflow-x-auto">
            <button
              v-for="t in FORM_TABS"
              :key="t.id"
              type="button"
              class="h-7 shrink-0 rounded-md px-2.5 text-[11px] font-semibold transition-colors"
              :class="activeTab === t.id
                ? 'bg-[#5b4eea] text-white shadow-sm'
                : 'border border-[#e6e7e9] text-slate-600 hover:bg-slate-50'"
              :aria-pressed="activeTab === t.id"
              @click="activeTab = t.id"
            >
              {{ t.label }}
            </button>
          </div>

          <div class="rounded-b-[14px] border border-[#e6e7e9] bg-white mt-5">
          <!-- TAB: Cá nhân -->
          <div v-show="activeTab === 'profile'" class="[&>section+section]:border-t [&>section+section]:border-[#e6e7e9]">
          <!-- ==================== Thông tin cá nhân ==================== -->
          <CvFormSection
            flat
            id="cv-section-personal"
            title="Thông tin cá nhân"
            description="Cho nhà tuyển dụng biết bạn là ai"
            :highlight="highlightSection === 'personal'"
          >
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label class="block">
                <span class="text-sm text-gray-700">
                  Họ và tên <span class="text-red-500">*</span>
                </span>
                <input
                  ref="fullNameInputRef"
                  v-model="personal.fullName"
                  class="input mt-1"
                  placeholder="Nguyễn Văn A"
                />
              </label>
              <label class="block">
                <span class="text-sm text-gray-700">
                  Email <span class="text-red-500">*</span>
                </span>
                <input
                  ref="emailInputRef"
                  v-model="personal.email"
                  type="email"
                  pattern="[^\s@]+@[^\s@]+\.[^\s@]+"
                  class="input mt-1"
                  placeholder="email@example.com"
                />
              </label>
              <label class="block">
                <span class="text-sm text-gray-700">
                  Số điện thoại <span class="text-red-500">*</span>
                </span>
                <input
                  ref="phoneInputRef"
                  v-model="personal.phone"
                  type="tel"
                  inputmode="numeric"
                  pattern="[0-9]{10,15}"
                  minlength="10"
                  maxlength="15"
                  class="input mt-1"
                  placeholder="VD: 0912345678"
                  @input="personal.phone = (personal.phone || '').replace(/[^0-9]/g, '')"
                />
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
                <span class="text-sm text-gray-700">Địa chỉ</span>
                <input v-model="personal.address" class="input mt-1" placeholder="VD: 123 Đường ABC, Quận 1, TP. Hồ Chí Minh" />
                <span class="text-xs text-gray-500 mt-1 block">Hiển thị trong khối liên hệ của một số mẫu (1, 2, 6).</span>
              </label>
              <label class="block sm:col-span-2 lg:col-span-3">
                <span class="text-sm text-gray-700">
                  Ảnh đại diện
                  <span
                    v-if="templateRequiresAvatar"
                    class="text-red-500"
                    title="Mẫu CV này có vị trí ảnh đại diện — bắt buộc tải ảnh lên"
                  >*</span>
                </span>
                <div class="flex items-center gap-3 mt-1 flex-wrap">
                  <div
                    v-if="personal.avatarUrl"
                    class="w-14 h-14 rounded-full overflow-hidden border border-gray-200 shrink-0 bg-gray-50"
                  >
                    <img :src="personal.avatarUrl" alt="Avatar" class="w-full h-full object-cover" />
                  </div>
                  <div
                    v-else
                    class="w-14 h-14 rounded-full border border-dashed shrink-0 flex items-center justify-center text-xs"
                    :class="templateRequiresAvatar ? 'border-red-400 bg-red-50 text-red-500' : 'border-gray-300 text-gray-400'"
                  >
                    Chưa có
                  </div>
                  <button
                    ref="avatarButtonRef"
                    type="button"
                    class="btn-secondary text-sm inline-flex items-center gap-2"
                    :class="templateRequiresAvatar && !personal.avatarUrl ? 'ring-2 ring-red-300 ring-offset-1' : ''"
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
          </CvFormSection>

          </div>

          <!-- TAB: Giới thiệu -->
          <div v-show="activeTab === 'summary'" class="[&>section+section]:border-t [&>section+section]:border-[#e6e7e9]">
          <!-- ==================== Giới thiệu ==================== -->
          <CvFormSection
            flat
            id="cv-section-summary"
            title="Giới thiệu"
            description="Tiêu đề CV và mục tiêu nghề nghiệp"
            :highlight="highlightSection === 'summary'"
          >
            <div class="space-y-4">
              <label class="block">
                <span class="text-sm text-gray-700">
                  Tiêu đề CV / Vị trí ứng tuyển <span class="text-red-500">*</span>
                </span>
                <input
                  ref="positionInputRef"
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
          </CvFormSection>

          </div>

          <!-- TAB: Học vấn & Kinh nghiệm -->
          <div v-show="activeTab === 'career'" class="[&>section+section]:border-t [&>section+section]:border-[#e6e7e9]">
          <!-- ==================== Học vấn ==================== -->
          <CvFormSection
            flat
            id="cv-section-education"
            title="Học vấn"
            description="Quá trình đào tạo và bằng cấp"
            :highlight="highlightSection === 'education'"
          >
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <p class="text-sm text-gray-500">
                  Thêm quá trình đào tạo của bạn. Có thể bỏ trống nếu chưa phù hợp.
                </p>
                <button @click="addEducation" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
                  <Plus class="w-4 h-4" /> Thêm học vấn
                </button>
              </div>
              <div v-for="(edu, i) in educations" :key="i" class="rounded-[14px] border border-[#e6e7e9] p-3 space-y-3">
                <div class="grid sm:grid-cols-2 gap-2.5">
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
                    <Trash2 class="w-4 h-4" /> 
                  </button>
                </div>
              </div>
            </div>
          </CvFormSection>

          <!-- ==================== Kinh nghiệm ==================== -->
          <CvFormSection
            flat
            id="cv-section-experience"
            title="Kinh nghiệm"
            description="Công ty và vị trí đã làm việc"
            :highlight="highlightSection === 'experience'"
          >
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <p class="text-sm text-gray-500">
                  Thêm kinh nghiệm làm việc. Bỏ trống nếu bạn là sinh viên / mới ra trường.
                </p>
                <button @click="addExperience" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
                  <Plus class="w-4 h-4" /> Thêm kinh nghiệm
                </button>
              </div>
              <div v-for="(exp, i) in experiences" :key="i" class="rounded-[14px] border border-[#e6e7e9] p-3 space-y-3">
                <div class="grid sm:grid-cols-2 gap-2.5">
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
                    <Trash2 class="w-4 h-4" /> 
                  </button>
                </div>
              </div>
            </div>
          </CvFormSection>

          </div>

          <!-- TAB: Kỹ năng & Sở thích -->
          <div v-show="activeTab === 'skills'" class="[&>section+section]:border-t [&>section+section]:border-[#e6e7e9]">
          <!-- ==================== Kỹ năng ==================== -->
          <CvFormSection
            flat
            id="cv-section-skills"
            title="Kỹ năng"
            description="Những kỹ năng nổi bật của bạn"
            :highlight="highlightSection === 'skills'"
          >
            <div class="space-y-4">
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
                  class="px-2.5 py-0.5 text-xs rounded-full border border-gray-300 bg-white text-gray-700 hover:border-[#5b4eea]/40 hover:text-[#5b4eea] hover:bg-[#f4f2ff] transition"
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
                  <span class="font-medium text-[#5b4eea]">{{ s.name }}</span>

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
                        :class="n <= s.level ? 'bg-[#4a3ed1]' : 'bg-gray-300'"
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
          </CvFormSection>

          <!-- ==================== Sở thích ==================== -->
          <CvFormSection
            flat
            id="cv-section-interests"
            title="Sở thích"
            description="Điểm cộng thêm cho hồ sơ của bạn"
          >
            <div class="space-y-4">
              <!-- Quick-add input -->
              <div class="flex gap-2">
                <input
                  v-model="interestDraft"
                  type="text"
                  class="input flex-1 min-w-0"
                  placeholder="Gõ sở thích rồi nhấn Enter..."
                  @keydown.enter.prevent="addInterestFromDraft"
                />
                <button
                  type="button"
                  class="btn-secondary inline-flex items-center gap-1 text-sm shrink-0"
                  :disabled="!interestDraft.trim()"
                  @click="addInterestFromDraft"
                >
                  <Plus class="w-4 h-4" /> <span class="hidden sm:inline">Thêm</span>
                </button>
              </div>

              <!-- Interest chips -->
              <ul v-if="interests.length" class="flex flex-wrap gap-2">
                <li
                  v-for="(it, i) in interests"
                  :key="`${it}-${i}`"
                  class="inline-flex items-center gap-2 pl-3 pr-1 py-1 rounded-full bg-gray-100 border border-gray-200 text-sm"
                >
                  <span class="font-medium text-[#5b4eea]">{{ it }}</span>
                  <button
                    type="button"
                    class="ml-1 w-5 h-5 inline-flex items-center justify-center rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50"
                    :title="`Xóa ${it}`"
                    @click="removeInterest(i)"
                  >
                    <X class="w-3.5 h-3.5" />
                  </button>
                </li>
              </ul>
              <p v-else class="text-xs text-gray-500">
                Chưa có sở thích nào. Gõ vào ô phía trên để thêm.
              </p>
            </div>
          </CvFormSection>

          </div>

          <!-- TAB: Dự án & Chứng chỉ -->
          <div v-show="activeTab === 'projects'" class="[&>section+section]:border-t [&>section+section]:border-[#e6e7e9]">
          <!-- ==================== Dự án & Chứng chỉ ==================== -->
          <CvFormSection
            flat
            id="cv-section-projects"
            title="Dự án & Chứng chỉ"
            description="Các dự án cá nhân và chứng chỉ chuyên môn"
            :highlight="highlightSection === 'projects'"
          >
            <div class="space-y-6">
              <!-- Card Dự án -->
              <div class="rounded-[14px] border border-[#e6e7e9] p-3.5 sm:p-4 space-y-4">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="font-semibold text-slate-900 text-base">Dự án</h3>
                    <p class="text-xs text-gray-500 mt-0.5">
                      Các dự án cá nhân / freelance / nghiên cứu nổi bật.
                    </p>
                  </div>
                  <button @click="addProject" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
                    <Plus class="w-4 h-4" /> Thêm dự án
                  </button>
                </div>
                <div v-for="(proj, i) in projects" :key="i" class="rounded-lg border border-[#e6e7e9]/70 bg-gray-50/40 p-3 space-y-3">
                  <div class="grid sm:grid-cols-2 gap-2.5">
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
              <div class="rounded-[14px] border border-[#e6e7e9] p-3.5 sm:p-4 space-y-4">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="font-semibold text-slate-900 text-base">Chứng chỉ</h3>
                    <p class="text-xs text-gray-500 mt-0.5">
                      Chứng chỉ chuyên môn, chứng nhận nghề nghiệp.
                    </p>
                  </div>
                  <button @click="addCertificate" type="button" class="btn-secondary inline-flex items-center gap-1 text-sm">
                    <Plus class="w-4 h-4" /> Thêm chứng chỉ
                  </button>
                </div>
                <div v-for="(c, i) in certificates" :key="i" class="rounded-lg border border-[#e6e7e9]/70 bg-gray-50/40 p-3 space-y-3">
                  <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
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
          </CvFormSection>
          </div>
          </div>

          <!-- ============ SAVE BAR — pill nổi, sticky bottom ============ -->
          <div
            class="sticky bottom-0 z-10 mt-4 flex items-center justify-between gap-3 border border-[#e6e7e9] bg-white/90 shadow-lg shadow-slate-900/10 backdrop-blur"
          >
            <button
              type="button"
              class="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-100 "
              @click="emit('cancel')"
            >
              Quay lại danh sách
            </button>
            <button
              type="button"
              class="inline-flex h-9 items-center gap-1.5 bg-[#5b4eea] px-5 text-sm font-semibold text-white transition hover:bg-[#4a3ed1] disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="isSaving"
              @click="handleSave"
            >
              <Loader2 v-if="isSaving" class="w-4 h-4 animate-spin" />
              <Check v-else class="w-4 h-4" />
              {{
                isSaving
                  ? (isEditMode ? 'Đang lưu...' : 'Đang tạo CV...')
                  : (isEditMode ? 'Lưu thay đổi' : 'Tạo CV')
              }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>

  <!-- ============================================================
       PREVIEW MODAL — overlay full màn hình (full-size, 7 mẫu + language)
       ============================================================ -->
  <Teleport to="body">
    <div
      v-if="previewOpen"
      class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      @click.self="closePreview"
    >
      <div class="bg-white rounded-2xl shadow-2xl shadow-slate-900/20 w-full max-w-5xl max-h-[95vh] sm:max-h-[92vh] flex flex-col ring-1 ring-slate-900/5">
        <header class="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between gap-2 sm:gap-4 flex-wrap">
          <h2 class="font-semibold text-slate-900 text-sm sm:text-base shrink-0">Xem trước CV</h2>
          <!-- Switch template trong modal preview — đủ 7 mẫu (CV_TEMPLATE_META). -->
          <div class="scrollbar-hide inline-flex rounded-lg border border-slate-200 p-0.5 sm:p-1 overflow-x-auto">
            <button
              v-for="tpl in CV_TEMPLATE_META"
              :key="tpl.id"
              type="button"
              :title="tpl.desc"
              @click="previewTemplateId = tpl.id"
              class="px-2.5 sm:px-3 py-1 text-xs rounded-md transition shrink-0"
              :class="previewTemplateId === tpl.id ? 'bg-[#5b4eea] text-white' : 'text-slate-600 hover:bg-slate-100'"
            >
              <span class="sm:hidden">{{ tpl.id }}</span>
              <span class="hidden sm:inline">{{ tpl.name }}</span>
            </button>
          </div>
          <button class="text-slate-400 hover:text-slate-600 p-1 shrink-0" @click="closePreview" aria-label="Đóng">
            <X class="w-5 h-5" />
          </button>
        </header>
        <div class="flex-1 overflow-y-auto bg-slate-50/60 p-3 sm:p-6">
          <div class="bg-white max-w-[820px] mx-auto shadow-lg rounded-lg ring-1 ring-slate-900/5">
            <CVTemplateRenderer
              :template-id="previewTemplateId"
              :data="cvData"
              :language="previewLanguage"
            />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>


<style scoped>
/* Appear transition — fade + trượt nhẹ khi component mount (tiếp nối luồng
   từ lightbox "Dùng mẫu này"). */
.builder-page-enter-active {
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}
.builder-page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

/* Form compact — input + label nhỏ lại để cột form gọn, nhường không gian
   cho preview pane bên trái (scale preview tỉ lệ theo chiều rộng pane).
   Nền form trong suốt (backdrop dim) → input tự mang nền trắng để chữ
   vẫn đọc được. */
.cv-form-compact :deep(.input) {
  padding: 5px 10px;
  font-size: 13px;
  background-color: #fff;
}
/* Chỉ target span TIÊU ĐỀ của label (first-child) — không đụng span hint
   (text-xs) nằm sau input để hint không bị phóng to/lệch cỡ. */
.cv-form-compact :deep(label > span:first-child) {
  font-size: 12.5px;
}
</style>
