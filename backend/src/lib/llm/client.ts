import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { env } from '../../config/env';

const baseConfig = {
  model: env.GEMINI_CHAT_MODEL,
  apiKey: env.GEMINI_API_KEY,
};

export const createGemini = (
  overrides: Partial<ConstructorParameters<typeof ChatGoogleGenerativeAI>[0]> = {},
) => {
  return new ChatGoogleGenerativeAI({ ...baseConfig, ...overrides });
}
