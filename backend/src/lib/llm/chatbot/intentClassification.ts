// Bước 1 — Intent classification cho chatbot.

import { createGemini } from '../client';
import { logger } from '../../../config/logger';
import {
  buildIntentCacheKey,
  getCachedIntent,
  setCachedIntent,
  type CachedIntent,
} from './chatCache';
import type { ChatMessage } from './types';
import {
  INTENT_CLASSIFICATION_SYSTEM_PROMPT,
  buildIntentClassificationUserPrompt,
  intentResultSchema,
} from '../../../prompts/chatbot/intent';
import { ALL_CHAT_TYPES } from './types';
import type { TokenUsage } from './tokenCounter';

export interface ClassifyIntentInput {
  sessionId: string;
  question: string;
  jobIds: string[];
  cvIds: string[];
  recentMessages: ChatMessage[];
  signal?: AbortSignal;
  traceId: string;
}

export interface ClassifyIntentResult {
  intent: CachedIntent;
  usage: TokenUsage;
}

const ZERO_USAGE: TokenUsage = { input: 0, output: 0 };

export const classifyIntent = async (
  input: ClassifyIntentInput,
): Promise<ClassifyIntentResult> => {
  const key = buildIntentCacheKey(input.sessionId, input.question, input.jobIds, input.cvIds);

  const cached = await getCachedIntent(key);
  if (cached) {
    logger.info(
      { traceId: input.traceId, cacheHit: true, types: cached.types },
      '[chatbot] intent cache hit',
    );
    return { intent: cached, usage: ZERO_USAGE };
  }

  const llm = createGemini({
    model: 'gemini-2.5-flash',
    temperature: 0.1,
    maxOutputTokens: 256,
  });

  try {
    // invokeJson trả parsed JSON; ta gọi kèm llm.invoke trực tiếp để lấy raw response
    // cho usage metadata (jsonParser chỉ return parsed content, không return usage).
    const parser = await import('@langchain/core/output_parsers').then((m) =>
      m.JsonMarkdownStructuredOutputParser.fromZodSchema(intentResultSchema),
    );
    const messages = [
      new (await import('@langchain/core/messages')).SystemMessage(
        INTENT_CLASSIFICATION_SYSTEM_PROMPT,
      ),
      new (await import('@langchain/core/messages')).HumanMessage(
        `${buildIntentClassificationUserPrompt({
          question: input.question,
          jobCount: input.jobIds.length,
          cvCount: input.cvIds.length,
          recentMessages: input.recentMessages.map((m) => ({ role: m.role, content: m.content })),
        })}\n\n${parser.getFormatInstructions()}`,
      ),
    ];
    const raw = await llm.invoke(messages);
    const result = await parser.parse(raw.content as string);

    // Extract usage — same pattern as jsonParser.ts:46-67.
    const meta = (raw as any).usage_metadata ?? (raw as any).response_metadata?.tokenUsage;
    const usage: TokenUsage = meta
      ? {
          input: meta.input_tokens ?? meta.promptTokens ?? 0,
          output: meta.output_tokens ?? meta.completionTokens ?? 0,
        }
      : ZERO_USAGE;

    // Sanity: lọc ra type hợp lệ (phòng hallucination enum).
    const validTypes = result.types.filter((t): t is typeof ALL_CHAT_TYPES[number] =>
      (ALL_CHAT_TYPES as readonly string[]).includes(t),
    );

    const intent: CachedIntent = {
      types: validTypes.length ? validTypes : ['general'],
      confidence: Math.max(0, Math.min(1, result.confidence)),
    };

    void setCachedIntent(key, intent);

    return { intent, usage };
  } catch (err) {
    logger.warn({ traceId: input.traceId, err }, '[chatbot] intent classify failed → general');
    return { intent: { types: ['general'], confidence: 0 }, usage: ZERO_USAGE };
  }
};
