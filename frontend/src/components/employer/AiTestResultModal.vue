<script setup lang="ts">
/**
 * AiTestResultModal — lightbox xem CHI TIẾT bài làm của ứng viên:
 * mỗi câu hiển thị đáp án ứng viên chọn + đáp án đúng, ✓/✗ per câu,
 * tổng điểm + timeline (gửi/bắt đầu/nộp/chấm) + cờ anti-cheat.
 *
 * Data từ GET /ai-tests/assignment/:assignmentId (employer owns).
 */
import { computed } from 'vue'
import { X, Loader2, CheckCircle2, XCircle, Flag, Clock } from 'lucide-vue-next'
import type { AssignmentDetail } from '@/services/aiTest.api'
import dayjs from 'dayjs'

const props = defineProps<{
  open: boolean
  detail: AssignmentDetail | null
  loading?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const testTypeLabel = computed(() =>
  props.detail?.test.testType === 'iq' ? 'IQ — Tư duy logic' : 'Tiếng Anh',
)

/** Flag slug → mô tả tiếng Việt (hover trên badge ⚠). Unknown → giữ slug. */
const FLAG_LABELS: Record<string, string> = {
  'too-fast-high-score': 'Làm quá nhanh nhưng điểm số lại cao — nghi ngờ có người hỗ trợ hoặc chia sẻ đáp án',
}

const flagLabel = (slug: string): string => FLAG_LABELS[slug] ?? slug

const flagsTitle = computed(() =>
  (props.detail?.assignment.flags ?? []).map(flagLabel).join('\n'),
)

/** Thời gian làm bài thực tế = submittedAt - startedAt. */
const timeSpent = computed<string>(() => {
  const a = props.detail?.assignment
  if (!a?.startedAt || !a.submittedAt) return '—'
  const secs = Math.max(0, Math.round((new Date(a.submittedAt).getTime() - new Date(a.startedAt).getTime()) / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m} phút ${s} giây` : `${s} giây`
})

/** Ghép câu hỏi + đáp án ứng viên → rows hiển thị ✓/✗. */
const rows = computed(() => {
  const qs = props.detail?.test.questions ?? []
  const answers = props.detail?.assignment.answers ?? {}
  return qs.map((q, i) => {
    const candidate = answers[q.id] ?? null
    const isCorrect = !!q.correctAnswer && !!candidate
      && candidate.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()
    return { q, index: i + 1, candidate, isCorrect }
  })
})

const correctCount = computed(() => rows.value.filter((r) => r.isCorrect).length)
const fmt = (iso: string | null): string => (iso ? dayjs(iso).format('DD/MM/YYYY HH:mm') : '—')
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
          <!-- Toolbar -->
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0 text-white">
              <div class="truncate text-[15px] font-semibold drop-shadow-sm">
                Bài làm — Test {{ testTypeLabel }}
              </div>
              <div class="flex flex-wrap items-center gap-3 text-[11px] text-white/70">
                <span>Gửi {{ fmt(detail?.assignment.sentAt ?? null) }}</span>
                <span>Nộp {{ fmt(detail?.assignment.submittedAt ?? null) }}</span>
                <span class="inline-flex items-center gap-1">
                  <Clock :size="11" /> Làm bài {{ timeSpent }}
                </span>
                <span class="inline-flex items-center gap-1">
                  Hạn {{ fmt(detail?.assignment.expiresAt ?? null) }}
                </span>
              </div>
            </div>
            <button
              type="button"
              class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20"
              aria-label="Đóng"
              @click="emit('close')"
            >
              <X :size="16" />
            </button>
          </div>

          <!-- Sheet -->
          <div class="overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-slate-900/5">
            <div v-if="loading" class="flex items-center justify-center p-10 text-slate-500">
              <Loader2 :size="20" class="animate-spin text-[#5b4eea]" />
            </div>

            <template v-else-if="detail">
              <!-- Điểm tổng + flags -->
              <div class="flex flex-wrap items-center gap-4 border-b border-slate-100 p-5">
                <div
                  class="grid h-14 w-14 shrink-0 place-items-center rounded-full text-[16px] font-bold"
                  :class="Number(detail.assignment.score) >= 60 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'"
                >
                  {{ Math.round(Number(detail.assignment.score ?? 0)) }}%
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-[13px] font-semibold text-slate-900">
                    Đúng {{ correctCount }}/{{ rows.length }} câu
                  </p>
                  <p class="text-[11px] text-slate-500">
                    {{ detail.test.totalPoints }} điểm · Đạt từ {{ detail.test.passingScore }}%
                  </p>
                </div>
                <span
                  v-if="detail.assignment.flags?.length"
                  class="inline-flex cursor-help items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700"
                  :title="flagsTitle"
                >
                  <Flag :size="12" /> Nghi ngờ gian lận ({{ detail.assignment.flags.length }})
                </span>
              </div>

              <!-- Từng câu -->
              <ol class="divide-y divide-slate-100">
                <li v-for="r in rows" :key="r.q.id" class="px-5 py-4">
                  <div class="flex items-start gap-3">
                    <span class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                      {{ r.index }}
                    </span>
                    <div class="min-w-0 flex-1">
                      <p class="text-[13px] font-medium text-slate-900">{{ r.q.question }}</p>

                      <div class="mt-2 space-y-1">
                        <p
                          class="flex items-start gap-1.5 rounded-md px-2 py-1 text-[12px]"
                          :class="r.isCorrect ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'"
                        >
                          <CheckCircle2 v-if="r.isCorrect" :size="13" class="mt-0.5 shrink-0" />
                          <XCircle v-else :size="13" class="mt-0.5 shrink-0" />
                          <span>
                            Ứng viên chọn: <span class="font-semibold">{{ r.candidate ?? '(bỏ trống)' }}</span>
                          </span>
                        </p>
                        <p v-if="!r.isCorrect && r.q.correctAnswer" class="flex items-start gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[12px] text-emerald-800">
                          <CheckCircle2 :size="13" class="mt-0.5 shrink-0" />
                          <span>Đáp án đúng: <span class="font-semibold">{{ r.q.correctAnswer }}</span></span>
                        </p>
                      </div>
                    </div>
                  </div>
                </li>
              </ol>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
