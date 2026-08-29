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
import { Sparkles, X } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { useChatbotStore } from '@stores/chatbot';
import { useAuthStore } from '@stores/auth';
import ChatbotHeader from '@components/chatbot/ChatbotHeader.vue';
import ChatbotSidebar from '@components/chatbot/ChatbotSidebar.vue';
import ChatbotMessage from '@components/chatbot/ChatbotMessage.vue';
import ChatbotInputBox from '@components/chatbot/ChatbotInputBox.vue';

const store = useChatbotStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const messagesEl = ref<HTMLElement | null>(null);
const draft = ref('');
const errorMessage = ref<string | null>(null);

/**
 * Sidebar collapse state. Persist qua localStorage để giữ thói quen user mỗi
 * lần vào lại — chỉ default = false (mở) cho user mới.
 */
const SIDEBAR_COLLAPSED_KEY = 'chatbot:sidebar-collapsed';
const sidebarCollapsed = ref<boolean>(
  typeof window !== 'undefined' && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
);
const toggleSidebar = (): void => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed.value ? '1' : '0');
  } catch {
    /* ignore quota errors */
  }
};

const canSend = computed(
  () => draft.value.trim().length > 0 && !store.isStreaming && !store.budgetExceeded,
);
const isEmpty = computed(() => !store.messages.length && !store.streamingContent);

/** Intent types đang được xử lý — trích từ `lastEvent` (event `types` gần nhất). */
const intentTypes = computed(() =>
  store.lastEvent?.type === 'types' ? store.lastEvent.types : undefined,
);

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
  // Set mobile view SAU khi selectSession xong (đã có activeSessionId).
  setInitialMobileView();
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
  // Mobile: sau khi tạo phiên → chuyển sang chat view.
  isMobileSidebar.value = false;
};

const onSelect = async (sessionId: string): Promise<void> => {
  router.replace({ query: { ...route.query, session: sessionId } });
  await store.selectSession(sessionId);
  // Mobile: chọn phiên nào → chuyển sang chat view của phiên đó.
  isMobileSidebar.value = false;
};

/** Back từ chat view → danh sách phiên (mobile only, desktop không gọi). */
const onBackToSessions = (): void => {
  isMobileSidebar.value = true;
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

/**
 * Budget warning banner (>45k token, <50k) — track trạng thái user đã đóng để
 * không hiện lại trong cùng session. Reset khi đổi session (session mới = cảnh
 * báo mới nếu có). Không liên quan đến `budgetExceeded` (>50k) — store đã có
 * banner riêng cho case đó.
 */
const dismissedBudgetWarning = ref(false);

watch(
  () => store.activeSessionId,
  () => {
    dismissedBudgetWarning.value = false;
  },
);

const dismissBudgetWarning = (): void => {
  dismissedBudgetWarning.value = true;
};

/** "Tạo mới" từ banner = tạo session mới + đóng banner ngay để không flash. */
const onCreateAndDismissWarning = async (): Promise<void> => {
  dismissedBudgetWarning.value = true;
  await onCreate();
};

/**
 * Banner offset (px from bottom của `<main>`) — push cao hơn khi input có chip
 * đính kèm để không bị chip che mất (chip row ~50px nằm ngay đầu input box,
 * trùng vị trí banner ở `bottom: 96px` khi không có chip).
 */
const bannerBottomOffset = computed(() => (store.totalContextCount > 0 ? '168px' : '96px'));

/**
 * Mobile-only routing giữa 2 panel:
 *   - true  → hiển thị sidebar (danh sách phiên)
 *   - false → hiển thị chat
 * Trên md+ luôn show cả 2 cùng lúc (sidebar bên trái + chat chiếm phần còn lại).
 * Mặc định `true` để user mới trên mobile thấy ngay CTA "Cuộc trò chuyện mới"
 * thay vì màn hình chat trống chưa có phiên.
 */
const isMobileSidebar = ref(true);

/**
 * Bootstrap mobile view sau khi load sessions xong:
 *   - Có session → vào thẳng chat (false)
 *   - Không có session → ở lại sidebar (true) để user bấm "Cuộc trò chuyện mới"
 */
const setInitialMobileView = (): void => {
  isMobileSidebar.value = !store.activeSessionId;
};

/** Dismiss cho banner budget-exceeded — tương tự warning banner. */
const dismissedBudgetExceeded = ref(false);
watch(
  () => store.activeSessionId,
  () => {
    dismissedBudgetExceeded.value = false;
  },
);
const dismissBudgetExceeded = (): void => {
  dismissedBudgetExceeded.value = true;
};
const onCreateAndDismissExceeded = async (): Promise<void> => {
  dismissedBudgetExceeded.value = true;
  await onCreate();
};
</script>

<template>
  <div class="flex h-screen flex-col bg-gray-50/50">
    <ChatbotHeader
      :title="store.activeSession?.title ?? null"
      :total-tokens="store.totalTokens"
      :show-back="!isMobileSidebar"
      @back="onBackToSessions"
    />

    <div class="flex flex-1 overflow-hidden">
      <!--
        Sidebar wrapper — responsive visibility:
          - Mobile: chỉ show khi isMobileSidebar=true (chat view ẩn sidebar)
          - md+: luôn show (col bên trái, w-72 hoặc w-12 tùy collapsed)
        Width: 72 normal / 12 collapsed trên desktop; full-width trên mobile
        khi show để tận dụng màn hẹp.
      -->
      <div
        class="border-r border-gray-200 bg-white transition-[width] duration-200"
        :class="[
          sidebarCollapsed ? 'md:w-12' : 'md:w-72',
          isMobileSidebar ? 'flex w-full flex-col' : 'hidden',
          'md:flex md:flex-col',
        ]"
      >
        <ChatbotSidebar
          :sessions="store.sessions"
          :active-session-id="store.activeSessionId"
          :collapsed="sidebarCollapsed"
          @select="onSelect"
          @new="onCreate"
          @toggle="toggleSidebar"
        />
      </div>

      <!--
        Main chat — ẩn trên mobile khi đang ở sidebar view, hiện khi ở chat view.
        Trên md+ luôn hiện, chiếm phần còn lại (flex-1).
      -->
      <main
        class="relative flex flex-1 flex-col overflow-hidden"
        :class="[isMobileSidebar ? 'hidden' : 'flex', 'md:flex']"
      >
        <!--
          Messages area (v-show thay vì v-if để giữ DOM + ref `messagesEl`,
          scroll-to-bottom hoạt động ngay khi load session cũ). Padding-bottom
          32 = 8rem để chừa chỗ cho input box absolute ở đáy không đè lên
          message cuối. Padding-x nhỏ hơn trên mobile (px-3) để có thêm không
          gian cho bubble.
        -->
        <div
          v-show="!isEmpty"
          ref="messagesEl"
          class="flex-1 overflow-y-auto scrollbar-thin px-3 pb-32 pt-4 md:px-6"
        >
          <ChatbotMessage
            :messages="store.messages"
            :streaming-content="store.streamingContent"
            :is-streaming="store.isStreaming"
            :intent-types="intentTypes"
          />
        </div>

        <!-- Error / budget banner (absolute, nằm trên input box) -->
        <Transition name="fade">
          <div
            v-if="errorMessage || (store.budgetExceeded && !dismissedBudgetExceeded)"
            class="absolute inset-x-0 px-3 transition-[bottom] duration-200 ease-out md:px-6"
            :style="{ bottom: bannerBottomOffset }"
          >
            <div
              v-if="errorMessage"
              class="mb-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
            >
              {{ errorMessage }}
              <button class="ml-2 underline" @click="errorMessage = null">Đóng</button>
            </div>
            <div
              v-if="store.budgetExceeded && !dismissedBudgetExceeded"
              class="mx-auto flex max-w-2xl items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 shadow-sm"
            >
              <span class="flex-1">
                Phiên chat đã dùng hết 50.000 token. Vui lòng tạo phiên mới để tiếp tục.
              </span>
              <button
                type="button"
                class="shrink-0 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-red-700"
                @click="onCreateAndDismissExceeded"
              >
                Tạo mới
              </button>
              <button
                type="button"
                class="shrink-0 text-red-600 transition hover:text-red-800"
                aria-label="Đóng thông báo"
                @click="dismissBudgetExceeded"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>
        </Transition>

        <!--
          Budget warning banner (>45k token, <50k) — hiện phía trên input box
          để user biết session sắp hết budget. Có 2 action:
            - "Tạo mới" → tạo session mới (đóng banner trước để không flash)
            - X → dismiss, không hiện lại cho session hiện tại
          Reset dismissedBudgetWarning khi đổi session (watch trong script).
          Dùng Transition `fade` đồng bộ với error banner — cùng thời gian fade.
        -->
        <Transition name="fade">
          <div
            v-if="store.budgetWarning && !dismissedBudgetWarning"
            class="absolute inset-x-0 px-3 transition-[bottom] duration-200 ease-out md:px-6"
            :style="{ bottom: bannerBottomOffset }"
          >
            <div class="mx-auto flex max-w-2xl items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 shadow-sm">
              <span class="flex-1">
                Cuộc trò chuyện của bạn sắp đạt giới hạn cho phép của hệ thống.
              </span>
              <button
                type="button"
                class="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-amber-700"
                @click="onCreateAndDismissWarning"
              >
                Tạo mới
              </button>
              <button
                type="button"
                class="shrink-0 text-amber-600 transition hover:text-amber-800"
                aria-label="Đóng thông báo"
                @click="dismissBudgetWarning"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>
        </Transition>

        <!--
          Input container — ALWAYS ở cùng 1 DOM node, animate vị trí + width qua
          CSS transition:
            - isEmpty: bottom: 50% + translate-y(50%) → centered dọc trong main
            - !isEmpty: bottom: 0 + translate-y(0) → anchored đáy main
          Khi user gửi tin đầu tiên, container này SLIDE mượt xuống đáy thay vì
          v-if/v-else swap (cách cũ làm nó biến mất rồi hiện lại).
          Greeting nằm bên trong container nên cũng đi theo khi slide xuống,
          sau đó fade out riêng nhờ <Transition>.
        -->
        <div
          class="absolute inset-x-0 transition-all duration-300 ease-out"
          :class="isEmpty
            ? 'bottom-1/2 translate-y-1/2'
            : 'bottom-0 translate-y-0'"
        >
          <div
            class="mx-auto w-full transition-all duration-300 ease-out"
            :class="isEmpty
              ? 'max-w-2xl px-3 pb-10 md:px-6'
              : 'max-w-full border-t border-gray-200 bg-white px-3 py-3 md:px-6'"
          >
            <!-- Greeting (chỉ khi empty, fade out khi có message) -->
            <Transition name="fade">
              <div v-if="isEmpty" key="greeting" class="text-center pb-4">
                <Sparkles class="mx-auto mb-2 h-6 w-6 text-gray-900" />
                <h2 class="text-base font-semibold tracking-tight text-gray-900">
                  Chào {{ userName }}, tôi có thể giúp gì cho bạn?
                </h2>
              </div>
            </Transition>

            <ChatbotInputBox
              :draft="draft"
              :can-send="canSend"
              @update:draft="(v) => (draft = v)"
              @send="onSend"
              @stop="onStop"
              @enter="onEnter"
            />
            <div
              v-if="store.totalContextCount > 0 && !isEmpty"
              class="mt-1.5 px-1 text-[11px] text-gray-400"
            >
              Đã gắn {{ store.totalContextCount }}/3 — bấm X trên chip hoặc mở kẹp giấy để đổi.
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
/*
 * Fade transition cho greeting + banner — chạy NGẦM với CSS transition của
 * input container (300ms) để khi user gửi tin nhắn đầu:
 *   - Greeting fade out (200ms)
 *   - Input container slide xuống đáy + nở width + thêm border (300ms)
 *   - Messages area hiện ra (v-show, instant)
 * Tổng thể trông như input "trượt" từ giữa xuống đáy, greeting biến mất,
 * messages xuất hiện — tất cả xảy ra cùng lúc trong ~300ms.
 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>