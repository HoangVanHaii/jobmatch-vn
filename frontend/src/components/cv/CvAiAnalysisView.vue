<script setup lang="ts">
/**
 * CvAiAnalysisView — modal hiển thị chi tiết phân tích AI của CV.
 *
 * Show:
 *   - Header: Brain icon + CV title + "Phân tích & chấm điểm bằng AI"
 *   - Score block: điểm lớn + nhãn (Xuất sắc / Tốt / Trung bình / Cần cải thiện)
 *     HOẶC warning "File này có vẻ không phải CV" nếu `isCv=false`
 *   - Body 4 sections:
 *     1. Điểm mạnh (CheckCircle2, emerald)
 *     2. Điểm yếu (AlertTriangle, amber)
 *     3. Gợi ý cải thiện (Lightbulb, primary)
 *     4. Cảnh báo xác minh (ShieldAlert, red — GitHub/LinkedIn 404/private)
 *   - Footer: disclaimer + Đóng button
 *
 * Tại sao tách riêng (so với MyResumesView):
 *   - 200+ dòng modal markup → ôm trong view quản lý CV → view phình to,
 *     khó maintain, khó test.
 *   - Khi AI analysis shape đổi (BE thêm field mới) → sửa 1 chỗ.
 *   - Khi đổi design (gradient header, score block layout) → không rò rỉ
 *     vào MyResumesView.
 *   - Tái sử dụng được ở flow khác (vd recruiter xem CV ứng viên có kèm
 *     AI analysis, dashboard CV quality).
 *
 * Props:
 *   - `open` : boolean — show/hide modal
 *   - `cv`   : Cv | null — CV đang xem analysis (header lấy title, body lấy ai_analysis)
 *
 * Emits:
 *   - `close` — backdrop click, X button, hoặc Đóng footer button
 */
import { AlertTriangle, Brain, CheckCircle2, Lightbulb, ShieldAlert, X } from 'lucide-vue-next';
import { scoreLabel } from '@/utils/aiScore';
import type { Cv } from '@/types/cv';

defineProps<{
  open: boolean;
  cv: Cv | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const onBackdropClick = (): void => emit('close');
const onClose = (): void => emit('close');
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
        class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
        @click.self="onBackdropClick"
      >
        <Transition
          appear
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 scale-95 translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
        >
          <div
            v-if="cv && cv.ai_analysis"
            class="bg-white rounded-2xl shadow-2xl shadow-slate-900/20 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden ring-1 ring-slate-900/5"
          >
            <!-- Header: điểm lớn + tiêu đề CV -->
            <header class="px-5 sm:px-6 py-4 sm:py-5 border-b border-slate-200 bg-gradient-to-br from-violet-50/60 via-white to-white">
              <div class="flex items-start justify-between gap-4">
                <div class="flex items-center gap-3.5 min-w-0">
                  <div class="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-100 to-violet-50 ring-1 ring-violet-200/70 flex items-center justify-center shrink-0">
                    <Brain class="w-5 h-5 text-violet-600" />
                  </div>
                  <div class="min-w-0">
                    <h2 class="text-base sm:text-lg font-semibold text-slate-900 truncate">
                      {{ cv.title || 'CV chưa đặt tên' }}
                    </h2>
                    <p class="text-xs text-slate-500 mt-0.5">
                      Phân tích &amp; chấm điểm bằng AI
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  class="w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors inline-flex items-center justify-center shrink-0"
                  :aria-label="'Đóng'"
                  @click="onClose"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>

              <!-- Score block: điểm lớn + nhãn HOẶC warning "không phải CV" -->
              <div
                v-if="cv.ai_analysis.isCv"
                class="mt-4 flex items-center gap-4"
              >
                <div class="flex items-baseline gap-1.5">
                  <span class="text-4xl sm:text-5xl font-bold text-violet-600 tabular-nums leading-none">
                    {{ cv.ai_analysis.total }}
                  </span>
                  <span class="text-base text-slate-400 font-medium tabular-nums">/100</span>
                </div>
                <span
                  class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ring-1"
                  :class="scoreLabel(cv.ai_analysis.total).tone"
                >
                  {{ scoreLabel(cv.ai_analysis.total).label }}
                </span>
              </div>
              <div
                v-else
                class="mt-4 flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-amber-50 ring-1 ring-amber-200/70"
              >
                <AlertTriangle class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p class="text-sm text-amber-800">
                  File này có vẻ không phải CV — AI không thể chấm điểm.
                </p>
              </div>
            </header>

            <!-- Body: 3 sections (strengths / weaknesses / suggestions) + warnings -->
            <div
              v-if="cv.ai_analysis.isCv"
              class="analysis-scroll flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5"
            >
              <!-- Strengths -->
              <section v-if="cv.ai_analysis.strengths.length > 0">
                <div class="flex items-center gap-2 mb-2.5">
                  <CheckCircle2 class="w-4 h-4 text-emerald-600" />
                  <h3 class="text-sm font-semibold text-slate-900">Điểm mạnh</h3>
                  <span class="text-[11px] font-semibold text-slate-400 tabular-nums">
                    {{ cv.ai_analysis.strengths.length }}
                  </span>
                </div>
                <ul class="space-y-2">
                  <li
                    v-for="(item, idx) in cv.ai_analysis.strengths"
                    :key="`s-${idx}`"
                    class="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 shrink-0" />
                    <span>{{ item }}</span>
                  </li>
                </ul>
              </section>

              <!-- Weaknesses -->
              <section v-if="cv.ai_analysis.weaknesses.length > 0">
                <div class="flex items-center gap-2 mb-2.5">
                  <AlertTriangle class="w-4 h-4 text-amber-600" />
                  <h3 class="text-sm font-semibold text-slate-900">Điểm yếu</h3>
                  <span class="text-[11px] font-semibold text-slate-400 tabular-nums">
                    {{ cv.ai_analysis.weaknesses.length }}
                  </span>
                </div>
                <ul class="space-y-2">
                  <li
                    v-for="(item, idx) in cv.ai_analysis.weaknesses"
                    :key="`w-${idx}`"
                    class="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 shrink-0" />
                    <span>{{ item }}</span>
                  </li>
                </ul>
              </section>

              <!-- Suggestions -->
              <section v-if="cv.ai_analysis.suggestions.length > 0">
                <div class="flex items-center gap-2 mb-2.5">
                  <Lightbulb class="w-4 h-4 text-primary-600" />
                  <h3 class="text-sm font-semibold text-slate-900">Gợi ý cải thiện</h3>
                  <span class="text-[11px] font-semibold text-slate-400 tabular-nums">
                    {{ cv.ai_analysis.suggestions.length }}
                  </span>
                </div>
                <ul class="space-y-2">
                  <li
                    v-for="(item, idx) in cv.ai_analysis.suggestions"
                    :key="`g-${idx}`"
                    class="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-primary-500 mt-2 shrink-0" />
                    <span>{{ item }}</span>
                  </li>
                </ul>
              </section>

              <!-- Verification warnings (GitHub / LinkedIn) -->
              <section v-if="cv.ai_analysis.verificationWarnings.length > 0">
                <div class="flex items-center gap-2 mb-2.5">
                  <ShieldAlert class="w-4 h-4 text-red-600" />
                  <h3 class="text-sm font-semibold text-slate-900">Cảnh báo xác minh</h3>
                  <span class="text-[11px] font-semibold text-slate-400 tabular-nums">
                    {{ cv.ai_analysis.verificationWarnings.length }}
                  </span>
                </div>
                <ul class="space-y-2">
                  <li
                    v-for="(warn, idx) in cv.ai_analysis.verificationWarnings"
                    :key="`v-${idx}`"
                    class="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-red-50/70 ring-1 ring-red-100/70"
                  >
                    <ShieldAlert class="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                    <div class="flex-1 min-w-0">
                      <p class="text-sm text-slate-800 leading-relaxed">{{ warn.message }}</p>
                      <a
                        v-if="warn.url"
                        :href="warn.url"
                        target="_blank"
                        rel="noopener"
                        class="text-xs text-red-700 hover:text-red-800 font-medium underline-offset-2 hover:underline mt-1 inline-block break-all"
                      >
                        {{ warn.url }}
                      </a>
                    </div>
                  </li>
                </ul>
              </section>
            </div>

            <!-- Footer -->
            <footer class="px-5 sm:px-6 py-3.5 border-t border-slate-200 bg-slate-50/40 flex items-center justify-between gap-3">
              <p class="text-[11px] text-slate-400">
                Điểm được tính dựa trên nội dung CV đã parse.
              </p>
              <button
                type="button"
                class="h-9 px-4 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                @click="onClose"
              >
                Đóng
              </button>
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Scrollbar mỏng — gọn trong modal AI analysis, không chiếm chiều ngang.
 * Firefox dùng `scrollbar-width: thin`, Webkit/Chromium/Safari dùng ::-webkit-scrollbar.
 * Track trong suốt + thumb slate-300 mảnh 4px, bo tròn full để hài hoà với
 * tone violet/slate của modal. */
.analysis-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(203, 213, 225, 0.7) transparent;
}
.analysis-scroll::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.analysis-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.analysis-scroll::-webkit-scrollbar-thumb {
  background-color: rgba(203, 213, 225, 0.7);
  border-radius: 9999px;
}
.analysis-scroll::-webkit-scrollbar-thumb:hover {
  background-color: rgba(148, 163, 184, 0.9);
}
</style>