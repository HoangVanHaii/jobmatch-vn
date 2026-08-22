import { z } from 'zod';
import { createGemini } from './client';
import { invokeJson } from './jsonParser';

export const moderationFlagSchema = z.object({
  severity: z.enum(['block', 'warn']),
  category: z.string(),
  field: z.enum(['title', 'description', 'requirements']),
  quote: z.string(),
  reasoning: z.string(),
  suggestion: z.string().optional(),
  lawRef: z.string().optional(),
});

export const moderationOutputSchema = z.object({
  verdict: z.enum(['approved', 'flagged']),
  score: z.number().min(0).max(1),
  flags: z.array(moderationFlagSchema).optional().default([]),
});

export type ModerationFlag = z.infer<typeof moderationFlagSchema>;
export type ModerationOutput = z.infer<typeof moderationOutputSchema>;

const moderationLlm = createGemini({
  temperature: 0.1,
  maxOutputTokens: 4096,
});

export const invokeJobModeration = async (systemPrompt: string, userPrompt: string): Promise<ModerationOutput> => {
  const result = await invokeJson({
    llm: moderationLlm,
    schema: moderationOutputSchema,
    systemPrompt,
    userPrompt,
    tag: 'jobModeration',
  });
  // flags optional trong schema → đảm bảo luôn là array khi trả về
  return { ...result, flags: result.flags ?? [] };
}
