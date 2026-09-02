<script setup lang="ts">
/**
 * EditJobModal — modal form sửa job, dùng ở 2 nơi:
 *  - JobDetailView (nút "Sửa job" ở sidebar).
 *  - PostedJobsView (nút "Sửa" trên EmployerJobCard qua @edit event).
 *
 * Props:
 *  - `open` (v-model)    : boolean — modal có đang hiển thị không.
 *  - `jobId`             : string — id job cần sửa. Fetch lại mỗi lần mở.
 *
 * Emits:
 *  - `update:open`       : boolean — đóng/mở modal.
 *  - `saved`             : không payload — báo cho parent refresh data.
 *
 * Behavior:
 *  - Teleport to body để tránh stacking context của ancestor (vd sidebar có
 *    overflow:hidden + transform sẽ che modal).
 *  - Trap focus + ESC đóng (giống ConfirmModal).
 *  - Scroll lock body khi mở.
 *  - Đổi jobId hoặc mở lại → reset form + fetch lại từ server.
 *
 * Form logic (y hệt EditJobView cũ):
 *  - Lương nhập theo TRIỆU VND → ×1_000_000 khi gửi backend.
 *  - deadline dùng datetime-local → convert sang ISO khi submit.
 *  - Skills: tag input (Enter/comma thêm, Backspace xoá).
 *  - Dirty check: chỉ gửi field đã đổi lên PATCH.
 *  - Validation client: title ≥ 3, description ≥ 10, salary max ≥ min, ...
 *  - Nút "Lưu & Submit AI scan" cho draft/ai_flagged → set status='ai_scanning'.
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import {
  AlertCircle,
  Calendar,
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  Send,
  Wallet,
  X,
} from 'lucide-vue-next';
import { useToastStore } from '@stores/toast';
import { useLocations } from '@composables/useLocations';
import { jobApi } from '@services/job.api';
import type {
  JobDetail,
  JobLevel,
  JobStatus,
  JobType,
} from '@/types/job';

/* ============================================================================
 * Props / emits
 * ==========================================================================*/
const props = withDefaults(
  defineProps<{
    open: boolean;
    jobId: string;
  }>(),
  { open: false, jobId: '' },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'saved'): void;
}>();

const toast = useToastStore();

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
  status: JobStatus;
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
  status: 'draft',
});

const dirty = reactive<Record<string, boolean>>({});
const markDirty = (key: keyof FormState): void => {
  dirty[key] = true;
};

/** Reset form state về rỗng — gọi khi đổi jobId hoặc mở modal lần đầu. */
const resetForm = (): void => {
  for (const k of Object.keys(dirty)) delete dirty[k];
  form.title = '';
  form.description = '';
  form.requirements = '';
  form.benefits = '';
  form.industry = '';
  form.jobLevel = '';
  form.jobType = '';
  form.salaryMinM = '';
  form.salaryMaxM = '';
  form.salaryCurrency = 'VND';
  form.salaryVisible = true;
  form.locationCity = '';
  form.remoteOk = false;
  form.experienceYearsMin = '';
  form.experienceYearsMax = '';
  form.requiredSkills = [];
  form.niceToHaveSkills = [];
  form.deadlineLocal = '';
  form.status = 'draft';
  skillInput.required = '';
  skillInput.niceToHave = '';
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
const skillInput = reactive({ required: '', niceToHave: '' });

const addSkill = (field: 'requiredSkills' | 'niceToHaveSkills', raw: string): void => {
  const trimmed = raw.trim();
  if (!trimmed) return;
  if (form[field].includes(trimmed)) return;
  if (form[field].length >= 50) {
    toast.push({ variant: 'info', title: 'Tối đa 50 kỹ năng' });
    return;
  }
  form[field] = [...form[field], trimmed];
  dirty[field] = true;
};

const removeSkill = (field: 'requiredSkills' | 'niceToHaveSkills', value: string): void => {
  form[field] = form[field].filter((s) => s !== value);
  dirty[field] = true;
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
    dirty[field] = true;
  }
};

/* ============================================================================
 * Locations
 * ==========================================================================*/
const locations = useLocations();
locations.fetch();

/* ============================================================================
 * Fetch + seed
 * ==========================================================================*/
const loading = ref(false);
const loadError = ref<string | null>(null);
const submitting = ref(false);

const toDatetimeLocal = (d: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const seedForm = (j: JobDetail): void => {
  form.title = j.title;
  form.description = j.description;
  form.requirements = j.requirements ?? '';
  form.benefits = j.benefits ?? '';
  form.industry = j.industry ?? '';
  form.jobLevel = j.jobLevel ?? '';
  form.jobType = j.jobType ?? '';
  form.salaryMinM = j.salaryMin != null ? String(Math.round(Number(j.salaryMin) / 1_000_000)) : '';
  form.salaryMaxM = j.salaryMax != null ? String(Math.round(Number(j.salaryMax) / 1_000_000)) : '';
  form.salaryCurrency = j.salaryCurrency ?? 'VND';
  form.salaryVisible = j.salaryVisible ?? true;
  form.locationCity = j.location?.city ?? '';
  form.remoteOk = j.remoteOk ?? false;
  form.experienceYearsMin = j.experienceYearsMin != null ? String(j.experienceYearsMin) : '';
  form.experienceYearsMax = j.experienceYearsMax != null ? String(j.experienceYearsMax) : '';
  form.requiredSkills = [...(j.requiredSkills ?? [])];
  form.niceToHaveSkills = [...(j.niceToHaveSkills ?? [])];
  form.deadlineLocal = j.deadline ? toDatetimeLocal(new Date(j.deadline)) : '';
  form.status = j.status;
};

const fetchJob = async (): Promise<void> => {
  if (!props.jobId) return;
  loading.value = true;
  loadError.value = null;
  try {
    const { data } = await jobApi.detail(props.jobId);
    seedForm(data.data);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Không tải được chi tiết job';
  } finally {
    loading.value = false;
  }
};

/** Mỗi lần mở modal HOẶC đổi jobId → reset form + fetch lại từ đầu.
 *  Lý do: tránh hiển thị data cũ của job khác khi parent toggle open/close
 *  nhiều lần. */
watch(
  () => [props.open, props.jobId] as [boolean, string],
  async ([isOpen]) => {
    if (!isOpen) {
      // Cleanup khi đóng — không giữ form state cũ.
      resetForm();
      return;
    }
    // Mở → reset + fetch (cover cả trường hợp đổi jobId).
    resetForm();
    await fetchJob();
    await nextTick();
  },
  { immediate: true },
);

/* ============================================================================
 * Submit
 * ==========================================================================*/
const buildPayload = (): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};

  if (dirty.title)                  payload.title = form.title.trim();
  if (dirty.description)            payload.description = form.description.trim();
  if (dirty.requirements)           payload.requirements = form.requirements.trim() || undefined;
  if (dirty.benefits)               payload.benefits = form.benefits.trim() || undefined;
  if (dirty.industry)               payload.industry = form.industry.trim() || undefined;
  if (dirty.jobLevel)               payload.jobLevel = form.jobLevel || undefined;
  if (dirty.jobType)                payload.jobType = form.jobType || undefined;
  if (dirty.salaryMinM) {
    payload.salaryMin = form.salaryMinM.trim() === ''
      ? null
      : Number(form.salaryMinM) * 1_000_000;
  }
  if (dirty.salaryMaxM) {
    payload.salaryMax = form.salaryMaxM.trim() === ''
      ? null
      : Number(form.salaryMaxM) * 1_000_000;
  }
  if (dirty.salaryCurrency)          payload.salaryCurrency = form.salaryCurrency || undefined;
  if (dirty.salaryVisible)           payload.salaryVisible = form.salaryVisible;
  if (dirty.locationCity) {
    payload.location = form.locationCity
      ? { city: form.locationCity }
      : null;
  }
  if (dirty.remoteOk)                payload.remoteOk = form.remoteOk;
  if (dirty.experienceYearsMin) {
    payload.experienceYearsMin = form.experienceYearsMin.trim() === ''
      ? null
      : Number(form.experienceYearsMin);
  }
  if (dirty.experienceYearsMax) {
    payload.experienceYearsMax = form.experienceYearsMax.trim() === ''
      ? null
      : Number(form.experienceYearsMax);
  }
  if (dirty.requiredSkills)          payload.requiredSkills = form.requiredSkills;
  if (dirty.niceToHaveSkills)        payload.niceToHaveSkills = form.niceToHaveSkills;
  if (dirty.deadlineLocal) {
    if (!form.deadlineLocal) {
      payload.deadline = null;
    } else {
      const d = new Date(form.deadlineLocal);
      payload.deadline = d.toISOString();
    }
  }
  // KHÔNG gửi `status` qua PATCH — status do hệ thống quản lý qua
  // /jobs/:id/submit (→ ai_scanning) hoặc worker (→ live / ai_flagged).
  // Nếu employer tự set status trong payload có thể bypass AI moderation.

  return payload;
};

const submit = async (postStatus: JobStatus | null): Promise<void> => {
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
  const hasContentChanges = Object.keys(payload).length > 0;
  const wantsSubmit = postStatus !== null;

  // Không có gì để làm (không edit field nào + không bấm Submit) → báo user.
  if (!hasContentChanges && !wantsSubmit) {
    toast.push({ variant: 'info', title: 'Chưa có gì thay đổi' });
    return;
  }

  submitting.value = true;
  try {
    // 1. PATCH content (chỉ khi có field dirty) — KHÔNG gửi status,
    //    vì status do hệ thống quản lý qua /submit endpoint.
    if (hasContentChanges) {
      await jobApi.update(props.jobId, payload);
    }

    // 2. Nếu user bấm "Lưu & Submit AI scan" → gọi /submit riêng để
    //    backend set status='ai_scanning' + enqueue worker.
    //    (KHÔNG gọi khi user chỉ muốn save draft — submit draft không cần scan.)
    if (wantsSubmit) {
      await jobApi.submit(props.jobId);
    }

    toast.push({
      variant: 'success',
      title: wantsSubmit ? 'Đã gửi job AI kiểm duyệt' : 'Đã lưu job',
    });
    emit('saved');
    emit('update:open', false);
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Lưu thất bại',
      body: e instanceof Error ? e.message : 'Vui lòng thử lại',
    });
  } finally {
    submitting.value = false;
  }
};

const close = (): void => {
  if (submitting.value) return;
  emit('update:open', false);
};

/* ============================================================================
 * Modal behavior: scroll lock + ESC + focus trap
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
        // Focus input đầu tiên để user có thể gõ luôn.
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

const STATUS_OPTIONS: { value: JobStatus; label: string; description: string }[] = [
  { value: 'draft',       label: 'Bản nháp',      description: 'Job chỉ bạn thấy. Submit để gửi AI moderation.' },
  { value: 'pending',     label: 'Đang chờ',      description: 'Job đang chờ xử lý moderation.' },
  { value: 'ai_scanning', label: 'AI đang quét',  description: 'Hệ thống AI đang quét nội dung. Vui lòng đợi.' },
  { value: 'live',        label: 'Đang hiển thị', description: 'Job hiển thị công khai cho ứng viên.' },
  { value: 'ai_flagged',  label: 'Bị gắn cờ',    description: 'AI phát hiện vấn đề. Sửa rồi submit lại.' },
  { value: 'expired',     label: 'Hết hạn',       description: 'Job đã quá hạn nộp.' },
  { value: 'closed',      label: 'Đã đóng',       description: 'Job đã bị đóng thủ công.' },
];

/** Badge classes cho read-only status display — match EmployerJobCard STATUS_MAP. */
const STATUS_BADGE_CLASSES: Record<JobStatus, string> = {
  draft:       'bg-gray-100 text-gray-600',
  pending:     'bg-blue-100 text-blue-700',
  ai_scanning: 'bg-yellow-100 text-yellow-700',
  live:        'bg-green-100 text-green-700',
  ai_flagged:  'bg-red-100 text-red-700',
  expired:     'bg-orange-100 text-orange-700',
  closed:      'bg-gray-200 text-gray-500 line-through',
};

const showSubmitAiBtn = computed(() =>
  form.status === 'draft' || form.status === 'ai_flagged',
);
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

        <!-- Dialog — scroll bên trong nếu nội dung dài -->
        <div
          ref="dialogEl"
          class="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl bg-white shadow-2xl ring-1 ring-gray-200"
          @mousedown.stop
        >
          <!-- Header -->
          <header class="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-200 shrink-0">
            <div>
              <h2 class="text-base font-semibold text-gray-900">Sửa job</h2>
              <p class="text-[11px] text-gray-500 mt-0.5">
                Chỉ những trường bạn thay đổi sẽ được gửi lên server.
              </p>
            </div>
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              title="Đóng"
              aria-label="Đóng"
              :disabled="submitting"
              @click="close"
            >
              <X class="h-4 w-4" />
            </button>
          </header>

          <!-- Body (scrollable) -->
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <!-- Loading -->
            <div
              v-if="loading"
              class="flex items-center justify-center py-12"
            >
              <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
            </div>

            <!-- Load error -->
            <div
              v-else-if="loadError"
              class="px-4 py-10 text-center"
            >
              <div class="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-2">
                <AlertCircle class="w-5 h-5 text-red-500" />
              </div>
              <p class="text-xs font-semibold text-gray-900">Không tải được job</p>
              <p class="text-[11px] text-gray-500 mt-1">{{ loadError }}</p>
              <button
                type="button"
                class="mt-3 px-3 py-1.5 text-xs rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition"
                @click="fetchJob"
              >
                Thử lại
              </button>
            </div>

            <!-- Form -->
            <form
              v-else
              class="space-y-4"
              @submit.prevent="submit(null)"
            >
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
                      @input="markDirty('title')"
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
                      @input="markDirty('industry')"
                    />
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">Cấp bậc</label>
                      <div class="relative">
                        <select
                          v-model="form.jobLevel"
                          class="w-full px-3 pr-9 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 bg-white transition appearance-none cursor-pointer"
                          @change="markDirty('jobLevel')"
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
                          @change="markDirty('jobType')"
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
                      @input="markDirty('description')"
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
                      @input="markDirty('requirements')"
                    />
                  </div>

                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Quyền lợi</label>
                    <textarea
                      v-model="form.benefits"
                      rows="3"
                      class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 bg-white transition whitespace-pre-line"
                      placeholder="Lương thưởng, phúc lợi, cơ hội phát triển..."
                      @input="markDirty('benefits')"
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
                        @input="markDirty('salaryMinM')"
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
                        @input="markDirty('salaryMaxM')"
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
                        @input="markDirty('salaryCurrency')"
                      />
                      <p v-if="errors.salaryCurrency" class="mt-1 text-[11px] text-red-600">{{ errors.salaryCurrency }}</p>
                    </div>
                  </div>

                  <label class="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      v-model="form.salaryVisible"
                      type="checkbox"
                      class="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-2 focus:ring-primary-500/30"
                      @change="markDirty('salaryVisible')"
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
                        @change="markDirty('locationCity')"
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
                      @change="markDirty('remoteOk')"
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
                      @input="markDirty('experienceYearsMin')"
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
                      @input="markDirty('experienceYearsMax')"
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
                      @input="markDirty('deadlineLocal')"
                    />
                    <button
                      v-if="form.deadlineLocal"
                      type="button"
                      class="mt-1 text-[11px] text-gray-500 hover:text-gray-700 transition"
                      @click="form.deadlineLocal = ''; markDirty('deadlineLocal');"
                    >
                      Xoá hạn nộp
                    </button>
                  </div>

                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Trạng thái</label>
                    <!--
                      Read-only — status là do hệ thống quản lý (worker AI moderation +
                      backend pipeline), KHÔNG cho employer set thủ công. Nếu cho
                      chọn trực tiếp `live` / `ai_flagged` / `ai_scanning` từ
                      dropdown, user bypass toàn bộ AI moderation → job có thể
                      public với nội dung vi phạm (PII, phân biệt đối xử, ...).

                      Cách chuyển trạng thái đúng:
                      - draft       → ai_scanning : bấm "Lưu & Submit AI scan"
                      - ai_scanning → live        : do worker set sau verdict='approved'
                      - ai_scanning → ai_flagged  : do worker set sau verdict='flagged'
                      - expired / closed           : nút riêng ("Gia hạn" / "Xoá") ở sidebar
                    -->
                    <div class="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50">
                      <span
                        class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium"
                        :class="STATUS_BADGE_CLASSES[form.status]"
                      >
                        {{ STATUS_OPTIONS.find((o) => o.value === form.status)?.label ?? form.status }}
                      </span>
                      <span class="text-[11px] text-gray-500">
                        {{ STATUS_OPTIONS.find((o) => o.value === form.status)?.description }}
                      </span>
                    </div>
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
              :disabled="submitting"
              @click="close"
            >
              Huỷ
            </button>
            <div class="flex items-center gap-2">
              <button
                v-if="showSubmitAiBtn"
                type="button"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="submitting"
                @click="submit('ai_scanning')"
              >
                <Loader2 v-if="submitting" class="w-4 h-4 animate-spin" />
                <Send v-else class="w-4 h-4" />
                Lưu & Submit AI scan
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="submitting"
                @click="submit(null)"
              >
                <Loader2 v-if="submitting" class="w-4 h-4 animate-spin" />
                <Check v-else class="w-4 h-4" />
                {{ submitting ? 'Đang lưu...' : 'Lưu thay đổi' }}
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
