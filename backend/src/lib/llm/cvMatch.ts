/**
 * cvMatch LLM module — gọi Gemini chấm điểm match CV ↔ Job.
 *
 * Flow:
 *   1. Nhận system prompt (CV_MATCH_SYSTEM_PROMPT) + user prompt (buildCvMatchUserPrompt).
 *   2. invokeJson() ép model trả JSON theo schema, retry nếu parse lỗi.
 *   3. Trả { data, usage } — `data` match percent + reasoning, `usage` để log token cost.
 *
 * Output schema khớp với `prompts/chatbot/cv_match.ts`. Khi lưu DB:
 *   - matchPercent → applications.aiMatchScore (numeric, indexable)
 *   - 5 field còn lại → applications.aiMatchReasoning (jsonb)
 *
 * Tách riêng khỏi service/worker để:
 *   - Dễ test (mock LLM), dễ swap provider (Gemini ↔ Claude).
 *   - Token usage tracking ở 1 chỗ, tránh duplicate logic.
 */
import { z } from 'zod';
import { createGemini } from './client';
import { invokeJson } from './jsonParser';
import type { InvokeJsonUsage } from './jsonParser';

/**
 * Schema match với output của prompt `cv_match.ts`. KHÔNG bao gồm `matchPercent`
 * ở đây vì matchPercent được tách riêng thành `aiMatchScore` (numeric) khi save DB.
 */
const cvMatchSchema = z.object({
  matchPercent: z.number().min(0).max(100),
  strengths: z.array(z.string()).min(2).max(5),
  concerns: z.array(z.string()).max(5).default([]),
  matchedSkills: z.array(z.string()).default([]),
  missingSkills: z.array(z.string()).default([]),
  rationale: z.string().max(300),  // ~ 30 từ tiếng Việt ~ 100-150 ký tự, cho buffer 300
});

/**
 * Output type — define tường minh (không dùng z.infer) vì Zod `.default()` đôi khi
 * làm TS inference thấy optional, dẫn đến lỗi khi pass vào ApplicationMatchReasoning
 * (required). Ép non-optional ở đây để khớp với field type.
 */
export interface CvMatchResult {
  matchPercent: number;
  strengths: string[];
  concerns: string[];
  matchedSkills: string[];
  missingSkills: string[];
  rationale: string;
}

/**
 * LLM instance riêng cho cvMatch. temperature thấp (0.2) vì cần kết quả ổn định
 * giữa các lần chạy (cùng CV + job → cùng điểm). maxOutputTokens vừa đủ cho
 * reasoning ngắn (200-400 tokens output).
 */
const matchLlm = createGemini({
  temperature: 0.2,
  maxOutputTokens: 32120,
});

export interface CvMatchData {
  data: CvMatchResult;
  usage: InvokeJsonUsage;
}

/**
 * Gọi Gemini chấm điểm CV ↔ Job.
 *
 * @param systemPrompt - thường là `CV_MATCH_SYSTEM_PROMPT` từ prompts/chatbot/cv_match.ts
 * @param userPrompt   - buildCvMatchUserPrompt(input) từ cùng file
 * @returns { data: { matchPercent, strengths, concerns, matchedSkills, missingSkills, rationale }, usage }
 */
export const invokeCvMatch = async (
  systemPrompt: string,
  userPrompt: string,
): Promise<CvMatchData> => {
  const { data, usage } = await invokeJson({
    llm: matchLlm,
    schema: cvMatchSchema,
    systemPrompt,
    userPrompt,
    tag: 'cvMatch',
  });
  return { data, usage } as CvMatchData;
};
