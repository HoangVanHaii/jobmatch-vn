/**
 * AI Provider — single-model (Google Gemini 2.5-flash).
 * Mọi role (chatbot / parsing / generation) đều dùng chung 1 model.
 * Chỉ khác nhau ở temperature + maxOutputTokens trong từng call site.
 *
 *   - embedding: text-embedding-004 (768-dim, riêng biệt vì là embedding model)
 *   - chat/parsing/generation: gemini-2.5-flash
 */
import { GeminiProvider } from '../ai/providers/gemini';
import { logger } from './logger';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  // Không throw để app vẫn boot — Google Generative AI sẽ báo lỗi khi gọi.
  logger.warn('GEMINI_API_KEY missing — AI calls will fail until configured');
}

const gemini = (modelEnv: string, fallback: string): GeminiProvider =>
  new GeminiProvider(process.env[modelEnv] ?? fallback);

export const embeddingProvider = gemini('GEMINI_EMBEDDING_MODEL', 'text-embedding-004');
export const chatbotProvider   = gemini('GEMINI_CHAT_MODEL',        'gemini-2.5-flash');
export const parsingProvider   = gemini('GEMINI_CHAT_MODEL',        'gemini-2.5-flash');
export const generationProvider = gemini('GEMINI_CHAT_MODEL',       'gemini-2.5-flash');

logger.info(
  {
    embedding: embeddingProvider.model,
    chatbot:   chatbotProvider.model,
    parsing:   parsingProvider.model,
    generation: generationProvider.model,
  },
  'AI providers initialized (single model: Gemini)',
);
