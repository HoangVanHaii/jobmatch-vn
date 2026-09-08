import { z } from 'zod';
import { createGemini } from './client';
import { invokeJson } from './jsonParser';
import type { InvokeJsonUsage } from './jsonParser';

const cvMatchSchema = z.object({
  matchPercent: z.number().min(0).max(100),
  strengths: z.array(z.string()).min(2).max(5),
  concerns: z.array(z.string()).max(5).default([]),
  matchedSkills: z.array(z.string()).default([]),
  missingSkills: z.array(z.string()).default([]),
  rationale: z.string().max(300),  // ~ 30 từ tiếng Việt ~ 100-150 ký tự, cho buffer 300
});

export interface CvMatchResult {
  matchPercent: number;
  strengths: string[];
  concerns: string[];
  matchedSkills: string[];
  missingSkills: string[];
  rationale: string;
}

const matchLlm = createGemini({
  temperature: 0.2,
  maxOutputTokens: 8192,
});

export interface CvMatchData {
  data: CvMatchResult;
  usage: InvokeJsonUsage;
}

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
