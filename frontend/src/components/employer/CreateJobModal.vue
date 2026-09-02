<script setup lang="ts">
/**
 * CreateJobModal — modal tạo job mới, dùng từ PostedJobsView.
 *
 * Flow:
 *   1. Mở modal → fetch company của user hiện tại (GET /companies/me).
 *      - Không có company → hiện empty state + CTA "Tạo công ty trước".
 *      - Có company    → hiện form, pre-fill companyId.
 *   2. (Tuỳ chọn) Generate JD với AI:
 *      - User nhập keyword (vd "Backend NodeJS lương 25tr").
 *      - Click "Generate" → POST /jobs/generate → fill vào form các field
 *        title/description/requirements/skills/jobLevel/jobType/salary.
 *      - Có rate-limit + quota → nếu fail 402 sẽ toast "Đã hết lượt".
 *   3. User chỉnh tay các field.
 *   4. Submit → POST /jobs → emit `created` với new jobId → parent navigate.
 *
 * Props / emits:
 *   - `open` (v-model)  : boolean.
 *   - emits: `update:open`, `created(jobId: string)`.
 *
 * Behavior:
 *   - Teleport to body, scroll lock, ESC đóng — giống EditJobModal.
 *   - Mỗi lần mở → reset form rỗng + fetch lại company (đề phòng user vừa
 *     tạo company ở tab khác).
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  Plus,
  Send,
  Sparkles,
  Wallet,
  X,
} from 'lucide-vue-next';
import { useToastStore } from '@stores/toast';
import { useLocations } from '@composables/useLocations';
import { companyApi } from '@services/company.api';
import { jobApi } from '@services/job.api';
import type {
  JobLevel,
  JobType,
} from '@/types/job';
import type { MyCompany } from '@/types/company';

/* ============================================================================
 * Props / emits
 * ==========================================================================*/
const props = withDefaults(
  defineProps<{
    open: boolean;
  }>(),
  { open: false },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  /** Submit thành công → báo cho parent navigate tới detail. */
  (e: 'created', jobId: string): void;
}>();

const toast = useToastStore();

/* ============================================================================
 * Company (fetch on open)
 * ==========================================================================*/
const company = ref<MyCompany | null>(null);
const companyLoading = ref(false);
const companyError = ref<string | null>(null);

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

/* ============================================================================
 * Form state
 * ==========================================================================*/
interface FormState {
  title: string;
  description: string;
  requirements: string;
  benefits: string;
  industry: string;
  jobLevel: JobLevel | '';
  jobType: JobType | '';
  salaryMinM: string;
  salaryMaxM: string;
  salaryCurrency: string;
  salaryVisible: boolean;
  locationCity: string;
  remoteOk: boolean;
  experienceYearsMin: string;
  experienceYearsMax: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  deadlineLocal: string;
}
const form = reactive<FormState>({
  title: '',
  description: '',
  requirements: '',
  benefits: '',
  industry: '',
  jobLevel: '',
  jobType: '',
  salaryMinM: '',
  salaryMaxM: '',
  salaryCurrency: 'VND',
  salaryVisible: true,
  locationCity: '',
  remoteOk: false,
  experienceYearsMin: '',
  experienceYearsMax: '',
  requiredSkills: [],
  niceToHaveSkills: [],
  deadlineLocal: '',
});

const resetForm = (): void => {
  for (const k of Object.keys(form)) {
    // safe: chỉ reset primitive; mảng clone để tránh share reference
    if (k === 'requiredSkills' || k === 'niceToHaveSkills') {
      (form[k] as string[]) = [];
    } else {
      (form as Record<string, unknown>)[k] = '';
    }
  }
  form.salaryCurrency = 'VND';
  form.salaryVisible = true;
  form.remoteOk = false;
  skillInput.keyword = '';
  skillInput.required = '';
  skillInput.niceToHave = '';
  for (const k of Object.keys(errors)) delete errors[k];
};

const errors = reactive<Record<string, string>>({});
const validateAll = (): boolean => {
  for (const k of Object.keys(errors)) delete errors[k];

  if (form.title.trim().length < 3) {
    errors.title = 'Tiêu đề tối thiểu 3 ký tự';
  }
  if (form.description.trim().length < 10) {
    errors.description = 'Mô tả tối thiểu 10 ký tự';
  }
  const minS = form.salaryMinM.trim() === '' ? null : Number(form.salaryMinM);
  const maxS = form.salaryMaxM.trim() === '' ? null : Number(form.salaryMaxM);
  if (form.salaryMinM.trim() !== '' && (Number.isNaN(minS) || minS! < 0)) {
    errors.salaryMinM = 'Lương tối thiểu phải >= 0';
  }
  if (form.salaryMaxM.trim() !== '' && (Number.isNaN(maxS) || maxS! < 0)) {
    errors.salaryMaxM = 'Lương tối đa phải >= 0';
  }
  if (minS != null && maxS != null && maxS < minS) {
    errors.salaryMaxM = 'Lương tối đa phải >= lương tối thiểu';
  }
  const expMin = form.experienceYearsMin.trim() === '' ? null : Number(form.experienceYearsMin);
  const expMax = form.experienceYearsMax.trim() === '' ? null : Number(form.experienceYearsMax);
  if (form.experienceYearsMin.trim() !== '' && (Number.isNaN(expMin) || expMin! < 0)) {
    errors.experienceYearsMin = 'Kinh nghiệm tối thiểu phải >= 0';
  }
  if (form.experienceYearsMax.trim() !== '' && (Number.isNaN(expMax) || expMax! < 0)) {
    errors.experienceYearsMax = 'Kinh nghiệm tối đa phải >= 0';
  }
  if (expMin != null && expMax != null && expMax < expMin) {
    errors.experienceYearsMax = 'Kinh nghiệm tối đa phải >= kinh nghiệm tối thiểu';
  }
  if (form.salaryCurrency && form.salaryCurrency.length !== 3) {
    errors.salaryCurrency = 'Mã tiền tệ phải đúng 3 ký tự (vd VND, USD)';
  }
  return Object.keys(errors).length === 0;
};

/* ============================================================================
 * Tag input (skills)
 * ==========================================================================*/
const skillInput = reactive({ keyword: '', required: '', niceToHave: '' });

const addSkill = (field: 'requiredSkills' | 'niceToHaveSkills', raw: string): void => {
  const trimmed = raw.trim();
  if (!trimmed) return;
  if (form[field].includes(trimmed)) return;
  if (form[field].length >= 50) {
    toast.push({ variant: 'info', title: 'Tối đa 50 kỹ năng' });
    return;
  }
  form[field] = [...form[field], trimmed];
};

const removeSkill = (field: 'requiredSkills' | 'niceToHaveSkills', value: string): void => {
  form[field] = form[field].filter((s) => s !== value);
};

const onSkillKeydown = (
  e: KeyboardEvent,
  field: 'requiredSkills' | 'niceToHaveSkills',
  inputKey: 'required' | 'niceToHave',
): void => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addSkill(field, skillInput[inputKey]);
    skillInput[inputKey] = '';
  } else if (e.key === 'Backspace' && skillInput[inputKey] === '' && form[field].length > 0) {
    e.preventDefault();
    form[field] = form[field].slice(0, -1);
  }
};

/* ============================================================================
 * Locations
 * ==========================================================================*/
const locations = useLocations();
locations.fetch();

/* ============================================================================
 * AI generate
 * ==========================================================================*/
const aiGenerating = ref(false);
const onAiGenerate = async (): Promise<void> => {
  const keyword = skillInput.keyword.trim();
  if (keyword.length < 5) {
    errors.aiKeyword = 'Keyword tối thiểu 5 ký tự';
    return;
  }
  delete errors.aiKeyword;
  aiGenerating.value = true;
  try {
    const { data } = await jobApi.generate({
      keyword,
      companyName: company.value?.name,
    });
    const draft = data.data as {
      title?: string;
      description?: string;
      requirements?: string;
      suggestedSkills?: string[];
      suggestedJobLevel?: JobLevel;
      suggestedJobType?: JobType;
      suggestedLocation?: string;
      suggestedSalaryMin?: number;
      suggestedSalaryMax?: number;
      suggestedSalaryCurrency?: string;
    };
    // Fill form — CHỈ ghi đè nếu field đang rỗng để tránh mất data user đã nhập.
    if (draft.title && !form.title)                       form.title = draft.title;
    if (draft.description && !form.description)           form.description = draft.description;
    if (draft.requirements && !form.requirements)         form.requirements = draft.requirements;
    if (draft.suggestedSkills && form.requiredSkills.length === 0) {
      form.requiredSkills = draft.suggestedSkills.slice(0, 50);
    }
    if (draft.suggestedJobLevel && !form.jobLevel)        form.jobLevel = draft.suggestedJobLevel;
    if (draft.suggestedJobType && !form.jobType)          form.jobType = draft.suggestedJobType;
    if (draft.suggestedSalaryMin != null && !form.salaryMinM) {
      form.salaryMinM = String(Math.round(draft.suggestedSalaryMin / 1_000_000));
    }
    if (draft.suggestedSalaryMax != null && !form.salaryMaxM) {
      form.salaryMaxM = String(Math.round(draft.suggestedSalaryMax / 1_000_000));
    }
    if (draft.suggestedSalaryCurrency && form.salaryCurrency === 'VND') {
      form.salaryCurrency = draft.suggestedSalaryCurrency;
    }
    toast.push({
      variant: 'success',
      title: 'Đã generate JD',
      body: 'Các trường đã được điền. Bạn có thể chỉnh tay trước khi lưu.',
    });
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Generate thất bại',
      body: e instanceof Error ? e.message : 'Vui lòng thử lại',
    });
  } finally {
    aiGenerating.value = false;
  }
};

/* ============================================================================
 * Submit
 * ==========================================================================*/
const submitting = ref(false);

const toDatetimeLocal = (d: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const buildPayload = (): Record<string, unknown> => {
  if (!company.value) return {};
  return {
    companyId: company.value.id,
    title: form.title.trim(),
    description: form.description.trim(),
    requirements: form.requirements.trim() || undefined,
    benefits: form.benefits.trim() || undefined,
    industry: form.industry.trim() || undefined,
    jobLevel: form.jobLevel || undefined,
    jobType: form.jobType || undefined,
    salaryMin: form.salaryMinM.trim() === '' ? undefined : Number(form.salaryMinM) * 1_000_000,
    salaryMax: form.salaryMaxM.trim() === '' ? undefined : Number(form.salaryMaxM) * 1_000_000,
    salaryCurrency: form.salaryCurrency || 'VND',
    salaryVisible: form.salaryVisible,
    location: form.locationCity ? { city: form.locationCity } : undefined,
    remoteOk: form.remoteOk,
    experienceYearsMin: form.experienceYearsMin.trim() === '' ? undefined : Number(form.experienceYearsMin),
    experienceYearsMax: form.experienceYearsMax.trim() === '' ? undefined : Number(form.experienceYearsMax),
    requiredSkills: form.requiredSkills,
    niceToHaveSkills: form.niceToHaveSkills,
    deadline: form.deadlineLocal ? new Date(form.deadlineLocal).toISOString() : undefined,
    status: 'draft' as const,
  };
};

const submit = async (postStatus: 'draft' | 'live'): Promise<void> => {
  if (!validateAll()) {
    toast.push({ variant: 'error', title: 'Vui lòng kiểm tra lại các trường lỗi' });
    const firstErrKey = Object.keys(errors)[0];
    if (firstErrKey) {
      const el = document.querySelector(`[data-field="${firstErrKey}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  const payload = buildPayload();
  if (postStatus === 'live') {
    (payload as Record<string, unknown>).status = 'live';
  }

  submitting.value = true;
  try {
    const { data } = await jobApi.create(payload);
    const newJobId = (data.data as { id: string }).id;
    toast.push({
      variant: 'success',
      title: postStatus === 'live' ? 'Đã đăng job (chờ kiểm duyệt AI)' : 'Đã tạo job (bản nháp)',
    });
    emit('created', newJobId);
    emit('update:open', false);
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Tạo job thất bại',
      body: e instanceof Error ? e.message : 'Vui lòng thử lại',
    });
  } finally {
    submitting.value = false;
  }
};

const close = (): void => {
  if (submitting.value || aiGenerating.value) return;
  emit('update:open', false);
};

/* ============================================================================
 * Watch open → fetch company + reset form
 * ==========================================================================*/
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      resetForm();
      company.value = null;
      return;
    }
    resetForm();
    await fetchCompany();
    await nextTick();
  },
  { immediate: true },
);

/* ============================================================================
 * Modal behavior: scroll lock + ESC
 * ==========================================================================*/
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

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      lockScroll();
      nextTick(() => {
        const firstInput = dialogEl.value?.querySelector<HTMLElement>('input, textarea, select');
        firstInput?.focus();
      });
    } else {
      unlockScroll();
    }
  },
);

const onKeydown = (e: KeyboardEvent): void => {
  if (!props.open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
};
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', onKeydown);
    } else {
      window.removeEventListener('keydown', onKeydown);
    }
  },
);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  unlockScroll();
});

/* ============================================================================
 * Dropdown constants
 * ==========================================================================*/
const JOB_LEVEL_OPTIONS: { value: JobLevel; label: string }[] = [
  { value: 'intern',   label: 'Intern' },
  { value: 'fresher',  label: 'Fresher' },
  { value: 'junior',   label: 'Junior' },
  { value: 'mid',      label: 'Mid-level' },
  { value: 'senior',   label: 'Senior' },
  { value: 'lead',     label: 'Lead' },
  { value: 'manager',  label: 'Manager' },
];

const JOB_TYPE_OPTIONS: { value: JobType; label: string }[] = [
  { value: 'full-time', label: 'Toàn thời gian' },
  { value: 'part-time', label: 'Bán thời gian' },
  { value: 'contract',  label: 'Hợp đồng' },
  { value: 'internship',label: 'Thực tập' },
  { value: 'freelance', label: 'Freelance' },
];

const showForm = computed(() => !companyLoading.value && company.value !== null);
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <!-- Backdrop — click ra ngoài đóng modal.
            Gắn handler TRỰC TIẾP trên backdrop (không dùng .self trên outer
            vì backdrop là child → .self không trigger). Dialog là sibling
            của backdrop (cùng parent) nên click dialog KHÔNG bubble qua
            backdrop, kết hợp @mousedown.stop trên dialog → an toàn. -->
        <div
          class="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
          @mousedown="close"
        />

        <!-- Dialog -->
        <div
          ref="dialogEl"
          class="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl bg-white shadow-2xl ring-1 ring-gray-200"
          @mousedown.stop
        >
          <!-- Header -->
          <header class="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-200 shrink-0">
            <div>
              <h2 class="text-base font-semibold text-gray-900">Đăng job mới</h2>
              <p class="text-[11px] text-gray-500 mt-0.5">
                Soạn tin tuyển dụng. Job sẽ ở trạng thái "Bản nháp" cho tới khi bạn gửi kiểm duyệt AI.
              </p>
            </div>
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              title="Đóng"
              aria-label="Đóng"
              :disabled="submitting || aiGenerating"
              @click="close"
            >
              <X class="h-4 w-4" />
            </button>
          </header>

          <!-- Body (scrollable) -->
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <!-- ============ Company loading ============ -->
            <div
              v-if="companyLoading"
              class="flex items-center justify-center py-12"
            >
              <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
            </div>

            <!-- ============ No company → CTA ============ -->
            <div
              v-else-if="!company"
              class="text-center py-10"
            >
              <div class="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mx-auto mb-3">
                <Building2 class="w-6 h-6 text-primary-600" />
              </div>
              <h3 class="text-sm font-semibold text-gray-900">
                {{ companyError ? 'Không tải được công ty' : 'Bạn chưa thuộc công ty nào' }}
              </h3>
              <p class="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                {{ companyError ?? 'Cần tạo công ty trước khi đăng job. Vào trang Hồ sơ công ty để thiết lập.' }}
              </p>
              <div class="mt-4 flex items-center justify-center gap-2">
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition"
                  @click="fetchCompany"
                >
                  Thử lại
                </button>
                <a
                  href="/employer/company"
                  class="inline-flex items-center px-3 py-1.5 text-xs rounded-md bg-gray-900 text-white hover:bg-gray-800 transition"
                >
                  Tạo công ty
                </a>
              </div>
            </div>

            <!-- ============ Form ============ -->
            <form
              v-else
              class="space-y-4"
              @submit.prevent="submit('draft')"
            >
              <!-- Company info banner -->
              <div class="flex items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2">
                <Building2 class="w-4 h-4 text-gray-500 shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="text-[11px] text-gray-500">Job sẽ được đăng cho</p>
                  <p class="text-sm font-medium text-gray-900 truncate">{{ company.name }}</p>
                </div>
              </div>

              <!-- ============ AI generate ============ -->
              <section class="rounded-xl border border-primary-200 bg-primary-50/30 p-4">
                <div class="flex items-center gap-1.5 mb-2">
                  <Sparkles class="w-4 h-4 text-primary-600" />
                  <h3 class="text-sm font-semibold text-primary-900">Generate JD với AI</h3>
                </div>
                <p class="text-[11px] text-gray-600 mb-2.5">
                  Nhập keyword ngắn (vd "Backend NodeJS lương 25tr"). AI sẽ soạn tiêu đề, mô tả, yêu cầu, kỹ năng, lương.
                </p>
                <div class="flex gap-2">
                  <input
                    v-model="skillInput.keyword"
                    type="text"
                    maxlength="500"
                    class="flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition bg-white"
                    :class="errors.aiKeyword ? 'border-red-300' : 'border-gray-300'"
                    placeholder="vd: Senior Backend NodeJS, Hà Nội, lương 25-40 triệu"
                    :disabled="aiGenerating"
                    @keydown.enter.prevent="onAiGenerate"
                  />
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    :disabled="aiGenerating"
                    @click="onAiGenerate"
                  >
                    <Loader2 v-if="aiGenerating" class="w-4 h-4 animate-spin" />
                    <Sparkles v-else class="w-4 h-4" />
                    Generate
                  </button>
                </div>
                <p v-if="errors.aiKeyword" class="mt-1 text-[11px] text-red-600">{{ errors.aiKeyword }}</p>
              </section>

              <!-- ============ Thông tin cơ bản ============ -->
              <section class="rounded-xl border border-gray-200 p-4">
                <h3 class="text-sm font-semibold text-gray-900 mb-3">Thông tin cơ bản</h3>
                <div class="space-y-3">
                  <div data-field="title">
                    <label class="block text-xs font-medium text-gray-700 mb-1">
                      Tiêu đề <span class="text-red-500">*</span>
                    </label>
                    <input
                      v-model="form.title"
                      type="text"
                      maxlength="200"
                      class="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition"
                      :class="errors.title ? 'border-red-300 bg-red-50/30' : 'border-gray-300 bg-white'"
                      placeholder="vd: Senior Backend Developer (Node.js)"
                    />
                    <p v-if="errors.title" class="mt-1 text-[11px] text-red-600">{{ errors.title }}</p>
                  </div>

                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Ngành nghề</label>
                    <input
                      v-model="form.industry"
                      type="text"
                      maxlength="100"
                      class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 bg-white transition"
                      placeholder="vd: Công nghệ thông tin"
                    />
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">Cấp bậc</label>
                      <div class="relative">
                        <select
                          v-model="form.jobLevel"
                          class="w-full px-3 pr-9 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 bg-white transition appearance-none cursor-pointer"
                        >
                          <option value="">-- Chọn cấp bậc --</option>
                          <option v-for="opt in JOB_LEVEL_OPTIONS" :key="opt.value" :value="opt.value">
                            {{ opt.label }}
                          </option>
                        </select>
                        <ChevronDown class="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">Loại hình</label>
                      <div class="relative">
                        <select
                          v-model="form.jobType"
                          class="w-full px-3 pr-9 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 bg-white transition appearance-none cursor-pointer"
                        >
                          <option value="">-- Chọn loại hình --</option>
                          <option v-for="opt in JOB_TYPE_OPTIONS" :key="opt.value" :value="opt.value">
                            {{ opt.label }}
                          </option>
                        </select>
                        <ChevronDown class="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <!-- ============ Mô tả ============ -->
              <section class="rounded-xl border border-gray-200 p-4">
                <h3 class="text-sm font-semibold text-gray-900 mb-3">Mô tả & Yêu cầu</h3>
                <div class="space-y-3">
                  <div data-field="description">
                    <label class="block text-xs font-medium text-gray-700 mb-1">
                      Mô tả công việc <span class="text-red-500">*</span>
                    </label>
                    <textarea
                      v-model="form.description"
                      rows="5"
                      class="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition whitespace-pre-line"
                      :class="errors.description ? 'border-red-300 bg-red-50/30' : 'border-gray-300 bg-white'"
                      placeholder="Mô tả chi tiết về vị trí, trách nhiệm, môi trường làm việc..."
                    />
                    <p v-if="errors.description" class="mt-1 text-[11px] text-red-600">{{ errors.description }}</p>
                  </div>

                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Yêu cầu ứng viên</label>
                    <textarea
                      v-model="form.requirements"
                      rows="4"
                      class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 bg-white transition whitespace-pre-line"
                      placeholder="Kinh nghiệm, kỹ năng, bằng cấp yêu cầu..."
                    />
                  </div>

                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Quyền lợi</label>
                    <textarea
                      v-model="form.benefits"
                      rows="3"
                      class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 bg-white transition whitespace-pre-line"
                      placeholder="Lương thưởng, phúc lợi, cơ hội phát triển..."
                    />
                  </div>
                </div>
              </section>

              <!-- ============ Kỹ năng ============ -->
              <section class="rounded-xl border border-gray-200 p-4">
                <h3 class="text-sm font-semibold text-gray-900 mb-3">Kỹ năng</h3>
                <div class="space-y-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">
                      Kỹ năng yêu cầu
                      <span class="text-gray-400 font-normal">(Enter hoặc dấu phẩy để thêm)</span>
                    </label>
                    <div class="min-h-[40px] px-2 py-1.5 border border-gray-300 rounded-lg bg-white flex flex-wrap gap-1.5 items-center focus-within:ring-2 focus-within:ring-primary-500/30 transition">
                      <span
                        v-for="skill in form.requiredSkills"
                        :key="skill"
                        class="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
                      >
                        {{ skill }}
                        <button
                          type="button"
                          class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-primary-200 transition"
                          :title="`Xoá ${skill}`"
                          @click="removeSkill('requiredSkills', skill)"
                        >
                          <X class="w-2.5 h-2.5" />
                        </button>
                      </span>
                      <input
                        v-model="skillInput.required"
                        type="text"
                        class="flex-1 min-w-[120px] px-1 py-0.5 text-sm bg-transparent focus:outline-none"
                        placeholder="vd: Node.js, TypeScript, ..."
                        @keydown="onSkillKeydown($event, 'requiredSkills', 'required')"
                      />
                    </div>
                  </div>

                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">
                      Kỹ năng ưu tiên
                      <span class="text-gray-400 font-normal">(không bắt buộc)</span>
                    </label>
                    <div class="min-h-[40px] px-2 py-1.5 border border-gray-300 rounded-lg bg-white flex flex-wrap gap-1.5 items-center focus-within:ring-2 focus-within:ring-primary-500/30 transition">
                      <span
                        v-for="skill in form.niceToHaveSkills"
                        :key="skill"
                        class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                      >
                        {{ skill }}
                        <button
                          type="button"
                          class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-gray-200 transition"
                          :title="`Xoá ${skill}`"
                          @click="removeSkill('niceToHaveSkills', skill)"
                        >
                          <X class="w-2.5 h-2.5" />
                        </button>
                      </span>
                      <input
                        v-model="skillInput.niceToHave"
                        type="text"
                        class="flex-1 min-w-[120px] px-1 py-0.5 text-sm bg-transparent focus:outline-none"
                        placeholder="vd: Docker, AWS, ..."
                        @keydown="onSkillKeydown($event, 'niceToHaveSkills', 'niceToHave')"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <!-- ============ Lương ============ -->
              <section class="rounded-xl border border-gray-200 p-4">
                <h3 class="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Wallet class="w-4 h-4 text-gray-500" /> Lương
                </h3>
                <div class="space-y-3">
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div data-field="salaryMinM">
                      <label class="block text-xs font-medium text-gray-700 mb-1">Tối thiểu (triệu)</label>
                      <input
                        v-model="form.salaryMinM"
                        type="number"
                        min="0"
                        step="0.5"
                        class="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition"
                        :class="errors.salaryMinM ? 'border-red-300 bg-red-50/30' : 'border-gray-300 bg-white'"
                        placeholder="vd: 15"
                      />
                      <p v-if="errors.salaryMinM" class="mt-1 text-[11px] text-red-600">{{ errors.salaryMinM }}</p>
                    </div>
                    <div data-field="salaryMaxM">
                      <label class="block text-xs font-medium text-gray-700 mb-1">Tối đa (triệu)</label>
                      <input
                        v-model="form.salaryMaxM"
                        type="number"
                        min="0"
                        step="0.5"
                        class="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition"
                        :class="errors.salaryMaxM ? 'border-red-300 bg-red-50/30' : 'border-gray-300 bg-white'"
                        placeholder="vd: 30"
                      />
                      <p v-if="errors.salaryMaxM" class="mt-1 text-[11px] text-red-600">{{ errors.salaryMaxM }}</p>
                    </div>
                    <div data-field="salaryCurrency">
                      <label class="block text-xs font-medium text-gray-700 mb-1">Tiền tệ</label>
                      <input
                        v-model="form.salaryCurrency"
                        type="text"
                        maxlength="3"
                        class="w-full px-3 py-2 text-sm border rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition"
                        :class="errors.salaryCurrency ? 'border-red-300 bg-red-50/30' : 'border-gray-300 bg-white'"
                        placeholder="VND"
                      />
                      <p v-if="errors.salaryCurrency" class="mt-1 text-[11px] text-red-600">{{ errors.salaryCurrency }}</p>
                    </div>
                  </div>

                  <label class="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      v-model="form.salaryVisible"
                      type="checkbox"
                      class="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-2 focus:ring-primary-500/30"
                    />
                    <span class="text-xs text-gray-700">Hiển thị mức lương cho ứng viên</span>
                  </label>
                </div>
              </section>

              <!-- ============ Địa điểm ============ -->
              <section class="rounded-xl border border-gray-200 p-4">
                <h3 class="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <MapPin class="w-4 h-4 text-gray-500" /> Địa điểm
                </h3>
                <div class="space-y-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Tỉnh/Thành phố</label>
                    <div class="relative">
                      <select
                        v-model="form.locationCity"
                        class="w-full px-3 pr-9 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 bg-white transition appearance-none cursor-pointer"
                      >
                        <option value="">-- Chọn tỉnh/thành --</option>
                        <option v-for="loc in locations.items.value" :key="loc.code" :value="loc.shortName">
                          {{ loc.name }}
                        </option>
                      </select>
                      <ChevronDown class="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                    <p v-if="locations.loading.value" class="mt-1 text-[11px] text-gray-500">Đang tải danh sách...</p>
                    <p v-else-if="locations.error.value" class="mt-1 text-[11px] text-orange-600">
                      Không tải được danh sách đầy đủ — đang dùng 3 tỉnh chính.
                    </p>
                  </div>

                  <label class="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      v-model="form.remoteOk"
                      type="checkbox"
                      class="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-2 focus:ring-primary-500/30"
                    />
                    <span class="text-xs text-gray-700">Cho phép làm việc remote</span>
                  </label>
                </div>
              </section>

              <!-- ============ Kinh nghiệm ============ -->
              <section class="rounded-xl border border-gray-200 p-4">
                <h3 class="text-sm font-semibold text-gray-900 mb-3">Kinh nghiệm</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div data-field="experienceYearsMin">
                    <label class="block text-xs font-medium text-gray-700 mb-1">Tối thiểu (năm)</label>
                    <input
                      v-model="form.experienceYearsMin"
                      type="number"
                      min="0"
                      step="0.5"
                      class="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition"
                      :class="errors.experienceYearsMin ? 'border-red-300 bg-red-50/30' : 'border-gray-300 bg-white'"
                      placeholder="vd: 2"
                    />
                    <p v-if="errors.experienceYearsMin" class="mt-1 text-[11px] text-red-600">{{ errors.experienceYearsMin }}</p>
                  </div>
                  <div data-field="experienceYearsMax">
                    <label class="block text-xs font-medium text-gray-700 mb-1">Tối đa (năm)</label>
                    <input
                      v-model="form.experienceYearsMax"
                      type="number"
                      min="0"
                      step="0.5"
                      class="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition"
                      :class="errors.experienceYearsMax ? 'border-red-300 bg-red-50/30' : 'border-gray-300 bg-white'"
                      placeholder="vd: 5"
                    />
                    <p v-if="errors.experienceYearsMax" class="mt-1 text-[11px] text-red-600">{{ errors.experienceYearsMax }}</p>
                  </div>
                </div>
              </section>

              <!-- ============ Khác ============ -->
              <section class="rounded-xl border border-gray-200 p-4">
                <h3 class="text-sm font-semibold text-gray-900 mb-3">Khác</h3>
                <div class="space-y-3">
                  <div>
                    <label class="text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                      <Calendar class="w-3 h-3" /> Hạn nộp hồ sơ
                    </label>
                    <input
                      v-model="form.deadlineLocal"
                      type="datetime-local"
                      class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 bg-white transition"
                    />
                    <button
                      v-if="form.deadlineLocal"
                      type="button"
                      class="mt-1 text-[11px] text-gray-500 hover:text-gray-700 transition"
                      @click="form.deadlineLocal = ''"
                    >
                      Xoá hạn nộp
                    </button>
                  </div>
                </div>
              </section>
            </form>
          </div>

          <!-- Footer -->
          <footer class="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-200 bg-gray-50/50 shrink-0 rounded-b-xl">
            <button
              type="button"
              class="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="submitting || aiGenerating"
              @click="close"
            >
              Huỷ
            </button>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="submitting || !showForm"
                @click="showForm && submit('live')"
              >
                <Loader2 v-if="submitting" class="w-4 h-4 animate-spin" />
                <Send v-else class="w-4 h-4" />
                Đăng & kiểm duyệt AI
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="submitting || !showForm"
                @click="showForm && submit('draft')"
              >
                <Loader2 v-if="submitting" class="w-4 h-4 animate-spin" />
                <Plus v-else class="w-4 h-4" />
                {{ submitting ? 'Đang tạo...' : 'Lưu nháp' }}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-active > div:last-child,
.modal-leave-active > div:last-child {
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from > div:last-child,
.modal-leave-to > div:last-child {
  transform: scale(0.96);
  opacity: 0;
}
</style>
