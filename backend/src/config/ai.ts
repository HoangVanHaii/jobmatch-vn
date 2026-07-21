/**
 * AI Provider — single-model (Google Gemini).
 * Project đã chuyển từ multi-provider về 1 model duy nhất (sản phẩm nghiên cứu).
 *
 * Mỗi role giữ API chung của LLMProvider nhưng dùng Gemini model phù hợp:
 *   - embedding: text-embedding-004 (768-dim)
 *   - chatbot  : gemini-1.5-flash (nhanh, rẻ, 1M context)
 *   - parsing  : gemini-1.5-flash (CV parse cần JSON nhanh, rẻ)
 *   - generation: gemini-1.5-pro   (chấm điểm / cover letter / JD gen — cần lý luận chuẩn)
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
export const chatbotProvider   = gemini('GEMINI_CHAT_MODEL',        'gemini-1.5-flash');
export const parsingProvider   = gemini('GEMINI_CHAT_MODEL',        'gemini-1.5-flash');
export const generationProvider = gemini('GEMINI_PRO_MODEL',        'gemini-1.5-pro');

logger.info(
  {
    embedding: embeddingProvider.model,
    chatbot:   chatbotProvider.model,
    parsing:   parsingProvider.model,
    generation: generationProvider.model,
  },
  'AI providers initialized (single model: Gemini)',
);
