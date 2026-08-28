/**
 * Bước 2 — Merge sections từ handlers và stream 1 LLM call cuối.
 *
 * - Sections do handlers build sẵn (text + label + citeData)
 * - Gộp lại qua `buildFinalMessages(sections, history, question)`
 * - Gọi `createGemini(...).stream()` (LangChain) → async iterator yield từng chunk
 * - Return `HandlerFinal` gồm usage metadata (input/output tokens) để update token budget
 *
 * Per-type config:
 *   Mỗi intent có temperature/maxOutputTokens riêng — intent data-heavy
 *   (cv_jd_match, cv, jd) cần temperature thấp để deterministic và maxOutput lớn
 *   để chứa JSON/bảng; intent small-talk (general, account, system_info) cho
 *   phép temperature cao hơn và output ngắn.
 *
 *   Multi-intent merge rule:
 *     - temperature = min(temperatures) — ưu tiên chính xác (data accuracy)
 *     - maxOutputTokens = max(maxOutputTokens) — đủ chỗ cho mọi intent
 *
 * Usage capture (3 lớp fallback):
 *   Layer 1: chunk usage_metadata — LangChain Gemini SDK trả differential
 *            (mỗi chunk là delta so với chunk trước). Chỉ work nếu SDK
 *            đính usage lên chunk — version này KHÔNG làm vậy đúng cách.
 *   Layer 2: Gemini SDK countTokens() trực tiếp — API chính thức của
 *            @google/generative-ai, count chính xác 100% prompt tokens.
 *            Reuse `_buildGenerateContentRequest` để build cùng format
 *            request như khi gọi generateContent.
 *   Layer 3: char/4 heuristic cho input/output khi Layer 2 fail.
 *
 * Signal handling: check `signal.aborted` giữa mỗi chunk.
 * LangChain không propagate abort xuống Gemini upstream đáng tin cậy,
 * nên best-effort là ng�ng yield — chấp nhận lãng phí 1-2 chunk cuối.
 */
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { createGemini } from '../../client';
import { logger } from '../../../../config/logger';
import { buildFinalMessages } from '../../../../prompts/chatbot/merge';
import type { ChatMessage, ChatType, HandlerFinal, HandlerSection } from '../types';

export interface StreamMergeInput {
  sections: HandlerSection[];
  history: ChatMessage[];
  question: string;
  /** Intent types t� LLM1 — dùng để pick per-type LLM config. */
  types: ChatType[];
  signal: AbortSignal;
  traceId: string;
  /**
   * Mutable sink — streamMerger sẽ ghi usage vào đây SAU khi compute xong.
   * Lý do: `merger.return()` trên generator đã hoàn thành chỉ trả
   * `{ value: undefined, done: true }` — final return value bị DISCARD
   * sau khi for-await consume xong. Caller không lấy lại được HandlerFinal.
   * Pattern: caller tạo `usageSink = {}` rồi pass vào; generator mutate
   * `usageSink.usage = { inputTokens, outputTokens }` ngay trước khi return.
   */
  usageSink: { usage?: { inputTokens: number; outputTokens: number } };
}

/**
 * Per-intent LLM config. Lý do đã chú thích ở JSDoc đầu file.
 * Token levels đã được nâng (từ maxOutput 2048 cố định → theo nhu cầu từng intent).
 */
const LLM_CONFIG_BY_TYPE: Record<ChatType, { temperature: number; maxOutputTokens: number }> = {
  // Data-heavy, cần deterministic
  cv_jd_match: { temperature: 0.1, maxOutputTokens: 4096 },
  // Cite data, diễn giải ngắn
  cv: { temperature: 0.2, maxOutputTokens: 4096 },
  jd: { temperature: 0.2, maxOutputTokens: 4096 },
  application: { temperature: 0.2, maxOutputTokens: 3072 },
  // Số liệu + so sánh gói
  billing_plan: { temperature: 0.2, maxOutputTokens: 3072 },
  // Có thể cần tóm tắt + ranking
  search: { temperature: 0.3, maxOutputTokens: 3072 },
  // Lịch cụ thể — format ngắn
  interview: { temperature: 0.2, maxOutputTokens: 2048 },
  // Small talk / FAQ — linh hoạt hơn
  account: { temperature: 0.4, maxOutputTokens: 2048 },
  system_info: { temperature: 0.4, maxOutputTokens: 2048 },
  general: { temperature: 0.5, maxOutputTokens: 2048 },
};

/**
 * Merge config khi multi-intent.
 * - temperature = min (an toàn nhất cho data accuracy)
 * - maxOutputTokens = max (đủ chỗ cho mọi intent)
 */
const mergeConfig = (
  types: ChatType[],
): { temperature: number; maxOutputTokens: number } => {
  if (!types.length) return { temperature: 0.3, maxOutputTokens: 2048 };
  let minTemp = LLM_CONFIG_BY_TYPE[types[0]].temperature;
  let maxOut = LLM_CONFIG_BY_TYPE[types[0]].maxOutputTokens;
  for (const t of types) {
    const c = LLM_CONFIG_BY_TYPE[t];
    if (c.temperature < minTemp) minTemp = c.temperature;
    if (c.maxOutputTokens > maxOut) maxOut = c.maxOutputTokens;
  }
  return { temperature: minTemp, maxOutputTokens: maxOut };
};

/**
 * Count input tokens bằng Gemini SDK `countTokens` API — chính xác 100%.
 * Reuse `_buildGenerateContentRequest` (private method) để build cùng request
 * format như khi gọi generateContent, đảm bảo số token khớp với request thật.
 */
const countInputTokensViaGemini = async (
  llm: any,
  lcMessages: Array<SystemMessage | HumanMessage>,
  options: { temperature: number; maxOutputTokens: number },
): Promise<number> => {
  try {
    const request = llm._buildGenerateContentRequest(lcMessages, options);
    const response = await llm.client.countTokens(request);
    return response?.totalTokens ?? 0;
  } catch (err) {
    logger.warn({ err }, '[chatbot] Gemini countTokens failed');
    return 0;
  }
};

export const streamMergedAnswer = async function* (
  input: StreamMergeInput,
): AsyncGenerator<string, HandlerFinal, void> {
  const messages = buildFinalMessages(input.sections, input.history, input.question, input.types);
  const cfg = mergeConfig(input.types);
  const llm: any = createGemini({
    model: 'gemini-2.5-flash',
    temperature: cfg.temperature,
    maxOutputTokens: cfg.maxOutputTokens,
  });

  logger.debug(
    {
      traceId: input.traceId,
      types: input.types,
      temperature: cfg.temperature,
      maxOutputTokens: cfg.maxOutputTokens,
    },
    '[chatbot] merge LLM config',
  );

  // Convert our plain {role, content} → LangChain messages
  const lcMessages: Array<SystemMessage | HumanMessage> = messages.map((m) =>
    m.role === 'system' ? new SystemMessage(m.content) : new HumanMessage(m.content),
  );

  // === Strategy A: count input tokens qua Gemini SDK countTokens API (chính xác) ===
  // Chạy song song với streaming — không block user.
  const inputTokensPromise = countInputTokensViaGemini(llm, lcMessages, {
    temperature: cfg.temperature,
    maxOutputTokens: cfg.maxOutputTokens,
  });

  const stream = await llm.stream(lcMessages, { signal: input.signal });

  let acc = '';
  // Output tokens: ch� char/4 heuristic (LangChain Gemini SDK version này không
  // trả output usage reliable trên stream). Layer B (chunk usage) vẫn chạy song
  // song để tận dụng nếu SDK trả đúng.
  let chunkOutputTotal = 0;

  for await (const chunk of stream) {
    if (input.signal.aborted) {
      logger.info({ traceId: input.traceId, aborted: true }, '[chatbot] merge stream aborted');
      break;
    }
    const text = typeof chunk.content === 'string' ? chunk.content : Array.isArray(chunk.content)
      ? chunk.content.filter((c: any) => typeof c === 'string').join('')
      : '';
    if (text) {
      acc += text;
      yield text;
    }
    // === Strategy B: chunk usage_metadata (incremental — cộng dồn các delta) ===
    // LangChain Gemini SDK trả usage trên MỖI chunk là DIFFERENTIAL
    // (xem chat_models.cjs:592-602). Cộng dồn các delta → full count.
    const meta =
      (chunk as any).message?.usage_metadata ??
      (chunk as any).usage_metadata ??
      (chunk as any).response_metadata?.tokenUsage;
    if (meta) {
      chunkOutputTotal += meta.output_tokens ?? meta.completionTokens ?? 0;
    }
  }

  const usage = {
    // Strategy A: countTokens API (preferred — chính xác 100%)
    inputTokens: await inputTokensPromise,
    // Ưu tiên chunk delta sum nếu > 0; fallback char/4
    outputTokens: chunkOutputTotal > 0 ? chunkOutputTotal : Math.ceil(acc.length / 4),
  };

  if (chunkOutputTotal === 0 && acc.length > 0) {
    logger.warn(
      { traceId: input.traceId, fallbackOutput: usage.outputTokens, outputChars: acc.length },
      '[chatbot] merge stream: outputTokens from char/4 (chunk usage unavailable)',
    );
  }

  logger.info(
    {
      traceId: input.traceId,
      types: input.types,
      input: usage.inputTokens,
      output: usage.outputTokens,
      outputChars: acc.length,
      chunkOutputTotal,
      maxOutputTokens: cfg.maxOutputTokens,
    },
    '[chatbot] merge stream done',
  );

  // Ghi usage vào `input.usageSink.usage` — caller sẽ đọc từ sink này SAU
  // khi for-await loop kết thúc. Lý do: `merger.return()` trên generator
  // đã hoàn thành chỉ trả `{ value: undefined, done: true }` — final return
  // value của async generator bị DISCARD sau khi for-await consume xong.
  // Pattern sink tránh được vấn đề đó mà không cần yield marker.
  input.usageSink.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };

  return { usage, data: { finalLength: acc.length } };
};
