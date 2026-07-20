/**
 * AI Provider factory — swap provider qua env
 */
import { OpenAIProvider } from '../ai/providers/openai';
import { DeepSeekProvider } from '../ai/providers/deepseek';
import { GeminiProvider } from '../ai/providers/gemini';
import { AnthropicProvider } from '../ai/providers/anthropic';
import type { LLMProvider } from '../ai/providers/base';
import { logger } from './logger';

const buildProvider = (name: string, model: string): LLMProvider => {
  switch (name) {
    case 'openai': return new OpenAIProvider(model);
    case 'deepseek': return new DeepSeekProvider(model);
    case 'gemini': return new GeminiProvider(model);
    case 'anthropic': return new AnthropicProvider(model);
    default: throw new Error(`Unknown AI provider: ${name}`);
  }
};

export const embeddingProvider = buildProvider(
  process.env.EMBEDDING_PROVIDER || 'openai',
  process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
);
export const chatbotProvider = buildProvider(
  process.env.LLM_CHATBOT_PROVIDER || 'deepseek',
  process.env.LLM_CHATBOT_MODEL || 'deepseek-chat',
);
export const parsingProvider = buildProvider(
  process.env.LLM_PARSING_PROVIDER || 'openai',
  process.env.LLM_PARSING_MODEL || 'gpt-4o-mini',
);
export const generationProvider = buildProvider(
  process.env.LLM_GENERATION_PROVIDER || 'openai',
  process.env.LLM_GENERATION_MODEL || 'gpt-4o-mini',
);
export const rerankProvider = buildProvider(
  process.env.LLM_RERANK_PROVIDER || 'deepseek',
  process.env.LLM_RERANK_MODEL || 'deepseek-chat',
);

logger.info({
  embedding: process.env.EMBEDDING_PROVIDER,
  chatbot: process.env.LLM_CHATBOT_PROVIDER,
  parsing: process.env.LLM_PARSING_PROVIDER,
}, 'AI providers initialized');