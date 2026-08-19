/**
 * Public API cho LLM wrappers.
 * Import từ '@/lib/llm' thay vì đi sâu vào từng file con.
 */

// === CHUNG: client factory + generic helper ===
export { createGemini } from './client';
export { invokeJson, type InvokeJsonOptions } from './jsonParser';

// === RIÊNG: features ===
export {
  moderationFlagSchema,
  moderationOutputSchema,
  type ModerationFlag,
  type ModerationOutput,
  invokeJobModeration,
} from './jobModeration';

export {
  buildJobEmbeddingText,
  embedText,
  embedTexts,
  getJobEmbedding,
  upsertJobEmbedding,
  searchSimilarJobs,
  type JobEmbeddingRow,
  type UpsertResult,
  type SemanticSearchOpts,
  type SemanticSearchResult,
} from './jobEmbedding';
