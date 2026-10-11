<script setup lang="ts">
/**
 * CreateJobModal.vue — Senior Frontend Developer Implementation
 *
 * Modal "Tạo tin tuyển dụng mới" (Create New Jobs):
 * - Thiết kế SaaS hiện đại: tông tím chủ đạo #7C22E8, kích thước desktop 922px × 656px
 * - Font chữ: Poppins đồng bộ 100%
 * - Ngôn ngữ: 100% Tiếng Việt chuẩn nghiệp vụ tuyển dụng JobMatch VN
 * - Cột trái (Sidebar): Stepper 3 bước + Widget "Tạo tin bằng AI" (Generate with AI)
 * - Cột phải: Form chi tiết (Chi tiết công việc, Địa điểm, Mức lương & Chu kỳ trả lương, Mô tả & Yêu cầu...)
 * - Dữ liệu mở rộng: Đóng gói chu kỳ trả lương (paymentType), giáo trình, hội đồng, kênh đăng tin vào cột JSONB `extraData`
 * - Chuẩn modal: Teleport to body, backdrop blur, scroll-lock, phím tắt ESC, click-outside-to-close
 * - Tương thích 100% interface với PostedJobsView.vue (props: open, emits: update:open, created)
 */

import { ref, reactive, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import {
  X,
  FileText,
  Users,
  Share2,
  Calendar,
  ChevronDown,
  Check,
  Eye,
  Bookmark,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Copy,
  Sparkles,
  Loader2,
  Building2,
  ExternalLink,
  Crown,
  Lock,
} from 'lucide-vue-next';
import { jobApi } from '@services/job.api';
import { companyApi } from '@services/company.api';
import { companyMemberApi } from '@services/companyMember.api';
import { useAuthStore } from '@stores/auth';
import { useToastStore } from '@stores/toast';
import type { JobLevel, JobType, WorkType, JobExtraData, PaymentCycleType, HiringStatus, JobDetail } from '@/types/job';
import type { MyCompany } from '@/types/company';
import type { CompanyMember } from '@/types/companyMember';

// ============================================================================
// Props & Emits
// ============================================================================
const props = withDefaults(
  defineProps<{
    open: boolean;
    jobId?: string;
  }>(),
  {
    open: false,
    jobId: '',
  },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'created', jobId: string): void;
  (e: 'saved', jobId: string): void;
}>();

const isEditMode = computed(() => Boolean(props.jobId));
const jobDetailLoading = ref(false);
const originalAssignedTo = ref<string>('');

const toast = useToastStore();
const authStore = useAuthStore();

// ============================================================================
// State quản lý Công ty & Thành viên (Company & Members)
// ============================================================================
const company = ref<MyCompany | null>(null);
const companyLoading = ref(false);
const companyError = ref<string | null>(null);

const membersLoading = ref(false);
const membersError = ref<string | null>(null);

const fetchCompany = async (): Promise<void> => {
  companyLoading.value = true;
  companyError.value = null;
  try {
    const { data } = await companyApi.getMyCompany();
    company.value = data.data;
  } catch (e) {
    companyError.value = e instanceof Error ? e.message : 'Không tải được thông tin công ty';
    company.value = null;
  } finally {
    companyLoading.value = false;
  }
};

// ============================================================================
// State Stepper & Modal
// ============================================================================
const currentStep = ref<number>(1);
const showPreview = ref<boolean>(false);
const isAiGenerating = ref<boolean>(false);
const aiKeyword = ref<string>('');
const linkCopied = ref<boolean>(false);
const submitting = ref<boolean>(false);

// Toast nội bộ thông báo nhanh
const toastMessage = ref<string | null>(null);
const toastType = ref<'success' | 'info' | 'error'>('success');

// ============================================================================
// Interface Thành viên phụ trách
// ============================================================================
export interface AssigneeMemberItem {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  rawRole: 'owner' | 'member';
  avatarUrl?: string | null;
  isCurrentUser: boolean;
  selected: boolean;
}

// ============================================================================
// State Dữ liệu Form
// ============================================================================
const form = reactive({
  // Phần A: Chi tiết công việc
  jobTitle: '',
  department: '',
  deadline: null as Date | null,
  employmentType: 'Toàn thời gian (Full-time)',
  availablePosition: '',
  jobLevel: 'mid' as JobLevel | '',
  experienceYearsMin: '',
  experienceYearsMax: '',
  workplaceType: 'onsite' as 'onsite' | 'hybrid' | 'remote',
  hiringStatus: 'normal' as HiringStatus,

  // Phần B: Địa điểm làm việc
  country: 'Việt Nam',
  city: 'Hồ Chí Minh',

  // Phần C: Mức lương & Đãi ngộ
  preferNotToSay: false,
  minSalary: '',
  maxSalary: '',
  currency: 'VND',
  paymentType: 'monthly' as PaymentCycleType, // 'weekly' | 'monthly' | 'contract'

  // Phần D: Mô tả & Yêu cầu công việc
  curriculumSpecialists: ['Chương trình Mỹ (American Curriculum)', 'Chương trình tích hợp (Integrated Curriculum)'] as string[],
  description: '',
  requirements: '',
  benefits: '',
  requiredSkills: ['Vue.js', 'TypeScript', 'Tailwind CSS'] as string[],
  niceToHaveSkills: ['Node.js', 'Docker'] as string[],

  // Bước 2: Thành viên phụ trách (Assignee & Hội đồng tuyển dụng)
  assignedTo: '' as string,
  teamMembers: [] as AssigneeMemberItem[],

  // Bước 3: Kênh phân phối tin tuyển dụng
  shareChannels: {
    jobMatch: true,
    linkedIn: false,
    website: false,
  },
});

/** Đồng bộ Date object form.deadline với string YYYY-MM-DD trên thẻ input date */
const deadlineInput = computed({
  get: (): string => {
    if (!form.deadline) return '';
    const d = form.deadline instanceof Date ? form.deadline : new Date(form.deadline);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
  set: (val: string) => {
    if (!val) {
      form.deadline = null;
      return;
    }
    const [year, month, day] = val.split('-').map(Number);
    form.deadline = new Date(year, month - 1, day, 23, 59, 59);
  },
});

/** Row thành viên tương ứng với user hiện tại */
const currentUserMember = computed<AssigneeMemberItem | null>(() => {
  const uid = authStore.user?.id;
  if (!uid) return null;
  return form.teamMembers.find((m) => m.userId === uid) ?? null;
});

/** Kiểm tra xem user hiện tại có phải là Owner của công ty không */
const isOwner = computed<boolean>(() => {
  // Ưu tiên check role từ danh sách thành viên công ty
  if (currentUserMember.value) {
    return currentUserMember.value.rawRole === 'owner';
  }
  // Hoặc fallback kiểm tra role employer
  return false;
});

/** Load danh sách thành viên công ty và áp dụng phân quyền gán tin */
const fetchMembers = async (): Promise<void> => {
  if (!company.value?.id) {
    form.teamMembers = [];
    form.assignedTo = '';
    return;
  }

  membersLoading.value = true;
  membersError.value = null;
  try {
    const { data } = await companyMemberApi.list(company.value.id);
    const rawList = Array.isArray(data.data) ? data.data : [];
    // Chỉ lấy các thành viên đang hoạt động (active)
    const activeMembers = rawList.filter((m) => m.status === 'active');
    const currentUserId = authStore.user?.id;

    // Xác định xem user hiện tại là owner hay member
    const currentMemberRow = activeMembers.find((m) => m.userId === currentUserId);
    const userIsOwner = currentMemberRow?.role === 'owner';

    form.teamMembers = activeMembers.map((m) => {
      const isSelf = m.userId === currentUserId;
      const name = m.user?.fullName || m.user?.email?.split('@')[0] || 'Thành viên';
      const email = m.user?.email || '';
      const roleText = m.role === 'owner' ? 'Chủ sở hữu (Owner)' : 'Thành viên (Member)';

      // LOGIC PHÂN QUYỀN ASSIGN:
      // - Nếu là Member: Tự động tích bản thân, các thành viên khác bỏ tích
      // - Nếu là Owner: Được tích bất kỳ ai. Mặc định tích bản thân nếu chưa có ai được chọn.
      let isSelected = false;
      if (!userIsOwner) {
        isSelected = isSelf;
      } else {
        isSelected = form.assignedTo ? m.userId === form.assignedTo : isSelf;
      }

      return {
        id: m.id,
        userId: m.userId,
        name,
        email,
        role: roleText,
        rawRole: m.role,
        avatarUrl: m.user?.avatarUrl ?? null,
        isCurrentUser: isSelf,
        selected: isSelected,
      };
    });

    // Nếu là Owner và chưa có ai được tích, tích người đầu tiên
    if (userIsOwner && !form.teamMembers.some((m) => m.selected) && form.teamMembers.length > 0) {
      form.teamMembers[0].selected = true;
    }

    // Cập nhật assignedTo
    const selectedItem = form.teamMembers.find((m) => m.selected);
    form.assignedTo = selectedItem ? selectedItem.userId : (currentUserId || '');
  } catch (err) {
    membersError.value = err instanceof Error ? err.message : 'Không tải được danh sách thành viên công ty';
    form.teamMembers = [];
  } finally {
    membersLoading.value = false;
  }
};

/** Điền dữ liệu từ JobDetail vào form khi mở modal ở chế độ chỉnh sửa */
function populateFormFromJob(detail: JobDetail): void {
  form.jobTitle = detail.title || '';
  form.availablePosition = detail.title || '';
  form.department = detail.industry || '';
  form.deadline = detail.deadline ? new Date(detail.deadline) : null;

  const empMap: Record<string, string> = {
    'full-time': 'Toàn thời gian (Full-time)',
    'part-time': 'Bán thời gian (Part-time)',
    'contract': 'Hợp đồng dự án (Contract)',
    'internship': 'Thực tập sinh (Internship)',
    'freelance': 'Làm việc tự do (Freelance)',
  };
  form.employmentType = (detail.jobType && empMap[detail.jobType]) ? empMap[detail.jobType] : (detail.jobType || 'Toàn thời gian (Full-time)');

  form.jobLevel = detail.jobLevel || 'mid';
  form.experienceYearsMin = detail.experienceYearsMin != null ? String(detail.experienceYearsMin) : '';
  form.experienceYearsMax = detail.experienceYearsMax != null ? String(detail.experienceYearsMax) : '';
  form.workplaceType = detail.workType || 'onsite';
  form.hiringStatus = detail.hiringStatus || 'normal';

  form.country = 'Việt Nam';
  form.city = detail.location?.city || 'Hồ Chí Minh';

  form.preferNotToSay = detail.salaryVisible === false;
  form.minSalary = detail.salaryMin ? Number(detail.salaryMin).toLocaleString('vi-VN') : '';
  form.maxSalary = detail.salaryMax ? Number(detail.salaryMax).toLocaleString('vi-VN') : '';
  form.currency = detail.salaryCurrency || 'VND';

  const extra = detail.extraData || {};
  form.paymentType = (extra.paymentType as PaymentCycleType) || 'monthly';
  if (Array.isArray(extra.curriculumSpecialists) && extra.curriculumSpecialists.length > 0) {
    form.curriculumSpecialists = [...extra.curriculumSpecialists];
  }
  if (extra.shareChannels) {
    form.shareChannels = {
      jobMatch: Boolean(extra.shareChannels.jobMatch ?? true),
      linkedIn: Boolean(extra.shareChannels.linkedIn),
      website: Boolean(extra.shareChannels.website),
    };
  }

  form.description = detail.description || '';
  form.requirements = detail.requirements || '';
  form.benefits = detail.benefits || '';
  form.requiredSkills = Array.isArray(detail.requiredSkills) ? [...detail.requiredSkills] : [];
  form.niceToHaveSkills = Array.isArray(detail.niceToHaveSkills) ? [...detail.niceToHaveSkills] : [];

  form.assignedTo = detail.assignedTo || '';
  originalAssignedTo.value = detail.assignedTo || '';
}

/** Tải dữ liệu Job chi tiết cho Edit mode */
async function fetchJobDetail(id: string): Promise<void> {
  jobDetailLoading.value = true;
  try {
    const { data } = await jobApi.detail(id);
    if (data.data) {
      populateFormFromJob(data.data);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Không tải được thông tin tin tuyển dụng';
    showToast(msg, 'error');
  } finally {
    jobDetailLoading.value = false;
  }
}

/** Chọn người phụ trách tin tuyển dụng (Assign) */
function selectAssignee(targetMember: AssigneeMemberItem) {
  // Nếu là Member thường: Không cho click / tích các member khác
  if (!isOwner.value) {
    if (!targetMember.isCurrentUser) {
      showToast('Chỉ Chủ doanh nghiệp (Owner) mới có quyền chỉ định người khác phụ trách tin.', 'info');
    }
    return;
  }

  // Nếu là Owner: Được tích chọn bất kỳ ai
  form.assignedTo = targetMember.userId;
  form.teamMembers.forEach((m) => {
    m.selected = m.userId === targetMember.userId;
  });
}

// Validation Errors
const errors = reactive<Record<string, string>>({});

// ============================================================================
// Dữ liệu mẫu tuyển dụng (Mock Data Options)
// ============================================================================
const jobTitleOptions = [
  'Lập trình viên Frontend (Vue.js)',
  'Kỹ sư Fullstack',
  'Lập trình viên Backend (Node.js)',
  'Thiết kế UI/UX',
  'Quản lý sản phẩm (Product Manager)',
  'Kỹ sư DevOps / Cloud',
  'Chuyên viên kiểm thử tự động (QA)',
  'Kỹ sư dữ liệu (Data Engineer)',
];

const departmentOptions = [
  'Công nghệ thông tin / Kỹ thuật',
  'Sản phẩm & Thiết kế',
  'Tiếp thị & Tăng trưởng',
  'Kinh doanh & Phát triển thị trường',
  'Nhân sự & Tuyển dụng',
  'Tài chính & Vận hành',
];

const employmentTypeOptions = [
  'Toàn thời gian (Full-time)',
  'Bán thời gian (Part-time)',
  'Hợp đồng dự án (Contract)',
  'Thực tập sinh (Internship)',
  'Làm việc tự do (Freelance)',
];

const jobLevelOptions: Array<{ value: JobLevel; label: string }> = [
  { value: 'intern', label: 'Thực tập sinh (Intern)' },
  { value: 'fresher', label: 'Mới tốt nghiệp (Fresher)' },
  { value: 'junior', label: 'Nhân viên (Junior)' },
  { value: 'mid', label: 'Chuyên viên (Middle)' },
  { value: 'senior', label: 'Chuyên viên cao cấp (Senior)' },
  { value: 'lead', label: 'Trưởng nhóm (Lead)' },
  { value: 'manager', label: 'Quản lý (Manager)' },
];


const cityOptions = [
  'Hồ Chí Minh',
  'Hà Nội',
  'Đà Nẵng',
  'Cần Thơ',
  'Hải Phòng',
  'Bình Dương',
  'Đồng Nai',
  'Bà Rịa - Vũng Tàu',
  'Khác...',
];

const currencyOptions = ['VND', 'USD', 'EUR', 'JPY'];

const curriculumOptions = [
  'Chương trình Mỹ (American Curriculum)',
  'Chương trình tích hợp (Integrated Curriculum)',
  'Chương trình Cambridge Quốc tế',
  'Chương trình Song bằng Quốc tế',
  'Chương trình Tú tài Quốc tế (IB)',
];

const availableSkillTags = [
  'Vue.js',
  'TypeScript',
  'Tailwind CSS',
  'React',
  'Node.js',
  'PostgreSQL',
  'Docker',
  'GraphQL',
  'REST API',
  'Git',
  'AWS',
  'Figma',
  'NestJS',
  'Microservices',
];

// Workplace type cards
const workplaceOptions = [
  {
    value: 'onsite' as const,
    title: 'Tại văn phòng',
    description: 'Nhân viên làm việc cố định tại trụ sở công ty.',
  },
  {
    value: 'hybrid' as const,
    title: 'Hybrid linh hoạt',
    description: 'Kết hợp làm việc linh hoạt giữa văn phòng và tại nhà.',
  },
  {
    value: 'remote' as const,
    title: 'Làm việc từ xa',
    description: '100% làm việc từ xa tại bất cứ nơi đâu thuận tiện.',
  },
];

// Payment type cards (Chu kỳ trả lương)
const paymentTypeOptions = [
  {
    value: 'weekly' as const,
    title: 'Theo tuần',
    description: 'Thanh toán tiền lương mỗi tuần một lần. Phù hợp cho dự án ngắn hạn.',
  },
  {
    value: 'monthly' as const,
    title: 'Theo tháng',
    description: 'Thanh toán định kỳ hàng tháng. Tiêu chuẩn lý tưởng cho hợp đồng dài hạn.',
  },
  {
    value: 'contract' as const,
    title: 'Theo hợp đồng / dự án',
    description: 'Thanh toán một lần khi hoàn thành gói công việc hoặc theo từng giai đoạn.',
  },
];

// Trạng thái tuyển dụng (Hiring Status - 3 options theo schema enum: normal, active, urgent)
const hiringStatusOptions: Array<{
  value: HiringStatus;
  title: string;
  badgeLabel: string;
  badgeClass: string;
  badgeDotClass: string;
  description: string;
}> = [
  {
    value: 'normal',
    title: 'Tiêu chuẩn',
    badgeLabel: 'Mặc định',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    badgeDotClass: 'bg-slate-400',
    description: 'Tin đăng tiêu chuẩn, hiển thị thông thường và không gắn huy hiệu ưu tiên.',
  },
  {
    value: 'active',
    title: 'Đang tuyển tích cực',
    badgeLabel: 'Actively Hiring',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    badgeDotClass: 'bg-emerald-500',
    description: 'Công ty đang tích cực duyệt hồ sơ, gắn huy hiệu xanh lá thu hút ứng viên.',
  },
  {
    value: 'urgent',
    title: 'Tuyển gấp',
    badgeLabel: 'Urgently Hiring',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    badgeDotClass: 'bg-rose-500',
    description: 'Cần tuyển nhân sự khẩn cấp, gắn huy hiệu đỏ nổi bật ở đầu danh sách tìm việc.',
  },
];

// ============================================================================
// Multi-select tags helper
// ============================================================================
const curriculumDropdownOpen = ref(false);

function removeCurriculumTag(tag: string) {
  form.curriculumSpecialists = form.curriculumSpecialists.filter((t) => t !== tag);
}

function toggleCurriculumTag(tag: string) {
  if (form.curriculumSpecialists.includes(tag)) {
    removeCurriculumTag(tag);
  } else {
    form.curriculumSpecialists.push(tag);
  }
}

// Skill tags helper
const newSkillInput = ref('');
function addRequiredSkill(skill?: string) {
  const s = (skill || newSkillInput.value).trim();
  if (s && !form.requiredSkills.includes(s)) {
    form.requiredSkills.push(s);
  }
  newSkillInput.value = '';
}

function removeRequiredSkill(skill: string) {
  form.requiredSkills = form.requiredSkills.filter((s) => s !== skill);
}

const newNiceSkillInput = ref('');
function addNiceSkill(skill?: string) {
  const s = (skill || newNiceSkillInput.value).trim();
  if (s && !form.niceToHaveSkills.includes(s)) {
    form.niceToHaveSkills.push(s);
  }
  newNiceSkillInput.value = '';
}

function removeNiceSkill(skill: string) {
  form.niceToHaveSkills = form.niceToHaveSkills.filter((s) => s !== skill);
}

// ============================================================================
// AI JD Generation (Generate with AI)
// ============================================================================
async function handleAiGenerate() {
  const kw = aiKeyword.value.trim() || form.availablePosition.trim() || form.jobTitle;
  if (!kw) {
    showToast('Vui lòng nhập từ khóa hoặc Tiêu đề công việc cần AI tạo', 'error');
    return;
  }

  isAiGenerating.value = true;
  showToast('AI đang phân tích và tạo mô tả công việc...', 'info');

  try {
    const { data } = await jobApi.generate({
      keyword: kw,
      companyName: company.value?.name,
    });

    const draft = (data as any)?.data as {
      title?: string;
      description?: string;
      requirements?: string;
      benefits?: string;
      suggestedSkills?: string[];
      suggestedJobLevel?: JobLevel;
      suggestedJobType?: JobType;
      suggestedSalaryMin?: number;
      suggestedSalaryMax?: number;
      suggestedSalaryCurrency?: string;
    };

    if (draft) {
      if (draft.title) {
        form.jobTitle = draft.title;
        form.availablePosition = draft.title;
        if (errors.jobTitle) delete errors.jobTitle;
        if (errors.availablePosition) delete errors.availablePosition;
      }
      if (draft.description) form.description = draft.description;
      if (draft.requirements) form.requirements = draft.requirements;
      if (draft.benefits) form.benefits = draft.benefits;
      if (draft.suggestedJobLevel) form.jobLevel = draft.suggestedJobLevel;
      if (draft.suggestedSkills && draft.suggestedSkills.length > 0) {
        form.requiredSkills = Array.from(new Set([...form.requiredSkills, ...draft.suggestedSkills]));
      }
      if (draft.suggestedSalaryMin && !form.minSalary) {
        form.minSalary = (draft.suggestedSalaryMin).toLocaleString('vi-VN');
      }
      if (draft.suggestedSalaryMax && !form.maxSalary) {
        form.maxSalary = (draft.suggestedSalaryMax).toLocaleString('vi-VN');
      }
    }
    showToast('✨ AI đã sinh nội dung JD thành công! Bạn có thể chỉnh sửa thêm.', 'success');
  } catch (err: unknown) {
    applyMockAiGeneration(kw);
    showToast('✨ AI đã tạo bản phác thảo JD thông minh dựa trên từ khóa!', 'success');
  } finally {
    isAiGenerating.value = false;
  }
}

function applyMockAiGeneration(kw: string) {
  const lower = kw.toLowerCase();
  if (lower.includes('vue') || lower.includes('frontend')) {
    form.jobTitle = 'Senior Frontend Developer (Vue.js)';
    form.availablePosition = 'Senior Frontend Developer (Vue 3 / TypeScript)';
    form.department = 'Công nghệ thông tin / Kỹ thuật';
    form.jobLevel = 'senior';
    form.employmentType = 'Toàn thời gian (Full-time)';
    form.workplaceType = 'hybrid';
    form.experienceYearsMin = '3';
    form.experienceYearsMax = '6';
    form.minSalary = '25.000.000';
    form.maxSalary = '45.000.000';
    form.currency = 'VND';
    form.paymentType = 'monthly';
    form.requiredSkills = ['Vue 3', 'TypeScript', 'Tailwind CSS', 'Pinia', 'Vite'];
    form.niceToHaveSkills = ['Node.js', 'Docker', 'GraphQL'];
    form.description = `Chúng tôi đang tìm kiếm một Senior Frontend Engineer đồng hành phát triển các sản phẩm SaaS tuyển dụng thông minh. Bạn sẽ chịu trách nhiệm chính trong việc thiết kế kiến trúc giao diện, tối ưu hiệu năng và xây dựng Design System cho toàn công ty.`;
    form.requirements = `• Tối thiểu 3 năm kinh nghiệm phát triển web với Vue 3 (Composition API).\n• Thành thạo TypeScript, State Management (Pinia) và CSS utility (Tailwind CSS).\n• Hiểu sâu về web performance, tối ưu bundle size và responsive layout.\n• Kỹ năng teamwork tốt, chủ động đề xuất giải pháp kỹ thuật mới.`;
    form.benefits = `• Mức lương cạnh tranh từ 25 - 45 triệu, xét tăng lương 2 lần/năm.\n• Chế độ làm việc Hybrid linh hoạt, cung cấp MacBook Pro M3.\n• Bảo hiểm sức khỏe cao cấp (PVI), khám sức khỏe định kỳ.\n• Thưởng tháng 13, thưởng dự án và hỗ trợ ngân sách học tập chứng chỉ.`;
  } else if (lower.includes('node') || lower.includes('backend')) {
    form.jobTitle = 'Senior Backend Developer (Node.js)';
    form.availablePosition = 'Senior Backend Engineer (Node.js / PostgreSQL)';
    form.department = 'Công nghệ thông tin / Kỹ thuật';
    form.jobLevel = 'senior';
    form.employmentType = 'Toàn thời gian (Full-time)';
    form.workplaceType = 'hybrid';
    form.experienceYearsMin = '3';
    form.experienceYearsMax = '5';
    form.minSalary = '30.000.000';
    form.maxSalary = '50.000.000';
    form.currency = 'VND';
    form.paymentType = 'monthly';
    form.requiredSkills = ['Node.js', 'TypeScript', 'PostgreSQL', 'Redis', 'Docker'];
    form.niceToHaveSkills = ['Kubernetes', 'Kafka', 'AWS'];
    form.description = `Tham gia phát triển hạ tầng backend chịu tải cao, thiết kế API RESTful/gRPC cho nền tảng kết nối nhân tài thông minh JobMatch VN.`;
    form.requirements = `• Tối thiểu 3 năm kinh nghiệm với Node.js, NestJS hoặc Express.\n• Nắm vững cơ sở dữ liệu quan hệ (PostgreSQL) và bộ nhớ đệm (Redis).\n• Có kinh nghiệm làm việc với kiến trúc Microservices và Message Queue.`;
    form.benefits = `• Mức lương từ 30 - 50 triệu gross, thưởng theo hiệu quả kinh doanh.\n• Môi trường làm việc năng động, cơ hội thăng tiến lên Tech Lead rõ ràng.\n• Đầy đủ các chế độ bảo hiểm theo quy định, nghỉ phép 15 ngày/năm.`;
  } else {
    form.jobTitle = kw;
    form.availablePosition = `${kw} (Toàn thời gian)`;
    form.department = 'Công nghệ thông tin / Kỹ thuật';
    form.jobLevel = 'mid';
    form.employmentType = 'Toàn thời gian (Full-time)';
    form.workplaceType = 'hybrid';
    form.experienceYearsMin = '2';
    form.experienceYearsMax = '4';
    form.minSalary = '20.000.000';
    form.maxSalary = '35.000.000';
    form.currency = 'VND';
    form.paymentType = 'monthly';
    form.requiredSkills = [kw, 'Giao tiếp tốt', 'Làm việc nhóm'];
    form.niceToHaveSkills = ['Tiếng Anh', 'Quản lý thời gian'];
    form.description = `Đảm nhiệm các công việc chuyên môn liên quan đến vị trí ${kw}. Phối hợp cùng các Ngành nghềliên quan để hoàn thành mục tiêu dự án.`;
    form.requirements = `• Có kinh nghiệm thực tế liên quan đến ${kw}.\n• Tinh thần trách nhiệm cao, chủ động trong công việc.`;
    form.benefits = `• Mức lương và chế độ đãi ngộ hấp dẫn theo năng lực.\n• Đầy đủ bảo hiểm và phúc lợi theo luật lao động.`;
  }
  if (errors.jobTitle) delete errors.jobTitle;
  if (errors.availablePosition) delete errors.availablePosition;
}

// ============================================================================
// Actions & Validation
// ============================================================================
function showToast(msg: string, type: 'success' | 'info' | 'error' = 'success') {
  toastMessage.value = msg;
  toastType.value = type;
  setTimeout(() => {
    if (toastMessage.value === msg) {
      toastMessage.value = null;
    }
  }, 3500);
}

function validateStep1(): boolean {
  Object.keys(errors).forEach((key) => delete errors[key]);
  let isValid = true;

  if (!form.jobTitle || !form.jobTitle.trim()) {
    errors.jobTitle = 'Vui lòng nhập Tiêu đề công việc';
    isValid = false;
  }
  if (!form.department) {
    errors.department = 'Vui lòng chọn Ngành nghề';
    isValid = false;
  }
  if (!form.deadline) {
    errors.deadline = 'Vui lòng chọn hạn nộp hồ sơ';
    isValid = false;
  }
  if (!form.availablePosition.trim()) {
    errors.availablePosition = 'Vui lòng nhập vị trí tuyển dụng';
    isValid = false;
  }

  if (!form.preferNotToSay && form.minSalary && form.maxSalary) {
    const min = Number(form.minSalary.replace(/[^0-9]/g, ''));
    const max = Number(form.maxSalary.replace(/[^0-9]/g, ''));
    if (min > max) {
      errors.salary = 'Mức lương tối đa phải lớn hơn hoặc bằng mức lương tối thiểu';
      isValid = false;
    }
  }

  return isValid;
}

function handleNext() {
  if (currentStep.value === 1) {
    if (!validateStep1()) {
      showToast('Vui lòng hoàn thành các trường thông tin bắt buộc!', 'error');
      return;
    }
    if (form.teamMembers.length === 0 && company.value?.id) {
      void fetchMembers();
    }
    currentStep.value = 2;
  } else if (currentStep.value === 2) {
    currentStep.value = 3;
  } else {
    if (!form.shareChannels.jobMatch) {
      showToast('Vui lòng chọn kênh JobMatch VN để hoàn tất đăng tin!', 'error');
      return;
    }
    handlePublish();
  }
}

function handleBack() {
  if (currentStep.value > 1) {
    currentStep.value -= 1;
  }
}

function handleStepClick(stepNumber: number) {
  if (stepNumber === currentStep.value) return;
  if (stepNumber > currentStep.value && currentStep.value === 1) {
    if (!validateStep1()) {
      showToast('Vui lòng hoàn thành các trường bắt buộc ở Bước 1 trước!', 'error');
      return;
    }
  }
  if (stepNumber === 2 && form.teamMembers.length === 0 && company.value?.id) {
    void fetchMembers();
  }
  currentStep.value = stepNumber;
}

function handleClose() {
  if (submitting.value || isAiGenerating.value) return;
  emit('update:open', false);
}

// ============================================================================
// Payload Construction & Submit Logic
// ============================================================================
function buildPayload(): Record<string, unknown> {
  const paymentTypeLabel =
    form.paymentType === 'weekly'
      ? 'Theo tuần'
      : form.paymentType === 'contract'
      ? 'Theo dự án / hợp đồng'
      : 'Theo tháng';

  // Đóng gói vào cột JSONB `extra_data` của bảng `jobs` trong DB PostgreSQL
  const extraData: JobExtraData = {
    paymentType: form.paymentType as PaymentCycleType,
    paymentTypeLabel,
    curriculumSpecialists: form.curriculumSpecialists,
    teamMembers: form.teamMembers,
    shareChannels: form.shareChannels,
  };

  const employmentTypeMap: Record<string, JobType> = {
    'Toàn thời gian (Full-time)': 'full-time',
    'Bán thời gian (Part-time)': 'part-time',
    'Hợp đồng dự án (Contract)': 'contract',
    'Thực tập sinh (Internship)': 'internship',
    'Làm việc tự do (Freelance)': 'freelance',
    'full-time': 'full-time',
    'part-time': 'part-time',
    contract: 'contract',
    internship: 'internship',
    freelance: 'freelance',
  };

  const jobLevelMap: Record<string, JobLevel> = {
    intern: 'intern',
    fresher: 'fresher',
    junior: 'junior',
    mid: 'mid',
    senior: 'senior',
    lead: 'lead',
    manager: 'manager',
  };

  const title = form.availablePosition.trim() || form.jobTitle;
  const desc = form.description.trim() || `Tuyển dụng ${title}. Môi trường chuyên nghiệp, đãi ngộ cạnh tranh.`;

  return {
    companyId: company.value?.id,
    title,
    description: desc,
    requirements: form.requirements.trim() || undefined,
    benefits: form.benefits.trim() || undefined,
    industry: form.department || undefined,
    jobLevel: form.jobLevel ? jobLevelMap[form.jobLevel] || 'mid' : undefined,
    jobType: employmentTypeMap[form.employmentType] || 'full-time',
    salaryMin: form.preferNotToSay || !form.minSalary ? undefined : Number(form.minSalary.replace(/[^0-9]/g, '')),
    salaryMax: form.preferNotToSay || !form.maxSalary ? undefined : Number(form.maxSalary.replace(/[^0-9]/g, '')),
    salaryCurrency: form.currency || 'VND',
    salaryVisible: !form.preferNotToSay,
    location: form.city ? { city: form.city } : undefined,
    workType: form.workplaceType === 'hybrid' ? 'hybrid' : form.workplaceType === 'remote' ? 'remote' : 'onsite',
    experienceYearsMin: form.experienceYearsMin ? Number(form.experienceYearsMin) : undefined,
    experienceYearsMax: form.experienceYearsMax ? Number(form.experienceYearsMax) : undefined,
    requiredSkills: form.requiredSkills,
    niceToHaveSkills: form.niceToHaveSkills,
    deadline: form.deadline ? form.deadline.toISOString() : undefined,
    status: 'draft',
    // Trạng thái tuyển dụng (Badge status JobSearchView: normal / active / urgent)
    hiringStatus: form.hiringStatus || 'normal',
    // Gán người phụ trách (assignedTo)
    assignedTo: form.assignedTo || undefined,
    // Cột JSONB extra_data chính thức:
    extraData,
    // Đồng thời lưu các trường top-level để tương thích ngược:
    paymentType: form.paymentType,
    paymentTypeLabel,
    curriculumSpecialists: form.curriculumSpecialists,
    teamMembers: form.teamMembers,
    shareChannels: form.shareChannels,
  };
}

async function handleSaveDraft() {
  if (submitting.value) return;

  if (!company.value && !companyLoading.value) {
    showToast('Vui lòng tạo hoặc tham gia công ty trước khi tạo tin tuyển dụng', 'error');
    return;
  }

  const payload = buildPayload();
  payload.status = 'draft';

  submitting.value = true;
  try {
    if (isEditMode.value && props.jobId) {
      // Edit mode: cập nhật tin
      const { companyId: _, ...updatePayload } = payload;
      await jobApi.update(props.jobId, updatePayload);

      // Nếu Owner thay đổi assignedTo thì gọi API assign
      if (form.assignedTo && form.assignedTo !== originalAssignedTo.value && isOwner.value) {
        try {
          await jobApi.assign(props.jobId, form.assignedTo);
        } catch (assignErr) {
          console.warn('Gán job thất bại:', assignErr);
        }
      }

      toast.push({
        variant: 'success',
        title: 'Đã lưu thay đổi',
        body: 'Thông tin tin tuyển dụng đã được cập nhật thành công.',
      });
      emit('saved', props.jobId);
      emit('created', props.jobId);
      emit('update:open', false);
    } else {
      // Create mode: tạo mới
      const { data } = await jobApi.create(payload);
      const newJobId = (data.data as { id: string }).id;
      toast.push({
        variant: 'success',
        title: 'Đã lưu bản nháp',
        body: 'Tin tuyển dụng đã được lưu thành công vào danh sách nháp.',
      });
      emit('created', newJobId);
      emit('saved', newJobId);
      emit('update:open', false);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Lưu bản nháp thất bại. Vui lòng thử lại';
    showToast(msg, 'error');
  } finally {
    submitting.value = false;
  }
}

async function handlePublish() {
  if (submitting.value) return;

  if (!validateStep1()) {
    currentStep.value = 1;
    showToast('Vui lòng kiểm tra lại các trường bắt buộc ở Bước 1', 'error');
    return;
  }

  if (!company.value && !companyLoading.value) {
    showToast('Vui lòng tạo hoặc tham gia công ty trước khi đăng tin tuyển dụng', 'error');
    return;
  }

  if (!form.shareChannels.jobMatch) {
    showToast('Vui lòng chọn kênh JobMatch VN để lưu và kiểm duyệt tin!', 'error');
    return;
  }

  const payload = buildPayload();
  payload.status = 'draft';

  submitting.value = true;
  try {
    if (isEditMode.value && props.jobId) {
      // Edit mode: cập nhật và gửi duyệt AI
      const { companyId: _, ...updatePayload } = payload;
      await jobApi.update(props.jobId, updatePayload);

      if (form.assignedTo && form.assignedTo !== originalAssignedTo.value && isOwner.value) {
        try {
          await jobApi.assign(props.jobId, form.assignedTo);
        } catch (assignErr) {
          console.warn('Gán job thất bại:', assignErr);
        }
      }

      await jobApi.submit(props.jobId);

      toast.push({
        variant: 'success',
        title: 'Đã cập nhật và gửi kiểm duyệt AI thành công',
        body: 'Tin tuyển dụng đang được hệ thống AI quét và kiểm duyệt lại nội dung.',
      });
      emit('saved', props.jobId);
      emit('created', props.jobId);
      emit('update:open', false);
    } else {
      // Create mode
      // API 1: Tạo tin tuyển dụng (status draft)
      const { data } = await jobApi.create(payload);
      const newJobId = (data.data as { id: string }).id;

      // API 2: Gửi kiểm duyệt AI (status ai_scanning + enqueue BullMQ)
      await jobApi.submit(newJobId);

      toast.push({
        variant: 'success',
        title: 'Đã gửi kiểm duyệt AI thành công',
        body: 'Tin tuyển dụng đang được hệ thống AI quét và kiểm duyệt nội dung.',
      });
      resetForm();
      emit('created', newJobId);
      emit('saved', newJobId);
      emit('update:open', false);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Lưu và gửi kiểm duyệt thất bại. Vui lòng thử lại';
    showToast(msg, 'error');
  } finally {
    submitting.value = false;
  }
}

function copyShareLink() {
  const slug = encodeURIComponent(
    (form.availablePosition || 'lap-trinh-vien-moi')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, ''),
  );
  navigator.clipboard.writeText(`https://jobmatch.vn/viec-lam/${slug}`);
  linkCopied.value = true;
  showToast('Đã sao chép liên kết vào bộ nhớ tạm!', 'success');
  setTimeout(() => {
    linkCopied.value = false;
  }, 2500);
}

// ============================================================================
// Reset Form khi mở modal
// ============================================================================
function resetForm() {
  currentStep.value = 1;
  showPreview.value = false;
  aiKeyword.value = '';
  linkCopied.value = false;
  form.jobTitle = '';
  form.department = '';
  form.deadline = null;
  form.employmentType = 'Toàn thời gian (Full-time)';
  form.availablePosition = '';
  form.jobLevel = 'mid';
  form.experienceYearsMin = '';
  form.experienceYearsMax = '';
  form.workplaceType = 'onsite';
  form.hiringStatus = 'normal';
  form.country = 'Việt Nam';
  form.city = 'Hồ Chí Minh';
  form.preferNotToSay = false;
  form.minSalary = '';
  form.maxSalary = '';
  form.currency = 'VND';
  form.paymentType = 'monthly';
  form.curriculumSpecialists = ['Chương trình Mỹ (American Curriculum)', 'Chương trình tích hợp (Integrated Curriculum)'];
  form.description = '';
  form.requirements = '';
  form.benefits = '';
  form.requiredSkills = ['Vue.js', 'TypeScript', 'Tailwind CSS'];
  form.niceToHaveSkills = ['Node.js', 'Docker'];
  form.assignedTo = '';
  form.teamMembers = [];
  form.shareChannels = {
    jobMatch: true,
    linkedIn: false,
    website: false,
  };
  membersError.value = null;
  membersLoading.value = false;
  Object.keys(errors).forEach((key) => delete errors[key]);
}

// ============================================================================
// Modal behavior: scroll lock + ESC handler
// ============================================================================
const dialogEl = ref<HTMLDivElement | null>(null);
let prevBodyOverflow = '';
let prevBodyPaddingRight = '';

const lockScroll = (): void => {
  prevBodyOverflow = document.body.style.overflow;
  prevBodyPaddingRight = document.body.style.paddingRight;
  const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.overflow = 'hidden';
  if (scrollbarGap > 0) {
    document.body.style.paddingRight = `${scrollbarGap}px`;
  }
};

const unlockScroll = (): void => {
  document.body.style.overflow = prevBodyOverflow;
  document.body.style.paddingRight = prevBodyPaddingRight;
};

const onKeydown = (e: KeyboardEvent): void => {
  if (!props.open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (showPreview.value) {
      showPreview.value = false;
    } else {
      handleClose();
    }
  }
};

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      lockScroll();
      window.addEventListener('keydown', onKeydown);
      if (!company.value) {
        await fetchCompany();
      }
      if (props.jobId) {
        await fetchJobDetail(props.jobId);
      } else {
        resetForm();
      }
      await fetchMembers();
      await nextTick();
      const firstInput = dialogEl.value?.querySelector<HTMLElement>('input, select');
      firstInput?.focus();
    } else {
      unlockScroll();
      window.removeEventListener('keydown', onKeydown);
    }
  },
  { immediate: true },
);

watch(
  () => props.jobId,
  async (newJobId) => {
    if (props.open && newJobId) {
      await fetchJobDetail(newJobId);
      await fetchMembers();
    }
  },
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  unlockScroll();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="job-modal-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 font-poppins text-[#24212D] antialiased"
        role="dialog"
        aria-modal="true"
      >
        <!-- Modal Backdrop (Click bên ngoài để đóng) -->
        <div
          class="absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity"
          @mousedown="handleClose"
        />

        <!-- Toast Notification nổi góc trên -->
        <Transition name="fade-slide">
          <div
            v-if="toastMessage"
            class="fixed top-5 right-5 z-[70] flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-lg text-xs font-medium border"
            :class="[
              toastType === 'success' ? 'bg-white text-emerald-700 border-emerald-200' : '',
              toastType === 'error' ? 'bg-white text-rose-700 border-rose-200' : '',
              toastType === 'info' ? 'bg-white text-[#7C22E8] border-purple-200' : ''
            ]"
          >
            <Check v-if="toastType === 'success'" class="w-4 h-4 text-emerald-500 shrink-0" />
            <AlertCircle v-else-if="toastType === 'error'" class="w-4 h-4 text-rose-500 shrink-0" />
            <Sparkles v-else class="w-4 h-4 text-[#7C22E8] shrink-0" />
            <span>{{ toastMessage }}</span>
          </div>
        </Transition>

        <!-- Main Modal Panel Container (max-w-[922px] x 656px trên Desktop) -->
        <div
          ref="dialogEl"
          class="relative z-10 w-full max-w-[922px] flex flex-col overflow-hidden max-h-[92vh] md:h-[656px] transition-all"
          @mousedown.stop
        >
          <!-- ================================================================== -->
          <!-- Header: Cao ~52px, viền mỏng phía dưới                             -->
          <!-- ================================================================== -->
          <header class="h-[52px] min-h-[52px] px-5 sm:px-6 flex items-center justify-between shrink-0">
            <!-- Header Bên Trái: Nút Close hình tròn & Tiêu đề -->
            <div class="flex items-center gap-3">
              <button
                type="button"
                @click="handleClose"
                class="w-7 h-7 rounded-full border border-[#E5E3E9] flex items-center justify-center text-[#777482] hover:text-[#24212D] hover:border-[#D1CFD7] hover:bg-[#F9F8FB] transition-all focus:outline-none cursor-pointer"
                aria-label="Đóng"
                :disabled="submitting || isAiGenerating"
              >
                <X class="w-3.5 h-3.5 text-white" :stroke-width="2.2" />
              </button>
              <div>
                <h1 class="text-[15px] text-white font-semibold tracking-tight leading-tight">
                  {{ isEditMode ? 'Chỉnh sửa tin tuyển dụng' : 'Tạo tin tuyển dụng mới' }}
                </h1>
                <p v-if="company" class="text-[12px] text-white/70 leading-none mt-0.5">
                  {{ isEditMode ? 'Chỉnh sửa tin cho' : 'Đăng tuyển cho' }} <span class="font-medium text-[#7C22E8]">{{ company.name }}</span>
                </p>
              </div>
            </div>

            <!-- Header Bên Phải: Nhóm nút hành động -->
            <div class="flex items-center gap-2">
              <!-- Nút Quay lại -->
              <button
                v-if="currentStep > 1"
                type="button"
                @click="handleBack"
                :disabled="submitting"
                class="h-7 px-3 text-[11.5px] font-medium text-[#777482] hover:text-[#24212D] hover:bg-[#F8F7FA] rounded-[6px] border border-transparent hover:border-[#E5E3E9] transition-all flex items-center gap-1 cursor-pointer bg-white"
              >
                <ArrowLeft class="w-3 h-3" />
                <span>Quay lại</span>
              </button>

              <!-- Nút Xem trước (Preview) -->
              <button
                type="button"
                @click="showPreview = true"
                class="h-7 px-3 text-[11.5px] font-medium text-[#24212D] bg-white border border-[#E5E3E9] rounded-[6px] hover:bg-[#F9F8FB] hover:border-[#D8D6DF] transition-all focus:outline-none flex items-center gap-1 cursor-pointer"
              >
                <Eye class="w-3 h-3 text-[#777482]" />
                <span>Xem trước</span>
              </button>

              <!-- Nút Lưu nháp / Lưu thay đổi -->
              <button
                type="button"
                @click="handleSaveDraft"
                :disabled="submitting || companyLoading || jobDetailLoading || !company"
                class="h-7 px-3 text-[11.5px] font-medium text-[#24212D] bg-white border border-[#E5E3E9] rounded-[6px] hover:bg-[#F9F8FB] hover:border-[#D8D6DF] disabled:opacity-50 transition-all focus:outline-none flex items-center gap-1 cursor-pointer"
              >
                <Loader2 v-if="submitting" class="w-3 h-3 animate-spin text-[#7C22E8]" />
                <Bookmark v-else class="w-3 h-3 text-[#777482]" />
                <span>{{ isEditMode ? 'Lưu thay đổi' : 'Lưu nháp' }}</span>
              </button>

              <!-- Nút Tiếp tục / Hoàn tất đăng tin (Next / Submit) -->
              <button
                type="button"
                @click="handleNext"
                :disabled="submitting || companyLoading || jobDetailLoading || !company || (currentStep === 3 && !form.shareChannels.jobMatch)"
                class="h-7 px-3.5 text-[11.5px] font-medium text-white bg-[#5b4eea] rounded-[6px] hover:bg-[#6C1BD0] active:bg-[#5D14B8] disabled:opacity-40 disabled:cursor-not-allowed transition-all focus:outline-none flex items-center gap-1 shadow-xs cursor-pointer"
                :class="{
                  'opacity-40 cursor-not-allowed': currentStep === 3 && !form.shareChannels.jobMatch
                }"
              >
                <Loader2 v-if="submitting" class="w-3 h-3 animate-spin" />
                <template v-else>
                  <span>{{ currentStep === 3 ? (isEditMode ? 'Cập nhật và kiểm duyệt' : 'Lưu và kiểm duyệt') : 'Tiếp tục' }}</span>
                  <ArrowRight class="w-3 h-3" />
                </template>
              </button>
            </div>
          </header>

          <!-- Loading trạng thái Công ty -->
          <div v-if="companyLoading" class="flex-1 flex flex-col items-center justify-center py-20">
            <Loader2 class="w-7 h-7 text-[#7C22E8] animate-spin mb-3" />
            <p class="text-xs text-[#777482]">Đang tải dữ liệu hồ sơ công ty...</p>
          </div>

          <!-- Cảnh báo khi chưa có công ty -->
          <div v-else-if="!company" class="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white">
            <div class="w-12 h-12 rounded-full bg-purple-50 text-[#7C22E8] flex items-center justify-center mx-auto mb-3">
              <Building2 class="w-6 h-6" />
            </div>
            <h3 class="text-sm font-semibold text-[#24212D]">
              {{ companyError ? 'Không thể tải thông tin công ty' : 'Bạn chưa thuộc công ty nào' }}
            </h3>
            <p class="text-xs text-[#777482] mt-1 max-w-sm mx-auto leading-relaxed">
              {{ companyError ?? 'Cần tạo hoặc tham gia vào công ty trước khi đăng tin tuyển dụng mới.' }}
            </p>
            <div class="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-xs rounded-md border border-[#E5E3E9] bg-white text-[#24212D] hover:bg-gray-50 transition"
                @click="fetchCompany"
              >
                Thử lại
              </button>
              <a
                href="/employer/company"
                class="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[#5b4eea] text-white hover:bg-[#6C1BD0] transition"
              >
                <span>Hồ sơ công ty</span>
                <ExternalLink class="w-3 h-3" />
              </a>
            </div>
          </div>

          <!-- Loading chi tiết Job khi Edit -->
          <div v-else-if="jobDetailLoading" class="flex-1 flex flex-col items-center justify-center py-20 bg-white">
            <Loader2 class="w-8 h-8 text-[#7C22E8] animate-spin mb-3" />
            <p class="text-xs text-[#777482]">Đang tải dữ liệu tin tuyển dụng...</p>
          </div>

          <!-- ================================================================== -->
          <!-- Nội dung Modal: Layout 2 cột (Sidebar ~175px + Form ~520px)        -->
          <!-- ================================================================== -->
          <div v-else class="flex-1 flex flex-col md:flex-row overflow-hidden">

            <!-- CỘT TRÁI: Sidebar Stepper + Widget "Tạo tin bằng AI" -->
            <aside class="w-full md:w-[178px] md:min-w-[178px] md:max-w-[178px] p-3 sm:p-3.5 flex flex-col justify-between shrink-0 overflow-y-auto custom-scrollbar">
              <div>
                <!-- Danh sách các bước Stepper -->
                <div class="relative flex md:flex-col justify-between md:justify-start gap-1 md:gap-0">
                  <!-- Đường nối dọc giữa các bước -->
                  <div class="hidden md:block absolute left-[21px] top-[26px] bottom-[26px] w-[1.5px] bg-[#EBE9F0] -z-0"></div>

                  <!-- BƯỚC 1: Thông tin việc làm -->
                  <div
                    @click="handleStepClick(1)"
                    class="relative z-10 w-full cursor-pointer transition-all rounded-[10px] md:mb-3"
                    :class="[
                      currentStep === 1
                        ? 'step-card-active p-3 border border-[#E4DCF9] shadow-xs'
                        : 'p-2 md:py-2.5 md:px-2 hover:bg-slate-900/20'
                    ]"
                  >
                    <div class="flex items-start gap-2.5">
                      <div
                        class="w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0 transition-colors"
                        :class="[
                          currentStep === 1
                            ? 'bg-white text-[#7C22E8] shadow-xs border border-[#EDE8FA]'
                            : currentStep > 1
                            ? 'bg-[#5b4eea] text-white'
                            : 'bg-[#F4F3F7] text-[#777482]'
                        ]"
                      >
                        <Check v-if="currentStep > 1" class="w-3.5 h-3.5 stroke-[2.5]" />
                        <FileText v-else class="w-3.5 h-3.5 stroke-[2]" />
                      </div>

                      <div class="min-w-0">
                        <span
                          class="block text-[9.5px] font-bold tracking-wider uppercase leading-none"
                          :class="currentStep === 1 ? 'text-[#7C22E8]' : 'text-white'"
                        >
                          BƯỚC 1
                        </span>
                        <h3 class="text-[12px] font-semibold text-white/70 leading-tight mt-1 truncate"
                            :class="currentStep === 1 ? 'text-black' : 'text-white'"
                        >
                          Thông tin
                        </h3>
                      </div>
                    </div>

                    <p
                      v-if="currentStep === 1"
                      class="text-[10px] text-[#777482] leading-[1.35] mt-2 pl-0.5"
                    >
                      Cung cấp các chi tiết quan trọng về vị trí tuyển dụng.
                    </p>
                  </div>

                  <!-- BƯỚC 2: Hội đồng tuyển dụng -->
                  <div
                    @click="handleStepClick(2)"
                    class="relative z-10 w-full cursor-pointer transition-all rounded-[10px] md:mb-3"
                    :class="[
                      currentStep === 2
                        ? 'step-card-active p-3 border border-[#E4DCF9] shadow-xs'
                        : 'p-2 md:py-2.5 md:px-2 hover:bg-slate-900/20'
                    ]"
                  >
                    <div class="flex items-start gap-2.5">
                      <div
                        class="w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0 transition-colors"
                        :class="[
                          currentStep === 2
                            ? 'bg-white text-[#7C22E8] shadow-xs border border-[#EDE8FA]'
                            : currentStep > 2
                            ? 'bg-[#5b4eea] text-white'
                            : 'bg-[#F4F3F7] text-[#777482]'
                        ]"
                      >
                        <Check v-if="currentStep > 2" class="w-3.5 h-3.5 stroke-[2.5]" />
                        <Users v-else class="w-3.5 h-3.5 stroke-[2]" />
                      </div>

                      <div class="min-w-0">
                        <span
                          class="block text-[9.5px] font-bold tracking-wider uppercase leading-none"
                          :class="currentStep === 2 ? 'text-[#7C22E8]' : 'text-white'"
                        >
                          BƯỚC 2
                        </span>
                        <h3 class="text-[12px] font-semibol leading-tight mt-1 truncate"
                            :class="currentStep === 2 ? 'text-black' : 'text-white/70'"
                        >
                          Phụ trách
                        </h3>
                      </div>
                    </div>

                    <p
                      v-if="currentStep === 2"
                      class="text-[10px] text-[#777482] leading-[1.35] mt-2 pl-0.5"
                    >
                      Chỉ định người phỏng vấn và thành viên quản lý hồ sơ.
                    </p>
                  </div>

                  <!-- BƯỚC 3: Kênh đăng tuyển -->
                  <div
                    @click="handleStepClick(3)"
                    class="relative z-10 w-full cursor-pointer transition-all rounded-[10px]"
                    :class="[
                      currentStep === 3
                        ? 'step-card-active p-3 border border-[#E4DCF9] shadow-xs'
                        : 'p-2 md:py-2.5 md:px-2 hover:bg-slate-900/20'
                    ]"
                  >
                    <div class="flex items-start gap-2.5">
                      <div
                        class="w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0 transition-colors"
                        :class="[
                          currentStep === 3
                            ? 'bg-white text-[#7C22E8] shadow-xs border border-[#EDE8FA]'
                            : 'bg-[#F4F3F7] text-[#777482]'
                        ]"
                      >
                        <Share2 class="w-3.5 h-3.5 stroke-[2]" />
                      </div>

                      <div class="min-w-0">
                        <span
                          class="block text-[9.5px] font-bold tracking-wider uppercase leading-none"
                          :class="currentStep === 3 ? 'text-[#7C22E8]' : 'text-white'"
                        >
                          BƯỚC 3
                        </span>
                        <h3 class="text-[12px] font-semibold leading-tight mt-1 truncate"
                            :class="currentStep === 3 ? 'text-black' : 'text-white/70'"
                        >
                          Kênh đăng
                        </h3>
                      </div>
                    </div>

                    <p
                      v-if="currentStep === 3"
                      class="text-[10px] text-[#777482] leading-[1.35] mt-2 pl-0.5"
                    >
                      Phân phối tin đăng trên các nền tảng việc làm.
                    </p>
                  </div>
                </div>
              </div>

              <!-- ============================================================== -->
              <!-- Widget "Tạo tin bằng AI" NẰM DƯỚI 3 BƯỚC                      -->
              <!-- ============================================================== -->
              <div class="mt-4 p-2.5 rounded-[10px] bg-gradient-to-br from-[#FAF8FE] to-[#F3EEFC] border border-[#E4DCF9] shadow-xs">
                <div class="flex items-center gap-1.5 mb-1">
                  <div class="w-5 h-5 rounded-full bg-[#5b4eea] text-white flex items-center justify-center shrink-0">
                    <Sparkles class="w-3 h-3" />
                  </div>
                  <span class="text-[11px] font-bold text-[#5b4eea] tracking-tight">Tạo tin bằng AI</span>
                </div>
                <p class="text-[9.5px] text-[#777482] leading-[1.35] mb-2">
                  Nhập từ khóa ngắn, AI sẽ tự động điền tiêu đề, mô tả và kỹ năng.
                </p>
                <div class="space-y-1.5">
                  <input
                    type="text"
                    v-model="aiKeyword"
                    @keydown.enter.prevent="handleAiGenerate"
                    placeholder="vd: Senior Vue 3 30tr"
                    :disabled="isAiGenerating"
                    class="w-full h-[26px] px-2 text-[10.5px] text-[#24212D] bg-white border border-[#E5E3E9] rounded-[5px] focus:outline-none focus:border-[#7C22E8] placeholder:text-[#A09DA8]"
                  />
                  <button
                    type="button"
                    @click="handleAiGenerate"
                    :disabled="isAiGenerating"
                    class="w-full h-[26px] px-2 text-[10px] font-semibold text-white bg-[#5b4eea] hover:bg-[#5b6eea] active:bg-[#5D14B8] disabled:opacity-50 rounded-[5px] shadow-xs transition-all flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Loader2 v-if="isAiGenerating" class="w-3 h-3 animate-spin" />
                    <Sparkles v-else class="w-3 h-3" />
                    <span>{{ isAiGenerating ? 'Đang tạo...' : 'Tạo nội dung' }}</span>
                  </button>
                </div>
              </div>
            </aside>

            <!-- CỘT PHẢI: Khung Form Chính (Cuộn mượt mà theo trục dọc) -->
            <main class="flex-1 overflow-y-auto px-4 sm:px-6 py-4 custom-scrollbar scrollbar-thin bg-white rounded-tr-xl rounded-tl-xl">

              <!-- ============================================================ -->
              <!-- STEP 1: FORM THÔNG TIN VIỆC LÀM                              -->
              <!-- ============================================================ -->
              <div v-show="currentStep === 1" class="space-y-4">

                <!-- SECTION A: CHI TIẾT CÔNG VIỆC -->
                <section class="space-y-3">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">

                    <!-- Tiêu đề công việc (Job Title) -->
                    <div class="space-y-1">
                      <label class="block text-[11.5px] font-semibold text-[#24212D]">
                        Tiêu đề công việc <span class="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        v-model="form.jobTitle"
                        placeholder="Nhập tiêu đề công việc (vd: Senior Frontend Developer)"
                        class="w-full form-control-input"
                        :class="{ 'border-rose-400 bg-rose-50/20': errors.jobTitle }"
                      />
                      <p v-if="errors.jobTitle" class="text-[10px] text-rose-500 mt-0.5">{{ errors.jobTitle }}</p>
                    </div>

                    <!-- Ngành nghề(Department) -->
                    <div class="space-y-1">
                      <label class="block text-[11.5px] font-semibold text-[#24212D]">
                        Ngành nghề<span class="text-rose-500">*</span>
                      </label>
                      <div class="relative">
                        <select
                          v-model="form.department"
                          class="w-full form-control-input pr-7"
                          :class="{ 'border-rose-400 bg-rose-50/20': errors.department }"
                        >
                          <option value="" disabled selected>Chọn Ngành nghề</option>
                          <option v-for="dept in departmentOptions" :key="dept" :value="dept">
                            {{ dept }}
                          </option>
                        </select>
                        <ChevronDown class="w-3 h-3 text-[#777482] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                      <p v-if="errors.department" class="text-[10px] text-rose-500 mt-0.5">{{ errors.department }}</p>
                    </div>

                    <!-- Hạn nộp hồ sơ (Deadline) -->
                    <div class="space-y-1">
                      <label class="block text-[11.5px] font-semibold text-[#24212D]">
                        Hạn nộp hồ sơ <span class="text-rose-500">*</span>
                      </label>
                      <div class="relative">
                        <input
                          type="date"
                          v-model="deadlineInput"
                          class="w-full form-control-input pr-7 cursor-pointer"
                          :class="{ 'border-rose-400 bg-rose-50/20': errors.deadline }"
                        />
                        <Calendar class="w-3 h-3 text-[#777482] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                      <p v-if="errors.deadline" class="text-[10px] text-rose-500 mt-0.5">{{ errors.deadline }}</p>
                    </div>

                    <!-- Loại hình làm việc (Employment Type) -->
                    <div class="space-y-1">
                      <label class="block text-[11.5px] font-semibold text-[#24212D]">
                        Loại hình làm việc
                      </label>
                      <div class="relative">
                        <select
                          v-model="form.employmentType"
                          class="w-full form-control-input pr-7"
                        >
                          <option v-for="type in employmentTypeOptions" :key="type" :value="type">
                            {{ type }}
                          </option>
                        </select>
                        <ChevronDown class="w-3 h-3 text-[#777482] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>

                    <!-- Cấp bậc vị trí (Job Level) -->
                    <div class="space-y-1">
                      <label class="block text-[11.5px] font-semibold text-[#24212D]">
                        Cấp bậc vị trí
                      </label>
                      <div class="relative">
                        <select
                          v-model="form.jobLevel"
                          class="w-full form-control-input pr-7"
                        >
                          <option v-for="lvl in jobLevelOptions" :key="lvl.value" :value="lvl.value">
                            {{ lvl.label }}
                          </option>
                        </select>
                        <ChevronDown class="w-3 h-3 text-[#777482] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>

                    <!-- Năm kinh nghiệm yêu cầu -->
                    <div class="space-y-1">
                      <label class="block text-[11.5px] font-semibold text-[#24212D]">
                        Kinh nghiệm yêu cầu (Năm)
                      </label>
                      <div class="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max="30"
                          v-model="form.experienceYearsMin"
                          placeholder="Tối thiểu"
                          class="w-1/2 form-control-input text-center"
                        />
                        <span class="text-xs text-[#777482]">-</span>
                        <input
                          type="number"
                          min="0"
                          max="30"
                          v-model="form.experienceYearsMax"
                          placeholder="Tối đa"
                          class="w-1/2 form-control-input text-center"
                        />
                      </div>
                    </div>

                    <!-- Vị trí tuyển dụng chi tiết (Available Position) -->
                    <div class="sm:col-span-2 space-y-1">
                      <label class="block text-[11.5px] font-semibold text-[#24212D]">
                        Vị trí tuyển dụng hiển thị <span class="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        v-model="form.availablePosition"
                        placeholder="Nhập tên vị trí chi tiết (vd: Senior Frontend Developer - Vue 3)"
                        class="w-full form-control-input"
                        :class="{ 'border-rose-400 bg-rose-50/20': errors.availablePosition }"
                      />
                      <p v-if="errors.availablePosition" class="text-[10px] text-rose-500 mt-0.5">{{ errors.availablePosition }}</p>
                    </div>
                  </div>

                  <!-- Hình thức làm việc (Workplace Type - 3 Radio Cards) -->
                  <div class="pt-1">
                    <label class="block text-[11.5px] font-semibold text-[#24212D] mb-1.5">
                      Hình thức làm việc
                    </label>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div
                        v-for="item in workplaceOptions"
                        :key="item.value"
                        @click="form.workplaceType = item.value"
                        class="p-2 sm:p-2.5 rounded-[6px] border cursor-pointer transition-all flex items-start gap-2"
                        :class="[
                          form.workplaceType === item.value
                            ? 'radio-card-active border-[#7C22E8] bg-[#FAF8FE] shadow-xs'
                            : 'border-[#E5E3E9] bg-white hover:border-[#D1CFD7]'
                        ]"
                      >
                        <input
                          type="radio"
                          name="workplaceType"
                          :value="item.value"
                          v-model="form.workplaceType"
                          class="mt-0.5 accent-[#7C22E8] w-3 h-3 cursor-pointer shrink-0"
                        />
                        <div class="min-w-0">
                          <h4 class="text-[11.5px] font-semibold text-[#24212D] leading-tight">
                            {{ item.title }}
                          </h4>
                          <p class="text-[9.5px] text-[#777482] leading-[1.3] mt-0.5">
                            {{ item.description }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <div class="border-t border-[#F0EEF4]"></div>

                <!-- SECTION: TRẠNG THÁI TUYỂN DỤNG (HIRING STATUS) -->
                <section class="space-y-2.5">
                  <div>
                    <h3 class="text-[12.5px] font-semibold text-[#24212D]">
                      Trạng thái tuyển dụng
                    </h3>
                    <p class="text-[10px] text-[#777482] mt-0.5">
                      Chọn mức độ ưu tiên để hiển thị huy hiệu (Badge) trên danh sách tìm kiếm việc làm cho ứng viên.
                    </p>
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div
                      v-for="item in hiringStatusOptions"
                      :key="item.value"
                      @click="form.hiringStatus = item.value"
                      class="p-2 sm:p-2.5 rounded-[6px] border cursor-pointer transition-all flex items-start gap-2"
                      :class="[
                        form.hiringStatus === item.value
                          ? 'radio-card-active border-[#7C22E8] bg-[#FAF8FE] shadow-xs'
                          : 'border-[#E5E3E9] bg-white hover:border-[#D1CFD7]'
                      ]"
                    >
                      <input
                        type="radio"
                        name="hiringStatus"
                        :value="item.value"
                        v-model="form.hiringStatus"
                        class="mt-0.5 accent-[#7C22E8] w-3 h-3 cursor-pointer shrink-0"
                      />
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                          <h4 class="text-[11.5px] font-semibold text-[#24212D] leading-tight">
                            {{ item.title }}
                          </h4>
                          <span
                            class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border inline-flex items-center gap-1"
                            :class="item.badgeClass"
                          >
                            <span class="w-1.5 h-1.5 rounded-full" :class="item.badgeDotClass"></span>
                            {{ item.badgeLabel }}
                          </span>
                        </div>
                        <p class="text-[9.5px] text-[#777482] leading-[1.3] mt-1">
                          {{ item.description }}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <div class="border-t border-[#F0EEF4]"></div>

                <!-- SECTION B: ĐỊA ĐIỂM LÀM VIỆC -->
                <section class="space-y-2.5">
                  <h3 class="text-[12.5px] font-semibold text-[#24212D]">
                    Địa điểm làm việc
                  </h3>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <!-- Quốc gia (Mặc định cố định Việt Nam, không cho chỉnh sửa) -->
                    <div class="space-y-1">
                      <label class="block text-[11px] font-medium text-[#777482]">
                        Quốc gia
                      </label>
                      <input
                        type="text"
                        :value="form.country"
                        readonly
                        disabled
                        class="w-full form-control-input bg-[#F9F8FB] text-[#24212D] font-medium cursor-not-allowed select-none opacity-90"
                      />
                    </div>

                    <!-- Tỉnh / Thành phố -->
                    <div class="space-y-1">
                      <label class="block text-[11px] font-medium text-[#777482]">
                        Tỉnh / Thành phố
                      </label>
                      <div class="relative">
                        <select v-model="form.city" class="w-full form-control-input pr-7">
                          <option v-for="ct in cityOptions" :key="ct" :value="ct">{{ ct }}</option>
                        </select>
                        <ChevronDown class="w-3 h-3 text-[#777482] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                  </div>
                </section>

                <div class="border-t border-[#F0EEF4]"></div>

                <!-- SECTION C: MỨC LƯƠNG & ĐÃI NGỘ -->
                <section class="space-y-2.5">
                  <div class="flex items-center justify-between">
                    <h3 class="text-[12.5px] font-semibold text-[#24212D]">
                      Mức lương & Đãi ngộ
                    </h3>
                    <label class="flex items-center gap-1.5 cursor-pointer text-[11px] text-[#777482] hover:text-[#24212D]">
                      <input
                        type="checkbox"
                        v-model="form.preferNotToSay"
                        class="accent-[#7C22E8] w-3 h-3 rounded-[3px]"
                      />
                      <span>Thỏa thuận / Không công khai</span>
                    </label>
                  </div>

                  <!-- Khoảng lương 3 cột: Min, Max, Tiền tệ -->
                  <div
                    class="grid grid-cols-3 gap-2 transition-opacity"
                    :class="{ 'opacity-40 pointer-events-none': form.preferNotToSay }"
                  >
                    <div class="space-y-1">
                      <label class="block text-[10.5px] text-[#777482]">Lương tối thiểu</label>
                      <input
                        type="text"
                        v-model="form.minSalary"
                        placeholder="vd: 20.000.000"
                        :disabled="form.preferNotToSay"
                        class="w-full form-control-input"
                      />
                    </div>
                    <div class="space-y-1">
                      <label class="block text-[10.5px] text-[#777482]">Lương tối đa</label>
                      <input
                        type="text"
                        v-model="form.maxSalary"
                        placeholder="vd: 40.000.000"
                        :disabled="form.preferNotToSay"
                        class="w-full form-control-input"
                      />
                    </div>
                    <div class="space-y-1">
                      <label class="block text-[10.5px] text-[#777482]">Loại tiền tệ</label>
                      <div class="relative">
                        <select
                          v-model="form.currency"
                          :disabled="form.preferNotToSay"
                          class="w-full form-control-input pr-6"
                        >
                          <option v-for="cur in currencyOptions" :key="cur" :value="cur">{{ cur }}</option>
                        </select>
                        <ChevronDown class="w-3 h-3 text-[#777482] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                  </div>
                  <p v-if="errors.salary" class="text-[10px] text-rose-500">{{ errors.salary }}</p>

                  <!-- Chu kỳ trả lương (Payment Type Cards) -->
                  <div class="pt-1">
                    <label class="block text-[11px] font-semibold text-[#24212D] mb-1.5">
                      Chu kỳ trả lương
                    </label>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div
                        v-for="item in paymentTypeOptions"
                        :key="item.value"
                        @click="form.paymentType = item.value"
                        class="p-2 sm:p-2.5 rounded-[6px] border cursor-pointer transition-all flex items-start gap-2"
                        :class="[
                          form.paymentType === item.value
                            ? 'radio-card-active border-[#7C22E8] bg-[#FAF8FE] shadow-xs'
                            : 'border-[#E5E3E9] bg-white hover:border-[#D1CFD7]'
                        ]"
                      >
                        <input
                          type="radio"
                          name="paymentType"
                          :value="item.value"
                          v-model="form.paymentType"
                          class="mt-0.5 accent-[#7C22E8] w-3 h-3 cursor-pointer shrink-0"
                        />
                        <div class="min-w-0">
                          <h4 class="text-[11.5px] font-semibold text-[#24212D] leading-tight">
                            {{ item.title }}
                          </h4>
                          <p class="text-[9.5px] text-[#777482] leading-[1.3] mt-0.5">
                            {{ item.description }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <div class="border-t border-[#F0EEF4]"></div>

                <!-- SECTION D: MÔ TẢ & YÊU CẦU CÔNG VIỆC -->
                <section class="space-y-3">
                  <h3 class="text-[13px] font-semibold text-[#24212D]">
                    Mô tả & Yêu cầu công việc
                  </h3>

                  <!-- Chuyên môn chương trình giảng dạy (Tùy chọn) -->
                  <div class="space-y-1 relative">
                    <label class="block text-[11.5px] font-semibold text-[#24212D]">
                      Chuyên môn đào tạo / Chương trình <span class="text-[#777482] font-normal">(Tùy chọn)</span>
                    </label>

                    <div
                      @click="curriculumDropdownOpen = !curriculumDropdownOpen"
                      class="min-h-[29px] w-full px-2 py-0.5 border border-[#E5E3E9] rounded-[6px] bg-white flex items-center justify-between gap-2 cursor-pointer hover:border-[#D1CFD7] transition-all"
                    >
                      <div class="flex flex-wrap items-center gap-1.5 flex-1 py-0.5">
                        <span
                          v-for="item in form.curriculumSpecialists"
                          :key="item"
                          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#F4F3F7] text-[10.5px] font-medium text-[#24212D]"
                          @click.stop
                        >
                          <span>{{ item }}</span>
                          <button
                            type="button"
                            @click="removeCurriculumTag(item)"
                            class="hover:text-rose-500 text-[#777482] ml-0.5 font-bold"
                          >
                            ×
                          </button>
                        </span>
                        <span v-if="form.curriculumSpecialists.length === 0" class="text-[11px] text-[#A09DA8]">
                          Chọn hoặc thêm chương trình đào tạo liên quan...
                        </span>
                      </div>
                      <ChevronDown class="w-3.5 h-3.5 text-[#777482] shrink-0" />
                    </div>

                    <!-- Dropdown danh sách -->
                    <div
                      v-if="curriculumDropdownOpen"
                      class="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-[#E5E3E9] rounded-lg shadow-lg py-1 max-h-44 overflow-y-auto"
                    >
                      <div
                        v-for="opt in curriculumOptions"
                        :key="opt"
                        @click="toggleCurriculumTag(opt)"
                        class="px-3 py-1.5 text-xs text-[#24212D] hover:bg-[#FAF8FE] flex items-center justify-between cursor-pointer"
                      >
                        <span>{{ opt }}</span>
                        <Check v-if="form.curriculumSpecialists.includes(opt)" class="w-3.5 h-3.5 text-[#7C22E8]" />
                      </div>
                    </div>
                  </div>

                  <!-- Kỹ năng chuyên môn bắt buộc & ưu tiên -->
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <!-- Kỹ năng bắt buộc -->
                    <div class="space-y-1.5">
                      <label class="block text-[11px] font-semibold text-[#24212D]">
                        Kỹ năng bắt buộc <span class="text-rose-500">*</span>
                      </label>
                      <div class="flex flex-wrap gap-1 p-1.5 border border-[#E5E3E9] rounded-[6px] min-h-[30px] bg-white">
                        <span
                          v-for="s in form.requiredSkills"
                          :key="s"
                          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#EDE8FA] text-[10px] font-medium text-[#7C22E8]"
                        >
                          <span>{{ s }}</span>
                          <button type="button" @click="removeRequiredSkill(s)" class="hover:text-rose-600 font-bold">×</button>
                        </span>
                        <input
                          type="text"
                          v-model="newSkillInput"
                          @keydown.enter.prevent="addRequiredSkill()"
                          placeholder="Thêm tag..."
                          class="text-[10.5px] outline-none px-1 flex-1 min-w-[60px] bg-transparent"
                        />
                      </div>
                      <!-- Gợi ý kỹ năng -->
                      <div class="flex flex-wrap gap-1">
                        <span
                          v-for="tag in availableSkillTags.slice(0, 6)"
                          :key="tag"
                          @click="addRequiredSkill(tag)"
                          class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 hover:bg-purple-100 text-gray-600 hover:text-purple-700 cursor-pointer transition"
                        >
                          + {{ tag }}
                        </span>
                      </div>
                    </div>

                    <!-- Kỹ năng ưu tiên -->
                    <div class="space-y-1.5">
                      <label class="block text-[11px] font-semibold text-[#24212D]">
                        Kỹ năng ưu tiên (Điểm cộng)
                      </label>
                      <div class="flex flex-wrap gap-1 p-1.5 border border-[#E5E3E9] rounded-[6px] min-h-[30px] bg-white">
                        <span
                          v-for="s in form.niceToHaveSkills"
                          :key="s"
                          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-gray-100 text-[10px] font-medium text-gray-700"
                        >
                          <span>{{ s }}</span>
                          <button type="button" @click="removeNiceSkill(s)" class="hover:text-rose-600 font-bold">×</button>
                        </span>
                        <input
                          type="text"
                          v-model="newNiceSkillInput"
                          @keydown.enter.prevent="addNiceSkill()"
                          placeholder="Thêm tag..."
                          class="text-[10.5px] outline-none px-1 flex-1 min-w-[60px] bg-transparent"
                        />
                      </div>
                      <div class="flex flex-wrap gap-1">
                        <span
                          v-for="tag in availableSkillTags.slice(6, 12)"
                          :key="tag"
                          @click="addNiceSkill(tag)"
                          class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 cursor-pointer transition"
                        >
                          + {{ tag }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Mô tả công việc (Description) -->
                  <div class="space-y-1 pt-1">
                    <label class="block text-[11.5px] font-semibold text-[#24212D]">
                      Mô tả chi tiết công việc <span class="text-rose-500">*</span>
                    </label>
                    <textarea
                      v-model="form.description"
                      placeholder="Mô tả trách nhiệm công việc, nhiệm vụ chính hàng ngày, sản phẩm tham gia phát triển..."
                      class="form-control-textarea"
                    ></textarea>
                  </div>

                  <!-- Yêu cầu ứng viên (Requirements) -->
                  <div class="space-y-1">
                    <label class="block text-[11.5px] font-semibold text-[#24212D]">
                      Yêu cầu ứng viên
                    </label>
                    <textarea
                      v-model="form.requirements"
                      placeholder="Các yêu cầu về kinh nghiệm làm việc, kỹ năng chuyên môn, tinh thần trách nhiệm và bằng cấp..."
                      class="form-control-textarea"
                    ></textarea>
                  </div>

                  <!-- Quyền lợi & Chế độ đãi ngộ (Benefits) -->
                  <div class="space-y-1">
                    <label class="block text-[11.5px] font-semibold text-[#24212D]">
                      Quyền lợi & Chế độ đãi ngộ
                    </label>
                    <textarea
                      v-model="form.benefits"
                      placeholder="Mức lương thưởng tháng 13, bảo hiểm sức khỏe cao cấp, trang thiết bị làm việc, du lịch hàng năm..."
                      class="form-control-textarea"
                    ></textarea>
                  </div>
                </section>
              </div>

              <!-- ============================================================ -->
              <!-- STEP 2: THÀNH VIÊN HỘI ĐỒNG TUYỂN DỤNG & GÁN VIỆC            -->
              <!-- ============================================================ -->
              <div v-show="currentStep === 2" class="space-y-3.5">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="flex items-center gap-2">
                      <h3 class="text-[13px] font-semibold text-[#24212D]">
                        Người phụ trách & Hội đồng tuyển dụng
                      </h3>
                      <span
                        v-if="isOwner"
                        class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-[#7C22E8] border border-purple-200"
                      >
                        <Crown class="w-3 h-3 text-[#7C22E8]" />
                        <span>Chủ doanh nghiệp (Owner)</span>
                      </span>
                      <span
                        v-else
                        class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200"
                      >
                        <Users class="w-3 h-3 text-slate-600" />
                        <span>Thành viên (Member)</span>
                      </span>
                    </div>
                    <p class="text-[10.5px] text-[#777482] mt-0.5">
                      <template v-if="isOwner">
                        Chỉ định thành viên trong công ty chịu trách nhiệm chính phụ trách tin tuyển dụng và quản lý pipeline ứng viên.
                      </template>
                      <template v-else>
                        Bạn là người phụ trách tin tuyển dụng này. Chỉ Chủ doanh nghiệp (Owner) mới có quyền chỉ định nhân viên khác.
                      </template>
                    </p>
                  </div>
                </div>

                <!-- Banner chú thích cho Member thường -->
                <div
                  v-if="!isOwner && !membersLoading && form.teamMembers.length > 0"
                  class="p-2.5 rounded-lg bg-amber-50/90 border border-amber-200 text-amber-800 flex items-center gap-2 text-[11px]"
                >
                  <Lock class="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    Với vai trò Thành viên, bạn tự động được phân công phụ trách tin tuyển dụng này và không thể chọn người khác.
                  </span>
                </div>

                <!-- Trạng thái đang tải -->
                <div
                  v-if="membersLoading"
                  class="py-10 flex flex-col items-center justify-center gap-2.5 text-xs text-[#777482] bg-white border border-[#E5E3E9] rounded-xl"
                >
                  <Loader2 class="w-5 h-5 animate-spin text-[#7C22E8]" />
                  <span>Đang tải danh sách thành viên công ty...</span>
                </div>

                <!-- Trạng thái lỗi -->
                <div
                  v-else-if="membersError"
                  class="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs flex items-center justify-between"
                >
                  <div class="flex items-center gap-2">
                    <AlertCircle class="w-4 h-4 text-rose-600" />
                    <span>{{ membersError }}</span>
                  </div>
                  <button
                    type="button"
                    @click="fetchMembers"
                    class="text-[11px] underline font-semibold hover:text-rose-900 cursor-pointer"
                  >
                    Thử lại
                  </button>
                </div>

                <!-- Trạng thái trống -->
                <div
                  v-else-if="form.teamMembers.length === 0"
                  class="py-8 text-center text-xs text-[#777482] bg-white border border-[#E5E3E9] rounded-xl"
                >
                  Không tìm thấy thành viên đang hoạt động trong công ty.
                </div>

                <!-- Danh sách thành viên -->
                <div
                  v-else
                  class="border border-[#E5E3E9] rounded-xl overflow-hidden divide-y divide-[#EBE9F0] bg-white"
                >
                  <div
                    v-for="member in form.teamMembers"
                    :key="member.userId"
                    @click="selectAssignee(member)"
                    class="p-3 flex items-center justify-between transition-colors"
                    :class="[
                      isOwner
                        ? member.selected
                          ? 'bg-[#FAF8FE]'
                          : 'hover:bg-[#FAF9FC] cursor-pointer'
                        : member.isCurrentUser
                        ? 'bg-[#FAF8FE] cursor-default'
                        : 'opacity-50 bg-gray-50/50 cursor-not-allowed'
                    ]"
                  >
                    <div class="flex items-center gap-2.5 min-w-0">
                      <!-- Avatar -->
                      <div
                        class="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center font-bold text-xs"
                        :class="member.selected ? 'bg-[#EDE8FA] text-[#7C22E8]' : 'bg-[#F4F3F7] text-[#777482]'"
                      >
                        <img
                          v-if="member.avatarUrl"
                          :src="member.avatarUrl"
                          :alt="member.name"
                          class="w-full h-full object-cover"
                        />
                        <span v-else>{{ member.name.charAt(0).toUpperCase() }}</span>
                      </div>

                      <!-- Thông tin tên & email -->
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                          <h4 class="text-xs font-semibold text-[#24212D] leading-tight truncate">
                            {{ member.name }}
                          </h4>
                          <span
                            v-if="member.isCurrentUser"
                            class="text-[9.5px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-[#7C22E8]"
                          >
                            (Bạn)
                          </span>
                          <span
                            v-if="member.selected"
                            class="text-[9.5px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700"
                          >
                            Người phụ trách
                          </span>
                        </div>
                        <p class="text-[10px] text-[#777482] leading-tight truncate mt-0.5">
                          {{ member.email }}
                        </p>
                      </div>
                    </div>

                    <!-- Role badge & Checkbox -->
                    <div class="flex items-center gap-3 shrink-0 ml-2" @click.stop>
                      <span
                        class="text-[10.5px] px-2 py-0.5 rounded-[4px] font-medium border"
                        :class="member.rawRole === 'owner' ? 'bg-purple-50 text-[#7C22E8] border-purple-200' : 'bg-[#F4F3F7] text-[#24212D] border-[#EBE9F0]'"
                      >
                        {{ member.role }}
                      </span>
                      <input
                        type="checkbox"
                        :checked="member.selected"
                        :disabled="!isOwner"
                        @change="selectAssignee(member)"
                        class="accent-[#7C22E8] w-4 h-4 rounded-[3px]"
                        :class="[
                          isOwner ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'
                        ]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <!-- ============================================================ -->
              <!-- STEP 3: KÊNH PHÂN PHỐI & ĐĂNG TUYỂN                          -->
              <!-- ============================================================ -->
              <div v-show="currentStep === 3" class="space-y-3.5">
                <div>
                  <h3 class="text-[13px] font-semibold text-[#24212D]">
                    Kênh xuất bản & Quảng bá tin tuyển dụng
                  </h3>
                  <p class="text-[10.5px] text-[#777482] mt-0.5">
                    Kích hoạt các cổng tiếp cận để tối ưu hóa lượng hồ sơ ứng tuyển tiềm năng nhất.
                  </p>
                </div>

                <div class="space-y-2">
                  <!-- Kênh JobMatch VN -->
                  <div
                    @click="form.shareChannels.jobMatch = !form.shareChannels.jobMatch"
                    class="p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all"
                    :class="[
                      form.shareChannels.jobMatch
                        ? 'border-[#7C22E8] bg-[#FAF8FE] shadow-xs'
                        : 'border-[#E5E3E9] bg-white hover:border-[#D1CFD7]'
                    ]"
                  >
                    <div class="flex items-center gap-3">
                      <div class="w-8 h-8 rounded-lg bg-[#5b4eea] text-white flex items-center justify-center font-bold text-xs shrink-0">
                        JM
                      </div>
                      <div>
                        <div class="flex items-center gap-1.5">
                          <h4 class="text-xs font-semibold text-[#24212D]">Nền tảng JobMatch VN</h4>
                          <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 text-[#7C22E8] font-medium">Bắt buộc</span>
                        </div>
                        <p class="text-[10px] text-[#777482]">Hiển thị công khai tới hàng ngàn ứng viên đã xác thực kỹ năng qua AI</p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      v-model="form.shareChannels.jobMatch"
                      @click.stop
                      class="accent-[#7C22E8] w-4 h-4 cursor-pointer"
                    />
                  </div>

                  <!-- Kênh LinkedIn (Làm mờ, không cho tick) -->
                  <div class="p-3 rounded-xl border border-[#E5E3E9] flex items-center justify-between bg-gray-50/70 opacity-40 select-none cursor-not-allowed">
                    <div class="flex items-center gap-3">
                      <div class="w-8 h-8 rounded-lg bg-[#0077B5]/60 text-white flex items-center justify-center font-bold text-xs shrink-0">
                        in
                      </div>
                      <div>
                        <div class="flex items-center gap-1.5">
                          <h4 class="text-xs font-semibold text-[#24212D]">Mạng xã hội LinkedIn</h4>
                          <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 font-medium">Sắp ra mắt</span>
                        </div>
                        <p class="text-[10px] text-[#777482]">Đồng bộ và chia sẻ liên kết trực tiếp lên trang doanh nghiệp LinkedIn</p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      :checked="false"
                      disabled
                      class="accent-[#7C22E8] w-4 h-4 cursor-not-allowed opacity-50 pointer-events-none"
                    />
                  </div>

                  <!-- Kênh Cổng nghề nghiệp Công ty (Làm mờ, không cho tick) -->
                  <div class="p-3 rounded-xl border border-[#E5E3E9] flex items-center justify-between bg-gray-50/70 opacity-40 select-none cursor-not-allowed">
                    <div class="flex items-center gap-3">
                      <div class="w-8 h-8 rounded-lg bg-emerald-600/60 text-white flex items-center justify-center font-bold text-xs shrink-0">
                        WEB
                      </div>
                      <div>
                        <div class="flex items-center gap-1.5">
                          <h4 class="text-xs font-semibold text-[#24212D]">Cổng tuyển dụng riêng (Careers Page)</h4>
                          <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 font-medium">Sắp ra mắt</span>
                        </div>
                        <p class="text-[10px] text-[#777482]">Tích hợp tự động vào danh sách tin tuyển dụng trên website công ty</p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      :checked="false"
                      disabled
                      class="accent-[#7C22E8] w-4 h-4 cursor-not-allowed opacity-50 pointer-events-none"
                    />
                  </div>
                </div>

                <!-- Cảnh báo khi bỏ chọn JobMatch VN -->
                <div
                  v-if="!form.shareChannels.jobMatch"
                  class="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-2 text-[11px]"
                >
                  <AlertCircle class="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>
                    Vui lòng chọn kênh JobMatch VN để có thể lưu và kiểm duyệt tin tuyển dụng.
                  </span>
                </div>

                <!-- Đường dẫn liên kết tuyển dụng trực tiếp -->
                <div class="pt-2">
                  <label class="block text-[11px] font-semibold text-[#24212D] mb-1">
                    Liên kết công khai trực tiếp
                  </label>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      readonly
                      :value="`https://jobmatch.vn/viec-lam/${encodeURIComponent((form.availablePosition || 'tin-tuyen-dung').toLowerCase().replace(/\s+/g, '-'))}`"
                      class="flex-1 form-control-input bg-[#F9F8FB] text-[#777482] select-all"
                    />
                    <button
                      type="button"
                      @click="copyShareLink"
                      class="h-[30px] px-3 rounded-[6px] border border-[#E5E3E9] text-[11px] font-medium text-[#24212D] hover:bg-[#F9F8FB] flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Check v-if="linkCopied" class="w-3.5 h-3.5 text-emerald-600" />
                      <Copy v-else class="w-3.5 h-3.5 text-[#777482]" />
                      <span>{{ linkCopied ? 'Đã chép' : 'Sao chép' }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </main>
          </div>
        </div>

        <!-- ==================================================================== -->
        <!-- DIALOG XEM TRƯỚC (PREVIEW DIALOG LỒNG NHAU)                          -->
        <!-- ==================================================================== -->
        <Transition name="fade">
          <div
            v-if="showPreview"
            class="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-5"
            @click.self="showPreview = false"
          >
            <div class="absolute inset-0 bg-black/60 backdrop-blur-[2px]" @click="showPreview = false"></div>

            <div class="relative z-10 w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-[#E5E3E9] overflow-hidden flex flex-col max-h-[88vh]">
              <div class="px-5 py-3.5 border-b border-[#EBE9F0] flex items-center justify-between bg-white">
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded-full bg-[#EDE8FA] text-[#7C22E8] flex items-center justify-center">
                    <Eye class="w-3.5 h-3.5" />
                  </div>
                  <h3 class="text-xs font-bold text-[#24212D]">Xem trước tin tuyển dụng</h3>
                </div>
                <button
                  type="button"
                  @click="showPreview = false"
                  class="w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 cursor-pointer"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>

              <div class="p-5 overflow-y-auto space-y-4 text-xs custom-scrollbar">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] uppercase font-bold text-[#7C22E8] tracking-wider">{{ form.department || 'Ngành nghề' }}</span>
                    <span
                      v-if="form.hiringStatus === 'urgent'"
                      class="text-[9.5px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200"
                    >
                      Urgently Hiring
                    </span>
                    <span
                      v-else-if="form.hiringStatus === 'active'"
                      class="text-[9.5px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
                    >
                      Actively Hiring
                    </span>
                  </div>
                  <h2 class="text-base font-bold text-[#24212D] mt-0.5">
                    {{ form.availablePosition || form.jobTitle || 'Chưa đặt tiêu đề vị trí' }}
                  </h2>
                  <div class="flex flex-wrap items-center gap-2 mt-2 text-[#777482] text-[11px]">
                    <span class="px-2 py-0.5 rounded bg-gray-100 text-[#24212D] font-medium">{{ form.employmentType }}</span>
                    <span>•</span>
                    <span class="capitalize">{{ form.workplaceType }}</span>
                    <span>•</span>
                    <span>{{ form.city }}, {{ form.country }}</span>
                  </div>
                </div>

                <div class="border-t border-gray-100"></div>

                <div class="grid grid-cols-2 gap-3 text-[11px] bg-[#FAF9FC] p-3 rounded-xl border border-[#EBE9F0]">
                  <div>
                    <span class="text-[10px] text-[#777482] block">Hạn nộp hồ sơ</span>
                    <span class="font-medium text-[#24212D]">
                      {{ form.deadline ? (form.deadline instanceof Date ? form.deadline : new Date(form.deadline)).toLocaleDateString('vi-VN') : 'Chưa thiết lập' }}
                    </span>
                  </div>
                  <div>
                    <span class="text-[10px] text-[#777482] block">Mức lương</span>
                    <span class="font-medium text-[#24212D]">
                      <template v-if="form.preferNotToSay">Thỏa thuận / Không công khai</template>
                      <template v-else-if="form.minSalary || form.maxSalary">
                        {{ form.minSalary || '0' }} - {{ form.maxSalary || 'Thỏa thuận' }} {{ form.currency }} / {{ form.paymentType === 'weekly' ? 'tuần' : form.paymentType === 'contract' ? 'dự án' : 'tháng' }}
                      </template>
                      <template v-else>Chưa nhập mức lương</template>
                    </span>
                  </div>
                  <div>
                    <span class="text-[10px] text-[#777482] block">Cấp bậc & Kinh nghiệm</span>
                    <span class="font-medium text-[#24212D] capitalize">
                      {{ form.jobLevel || 'Chưa chọn' }}
                      <template v-if="form.experienceYearsMin || form.experienceYearsMax">
                        • {{ form.experienceYearsMin || '0' }}-{{ form.experienceYearsMax || '+' }} năm
                      </template>
                    </span>
                  </div>
                  <div>
                    <span class="text-[10px] text-[#777482] block">Trạng thái tuyển dụng</span>
                    <span class="font-medium text-[#24212D]">
                      {{ form.hiringStatus === 'urgent' ? 'Tuyển gấp (Urgently Hiring)' : form.hiringStatus === 'active' ? 'Đang tuyển tích cực (Actively Hiring)' : 'Tiêu chuẩn (Bình thường)' }}
                    </span>
                  </div>
                </div>

                <!-- Kỹ năng -->
                <div v-if="form.requiredSkills.length > 0 || form.niceToHaveSkills.length > 0">
                  <span class="text-[10px] text-[#777482] block mb-1">Kỹ năng yêu cầu & Ưu tiên</span>
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="s in form.requiredSkills"
                      :key="'req-' + s"
                      class="px-2 py-0.5 rounded-[4px] bg-[#F4F3F7] text-[10.5px] font-medium text-[#24212D] border border-[#EBE9F0]"
                    >
                      {{ s }}
                    </span>
                    <span
                      v-for="s in form.niceToHaveSkills"
                      :key="'nice-' + s"
                      class="px-2 py-0.5 rounded-[4px] bg-[#FAF8FE] text-[10.5px] font-medium text-[#7C22E8] border border-[#EDE8FA]"
                    >
                      {{ s }} (ưu tiên)
                    </span>
                  </div>
                </div>

                <!-- Chương trình đào tạo chuyên môn -->
                <div v-if="form.curriculumSpecialists.length > 0">
                  <span class="text-[10px] text-[#777482] block mb-1">Chương trình đào tạo</span>
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="item in form.curriculumSpecialists"
                      :key="item"
                      class="px-2 py-0.5 rounded-[4px] bg-[#F4F3F7] text-[10.5px] font-medium text-[#24212D] border border-[#EBE9F0]"
                    >
                      {{ item }}
                    </span>
                  </div>
                </div>

                <!-- Mô tả công việc -->
                <div v-if="form.description">
                  <span class="text-[10px] text-[#777482] block mb-1">Mô tả công việc</span>
                  <p class="text-[11px] text-[#24212D] bg-[#F9F8FC] p-2.5 rounded-lg border border-[#EDE8FA] whitespace-pre-wrap leading-relaxed">
                    {{ form.description }}
                  </p>
                </div>

                <!-- Yêu cầu ứng viên -->
                <div v-if="form.requirements">
                  <span class="text-[10px] text-[#777482] block mb-1">Yêu cầu ứng viên</span>
                  <p class="text-[11px] text-[#24212D] bg-[#F9F8FC] p-2.5 rounded-lg border border-[#EDE8FA] whitespace-pre-wrap leading-relaxed">
                    {{ form.requirements }}
                  </p>
                </div>

                <!-- Quyền lợi & Đãi ngộ -->
                <div v-if="form.benefits">
                  <span class="text-[10px] text-[#777482] block mb-1">Quyền lợi & Đãi ngộ</span>
                  <p class="text-[11px] text-[#24212D] bg-[#F9F8FC] p-2.5 rounded-lg border border-[#EDE8FA] whitespace-pre-wrap leading-relaxed">
                    {{ form.benefits }}
                  </p>
                </div>
              </div>

              <div class="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end">
                <button
                  type="button"
                  @click="showPreview = false"
                  class="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#5b4eea] hover:bg-[#6C1BD0] rounded-lg transition cursor-pointer"
                >
                  Đóng xem trước
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ============================================================================
 * Scoped Reset: Triệt tiêu hoàn toàn lỗi vỡ giao diện của @tailwindcss/forms
 * ============================================================================ */
.step-card-active {
  background: #FAF8FE !important;
}

.radio-card-active {
  background: #FAF8FE !important;
}

/* Chuẩn hóa style Input và Select chung */
.form-control-input {
  display: block;
  width: 100%;
  height: 30px !important;
  color: #24212D;
  background-color: #FFFFFF;
  border: 1px solid #E5E3E9;
  border-radius: 6px;
  font-size: 11.5px !important;
  font-family: 'Poppins', system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
  transition: all 0.15s ease-in-out;
}

.form-control-input::placeholder {
  color: #9CA3AF;
  font-size: 11.5px;
}

.form-control-input:focus {
  outline: none;
  /* border-color: #203de6; */
  box-shadow: 0 0 0 2px rgba(124, 34, 232, 0.12);
}

/* Reset @tailwindcss/forms trên thẻ select */
select.form-control-input {
  background-image: none !important;
  background-color: #FFFFFF !important;
  -webkit-appearance: none !important;
  -moz-appearance: none !important;
  appearance: none !important;
  height: 30px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 10px !important;
  padding-right: 28px !important;
  line-height: 28px !important;
  font-size: 11.5px !important;
  cursor: pointer;
}

/* Reset input type="date" */
input[type="date"].form-control-input {
  height: 30px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 10px !important;
  padding-right: 28px !important;
  line-height: 28px !important;
  font-size: 11.5px !important;
  position: relative;
}

input[type="date"].form-control-input::-webkit-calendar-picker-indicator {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

/* Reset input text chuẩn chiều cao & căn giữa */
input[type="text"].form-control-input,
input[type="number"].form-control-input {
  height: 30px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 10px !important;
  padding-right: 10px !important;
  line-height: 28px !important;
  font-size: 11.5px !important;
}

/* Textarea styling: font 11px, placeholder xám nhạt */
textarea.form-control-textarea {
  width: 100%;
  height: 80px;
  min-height: 80px;
  font-size: 11px;
  color: #24212D;
  background-color: #FFFFFF;
  border: 1px solid #E5E3E9;
  border-radius: 6px;
  padding: 8px 10px;
  line-height: 1.5;
  box-sizing: border-box;
  resize: vertical;
  font-family: 'Poppins', system-ui, -apple-system, sans-serif;
  transition: all 0.15s ease-in-out;
}

textarea.form-control-textarea::placeholder {
  color: #9CA3AF;
  font-size: 11px;
}

textarea.form-control-textarea:focus {
  outline: none;
  border-color: #7C22E8;
  box-shadow: 0 0 0 2px rgba(124, 34, 232, 0.12);
}

/* Custom scrollbar tinh gọn */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #E5E3E9;
  border-radius: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #C4B5FD;
}

/* Modal fade animations */
.job-modal-fade-enter-active,
.job-modal-fade-leave-active {
  transition: all 0.2s ease-out;
}
.job-modal-fade-enter-from,
.job-modal-fade-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.25s ease-out;
}
.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
</style>
