<script setup lang="ts">
/**
 * AiTestReviewModal — lightbox HR review đề AI test trước khi giao.
 *
 * Pattern CvDetailView: Teleport + overlay slate-900/60, sheet trắng
 * max-w-3xl, câu hỏi kèm ĐÁP ÁN ĐÚNG highlight (HR cần thấy để review).
 *
 * Props: open, test (full detail từ GET /ai-tests/:id), loading, assigning.
 * Emits: close, assign — parent tự gọi API (component pure).
 */
import { computed } from 'vue'
import { X, Loader2, Send, CheckCircle2, Clock, HelpCircle } from 'lucide-vue-next'
import type { AiTestDetail } from '@/services/aiTest.api'

const props = defineProps<{
  open: boolean
  test: AiTestDetail | null
  loading?: boolean
  assigning?: boolean
}>()

const emit = defineEmits<{ close: []; assign: [] }>()

const testTypeLabel = computed(() =>
  props.test?.testType === 'iq' ? 'IQ — Tư duy logic' : 'Tiếng Anh',
)
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
        class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-[2px] sm:p-8"
        @click.self="emit('close')"
      >
        <div class="font-poppins mx-auto flex w-full max-w-3xl flex-col">
          <!-- Toolbar nổi -->
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0 text-white">
              <div class="truncate text-[15px] font-semibold drop-shadow-sm">
                Đề test {{ testTypeLabel }}
              </div>
              <div class="flex items-center gap-3 text-[11px] text-white/70">
                <span class="inline-flex items-center gap-1">
                  <HelpCircle :size="11" />
                  {{ test?.questions?.length ?? 0 }} câu
                </span>
                <span class="inline-flex items-center gap-1">
                  <Clock :size="11" />
                  {{ test?.durationMin ?? '—' }} phút
                </span>
                <span>Tổng {{ test?.totalPoints ?? 0 }} điểm</span>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                :disabled="assigning || !test || test.status !== 'ready'"
                class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#5b4eea] px-3.5 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-[#4a3ed1] disabled:cursor-not-allowed disabled:opacity-50"
                title="Gửi link bài test qua email cho ứng viên"
                @click="emit('assign')"
              >
                <Loader2 v-if="assigning" :size="12" class="animate-spin" />
                <Send v-else :size="12" />
                Gửi cho ứng viên
              </button>
              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20"
                aria-label="Đóng"
                @click="emit('close')"
              >
                <X :size="16" />
              </button>
            </div>
          </div>

          <!-- Sheet trắng -->
          <div class="overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-slate-900/5">
            <div class="flex items-center justify-center p-10 text-slate-500" v-if="loading">
              <Loader2 :size="20" class="animate-spin text-[#5b4eea]" />
            </div>

            <div v-else-if="test?.status === 'generating'" class="flex flex-col items-center gap-2 p-10 text-center">
              <Loader2 :size="20" class="animate-spin text-[#5b4eea]" />
              <p class="text-[12px] text-slate-600">AI đang sinh đề — đóng modal, đề sẽ sẵn sàng trong ít phút.</p>
            </div>

            <div v-else-if="test?.status === 'failed'" class="flex flex-col items-center gap-2 p-10 text-center">
              <p class="text-[12px] text-red-600">Sinh đề thất bại — thử bấm "Giao bài" lại.</p>
            </div>

            <ol v-else-if="test?.questions?.length" class="divide-y divide-slate-100">
              <li v-for="(q, i) in test.questions" :key="q.id" class="px-5 py-4">
                <div class="flex items-start gap-3">
                  <span class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                    {{ i + 1 }}
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="text-[13px] font-medium text-slate-900">{{ q.question }}</p>
                    <ul class="mt-2 space-y-1">
                      <li
                        v-for="(opt, j) in q.options"
                        :key="j"
                        class="flex items-start gap-2 rounded-md px-2 py-1 text-[12px]"
                        :class="opt === q.correctAnswer ? 'bg-emerald-50 font-semibold text-emerald-800' : 'text-slate-600'"
                      >
                        <CheckCircle2
                          v-if="opt === q.correctAnswer"
                          :size="13"
                          class="mt-0.5 shrink-0 text-emerald-600"
                        />
                        <span>{{ opt }}</span>
                      </li>
                    </ul>
                    <p class="mt-1.5 text-[10.5px] text-slate-400">{{ q.points }} điểm</p>
                  </div>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
