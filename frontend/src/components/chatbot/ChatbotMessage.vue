<script setup lang="ts">
/**
 * ChatbotMessage
 *
 * Render danh sách messages user/assistant + streaming content đang chạy.
 * - User: bubble xanh, bên phải
 * - Assistant: bubble xám, bên trái, hỗ trợ markdown render
 * - Streaming: thêm cursor nháy `▌` cuối
 *
 * Intent hint: khi streaming, hiển thị các chip intent phía trên streaming bubble
 * để user biết AI đang xử lý theo hướng nào (CV, JD, match, …).
 */
import { computed } from 'vue';
import { marked } from 'marked';
import { Sparkles, Loader2, Briefcase, FileText } from 'lucide-vue-next';
import type { ChatMessage, ChatType } from '@/types/chatbot';

const props = defineProps<{
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  /** Intent types backend vừa classify cho turn hiện tại. */
  intentTypes?: ChatType[];
}>();

/** Map intent type → label tiếng Việt thân thiện cho UI. */
const INTENT_LABELS: Record<ChatType, string> = {
  cv: 'CV của bạn',
  jd: 'Job description',
  cv_jd_match: 'Độ phù hợp CV–JD',
  search: 'Tìm việc',
  billing_plan: 'Gói dịch vụ',
  application: 'Đơn ứng tuyển',
  interview: 'Lịch phỏng vấn',
  account: 'Tài khoản',
  system_info: 'Hệ thống',
  general: 'Trò chuyện',
};

const renderedHtml = (content: string): string => {
  // marked.parse() trả string khi không có async token.
  return marked.parse(content, { async: false }) as string;
};

const streamingHtml = computed(() =>
  props.streamingContent ? renderedHtml(props.streamingContent) : '',
);

const userHtml = (m: ChatMessage): string => renderedHtml(m.content);

/** Có đang ở trạng thái "vừa classify intent, chưa có chunk nào" không? */
const showClassifying = computed(
  () => props.isStreaming && !props.streamingContent && (props.intentTypes?.length ?? 0) > 0,
);
</script>

<template>
  <!--
    Messages list bọc trong <TransitionGroup> để:
      - User message vừa gửi: fade in + slide up nhẹ (enter animation)
      - Final assistant message (sau khi commit): fade in + slide up
    Streaming bubble tách riêng <Transition> để:
      - Khi AI bắt đầu stream: fade in (đang có sẵn Loader2/dots placeholder)
      - Khi commit: fade out đồng thời với message mới fade in → smooth handoff
    Key dùng `${role}-${idx}` đảm bảo key unique cho mỗi entry append (Vue
    chỉ animate key MỚI, key cũ giữ nguyên → không bị re-animate cả list).
  -->
  <TransitionGroup tag="div" name="msg" class="flex flex-col gap-4">
    <div v-for="(m, idx) in props.messages" :key="`${m.role}-${idx}`">
      <div v-if="m.role === 'user'" class="flex flex-col items-end gap-1.5">
        <div
          class="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-gray-900 px-4 py-2.5 text-sm text-white shadow-sm"
        >
          {{ m.content }}
        </div>
        <!-- Attached items snapshot lúc gửi (chatGPT-style chips dưới bubble user) -->
        <div
          v-if="(m.attachedJobs?.length ?? 0) + (m.attachedCvs?.length ?? 0) > 0"
          class="flex max-w-[80%] flex-wrap items-center justify-end gap-1.5 px-1"
        >
          <span
            v-for="j in m.attachedJobs ?? []"
            :key="`msg-${idx}-job-${j.id}`"
            class="inline-flex max-w-[180px] items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-800"
            :title="j.title"
          >
            <Briefcase class="h-3 w-3 shrink-0 text-blue-500" />
            <span class="truncate">{{ j.title }}</span>
          </span>
          <span
            v-for="c in m.attachedCvs ?? []"
            :key="`msg-${idx}-cv-${c.id}`"
            class="inline-flex max-w-[180px] items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800"
            :title="c.title || 'CV chính'"
          >
            <FileText class="h-3 w-3 shrink-0 text-emerald-500" />
            <span class="truncate">{{ c.title || 'CV chính' }}</span>
          </span>
        </div>
      </div>
      <div v-else class="flex flex-col items-start gap-1.5">
        <!-- Icon trên đầu bubble assistant (đồng bộ với indicator 'Sparkles' ở header). -->
        <div class="flex items-center gap-1.5 px-1 text-[11px] font-medium text-gray-500">
          <Sparkles class="h-3 w-3 shrink-0 text-gray-900" />
          <span>JobMatch AI</span>
        </div>
        <div
          class="chatbot-markdown max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm ring-1 ring-gray-200"
          v-html="userHtml(m)"
        />
      </div>
    </div>
  </TransitionGroup>

  <!--
    Streaming bubble — <Transition> thường (không phải TransitionGroup) vì
    chỉ có 0 hoặc 1 instance tại 1 thời điểm. isStreaming=true → enter,
    false → leave.
  -->
  <Transition name="stream">
    <div v-if="props.isStreaming" class="flex flex-col items-start gap-1.5">
      <!-- Icon + label cho streaming bubble -->
      <div class="flex items-center gap-1.5 px-1 text-[11px] font-medium text-gray-500">
        <Sparkles class="h-3 w-3 shrink-0 text-gray-900" />
        <span>JobMatch AI</span>
      </div>
      <!-- Intent chips: hiện trong suốt quá trình streaming (kể cả khi đã có chunk) -->
      <div
        v-if="props.intentTypes?.length"
        class="flex max-w-[85%] flex-wrap items-center gap-1 px-1 text-[11px] text-gray-500"
      >
        <span class="shrink-0">Đang tra cứu:</span>
        <span
          v-for="t in props.intentTypes"
          :key="t"
          class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700 ring-1 ring-gray-200"
        >
          {{ INTENT_LABELS[t] ?? t }}
        </span>
      </div>

      <!-- Streaming bubble -->
      <div
        class="chatbot-markdown max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-sm text-gray-900 shadow-sm ring-1 ring-gray-200"
      >
        <span v-if="!props.streamingContent" class="inline-flex items-center gap-2 text-gray-500">
          <Loader2 v-if="showClassifying" class="h-3.5 w-3.5 animate-spin" />
          <span v-if="showClassifying">Đang phân tích câu hỏi…</span>
          <span v-else class="inline-flex items-center gap-1">
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:120ms]" />
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:240ms]" />
          </span>
        </span>
        <span v-else v-html="streamingHtml" />
        <span
          v-if="props.streamingContent"
          class="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-gray-500"
          aria-hidden="true"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/*
 * === Message enter/leave animations ===
 * Chạy NGẦM với streaming bubble (200ms) để:
 *   - User gửi tin → bubble user fade in + slide up (~250ms)
 *   - AI commit → streaming bubble fade out (~200ms) + final message fade in + slide up (~250ms) → smooth handoff
 *   - Streaming bắt đầu → bubble fade in (~250ms)
 * Dùng translateY thay vì margin/padding để không ảnh hưởng layout flex.
 */
.msg-enter-active {
  transition: opacity 0.25s ease-out, transform 0.25s ease-out;
}
.msg-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.msg-leave-active {
  transition: opacity 0.2s ease-in;
}
.msg-leave-to {
  opacity: 0;
}

.stream-enter-active {
  transition: opacity 0.25s ease-out, transform 0.25s ease-out;
}
.stream-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.stream-leave-active {
  transition: opacity 0.2s ease-in;
}
.stream-leave-to {
  opacity: 0;
}

.chatbot-markdown :deep(h1),
.chatbot-markdown :deep(h2),
.chatbot-markdown :deep(h3) {
  font-weight: 600;
  margin-top: 0.75rem;
  margin-bottom: 0.5rem;
}
.chatbot-markdown :deep(h1) { font-size: 1.125rem; }
.chatbot-markdown :deep(h2) { font-size: 1rem; }
.chatbot-markdown :deep(h3) { font-size: 0.875rem; }

.chatbot-markdown :deep(p) { margin: 0.5rem 0; line-height: 1.55; }
.chatbot-markdown :deep(ul),
.chatbot-markdown :deep(ol) {
  margin: 0.5rem 0 0.5rem 1.25rem;
  list-style: revert;
}
.chatbot-markdown :deep(li) { margin: 0.25rem 0; }

.chatbot-markdown :deep(code) {
  background: #f3f4f6;
  border-radius: 0.25rem;
  padding: 0.05rem 0.35rem;
  font-size: 0.85em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.chatbot-markdown :deep(pre) {
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.75rem;
  overflow-x: auto;
  margin: 0.5rem 0;
}
.chatbot-markdown :deep(pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
}

.chatbot-markdown :deep(blockquote) {
  border-left: 3px solid #e5e7eb;
  padding-left: 0.75rem;
  color: #4b5563;
  margin: 0.5rem 0;
}
.chatbot-markdown :deep(a) {
  color: #2563eb;
  text-decoration: underline;
}
</style>