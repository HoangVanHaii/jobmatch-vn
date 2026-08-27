/**
 * Public API cho chatbot AI.
 * Import từ '@/lib/llm/chatbot' thay vì đi sâu vào từng file con.
 */

// Types + enums
export {
  ALL_CHAT_TYPES,
  type ChatType,
  type ChatMessage,
  type IntentResult,
  type HandlerContext,
  type HandlerSection,
  type HandlerFinal,
  type HandlerFn,
  type ActiveSubscription,
  type AttachedJobItem,
  type AttachedCvItem,
} from './types';

// Bước 1 — intent classification
export { classifyIntent, type ClassifyIntentInput } from './intentClassification';

// Cache + token counter
export {
  buildIntentCacheKey,
  getCachedIntent,
  setCachedIntent,
  INTENT_CACHE_TTL_SECONDS,
  type CachedIntent,
} from './chatCache';
export {
  recordUsage,
  isBudgetExceeded,
  isBudgetWarning,
  TOKEN_BUDGET_LIMIT,
  TOKEN_BUDGET_WARNING,
  type TokenUsage,
} from './tokenCounter';

// Handlers + dispatcher
export { HANDLERS, dispatchHandlers } from './handlers/dispatcher';
export { streamMergedAnswer, type StreamMergeInput } from './handlers/streamMerger';

// Individual handlers — để service có thể chạy riêng làm safety-net
// (vd: luôn chạy jdHandler khi user gắn job, bất kể LLM1 classify thế nào).
export { jdHandler } from './handlers/jd';
export { cvHandler } from './handlers/cv';

// Intent-classification prompt helpers (để service có thể gọi trực tiếp)
export {
  buildIntentClassificationUserPrompt,
  intentResultSchema,
  type IntentResultParsed,
} from '../../../prompts/chatbot/intent';
export { buildMergedPrompt, buildFinalMessages } from '../../../prompts/chatbot/merge';
