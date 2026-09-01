/**
 * API client cho chatbot JobMatch AI.
 *
 * - REST: qua axios `http` (auto refresh token + baseURL)
 * - SSE:  raw fetch + ReadableStream (cần POST + body) + AbortController
 *         Parse dòng `data: {JSON}\n\n` và `data: [DONE]\n\n` (backend chatbot controller).
 *
 * Phase 2 refactor: attach chip là local state ở FE — KHÔNG gọi PATCH /context.
 * Context chỉ được gửi kèm khi user POST /turn. Xem `streamTurn` dưới.
 */
import { http } from './http';
import type {
  ChatbotSseYield,
  ChatSession,
  PickerCvItem,
  PickerJobItem,
  PickerJobSource,
} from '@/types/chatbot';

export const chatbotApi = {
  // === Sessions ===
  createSession: async (title?: string): Promise<ChatSession> => {
    const res = await http.post('/chatbot/sessions', title ? { title } : "abc");
    return res.data.data as ChatSession;
  },

  listSessions: async (limit = 20): Promise<ChatSession[]> => {
    const res = await http.get('/chatbot/sessions', { params: { limit } });
    return res.data.data as ChatSession[];
  },

  getSession: async (sessionId: string): Promise<ChatSession> => {
    const res = await http.get(`/chatbot/sessions/${sessionId}`);
    return res.data.data as ChatSession;
  },

  /**
   * Phase 2: FE không còn gọi PATCH /context (attach chip là local).
   * Giữ method để backward-compat / debug. Nếu gọi sẽ chỉ cập nhật DB context
   * nhưng KHÔNG trigger turn nào.
   */
  patchContext: async (
    sessionId: string,
    body: { jobIds: string[]; cvIds: string[] },
  ): Promise<ChatSession> => {
    const res = await http.patch(`/chatbot/sessions/${sessionId}/context`, body);
    return res.data.data as ChatSession;
  },

  resetContext: async (sessionId: string): Promise<ChatSession> => {
    const res = await http.delete(`/chatbot/sessions/${sessionId}/context`);
    return res.data.data as ChatSession;
  },

  /**
   * Xóa hẳn 1 session — gọi từ nút xoá ở sidebar.
   * Backend đã ownership-check, nhưng FE vẫn nên lọc lại trong store
   * (xóa khỏi list local, clear active nếu đúng session đang mở).
   */
  deleteSession: async (sessionId: string): Promise<{ id: string }> => {
    const res = await http.delete(`/chatbot/sessions/${sessionId}`);
    return res.data.data as { id: string };
  },

  /**
   * Đổi title phiên chat — gọi từ nút cây bút ở sidebar.
   * Backend validate title (1..200 ký tự sau trim).
   */
  updateSession: async (sessionId: string, title: string): Promise<ChatSession> => {
    const res = await http.patch(`/chatbot/sessions/${sessionId}`, { title });
    return res.data.data as ChatSession;
  },

  // === Picker ===
  listJobsPicker: async (
    source: PickerJobSource,
    q?: string,
    limit = 20,
  ): Promise<PickerJobItem[]> => {
    const params: Record<string, unknown> = { source, limit };
    if (q) params.q = q;
    const res = await http.get('/chatbot/jobs/picker', { params });
    return res.data.data as PickerJobItem[];
  },

  listCvsPicker: async (): Promise<PickerCvItem[]> => {
    const res = await http.get('/chatbot/cvs/picker');
    return res.data.data as PickerCvItem[];
  },

  /**
   * Stream 1 turn (SSE).
   *
   * Phase 2 refactor: payload gồm `{ message, jobIds, cvIds }`. Backend lưu
   * context + xử lý turn trong 1 call.
   *
   * Yield:
   *   { chunk: '...' }         — từng đoạn text LLM
   *   { event: { type, ... } } — structured event (types, done, error, …)
   *
   * Caller pass `signal` để abort (user bấm Stop / unmount).
   */
  streamTurn: async function* (
    sessionId: string,
    message: string,
    jobIds: string[],
    cvIds: string[],
    attachedJobs: PickerJobItem[],
    attachedCvs: PickerCvItem[],
    signal: AbortSignal,
  ): AsyncGenerator<ChatbotSseYield, void, void> {
    const baseUrl = (import.meta.env.VITE_API_BASE_URL as string) || '';
    const token = localStorage.getItem('access_token');

    const res = await fetch(`${baseUrl}/chatbot/sessions/${sessionId}/turn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ message, jobIds, cvIds, attachedJobs, attachedCvs }),
      signal,
    });

    if (!res.ok || !res.body) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        errMsg = j?.error?.message ?? errMsg;
      } catch {
        /* ignore */
      }
      throw new Error(errMsg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      // Bọc read() trong try/catch để abort = clean exit (không throw ra caller).
      // Browser reject với DOMException tên 'AbortError'; Node 18+/modern polyfill
      // có thể trả message "BodyStreamBuffer was aborted" — match cả hai.
      let value: Uint8Array | undefined;
      let done = false;
      try {
        ({ value, done } = await reader.read());
      } catch (e) {
        if (
          e instanceof DOMException &&
          (e.name === 'AbortError' || /abort/i.test(e.message))
        ) {
          return;
        }
        throw e;
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Tách theo \n\n (SSE record separator).
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const record = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        idx = buffer.indexOf('\n\n');

        // Comment line ": ping" — bỏ qua.
        if (record.startsWith(':')) continue;
        if (!record.startsWith('data: ')) continue;
        const data = record.slice(6);
        if (data === '[DONE]') return;
        if (!data) continue;

        try {
          const parsed = JSON.parse(data);
          // Phân biệt chunk vs event: event luôn có field 'type'.
          if (parsed && typeof parsed === 'object' && 'type' in parsed) {
            yield { event: parsed as ChatbotSseYield['event'] };
          } else if ('chunk' in parsed) {
            yield { chunk: String(parsed.chunk ?? '') };
          }
        } catch {
          // ignore parse lỗi — không break stream
        }
      }
    }
  },
};
