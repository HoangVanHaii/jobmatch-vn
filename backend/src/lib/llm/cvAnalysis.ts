import { z } from "zod";
import { createGemini } from "./client";
import { invokeJson } from "./jsonParser";
import { InvokeJsonUsage } from "./jsonParser";

const verificationWarningSchema = z.object({
  type: z.enum(["github", "linkedin"]),
  url: z.string(),
  message: z.string(),
});

export const cvAnalysisSchema = z.object({
  isCv: z.boolean(),
  total: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  suggestions: z.array(z.string()),
  verificationWarnings: z.array(verificationWarningSchema).default([]),
});

export type AiAnalysis = z.infer<typeof cvAnalysisSchema>;
const analysisLlm = createGemini({
  temperature: 0.3,
  maxOutputTokens: 2048,
});
export interface AiAnalysisData {
  data: AiAnalysis;
  usage: InvokeJsonUsage;
}

export const invokeCvAnalysis = async (
  systemPrompt: string,
  userPrompt: string,
): Promise<AiAnalysisData> => {
  const {data, usage} = await invokeJson({
    llm: analysisLlm,
    schema: cvAnalysisSchema,
    systemPrompt,
    userPrompt,
    tag: "cvAnalysis",
  });
    return { data, usage } as AiAnalysisData;
};
