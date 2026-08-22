import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { JsonMarkdownStructuredOutputParser } from '@langchain/core/output_parsers';
import type { ZodSchema } from 'zod';
import { logger } from '../../config/logger';

export interface InvokeJsonUsage {
  promptTokens: number;
  completionTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
}

export interface InvokeJsonOptions<T> {
  llm: BaseChatModel;
  schema: ZodSchema<T>;
  systemPrompt: string;
  userPrompt: string; //data cần xử lý
  /** Tag để log (VD: 'jobModeration', 'jobGeneration') */
  tag?: string;
}
// invoke json: gọi llm trả về json, log token usage để theo dõi cost
export async function invokeJson<T>(opts: InvokeJsonOptions<T>): Promise<T> {
  const parser = JsonMarkdownStructuredOutputParser.fromZodSchema(opts.schema);

  const messages = [
    new SystemMessage(opts.systemPrompt),
    new HumanMessage(`${opts.userPrompt}\n\n${parser.getFormatInstructions()}`),
  ];

  // LangSmith tự log raw invoke; parse riêng để surface lỗi validation
  const raw = await opts.llm.invoke(messages);
  if (opts.tag) {
    logger.info({
      tag: opts.tag,
      response_metadata: (raw as any).response_metadata,
      usage_metadata: (raw as any).usage_metadata,
    }, `[LLM DEBUG] ${opts.tag} raw usage objects`);
  }
  const usageMeta = extractUsage(raw)
  if (usageMeta && opts.tag) {
    logger.info({ tag: opts.tag, ...usageMeta }, `[LLM] ${opts.tag} tokens used`);
  }
  return parser.parse(raw.content as string) as T;
}
const extractUsage = (raw: any): InvokeJsonUsage | null => {
  const g = raw.response_metadata?.tokenUsage;
  const u = raw.usage_metadata;
  const source = g ?? u;
  if (!source) return null;

  const promptTokens = source.promptTokens ?? source.input_tokens ?? 0;
  const completionTokens = source.completionTokens ?? source.output_tokens ?? 0;
  const totalTokens = source.totalTokens ?? source.total_tokens ?? 0;

  // Breakdown chi tiết (thoughts/cache) KHÔNG được expose ở version này.
  // Suy ra phần "ẩn" = total - prompt - completion (thường là reasoning/thoughts tokens).
  const unaccounted = totalTokens - promptTokens - completionTokens;

  const usage: InvokeJsonUsage = {
    promptTokens,
    completionTokens,
    thoughtsTokens: unaccounted > 0 ? unaccounted : 0,
    totalTokens,
  };

  return usage;
};