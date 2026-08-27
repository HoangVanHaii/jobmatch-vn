/**
 * Shared types cho chatbot pipeline.
 *
 * Luồng xử lý:
 *   1. service.streamTurn() load context + classify intent (intentClassification.ts)
 *   2. dispatch handlers (handlers/cv.ts, jd.ts, ...) theo intent[] array
 *      Mỗi handler return HandlerSection (text đã render — KHÔNG stream riêng)
 *   3. handlers/streamMerger.ts merge sections + gọi 1 LLM stream cuối (cite data thật)
 *
 * Multi-intent có data type + general: section data → merge trước phần cần data,
 * section general rỗng → LLM cuối tự trả lời phần tự do.
 */
import type { Cv } from '../../../interface/cv';
import type { Job } from '../../../interface/job';
import type { plans, subscriptions } from '../../../db/schema';

type Subscription = typeof subscriptions.$inferSelect;
type Plan = typeof plans.$inferSelect;

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

export const ALL_CHAT_TYPES: ChatType[] = [
  'cv',
  'jd',
  'cv_jd_match',
  'search',
  'billing_plan',
  'application',
  'interview',
  'account',
  'system_info',
  'general',
];

/** Kết quả bước 1 — multi-intent, sắp theo độ ưu tiên. */
export interface IntentResult {
  types: ChatType[];
  confidence: number;
}

/** Item trong context, mirror backend row. */
/** Snapshot metadata của job user đã đính kèm khi gửi message. Lưu theo
 *  message (không theo session) để hiển thị chips đúng theo thời điểm gửi. */
export interface AttachedJobItem {
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
  publishedAt: string | null; // ISO (JSON-safe; Date được serialize thành string khi đi qua mạng)
}

/** Snapshot metadata của CV user đã đính kèm. */
export interface AttachedCvItem {
  id: string;
  title: string | null;
  isPrimary: boolean;
  status: string;
  source: string;
  aiAnalysisTotal: number | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: string; // ISO
  /**
   * Snapshot items user đã đính kèm khi gửi message này. Chỉ áp dụng cho
   * `role: 'user'`. Persist cùng message để reload hiển thị chips đúng
   * historical context (không bị lệch khi user đổi attach sau).
   */
  attachedJobs?: AttachedJobItem[];
  attachedCvs?: AttachedCvItem[];
}

export interface ActiveSubscription extends Subscription {
  planCode: string;
  planName: string;
}

export interface HandlerContext {
  userId: string;
  userRole: string;
  question: string;
  jobIds: string[];
  cvIds: string[];
  jobs: Job[];
  cvs: Cv[];
  subscription: ActiveSubscription | null;
  plans: Plan[];
  recentMessages: ChatMessage[]; // 3 lượt gần nhất
  signal: AbortSignal;
  traceId: string;
  /**
   * Mutable sink — handlers có thể ghi usage sau khi gọi LLM riêng (vd. cvMatch
   * gọi LLM chấm điểm, search gọi LLM rerank). Service đọc sau khi dispatch
   * xong để cộng vào token budget.
   *
   * Lý do dùng sink thay vì return value: `dispatchHandlers` đã chuẩn hoá
   * output thành `HandlerSection[]` (chỉ text), không muốn đ�i signature
   * cho 10 handlers vì 1-2 handler LLM-calling. Khi nào số handler LLM-calling
   * > 3 thì refactor sang `{ section, usage }` return shape.
   */
  usageSink?: { usage?: { input: number; output: number } };
}

/**
 * Section do 1 handler build — text đã format, sẵn để LLM cuối cite.
 * - citeData=true: LLM phải dùng data này, không tự thêm thông tin khác
 * - citeData=false: data mang tính tham khảo (general, account, systemInfo)
 */
export interface HandlerSection {
  label: ChatType;
  content: string;
  citeData: boolean;
}

/** Final output của 1 streaming LLM call. */
export interface HandlerFinal {
  usage: { inputTokens: number; outputTokens: number };
  data?: unknown;
}

/** Mỗi handler return Promise<HandlerSection>. KHÔNG stream riêng — merge sau. */
export type HandlerFn = (ctx: HandlerContext) => Promise<HandlerSection>;
