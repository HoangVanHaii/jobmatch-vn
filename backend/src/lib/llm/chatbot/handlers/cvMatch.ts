/**
 * Handler cho intent `cv_jd_match` — LLM chấm điểm semantic CV ↔ Job.
 *
 * Flow:
 *   1. Nếu ctx thiếu jobIds/cvIds/jobs/cvs → section giải thích.
 *   2. Với MỖI cặp (cv, job): gọi LLM riêng. Structured output (zod) →
 *      JSON `{ matchPercent, strengths, concerns, matchedSkills,
 *      missingSkills, rationale }`. Service tự gắn jobId/cvId sau khi parse.
 *   3. JSON dump các cặp → section content. Final merge LLM sẽ diễn giải
 *      tự nhiên cho user, cite từ JSON này.
 *   4. Ghi `usageSink.usage` (cộng dồn input/output từ tất cả LLM calls).
 *
 * Nếu LLM throw / parse fail → rethrow, dispatcher catch trả section lỗi.
 */
import { z } from 'zod';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { createGemini } from '../../client';
import { logger } from '../../../../config/logger';
import {
  CV_MATCH_SYSTEM_PROMPT,
  buildCvMatchUserPrompt,
} from '../../../../prompts/chatbot/cvMatch';
import type { HandlerContext, HandlerSection } from '../types';

/** Schema cho LLM output 1 cặp. LLM ch� generate 6 fields này; jobId/cvId
 *  do service tự gắn sau khi parse. */
const llmPairSchema = z.object({
  matchPercent: z.number().min(0).max(100),
  strengths: z.array(z.string()).max(8),
  concerns: z.array(z.string()).max(8),
  matchedSkills: z.array(z.string()).max(20),
  missingSkills: z.array(z.string()).max(20),
  rationale: z.string().max(200),
});

/** Shape đầy đủ 1 cặp sau khi service gắn jobId/cvId. */
type ScoredPair = {
  jobId: string;
  cvId: string;
  matchPercent: number;
  strengths: string[];
  concerns: string[];
  matchedSkills: string[];
  missingSkills: string[];
  rationale: string;
};

// === LLM scoring cho 1 cặp ===

/**
 * Robust JSON extractor — LangChain `JsonMarkdownStructuredOutputParser` từng
 * throw "Unexpected token '`'" trên output markdown-fenced bị cắt giữa chừng.
 * Manual regex + JSON.parse thân thiện với mọi edge case (fence có/không,
 * whitespace lạ, content bị cắt). Nếu vẫn fail → throw.
 */
const extractAndParseJson = <T>(
  raw: string,
  schema: z.ZodSchema<T>,
): T => {
  // Strip markdown fence: ```json ... ``` hoặc ``` ...
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenceMatch ? fenceMatch[1]!.trim() : raw.trim();
  // Tìm object JSON đầu tiên { ... } (phòng LLM wrap text bên ngoài)
  const objStart = jsonText.indexOf('{');
  const objEnd = jsonText.lastIndexOf('}');
  if (objStart === -1 || objEnd === -1 || objEnd <= objStart) {
    throw new Error(`No JSON object found in: ${raw.slice(0, 200)}`);
  }
  const candidate = jsonText.slice(objStart, objEnd + 1);
  const parsed = JSON.parse(candidate);
  return schema.parse(parsed);
};

const scoreOnePair = async (
  cv: HandlerContext['cvs'][number],
  job: HandlerContext['jobs'][number],
  signal: AbortSignal,
  traceId: string,
): Promise<{ pair: ScoredPair; usage: { input: number; output: number } }> => {
  const llm = createGemini({
    model: 'gemini-2.5-flash',
    temperature: 0.1, // deterministic cho scoring
    maxOutputTokens: 4096, // bump 2048 → 4096, output JSON đủ 6 fields
    /**
     * Tắt thinking mode cho cvMatch — JSON structured output không cần reasoning
     * chain, mà thinking tokens chiếm phần lớn maxOutput budget gây cắt output
     * giữa ch�ng (MAX_TOKENS finishReason dù output mới ~80 tokens).
     */
    thinkingConfig: { thinkingBudget: 0 },
  });

  // Không dùng JsonMarkdownStructuredOutputParser — gặp edge case với
  // markdown fence bị cắt giữa chừng. Thay bằng manual extract.
  const messages = [
    new SystemMessage(CV_MATCH_SYSTEM_PROMPT),
    new HumanMessage(
      buildCvMatchUserPrompt({
        cvTitle: cv.title ?? '(không đặt)',
        cvParsedData: cv.parsedData ?? {},
        jobTitle: job.title,
        jobRequiredSkills: job.requiredSkills ?? [],
        jobNiceToHaveSkills: job.niceToHaveSkills ?? [],
        jobRequirements: job.requirements ?? null,
        jobExperienceYearsMin: job.experienceYearsMin ?? null,
        jobLevel: job.jobLevel ?? null,
        jobType: job.jobType ?? null,
        jobIndustry: job.industry ?? null,
      }),
    ),
  ];

  const raw = await llm.invoke(messages, { signal });
  const meta = (raw as any).usage_metadata ?? (raw as any).response_metadata?.tokenUsage;
  const usage = {
    input: meta?.input_tokens ?? meta?.promptTokens ?? 0,
    output: meta?.output_tokens ?? meta?.completionTokens ?? 0,
  };

  const content = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content);
  const parsed = extractAndParseJson(content, llmPairSchema);

  logger.info(
    {
      traceId,
      cvId: cv.id,
      jobId: job.id,
      matchPercent: parsed.matchPercent,
      usageIn: usage.input,
      usageOut: usage.output,
    },
    '[chatbot] cv_jd_match scored',
  );

  return {
    pair: {
      jobId: job.id,
      cvId: cv.id,
      matchPercent: parsed.matchPercent,
      strengths: parsed.strengths,
      concerns: parsed.concerns,
      matchedSkills: parsed.matchedSkills,
      missingSkills: parsed.missingSkills,
      rationale: parsed.rationale,
    },
    usage,
  };
};

// === Main handler ===

export const cvMatchHandler = async (ctx: HandlerContext): Promise<HandlerSection> => {
  if (ctx.jobIds.length === 0 || ctx.cvIds.length === 0) {
    return {
      label: 'cv_jd_match',
      citeData: true,
      content:
        'Để so sánh CV với job, user cần gắn ít nhất 1 job và 1 CV vào context. Hướng d�n họ dùng 2 picker phía trên khung chat.',
    };
  }
  if (ctx.jobs.length === 0 || ctx.cvs.length === 0) {
    return {
      label: 'cv_jd_match',
      citeData: true,
      content: 'Job hoặc CV trong context không tìm thấy (có thể đã xoá/closed). Không thể tính match.',
    };
  }

  const pairs: ScoredPair[] = [];
  let totalUsage = { input: 0, output: 0 };

  // Chạy tuần tự để dễ debug + tránh rate-limit Gemini (parallel có thể trigger 429).
  // User cap 3 job × 3 CV = 9 cặp max, thực tế 1-3 cặp — latency chấp nhận được.
  for (const job of ctx.jobs) {
    for (const cv of ctx.cvs) {
      const { pair, usage } = await scoreOnePair(cv, job, ctx.signal, ctx.traceId);
      pairs.push(pair);
      totalUsage.input += usage.input;
      totalUsage.output += usage.output;
    }
  }

  // Ghi usage vào sink để service cộng vào token budget.
  if (ctx.usageSink && totalUsage.input + totalUsage.output > 0) {
    ctx.usageSink.usage = {
      input: (ctx.usageSink.usage?.input ?? 0) + totalUsage.input,
      output: (ctx.usageSink.usage?.output ?? 0) + totalUsage.output,
    };
  }

  const blocks = pairs.map((r, i) => {
    const lines: string[] = [];
    lines.push(`Cặp #${i + 1}:`);
    lines.push(`- matchPercent: ${r.matchPercent}`);
    lines.push(`- rationale: ${r.rationale}`);
    if (r.strengths.length) {
      lines.push(`- strengths:`);
      r.strengths.forEach((s) => lines.push(`    - ${s}`));
    }
    if (r.concerns.length) {
      lines.push(`- concerns:`);
      r.concerns.forEach((c) => lines.push(`    - ${c}`));
    }
    if (r.matchedSkills.length) {
      lines.push(`- matchedSkills: ${r.matchedSkills.join(', ')}`);
    }
    if (r.missingSkills.length) {
      lines.push(`- missingSkills: ${r.missingSkills.join(', ')}`);
    }
    return lines.join('\n');
  });

  return {
    label: 'cv_jd_match',
    citeData: true,
    content: `Kết quả so khớp CV ↔ Job (LLM semantic scoring; LLM cuối sẽ diễn giải tự nhiên):\n\n${blocks.join('\n\n')}`,
  };
};
