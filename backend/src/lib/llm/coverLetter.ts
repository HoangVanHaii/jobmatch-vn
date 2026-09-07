import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createGemini } from './client';
import { logger } from '../../config/logger';
import {
  COVER_LETTER_SYSTEM_PROMPT,
  buildCoverLetterUserPrompt,
  type CoverLetterLanguage,
} from '../../prompts/coverLetter';

export interface GenerateCoverLetterInput {
  cv: Record<string, unknown> | null;
  job: {
    title: string;
    companyName: string | null;
    industry: string | null;
    description: string | null;
    requirements: string | null;
    jobLevel: string | null;
    requiredSkills: string[];
    niceToHaveSkills: string[];
    experienceYearsMin: number | null;
  };
  /**
   * Ngôn ngữ output: 'vi' (Vietnamese — mặc định) hoặc 'en' (English).
   * Quyết định greeting mở đầu, chữ ký kết thúc, hard limit, tone.
   */
  language?: CoverLetterLanguage;
}

export interface GenerateCoverLetterResult {
  /** Cover letter text thuần (đã strip markdown fence + reasoning leak). */
  content: string;
  usage: {
    input: number;
    output: number;
  };
}

/**
 * Strip mọi "reasoning leak" Gemini 2.5+ có thể nhè ra ngoài cover letter:
 *   - Markdown code fence ```...```
 *   - <thinking>...</thinking>, <analysis>...</analysis>, <reasoning>...</reasoning>
 *   - Block "THOUGHTS:" / "Mental Sandbox:" / "Constraint Checklist & Confidence Score:"
 *     / "Let's combine..." — Gemini đôi khi trả reasoning thô trước output.
 *   - Mọi dòng có format "Key: value" kiểu rubric nằm TRƯỚC dòng bắt đầu thư.
 *
 * Cách làm: cắt TỪ đầu đến vị trí có dấu hiệu bắt đầu thư (Kính gửi / Kính thưa /
 * lời chào). Nếu không match → fallback strip từng block.
 */
const stripReasoningLeak = (raw: string): string => {
  let s = raw;

  // 1. Strip markdown fence bao quanh toàn bộ output.
  s = s.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // 2. Strip XML-like thinking tags (lồng nhau 1 cấp — Gemini hiếm khi nest sâu).
  s = s.replace(/<(thinking|analysis|reasoning|reflection)>[\s\S]*?<\/\1>/gi, '');
  // 3. Strip self-closing / unclosed ở cuối.
  s = s.replace(/<(thinking|analysis|reasoning|reflection)>[\s\S]*$/gi, '');

  // 4. Strip block "THOUGHTS:"... (Gemini 2.5 đôi khi dump reasoning dạng này).
  //    Các nhãn reasoning phổ biến:
  const reasoningLabels = [
    'THOUGHTS:',
    'THOUGHT:',
    'Mental Sandbox:',
    'Mental sandbox:',
    'Constraint Checklist',
    'Confidence Score:',
    "Let's combine",
    'Let\'s combine',
    'Revised',
    'Drafting Body',
    'Drafting body',
    'Conclusion:',
    'Initial thought',
  ];
  for (const label of reasoningLabels) {
    const idx = s.indexOf(label);
    if (idx > 0 && idx < 500) {
      // Reasoning block thường nằm ở ĐẦU output → cắt về sau nó.
      // Nhưng nếu label lặp lại trong thư → chỉ cắt block ĐẦU TIÊN.
      s = s.slice(idx + label.length);
      break;
    }
  }

  // 5. Tìm dấu hiệu bắt đầu thư. Nếu tìm thấy trong ~800 ký tự đầu → cắt phía trước.
  const letterStartPatterns: RegExp[] = [
    /\n\s*Kính gửi\b/i,
    /\n\s*Kính thưa\b/i,
    /\n\s*Kính,\s/i,
    /\n\s*Xin chào\b/i,
    /\n\s*Dear\b/i,
    /\n\s*To (?:Whom It May Concern|the Hiring|the Recruiter)\b/i,
  ];
  for (const re of letterStartPatterns) {
    const m = s.match(re);
    if (m && m.index !== undefined && m.index < 1000) {
      // Bỏ 1 dòng trống phía trước dòng "Kính gửi...".
      s = s.slice(m.index).replace(/^\s+/, '');
      break;
    }
  }

  return s.trim();
};

/**
 * Sinh cover letter sync (1 round-trip tới Gemini).
 *
 * Dùng temperature 0.7 (sáng tạo vừa) và maxOutputTokens 1024 — cover letter
 * chỉ ~250 từ, headroom cho retry nếu model dài dòng.
 *
 * Output là RAW TEXT (không qua jsonParser) vì prompt yêu cầu plain text,
 * có 2 lớp fallback strip:
 *   1. thinkingBudget: 0 (disable Gemini 2.5 internal reasoning chain).
 *   2. stripReasoningLeak() — regex catch-all phòng model vẫn lỡ leak.
 */
const coverLetterLlm = createGemini({
  temperature: 0.7,
  maxOutputTokens: 1024,
  /**
   * Disable Gemini 2.5 internal "thinking" feature — model có thể in ra cả
   * chain-of-thought vào `content` thay vì tách vào `thinking` field riêng,
   * gây leak "THOUGHTS: ..." ra FE. Setting thinkingBudget = 0 tắt hẳn.
   *
   * LangChain map `thinkingConfig.thinkingBudget` → Gemini `generationConfig`.
   */
  thinkingConfig: { thinkingBudget: 0 },
});

export const generateCoverLetter = async (
  input: GenerateCoverLetterInput,
  signal?: AbortSignal,
): Promise<GenerateCoverLetterResult> => {
  const messages = [
    new SystemMessage(COVER_LETTER_SYSTEM_PROMPT),
    new HumanMessage(buildCoverLetterUserPrompt(input)),
  ];

  const raw = await coverLetterLlm.invoke(messages, { signal });

  const rawText = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content);
  const content = stripReasoningLeak(rawText);

  const meta = (raw as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number; promptTokens?: number; completionTokens?: number } }).usage_metadata;
  const usage = {
    input: meta?.input_tokens ?? meta?.promptTokens ?? 0,
    output: meta?.output_tokens ?? meta?.completionTokens ?? 0,
  };

  logger.info(
    {
      usage,
      contentLen: content.length,
      rawLen: rawText.length,
      stripped: rawText.length !== content.length,
    },
    '[coverLetter] generated',
  );

  return { content, usage };
};
