import { z } from 'zod';
import { createGemini } from './client';
import { invokeJson } from './jsonParser';
import { InvokeJsonUsage } from './jsonParser';

export const jdDraftSchema = z.object({
  title: z.string().min(10).max(200),
  description: z.string().min(50).max(4000),
  requirements: z.string().min(20).max(2000),
  suggestedSkills: z.array(z.string()).min(1).max(15),
  suggestedJobLevel: z.enum(['intern', 'fresher', 'junior', 'mid', 'senior', 'lead', 'manager']).optional(),
  suggestedJobType: z.enum(['full-time', 'part-time', 'contract', 'internship', 'freelance']).default('full-time'),
  suggestedLocation: z.string().optional(),
  suggestedSalaryMin: z.number().int().nonnegative().optional(),
  suggestedSalaryMax: z.number().int().nonnegative().optional(),
  suggestedSalaryCurrency: z.string().length(3).default('VND'),
  reasoningNotes: z.string().optional(), // gợi ý cho HR biết tại sao AI chọn các options này
});

export type JdDraft = z.infer<typeof jdDraftSchema>;

const generationLlm = createGemini({
  temperature: 0.7,
  maxOutputTokens: 4096,
});
export interface JdDraftData {
  data: JdDraft;
  usage: InvokeJsonUsage;
}

export const invokeJobGeneration = async (
  systemPrompt: string,
  userPrompt: string,
): Promise<JdDraftData> => {
  const { data, usage } = await invokeJson({
    llm: generationLlm,
    schema: jdDraftSchema,
    systemPrompt,
    userPrompt,
    tag: "jobGeneration",
  });
    return { data, usage} as JdDraftData;
};