/**
 * Pinia store cho trang Chatbot AI.
 *
 * Responsibility:
 *  - Quản lý sessions list + active session + messages
 *  - Quản lý context (jobIds/cvIds + attached metadata) — Phase 2 refactor:
 *      attach chip chỉ cập nhật local state (KHÔNG gọi API). Khi gửi message,
 *      payload POST /turn mang kèm jobIds/cvIds → backend lưu context + xử lý
 *      turn trong 1 call.
 *  - SSE consumer: gọi chatbotApi.streamTurn(jobIds, cvIds) với AbortController
 *  - Status flags: isStreaming, totalTokens, streamingContent, lastEvent
 *
 * Picker bị LOCK khi isStreaming=true → không có race khi user đổi context
 * trong lúc SSE đang stream.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { chatbotApi } from '@services/chatbot.api';
import type {
  ChatbotSseEvent,
  ChatMessage,
  ChatSession,
  PickerCvItem,
  PickerJobItem,
} from '@/types/chatbot';

export const useChatbotStore = defineStore('chatbot', () => {
  // === State ===
  const sessions = ref<ChatSession[]>([]);
  const activeSessionId = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const jobIds = ref<string[]>([]);
  const cvIds = ref<string[]>([]);
  /**
   * Metadata đầy đủ của items đã gắn ở local. Có 2 nguồn:
   *  - Lúc attach: set ngay từ full PickerItem (dropdown emit items)
   *  - Lúc load session: từ `selectSession` → API trả `attachedJobs/attachedCvs`
   * Đây là source of truth cho chip rendering (không phụ thuộc pickerJobs
   * đang load tab nào).
   */
  const attachedJobs = ref<PickerJobItem[]>([]);
  const attachedCvs = ref<PickerCvItem[]>([]);
  const totalTokens = ref(0);
  const streamingContent = ref('');
  const isStreaming = ref(false);
  const lastEvent = ref<ChatbotSseEvent | null>(null);
  const abortController = ref<AbortController | null>(null);

  // Picker data (chỉ để dropdown có sẵn list khi user mở)
  const pickerJobs = ref<PickerJobItem[]>([]);
  const pickerCvs = ref<PickerCvItem[]>([]);

  // === Computed ===
  const activeSession = computed<ChatSession | null>(
    () => sessions.value.find((s) => s.id === activeSessionId.value) ?? null,
  );
  const budgetWarning = computed(() => totalTokens.value >= 45_000 && totalTokens.value < 50_000);
  const budgetExceeded = computed(() => totalTokens.value >= 50_000);
  const totalContextCount = computed(() => jobIds.value.length + cvIds.value.length);

  // === Actions ===

  const loadSessions = async (): Promise<void> => {
    sessions.value = await chatbotApi.listSessions();
  };

  const createSession = async (): Promise<ChatSession> => {
    const session = await chatbotApi.createSession();
    sessions.value = [session, ...sessions.value];
    await selectSession(session.id);
    return session;
  };

  const selectSession = async (sessionId: string): Promise<void> => {
    activeSessionId.value = sessionId;
    const session = await chatbotApi.getSession(sessionId);
    messages.value = session.messages ?? [];
    jobIds.value = session.context?.jobIds ?? [];
    cvIds.value = session.context?.cvIds ?? [];
    totalTokens.value = session.context?.totalTokens ?? 0;
    // Hydrate attached items từ API response — đây là "last-sent context" từ DB.
    attachedJobs.value = session.attachedJobs ?? [];
    attachedCvs.value = session.attachedCvs ?? [];
  };

  /**
   * Reset toàn bộ state về rỗng — KHÔNG gọi API, chỉ clear local.
   *
   * Dùng khi user vào `/chatbot` KHÔNG kèm `?session=<id>`:
   *   - Bootstrap intent = "fresh entry" → user tự chọn session trong sidebar
   *     hoặc bấm "Cuộc trò chuyện mới".
   *   - Không auto-open session gần nhất — mỗi lần vào /chatbot mà không có
   *     param đều là intent khác nhau (vd chuyển tab khác rồi quay lại).
   *
   * Lưu ý: KHÔNG abort stream — nếu stream đang chạy từ session cũ, caller
   * cần xử lý explicit (hiện tại không có scenario này vì ChatbotView là
   * single-instance, đổi session thì loop ngoài break rồi).
   */
  const clearActive = (): void => {
    activeSessionId.value = null;
    messages.value = [];
    streamingContent.value = '';
    jobIds.value = [];
    cvIds.value = [];
    attachedJobs.value = [];
    attachedCvs.value = [];
    totalTokens.value = 0;
    lastEvent.value = null;
  };

  /**
   * Thay thế toàn bộ jobIds (local state only).
   *
   * Phase 2: KHÔNG gọi API. Khi user gửi message, payload kèm jobIds.value lên
   * backend mới thực sự lưu. Trade-off: reload giữa lúc attach (chưa gửi) sẽ
   * mất chip (DB chỉ có "last-sent" context).
   *
   * Auto-create session nếu user chưa có (mở /chatbot lần đầu, attach trước
   * khi gửi).
   */
  const attachJobs = async (items: PickerJobItem[]): Promise<void> => {
    if (isStreaming.value) return;
    if (!activeSessionId.value) {
      await createSession();
    }
    const newJobs = items.slice(0, 3);
    attachedJobs.value = newJobs;
    jobIds.value = newJobs.map((j) => j.id);
  };

  const attachCvs = async (items: PickerCvItem[]): Promise<void> => {
    if (isStreaming.value) return;
    if (!activeSessionId.value) {
      await createSession();
    }
    const newCvs = items.slice(0, 3);
    attachedCvs.value = newCvs;
    cvIds.value = newCvs.map((c) => c.id);
  };

  /** Xóa 1 job khỏi context (local only). */
  const removeJob = (id: string): void => {
    if (isStreaming.value) return;
    jobIds.value = jobIds.value.filter((x) => x !== id);
    attachedJobs.value = attachedJobs.value.filter((j) => j.id !== id);
  };

  /** Xóa 1 CV khỏi context (local only). */
  const removeCv = (id: string): void => {
    if (isStreaming.value) return;
    cvIds.value = cvIds.value.filter((x) => x !== id);
    attachedCvs.value = attachedCvs.value.filter((c) => c.id !== id);
  };

  /**
   * Xóa 1 session — gọi API + lọc khỏi list local. Nếu đúng session đang
   * active thì clear active (UI về trang trống).
   *
   * Trả về `wasActive` để caller (ChatbotView) biết có cần update URL không
   * (xoá ?session=<deleted-id> khỏi route để F5 sau không 404).
   */
  const deleteSession = async (sessionId: string): Promise<{ wasActive: boolean }> => {
    await chatbotApi.deleteSession(sessionId);
    const wasActive = activeSessionId.value === sessionId;
    sessions.value = sessions.value.filter((s) => s.id !== sessionId);
    if (wasActive) {
      clearActive();
    }
    return { wasActive };
  };

  /**
   * Đổi title phiên chat — gọi API + patch session trong list local (immutable
   * replace để reactivity fire đúng). Caller (ChatbotView) chịu trách nhiệm
   * validate input trước khi gọi (trim, non-empty, max 200).
   *
   * Trả về session đã update để caller có thể show toast / rollback nếu cần.
   */
  const updateSessionTitle = async (
    sessionId: string,
    title: string,
  ): Promise<ChatSession> => {
    const updated = await chatbotApi.updateSession(sessionId, title);
    const idx = sessions.value.findIndex((s) => s.id === sessionId);
    if (idx !== -1) {
      sessions.value = [
        ...sessions.value.slice(0, idx),
        updated,
        ...sessions.value.slice(idx + 1),
      ];
    }
    return updated;
  };

  /**
   * Reset toàn bộ context — gọi DELETE /context để xóa cả DB.
   * User explicit action, không bị trigger tự động.
   */
  const resetContext = async (): Promise<void> => {
    const id = activeSessionId.value;
    jobIds.value = [];
    cvIds.value = [];
    attachedJobs.value = [];
    attachedCvs.value = [];
    if (!id) return;
    try {
      await chatbotApi.resetContext(id);
    } catch {
      // ignore — state đã clear local
    }
  };

  const loadPicker = async (): Promise<void> => {
    const [jobs, cvs] = await Promise.all([
      chatbotApi.listJobsPicker('all', undefined, 50),
      chatbotApi.listCvsPicker(),
    ]);
    pickerJobs.value = jobs;
    pickerCvs.value = cvs;
  };

  /** Abort stream hiện tại (nếu đang chạy). Sau đó user có thể đổi context + gửi lại. */
  const abortStream = (): void => {
    if (abortController.value) {
      abortController.value.abort();
      abortController.value = null;
    }
  };

  /**
   * Gửi 1 message + stream câu trả lời.
   *
   * Phase 2 refactor: payload gồm `message` + `jobIds.value` + `cvIds.value`.
   * Backend lưu context + xử lý turn trong 1 call → không cần flush PATCH
   * pending trước khi gửi (vì attach giờ là local only).
   */
  const sendMessage = async (content: string): Promise<void> => {
    const sessionId = activeSessionId.value;
    if (!sessionId) throw new Error('Chưa chọn session');
    if (budgetExceeded.value) {
      throw new Error('Phiên chat đã hết token. Vui lòng tạo phiên mới.');
    }

    const userMsg: ChatMessage = {
      role: 'user',
      content,
      ts: new Date().toISOString(),
      // Snapshot attached items tại thời điểm gửi → render chip bên dưới bubble user.
      // Không dùng reference mà deep copy để user đổi chip sau đó không ảnh hưởng.
      attachedJobs: attachedJobs.value.map((j) => ({ ...j })),
      attachedCvs: attachedCvs.value.map((c) => ({ ...c })),
    };
    messages.value = [...messages.value, userMsg];
    // Auto-update session title NGAY khi user gửi (không đợi AI trả lời).
    // Logic: nếu session chưa có title → derive từ first 50 chars của message
    // hiện tại. Match với backend `appendUserMessage` (cũng set title từ slice).
    // Update sớm → sidebar + header reflect ngay, không phải đợi streaming xong.
    const sessionIdx = sessions.value.findIndex((s) => s.id === sessionId);
    if (sessionIdx !== -1 && !sessions.value[sessionIdx].title) {
      const trimmed = content.trim();
      sessions.value[sessionIdx] = {
        ...sessions.value[sessionIdx],
        title: trimmed.slice(0, 50) + (trimmed.length > 50 ? '…' : ''),
        updatedAt: new Date().toISOString(),
      };
    }
    isStreaming.value = true;
    streamingContent.value = '';
    // Reset intent hint từ turn trước (nếu có) để chip không leak qua turn mới.
    lastEvent.value = null;

    const ac = new AbortController();
    abortController.value = ac;

    try {
      // Gửi attached metadata lên backend để persist vào ChatMessage — reload
      // session hiển thị đúng chip theo từng turn thay vì chỉ chip hiện tại.
      // jobIds/cvIds vẫn gửi để backend lưu context.
      const stream = chatbotApi.streamTurn(
        sessionId,
        content,
        [...jobIds.value],
        [...cvIds.value],
        attachedJobs.value.map((j) => ({ ...j })),
        attachedCvs.value.map((c) => ({ ...c })),
        ac.signal,
      );
      for await (const item of stream) {
        if (item.chunk) {
          streamingContent.value += item.chunk;
          continue;
        }
        if (item.event) {
          lastEvent.value = item.event;
          if (item.event.type === 'done') {
            totalTokens.value = item.event.totalTokens;
            messages.value = [
              ...messages.value,
              {
                role: 'assistant',
                content: streamingContent.value,
                ts: new Date().toISOString(),
              },
            ];
            streamingContent.value = '';
          }
          if (item.event.type === 'error' || item.event.type === 'budget_exceeded') {
            // Vẫn lưu partial nếu có.
            if (streamingContent.value) {
              messages.value = [
                ...messages.value,
                {
                  role: 'assistant',
                  content: streamingContent.value,
                  ts: new Date().toISOString(),
                },
              ];
              streamingContent.value = '';
            }
          }
        }
      }
    } catch (e) {
      // Abort = user bấm Stop — KHÔNG hiện error banner, KHÔNG log.
      // Partial content (nếu có) đã được lưu ở finally.
      if (
        e instanceof DOMException &&
        (e.name === 'AbortError' || /abort/i.test(e.message))
      ) {
        return;
      }
      throw e;
    } finally {
      isStreaming.value = false;
      abortController.value = null;
      // Lưu partial content nếu user bấm Stop giữa chừng (loop kết thúc do abort,
      // không có event 'done'/'error' để save). Đánh dấu "(đã dừng bởi bạn)" để
      // user biết đây là nội dung bị cắt.
      if (streamingContent.value) {
        messages.value = [
          ...messages.value,
          {
            role: 'assistant',
            content: `${streamingContent.value}\n\n_(đã dừng bởi bạn)_`,
            ts: new Date().toISOString(),
          },
        ];
        streamingContent.value = '';
      }
    }
  };

  return {
    // state
    sessions,
    activeSessionId,
    messages,
    jobIds,
    cvIds,
    attachedJobs,
    attachedCvs,
    totalTokens,
    streamingContent,
    isStreaming,
    lastEvent,
    abortController,
    pickerJobs,
    pickerCvs,
    // computed
    activeSession,
    budgetWarning,
    budgetExceeded,
    totalContextCount,
    // actions
    loadSessions,
    createSession,
    selectSession,
    clearActive,
    removeJob,
    removeCv,
    attachJobs,
    attachCvs,
    resetContext,
    deleteSession,
    updateSessionTitle,
    loadPicker,
    abortStream,
    sendMessage,
  };
});
