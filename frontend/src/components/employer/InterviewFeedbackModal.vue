<script setup lang="ts">
/**
 * InterviewFeedbackModal — Modal cho HR / Interviewer gửi đánh giá kết quả phỏng vấn.
 * Chuyển trạng thái buổi phỏng vấn sang 'completed'.
 */
import { ref, computed } from 'vue';
import {
  X,
  Loader2,
  CheckCircle2,
  Star,
  Sparkles,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Layers,
} from 'lucide-vue-next';
import { interviewApi, type SubmitInterviewFeedbackPayload } from '@/services/interview.api';
import { useToastStore } from '@stores/toast';
import { extractErrorMessage } from '@/services/http';

const props = defineProps<{
  open: boolean;
  interviewId: string;
  interviewType?: string | null;
  candidateName: string;
  jobTitle?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submitted'): void;
}>();

const toast = useToastStore();

const recommendation = ref<'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire'>('hire');
const comments = ref('');
const submitting = ref(false);

// Tiêu chí chấm điểm (1 - 5 điểm)
const criteria = ref([
  { key: 'technical', label: 'Chuyên môn & Kỹ thuật', score: 4 },
  { key: 'problem_solving', label: 'Giải quyết vấn đề', score: 4 },
  { key: 'communication', label: 'Giao tiếp & Thái độ', score: 4 },
  { key: 'culture_fit', label: 'Phù hợp văn hóa', score: 4 },
]);

const INTERVIEW_TYPE_LABELS: Record<string, string> = {
  screening: 'Sơ loại',
  technical: 'Kỹ thuật',
  coding: 'Live Coding',
  system_design: 'System Design',
  hr: 'Nhân sự',
  culture_fit: 'Văn hóa',
  panel: 'Hội đồng',
  final: 'Vòng cuối',
  other: 'Phỏng vấn',
};

const interviewTypeLabel = computed(() => {
  if (!props.interviewType) return 'Phỏng vấn';
  return INTERVIEW_TYPE_LABELS[props.interviewType] || props.interviewType;
});

const RECOMMENDATION_OPTIONS: Array<{
  value: 'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire';
  label: string;
  desc: string;
  colorClass: string;
  activeClass: string;
}> = [
  {
    value: 'strong_hire',
    label: 'Rất nên tuyển (Strong Hire)',
    desc: 'Vượt trội yêu cầu, phù hợp xuất sắc',
    colorClass: 'hover:border-emerald-500 hover:bg-emerald-50/40',
    activeClass: 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-600',
  },
  {
    value: 'hire',
    label: 'Đạt yêu cầu (Hire)',
    desc: 'Đạt yêu cầu chuyên môn, đề xuất nhận',
    colorClass: 'hover:border-blue-500 hover:bg-blue-50/40',
    activeClass: 'border-[#1769e8] bg-blue-50 text-blue-900 ring-1 ring-[#1769e8]',
  },
  {
    value: 'no_hire',
    label: 'Chưa đạt (No Hire)',
    desc: 'Chưa đạt tiêu chí của vòng này',
    colorClass: 'hover:border-amber-500 hover:bg-amber-50/40',
    activeClass: 'border-amber-500 bg-amber-50 text-amber-900 ring-1 ring-amber-500',
  },
  {
    value: 'strong_no_hire',
    label: 'Từ chối (Strong No Hire)',
    desc: 'Hoàn toàn không phù hợp vị trí',
    colorClass: 'hover:border-rose-500 hover:bg-rose-50/40',
    activeClass: 'border-rose-500 bg-rose-50 text-rose-900 ring-1 ring-rose-500',
  },
];

const setScore = (criterionKey: string, val: number): void => {
  const item = criteria.value.find((c) => c.key === criterionKey);
  if (item) {
    item.score = val;
  }
};

const handleClose = (): void => {
  if (!submitting.value) {
    emit('close');
  }
};

const handleSubmit = async (): Promise<void> => {
  if (!props.interviewId) {
    toast.push({ variant: 'error', title: 'Lỗi', body: 'Thiếu mã buổi phỏng vấn.' });
    return;
  }

  if (!comments.value.trim()) {
    toast.push({
      variant: 'error',
      title: 'Chưa có nhận xét',
      body: 'Vui lòng nhập nhận xét hoặc tóm tắt ý kiến của người phỏng vấn.',
    });
    return;
  }

  submitting.value = true;
  try {
    const scoresMap: Record<string, number> = {};
    for (const c of criteria.value) {
      scoresMap[c.key] = c.score;
    }

    const payload: SubmitInterviewFeedbackPayload = {
      scores: scoresMap,
      comments: comments.value.trim(),
      recommendation: recommendation.value,
    };

    await interviewApi.submitFeedback(props.interviewId, payload);

    toast.push({
      variant: 'success',
      title: 'Đã hoàn thành vòng phỏng vấn!',
      body: `Đã lưu đánh giá cho ứng viên ${props.candidateName}.`,
    });

    emit('submitted');
    emit('close');
  } catch (err) {
    toast.push({
      variant: 'error',
      title: 'Không thể lưu đánh giá',
      body: extractErrorMessage(err, 'Đã xảy ra lỗi khi gửi đánh giá.'),
    });
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-[2px] sm:p-6"
        @click.self="handleClose"
      >
        <div class="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95">
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/50">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-[#1769e8]">
                <CheckCircle2 class="h-5 w-5" />
              </div>
              <div>
                <h3 class="text-sm font-bold text-slate-900">Đánh giá kết quả phỏng vấn</h3>
                <p class="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span class="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#1769e8]">
                    <Layers class="h-3 w-3" />
                    {{ interviewTypeLabel }}
                  </span>
                  <span>•</span>
                  <span class="font-medium text-slate-700">{{ candidateName }}</span>
                  <span v-if="jobTitle" class="text-slate-400">({{ jobTitle }})</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              class="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
              @click="handleClose"
            >
              <X class="h-5 w-5" />
            </button>
          </div>

          <!-- Body Form -->
          <div class="max-h-[75vh] overflow-y-auto p-6 space-y-5">
            <!-- Đề xuất kết quả (Recommendation) -->
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-2">
                Đề xuất kết quả vòng này <span class="text-rose-500">*</span>
              </label>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  v-for="opt in RECOMMENDATION_OPTIONS"
                  :key="opt.value"
                  type="button"
                  class="rounded-xl border p-3 text-left transition cursor-pointer flex flex-col justify-between"
                  :class="[
                    recommendation === opt.value ? opt.activeClass : `border-slate-200 text-slate-700 ${opt.colorClass}`,
                  ]"
                  @click="recommendation = opt.value"
                >
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-bold leading-tight">{{ opt.label }}</span>
                    <span
                      class="h-3.5 w-3.5 rounded-full border flex items-center justify-center shrink-0"
                      :class="recommendation === opt.value ? 'border-current bg-current' : 'border-slate-300'"
                    >
                      <span v-if="recommendation === opt.value" class="h-1.5 w-1.5 rounded-full bg-white"></span>
                    </span>
                  </div>
                  <span class="text-[11px] opacity-75 leading-relaxed">{{ opt.desc }}</span>
                </button>
              </div>
            </div>

            <!-- Chấm điểm tiêu chí -->
            <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
              <label class="block text-xs font-semibold text-slate-700">
                Thang điểm theo tiêu chí (1 - 5 sao)
              </label>
              <div class="space-y-2.5">
                <div
                  v-for="item in criteria"
                  :key="item.key"
                  class="flex items-center justify-between gap-3 text-xs"
                >
                  <span class="text-slate-700 font-medium">{{ item.label }}</span>
                  <div class="flex items-center gap-1">
                    <button
                      v-for="star in 5"
                      :key="star"
                      type="button"
                      class="p-0.5 text-slate-300 hover:text-amber-400 transition cursor-pointer"
                      :class="star <= item.score ? '!text-amber-400' : ''"
                      @click="setScore(item.key, star)"
                    >
                      <Star class="h-4 w-4 fill-current" />
                    </button>
                    <span class="ml-1 w-6 text-right font-semibold text-slate-700">{{ item.score }}/5</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Nhận xét chi tiết -->
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>Nhận xét & Ghi chú phỏng vấn <span class="text-rose-500">*</span></span>
                <span class="text-[11px] text-slate-400 font-normal">Ghi nhận từ Tech Lead / Interviewer</span>
              </label>
              <textarea
                v-model="comments"
                rows="4"
                placeholder="Ví dụ: Ứng viên nắm vững kiến trúc Vue/TypeScript, giải thuật tối ưu tốt. Kỹ năng giao tiếp tự tin. Đề xuất cho vào vòng Culture Fit tiếp theo..."
                class="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1769e8] focus:outline-hidden focus:ring-1 focus:ring-[#1769e8] resize-none"
              ></textarea>
            </div>
          </div>

          <!-- Footer Actions -->
          <div class="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 bg-slate-50/50">
            <button
              type="button"
              class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              :disabled="submitting"
              @click="handleClose"
            >
              Hủy bỏ
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-xl bg-[#1769e8] px-5 py-2 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm transition cursor-pointer disabled:opacity-60"
              :disabled="submitting"
              @click="handleSubmit"
            >
              <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
              <CheckCircle2 v-else class="h-4 w-4" />
              <span>Hoàn thành vòng phỏng vấn</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

