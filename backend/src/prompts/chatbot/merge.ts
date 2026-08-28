/**
 * Merge nhiều HandlerSection vào 1 prompt cuối cho LLM bước 2.
 *
 * Structure của prompt cuối (LLM cuối = 1 streaming call duy nhất):
 *   [System prompt chính]           (CHATBOT_SYSTEM_PROMPT + per-type hints)
 *   [Lịch sử]                       (recentMessages)
 *   [Section A — label — cite=YES]  (handler output cho intent chính)
 *   [Section B — label — cite=NO]   (handler output cho intent phụ / general)
 *   ...
 *   [Câu hỏi hiện tại]
 *
 * Multi-intent có data + general: data section cite=YES, general section cite=NO.
 * Section cite=NO + content rỗng → bỏ qua (LLM tự trả l�i general trong phần cuối).
 *
 * Per-type hints: thay vì handler tự gắn hướng dẫn xử lý vào section content
 * (làm phình data dump), hints để riêng trong system prompt. Chỉ include
 * hint cho section THỰC SỰ xuất hiện — tránh context thừa.
 */
import { CHATBOT_SYSTEM_PROMPT } from './system';
import { buildTypeHintsBlock } from './perTypeHints';
import type { ChatMessage, ChatType, HandlerSection } from '../../lib/llm/chatbot/types';

export const buildMergedPrompt = (
  sections: HandlerSection[],
  history: ChatMessage[],
  question: string,
): string => {
  const historyBlock = history.length
    ? history
        .map((m) => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
        .join('\n')
    : '(chưa có)';

  const sectionsBlock = sections
    .filter((s) => s.content.trim().length > 0)
    .map((s) => `## Section ${s.label}${s.citeData ? ' (cite — bám sát data này)' : ' (tham khảo — trả lời tự do)'}\n${s.content}`)
    .join('\n\n');

  return `## Lịch sử 2–3 lượt gần nhất
${historyBlock}

${sectionsBlock || '## Section\n(Không có data cụ thể — trả lời tự do dựa trên lịch sử + câu hỏi.)'}

## Câu hỏi hiện tại
${question}
`.trim();
};

/**
 * Helper: trả system + user prompt đầy đủ cho LLM cuối.
 *
 * `types[]` là intent types đã được intent classifier chọn (không phải
 * post-dispatch sections). Cần thiết để gắn per-type hint đúng — một số
 * intent có thể bị dispatcher skip nhưng hint vẫn nên có (vd. general).
 */
export const buildFinalMessages = (
  sections: HandlerSection[],
  history: ChatMessage[],
  question: string,
  types: ChatType[],
): Array<{ role: 'system' | 'user'; content: string }> => {
  const hintsBlock = buildTypeHintsBlock(types);
  const systemContent = hintsBlock
    ? `${CHATBOT_SYSTEM_PROMPT}\n\n${hintsBlock}`
    : CHATBOT_SYSTEM_PROMPT;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: buildMergedPrompt(sections, history, question) },
  ];
};
