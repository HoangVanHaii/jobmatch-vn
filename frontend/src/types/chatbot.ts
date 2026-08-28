/**
 * Type mirror cho chatbot JobMatch AI.
 * Match với backend `backend/src/lib/llm/chatbot/types.ts` + service responses.
 */

export type ChatType =
  | 'cv'
  | 'jd'
  | 'cv_jd_match'
  | 'search'
  | 'billing_plan'
  | 'application'
  | 'interview'
  | 'account'
  | 'system_info'
  | 'general';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  /**
   * Snapshot các item user đã đính kèm khi gửi message này. Chỉ apply cho
   * `role: 'user'`. Assistant message không có (LLM không đính kèm).
   * Dùng để render chip bên dưới bubble user — kiểu chatGPT.
   */
  attachedJobs?: PickerJobItem[];
  attachedCvs?: PickerCvItem[];
}

export interface ChatSessionContext {
  jobIds: string[];
  cvIds: string[];
  totalTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string | null;
  messages: ChatMessage[];
  context: ChatSessionContext;
  /** Metadata của jobs trong context (trả về từ backend) — dùng render chip. */
  attachedJobs?: PickerJobItem[];
  /** Metadata của CVs trong context (ownership-filtered). */
  attachedCvs?: PickerCvItem[];
  createdAt: string;
  updatedAt: string;
}

export type PickerJobSource = 'all' | 'saved' | 'applied';

export interface PickerJobItem {
  id: string;
  title: string;
  slug?: string | null;
  companyId: string;
  companyName?: string | null;
  salaryMin: string | null;
  salaryMax: string | null;
  salaryCurrency: string | null;
  salaryVisible?: boolean | null;
  location?: { city?: string } | null;
  jobLevel?: string | null;
  jobType?: string | null;
  status: string;
  publishedAt: string | null;
}

export interface PickerCvItem {
  id: string;
  title: string | null;
  isPrimary: boolean;
  status: string;
  source: string;
  aiAnalysisTotal: number | null;
}

export type ChatbotSseEvent =
  | { type: 'types'; types: ChatType[] }
  | { type: 'done'; sessionId: string; totalTokens: number; usage: { input: number; output: number } }
  | { type: 'error'; code: string; message: string }
  | { type: 'budget_exceeded' }
  | { type: 'busy' }
  | { type: 'aborted' };

export interface ChatbotSseYield {
  chunk?: string;
  event?: ChatbotSseEvent;
}
