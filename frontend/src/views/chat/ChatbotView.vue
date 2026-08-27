<script setup lang="ts">
/**
 * ChatbotView
 *
 * Trang full-page `/chatbot`. Layout (chatGPT-style attachment):
 *   ┌────────────────────────────────────────────┐
 *   │ ChatbotHeader (title + totalTokens + Reset) │
 *   ├──────────────┬─────────────────────────────┤
 *   │  Sidebar     │  Messages list              │
 *   │  sessions    │  ─────────────────────────  │
 *   │  list        │  [Chips đã gắn nếu có]     │
 *   │              │  [Paperclip] [Input] [Send] │
 *   └──────────────┴─────────────────────────────┘
 *
 * Picker không còn là panel riêng — user click icon Paperclip để mở menu
 * "Thêm Job / Thêm CV", chọn xong đóng dropdown và chip hiện inline trên input.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { Send, Square, Sparkles, X, Briefcase, FileText } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { useChatbotStore } from '@stores/chatbot';
import { useAuthStore } from '@stores/auth';
import ChatbotHeader from '@components/chatbot/ChatbotHeader.vue';
import ChatbotSidebar from '@components/chatbot/ChatbotSidebar.vue';
import ChatbotMessage from '@components/chatbot/ChatbotMessage.vue';
import ChatbotAttachmentMenu from '@components/chatbot/ChatbotAttachmentMenu.vue';

const store = useChatbotStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const messagesEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
const draft = ref('');
const errorMessage = ref<string | null>(null);

const canSend = computed(
  () => draft.value.trim().length > 0 && !store.isStreaming && !store.budgetExceeded,
);
const isEmpty = computed(() => !store.messages.length && !store.streamingContent);

/** Intent types đang được xử lý — trích từ `lastEvent` (event `types` gần nhất). */
const intentTypes = computed(() =>
  store.lastEvent?.type === 'types' ? store.lastEvent.types : undefined,
);

/**
 * Chip rendering lấy trực tiếp từ `store.attachedJobs` / `store.attachedCvs`
 * (backend trả về metadata kèm theo session). KHÔNG lookup qua `pickerJobs.find()`
 * vì pickerJobs chỉ load list 1 source tại 1 thời điểm — item gắn từ tab khác
 * hoặc sau reload sẽ không có → chip không render.
 */
const selectedJobs = computed(() => store.attachedJobs);
const selectedCvs = computed(() => store.attachedCvs);
const hasContext = computed(
  () => selectedJobs.value.length > 0 || selectedCvs.value.length > 0,
);
const totalContext = computed(() => store.jobIds.length + store.cvIds.length);

const scrollToBottom = async (): Promise<void> => {
  await nextTick();
  if (!messagesEl.value) return;
  messagesEl.value.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' });
};

watch(
  () => [store.messages.length, store.streamingContent.length],
  () => {
    scrollToBottom();
  },
);

const bootstrap = async (): Promise<void> => {
  await store.loadSessions();
  // Pre-load picker data để dropdown có sẵn list khi user click Paperclip.
  await store.loadPicker();
  const qSession = (route.query.session as string | undefined) ?? null;
  const last = store.sessions[0]?.id ?? null;
  const target = qSession ?? last;
  if (target) {
    await store.selectSession(target);
  }
};

onMounted(bootstrap);

watch(
  () => route.query.session,
  async (sid) => {
    if (typeof sid === 'string' && sid && sid !== store.activeSessionId) {
      await store.selectSession(sid);
    }
  },
);

const onCreate = async (): Promise<void> => {
  await store.createSession();
  router.replace({ query: { ...route.query, session: store.activeSessionId ?? '' } });
};

const onSelect = async (sessionId: string): Promise<void> => {
  router.replace({ query: { ...route.query, session: sessionId } });
  await store.selectSession(sessionId);
};

const onSend = async (): Promise<void> => {
  if (!canSend.value) return;
  if (!store.activeSessionId) {
    await onCreate();
  }
  const content = draft.value.trim();
  if (!content) return;
  draft.value = '';
  errorMessage.value = null;
  try {
    await store.sendMessage(content);
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Có lỗi, vui lòng thử lại.';
  }
};

const onStop = (): void => {
  store.abortStream();
};

const onReset = async (): Promise<void> => {
  await store.resetContext();
};

const onEnter = (e: KeyboardEvent): void => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  // Chặn Enter khi không gửi được (đang stream / hết budget / draft rỗng)
  // để newline không bị chèn vào textarea — UX rõ ràng hơn cho user.
  e.preventDefault();
  if (!canSend.value) return;
  void onSend();
};

const userName = computed(() => {
  const u = auth.user;
  if (!u) return 'bạn';
  const local = u.email?.split('@')[0];
  return local || 'bạn';
});

const removeTooltip = computed(() =>
  store.isStreaming ? 'Đang chờ phản hồi — bấm "Dừng" phía dưới để đổi.' : '',
);
</script>

<template>
  <div class="flex h-screen flex-col bg-gray-50">
    <ChatbotHeader
      :title="store.activeSession?.title ?? null"
      :total-tokens="store.totalTokens"
      @reset="onReset"
    />

    <div class="flex flex-1 overflow-hidden">
      <ChatbotSidebar
        :sessions="store.sessions"
        :active-session-id="store.activeSessionId"
        @select="onSelect"
        @new="onCreate"
      />

      <main class="flex flex-1 flex-col overflow-hidden">
        <!-- Messages -->
        <div ref="messagesEl" class="flex-1 overflow-y-auto bg-gray-50 px-6 py-4">
          <div v-if="isEmpty" class="flex h-full items-center justify-center">
            <div class="max-w-md rounded-xl bg-white p-6 text-center shadow ring-1 ring-gray-200">
              <Sparkles class="mx-auto mb-2 h-6 w-6 text-blue-600" />
              <h2 class="text-base font-semibold text-gray-900">
                Chào {{ userName }}, tôi có thể giúp gì cho bạn?
              </h2>
              <p class="mt-1 text-sm text-gray-600">
                Hỏi về CV, JD, độ phù hợp với job, tìm việc, đơn ứng tuyển, lịch phỏng vấn hoặc gói dịch vụ.
              </p>
              <p class="mt-3 text-xs text-gray-400">
                Bấm biểu tượng kẹp giấy bên dưới để đính kèm job/CV (tối đa 3).
              </p>
            </div>
          </div>

          <ChatbotMessage
            v-else
            :messages="store.messages"
            :streaming-content="store.streamingContent"
            :is-streaming="store.isStreaming"
            :intent-types="intentTypes"
          />
        </div>

        <!-- Error banner -->
        <div
          v-if="errorMessage"
          class="mx-6 mb-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          {{ errorMessage }}
          <button class="ml-2 underline" @click="errorMessage = null">Đóng</button>
        </div>

        <div
          v-if="store.budgetExceeded"
          class="mx-6 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700"
        >
          Phiên chat đã dùng hết 50.000 token. Vui lòng tạo phiên mới để tiếp tục.
        </div>

        <!-- Unified input box: chips (nếu có) + paperclip + textarea + send/stop -->
        <div class="border-t border-gray-200 bg-white px-6 py-3">
          <div class="rounded-xl border border-gray-300 bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/20">
            <!-- Chips row (chỉ hiện khi có context) -->
            <div
              v-if="hasContext"
              class="flex flex-wrap items-center gap-1.5 border-b border-gray-100 px-3 pt-2.5 pb-1.5"
            >
              <span
                v-for="j in selectedJobs"
                :key="`job-${j.id}`"
                class="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800"
                :title="j.title"
              >
                <Briefcase class="h-3 w-3 shrink-0" />
                <span class="truncate">{{ j.title }}</span>
                <button
                  type="button"
                  class="shrink-0 text-blue-600 hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="store.isStreaming"
                  :title="store.isStreaming ? removeTooltip : 'Bỏ gắn job'"
                  aria-label="Bỏ gắn job"
                  @click="store.removeJob(j.id)"
                >
                  <X class="h-3 w-3" />
                </button>
              </span>
              <span
                v-for="c in selectedCvs"
                :key="`cv-${c.id}`"
                class="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-800"
                :title="c.title || 'CV chính'"
              >
                <FileText class="h-3 w-3 shrink-0" />
                <span class="truncate">{{ c.title || 'CV chính' }}</span>
                <button
                  type="button"
                  class="shrink-0 text-purple-600 hover:text-purple-900 disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="store.isStreaming"
                  :title="store.isStreaming ? removeTooltip : 'Bỏ gắn CV'"
                  aria-label="Bỏ gắn CV"
                  @click="store.removeCv(c.id)"
                >
                  <X class="h-3 w-3" />
                </button>
              </span>
            </div>

            <!-- Input row -->
            <div class="flex items-end gap-2 p-2">
              <ChatbotAttachmentMenu v-if="auth.isAuthenticated" />
              <textarea
                ref="inputEl"
                v-model="draft"
                rows="1"
                :placeholder="
                  hasContext
                    ? 'Nhập câu hỏi về job/CV đã đính kèm...'
                    : 'Nhập câu hỏi của bạn (bấm kẹp giấy để đính kèm job/CV)...'
                "
                class="min-h-[36px] max-h-32 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm focus:outline-none focus:ring-0"
                @keydown="onEnter"
              />
              <button
                v-if="!store.isStreaming"
                type="button"
                :disabled="!canSend"
                class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                title="Gửi"
                @click="onSend"
              >
                <Send class="h-4 w-4" />
              </button>
              <button
                v-else
                type="button"
                class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white transition hover:bg-red-700"
                title="Dừng"
                @click="onStop"
              >
                <Square class="h-4 w-4" />
              </button>
            </div>
          </div>

          <!-- Helper hint: cap counter -->
          <div
            v-if="hasContext"
            class="mt-1.5 px-1 text-[11px] text-gray-400"
          >
            Đã gắn {{ totalContext }}/3 — bấm X trên chip hoặc mở kẹp giấy để đổi.
          </div>
        </div>
      </main>
    </div>
  </div>
</template>