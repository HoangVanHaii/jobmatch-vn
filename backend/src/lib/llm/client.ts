import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { env } from '../../config/env';

const baseConfig = {
  model: env.GEMINI_CHAT_MODEL,
  apiKey: env.GEMINI_API_KEY,
  /**
   * Bắt buộc để Gemini streaming trả `usage_metadata` (input/output tokens)
   * trên chunks. Nếu thiếu → token budget DB sẽ chỉ ghi intent-approx (~40)
   * trong khi LangSmith thấy ~4500, gây budget_exceeded sai.
   *
   * An toàn cho cả non-streaming `invoke()` (jsonParser) — không thay đổi hành vi.
   */
  streamUsage: true,
};

export const createGemini = (
  overrides: Partial<ConstructorParameters<typeof ChatGoogleGenerativeAI>[0]> = {},
) => {
  return new ChatGoogleGenerativeAI({ ...baseConfig, ...overrides });
}
