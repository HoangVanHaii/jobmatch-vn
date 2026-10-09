<script setup lang="ts">
/**
 * TakeTestView — trang PUBLIC cho candidate làm bài test qua link email.
 *
 * Token 64 hex là proof-of-access duy nhất (không login). Đề đã strip đáp án
 * + shuffle từ BE. Đồng hồ đếm ngược durationMin tính từ lần ĐẦU mở link
 * (startedAt do BE set) — hết giờ tự nộp những câu đã chọn.
 *
 * States: loading → (error: invalid/expired/already) → test → done.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-vue-next';
import { aiTestApi, type PublicTest } from '@/services/aiTest.api';
import { extractErrorMessage } from '@/services/http';

const route = useRoute();
const token = String(route.params.token ?? '');

type ViewState = 'loading' | 'error' | 'test' | 'done';
const view = ref<ViewState>('loading');
const errorMsg = ref('');
const test = ref<PublicTest | null>(null);

const answers = ref<Record<string, string>>({});
const submitting = ref(false);
const result = ref<{ score: number; passed: boolean } | null>(null);

// ---------------------------------------------------------------------------
// Đồng hồ — đếm ngược từ startedAt (BE set lần đầu mở) + durationMin.
// Hết giờ → auto-submit. Tick mỗi giây.
// ---------------------------------------------------------------------------
const secondsLeft = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const startTimer = (): void => {
  if (!test.value) return;
  const startedMs = new Date(test.value.startedAt).getTime();
  const deadline = startedMs + (test.value.durationMin ?? 30) * 60_000;
  const tick = (): void => {
    secondsLeft.value = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    if (secondsLeft.value <= 0) {
      if (timer) clearInterval(timer);
      timer = null;
      showMissingConfirm.value = false; // hết giờ — nộp thẳng, không hỏi
      void doSubmit(true);
    }
    if (secondsLeft.value <= 300) {
      // ≤5 phút — nhấp nháy đỏ
    }
  };
  tick();
  timer = setInterval(tick, 1000);
};

const formatTime = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * AUTOSAVE — chọn đáp án là lưu ngay lên BE (fire-and-forget). Lỗi im lặng:
 * submit cuối vẫn gửi full answers làm source of truth. Chống spam: gom
 * questionId đang lưu vào Set, tick tiếp cùng câu thì bỏ qua request cũ.
 */
const savingQuestions = ref<Set<string>>(new Set());

const onAnswerChange = (qid: string, value: string): void => {
  answers.value[qid] = value;
  if (savingQuestions.value.has(qid)) return; // request trước chưa xong — submit sẽ cover
  savingQuestions.value.add(qid);
  aiTestApi
    .saveAnswer(token, qid, value)
    .catch(() => {/* im lặng — doSubmit gửi lại đầy đủ */})
    .finally(() => {
      const next = new Set(savingQuestions.value);
      next.delete(qid);
      savingQuestions.value = next;
    });
};

const load = async (): Promise<void> => {
  view.value = 'loading';
  try {
    const { data } = await aiTestApi.getPublicTest(token);
    test.value = data.data;
    view.value = 'test';
    startTimer();
  } catch (e) {
    errorMsg.value = extractErrorMessage(e, 'Link bài test không hợp lệ');
    view.value = 'error';
  }
};

/** Bấm số thứ tự ở navigator → scroll mượt đến câu đó (trừ sticky header). */
const scrollToQuestion = (qid: string): void => {
  document.getElementById(`q-${qid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ---------------------------------------------------------------------------
// Submit flow — bấm "Nộp bài" còn câu trống → CẢNH BÁO xác nhận trước
// (auto-submit hết giờ thì bỏ qua cảnh báo, nộp những gì đã chọn).
// ---------------------------------------------------------------------------
const showMissingConfirm = ref(false);

const requestSubmit = (): void => {
  if (submitting.value || view.value !== 'test' || !test.value) return;
  const unanswered = test.value.questions.filter((q) => !answers.value[q.id]).length;
  if (unanswered > 0) {
    showMissingConfirm.value = true;
    return;
  }
  void doSubmit();
};

const cancelMissingConfirm = (): void => {
  showMissingConfirm.value = false;
};

const doSubmit = async (auto = false): Promise<void> => {
  if (submitting.value || view.value !== 'test') return;
  submitting.value = true;
  try {
    const { data } = await aiTestApi.submitTest(token, answers.value);
    result.value = { score: data.data.score, passed: data.data.passed };
    view.value = 'done';
  } catch (e) {
    if (auto) {
      // Hết giờ mà submit fail → vẫn hiện lỗi để candidate biết.
    }
    errorMsg.value = extractErrorMessage(e, 'Nộp bài thất bại');
    view.value = 'error';
  } finally {
    submitting.value = false;
  }
};

onMounted(load);
</script>

<template>
  <div class="min-h-screen bg-[#f7f9fc] font-poppins text-[#17233c]">
    <!-- Loading -->
    <div v-if="view === 'loading'" class="flex min-h-screen items-center justify-center text-gray-500">
      <Loader2 class="mr-2 h-5 w-5 animate-spin" /> Đang tải bài test…
    </div>

    <!-- Error -->
    <div v-else-if="view === 'error'" class="flex min-h-screen items-center justify-center p-4">
      <div class="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <XCircle class="mx-auto mb-3 h-10 w-10 text-red-400" />
        <h1 class="text-lg font-semibold text-gray-900">Không mở được bài test</h1>
        <p class="mt-2 text-sm text-gray-600">{{ errorMsg }}</p>
      </div>
    </div>

    <!-- Done -->
    <div v-else-if="view === 'done' && result" class="flex min-h-screen items-center justify-center p-4">
      <div class="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <CheckCircle2 class="mx-auto mb-3 h-12 w-12" :class="result.passed ? 'text-emerald-500' : 'text-amber-500'" />
        <h1 class="text-lg font-semibold text-gray-900">Đã nộp bài thành công!</h1>
        <p class="mt-2 text-3xl font-bold" :class="result.passed ? 'text-emerald-600' : 'text-amber-600'">
          {{ result.score }}%
        </p>
        <p class="mt-1 text-sm text-gray-600">
          {{ result.passed ? 'Kết quả đã được gửi tới nhà tuyển dụng.' : 'Nhà tuyển dụng sẽ xem xét kết quả của bạn.' }}
        </p>
      </div>
    </div>

    <!-- Test — main + navigator phải (lg): số câu đã làm / bỏ sót, bấm để
         scroll tới câu. -->
    <div v-else-if="view === 'test' && test" class="mx-auto flex max-w-5xl gap-6 px-4 py-8">
      <div class="min-w-0 flex-1">
      <!-- Sticky header: loại test + đồng hồ -->
      <div class="sticky top-0 z-10 -mx-4 mb-6 flex items-center justify-between border-b border-gray-200 bg-[#f7f9fc] px-4 py-3">
        <div>
          <h1 class="text-[15px] font-bold text-gray-900">
            {{ test.testType === 'iq' ? 'Bài test IQ — Tư duy logic' : 'Bài test Tiếng Anh' }}
          </h1>
          <p class="text-[11px] text-[#8190a5]">
            {{ test.questions.length }} câu · {{ test.totalPoints }} điểm
          </p>
        </div>
        <div
          class="rounded-lg px-4 py-2 text-[16px] font-bold tabular-nums"
          :class="secondsLeft <= 300 ? 'bg-red-50 text-red-600' : 'bg-white text-gray-900 shadow-sm border border-gray-200'"
        >
          <Clock class="mr-1 inline h-4 w-4" />{{ formatTime(secondsLeft) }}
          <span v-if="submitting" class="ml-2 text-[12px] font-normal"><Loader2 class="inline h-3 w-3 animate-spin" /></span>
        </div>
      </div>

      <!-- Questions -->
      <ol class="space-y-5">
        <li
          v-for="(q, i) in test.questions"
          :id="`q-${q.id}`"
          :key="q.id"
          class="scroll-mt-20 rounded-xl border border-[#e7ebf1] bg-white p-5"
        >
          <p class="text-[13.5px] font-medium text-gray-900">
            <span class="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-primary-100 text-[11px] font-bold text-primary-700">{{ i + 1 }}</span>
            {{ q.question }}
            <span class="ml-1 text-[11px] font-normal text-[#94a3b8]">({{ q.points }} điểm)</span>
          </p>
          <div class="mt-3 space-y-2">
            <label
              v-for="(opt, j) in q.options"
              :key="j"
              class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#e3e8ef] px-3 py-2.5 text-[12.5px] transition hover:bg-[#eef5ff]"
              :class="answers[q.id] === opt ? 'border-[#1769e8] bg-[#eef5ff]' : ''"
            >
              <input
                type="radio"
                :name="q.id"
                :value="opt"
                :checked="answers[q.id] === opt"
                class="mt-0.5 accent-[#1769e8]"
                @change="onAnswerChange(q.id, opt)"
              />
              <span>{{ opt }}</span>
            </label>
          </div>
        </li>
      </ol>

      <!-- Submit bar + cảnh báo thiếu câu -->
      <div class="sticky bottom-0 -mx-4 mt-6 border-t border-gray-200 bg-[#f7f9fc] px-4 py-3">
        <!-- Cảnh báo: còn câu bỏ trống → xác nhận trước khi nộp -->
        <div
          v-if="showMissingConfirm"
          class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5"
        >
          <p class="text-[12px] font-medium text-amber-800">
            ⚠ Bạn còn
            <strong>
              {{ test.questions.filter((q) => !answers[q.id]).length }}
            </strong>
            câu chưa trả lời. Câu bỏ trống sẽ bị tính 0 điểm.
          </p>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="h-8 rounded-lg border border-amber-400 px-3 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
              @click="cancelMissingConfirm"
            >
              Làm tiếp
            </button>
            <button
              type="button"
              :disabled="submitting"
              class="h-8 rounded-lg bg-amber-600 px-3 text-[11px] font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
              @click="doSubmit(false)"
            >
              <Loader2 v-if="submitting" class="mr-1 inline h-3 w-3 animate-spin" />
              Vẫn nộp
              </button>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <p class="text-[11px] text-[#8190a5]">
            Đã trả lời {{ Object.keys(answers).length }}/{{ test.questions.length }} câu
          </p>
          <button
            type="button"
            :disabled="submitting"
            class="inline-flex h-11 items-center gap-2 rounded-lg bg-[#1769e8] px-6 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#0f5ccc] disabled:opacity-50"
            @click="requestSubmit"
          >
            <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
            Nộp bài
          </button>
        </div>
      </div>
      </div>

      <!-- Navigator phải — ô số theo trạng thái: xanh = đã trả lời, trắng =
           chưa. Bấm → scroll mượt tới câu. Sticky theo scroll. -->
      <aside class="hidden lg:block w-28 shrink-0">
        <div class="sticky top-20 grid grid-cols-3 gap-2 rounded-xl border border-[#e7ebf1] bg-white p-3">
          <button
            v-for="(q, i) in test.questions"
            :key="q.id"
            type="button"
            class="grid h-10 w-full min-w-0 place-items-center rounded-lg border text-[12px] font-semibold tabular-nums transition"
            :class="answers[q.id]
              ? 'border-[#1769e8] bg-[#1769e8] text-white'
              : 'border-gray-300 bg-white text-gray-500 hover:border-[#1769e8] hover:text-[#1769e8]'"
            :title="`Câu ${i + 1}${answers[q.id] ? ' — đã trả lời' : ' — chưa trả lời'}`"
            @click="scrollToQuestion(q.id)"
          >
            {{ i + 1 }}
          </button>
          <!-- Chú giải -->
          <div class="col-span-3 mt-1 space-y-1 border-t border-gray-100 pt-2 text-[9.5px] text-gray-400">
            <p class="flex items-center gap-1">
              <span class="inline-block h-2 w-2 rounded-sm bg-[#1769e8]"></span> Đã làm
            </p>
            <p class="flex items-center gap-1">
              <span class="inline-block h-2 w-2 rounded-sm border border-gray-300 bg-white"></span> Bỏ sót
            </p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
