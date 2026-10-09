/**
 * aiTestGenerate — LLM layer sinh đề test (IQ/English) cho Phase 3.
 *
 * Pattern giống cvMatch.ts: zod schema validate output → invokeJson với
 * Gemini (temperature thấp để đề ổn định). Worker `aiTestGenerate.worker`
 * gọi hàm này, kết quả persist vào `ai_tests`.
 */
import { z } from 'zod';
import { createGemini } from './client';
import { invokeJson } from './jsonParser';
import type { InvokeJsonUsage } from './jsonParser';

export const aiTestQuestionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string()).min(2).optional(),
  correctAnswer: z.string().min(1).optional(),
  points: z.number().min(0),
});

export const aiTestGenerateSchema = z.object({
  questions: z.array(aiTestQuestionSchema).min(1).max(50),
  totalPoints: z.number().min(1),
  durationMin: z.number().min(5).max(180),
});

export type AiTestQuestion = z.infer<typeof aiTestQuestionSchema>;
export interface AiTestGenerateResult {
  questions: AiTestQuestion[];
  totalPoints: number;
  durationMin: number;
}

const generateLlm = createGemini({
  temperature: 0.4, // thấp — đề ổn định, không quá sáng tạo
  maxOutputTokens: 8192,
});

export interface AiTestGenerateData {
  data: AiTestGenerateResult;
  usage: InvokeJsonUsage;
}

export const invokeAiTestGenerate = async (
  systemPrompt: string,
  userPrompt: string,
): Promise<AiTestGenerateData> => {
  const { data, usage } = await invokeJson({
    llm: generateLlm,
    schema: aiTestGenerateSchema,
    systemPrompt,
    userPrompt,
    tag: 'aiTestGenerate',
  });
  return { data, usage } as AiTestGenerateData;
};
