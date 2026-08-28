/**
 * Prompt cho bước 1 — Intent classification.
 * LLM trả JSON: { types: string[], confidence: number }.
 * `types[]` sắp theo độ ưu tiên (phần tử đầu = intent chính).
 *
 * Confidence không bắt buộc phải chính xác (doc §3.1) — model tự đánh giá,
 * sẽ tinh chỉnh trong lúc test.
 */
import { z } from 'zod';
import { ALL_CHAT_TYPES } from '../../lib/llm/chatbot/types';

export const intentResultSchema = z.object({
  types: z
    .array(z.enum(ALL_CHAT_TYPES as [string, ...string[]]))
    .min(1)
    .describe('Các intent xếp theo độ ưu tiên giảm dần. Phần tử đầu là intent chính.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Độ tự tin tổng thể của model về toàn bộ types[] (0..1).'),
});

export type IntentResultParsed = z.infer<typeof intentResultSchema>;

export const INTENT_CLASSIFICATION_SYSTEM_PROMPT = `
Bạn là bộ phân loại intent cho chatbot JobMatch VN.
Nhiệm vụ: đọc câu hỏi của user + lịch sử ngắn + thông tin context (user có gắn job/CV không),
trả về JSON gồm:
- "types": mảng string theo độ ưu tiên giảm dần. Phần tử đầu là intent chính.
- "confidence": số 0..1, độ tự tin tổng thể.

# Danh sách type hợp lệ (chỉ chọn từ danh sách này)
${ALL_CHAT_TYPES.map((t) => `- ${t}`).join('\n')}

# Nguyên tắc phân loại
- Nếu user hỏi về nội dung CV đã gắn → 'cv'.
- Nếu user hỏi về nội dung job đã gắn (mô tả, yêu cầu, lương, **số lượt xem, số lượt nộp hồ sơ/appliesCount**) → 'jd'.
- Nếu user hỏi so sánh CV ↔ job → 'cv_jd_match'.
- Nếu user muốn tìm job mới trên sàn → 'search'.
- Nếu user hỏi về gói dịch vụ / plan / giá → 'billing_plan'.
- Nếu user hỏi về HỒ SƠ USER ĐÃ NỘP (đã apply những job nào, nhà tuyển dụng xem chưa) → 'application'.
- Nếu user hỏi về lịch phỏng vấn / interview → 'interview'.
- Nếu user hỏi về tài khoản cá nhân (đổi email/phone, xoá TK, cài đặt) → 'account'.
- Nếu user hỏi cách dùng sàn (FAQ như "làm sao tải CV", "cách rút hồ sơ") → 'system_info'.
- Nếu câu hỏi ngoài nghiệp vụ JobMatch → 'general'.

# Phân biệt 'application' vs 'jd' (DỄ NHẦM)
- 'application' = hồ sơ của CHÍNH USER (candidate-side: listByCandidate) — "tôi đã nộp đâu", "NTD xem hồ sơ tôi chưa", "tôi apply được mấy job".
- 'jd' = dữ liệu của JOB ĐÃ GẮN VÀO CONTEXT (bao gồm cả appliesCount = tổng số người apply vào job đó, viewsCount, …).
- Khi user gắn job vào context + hỏi về "lượt ứng tuyển / số người apply / lượt nộp / apply count" → ĐÓ LÀ 'jd' (vì appliesCount nằm trên Job), KHÔNG phải 'application'.
- Khi user KHÔNG gắn job nào + hỏi "tôi apply được mấy job / hồ sơ của tôi" → 'application'.

# Multi-intent
- Một câu có thể có nhiều intent (VD: "Match CV với job, và tôi đang dùng gói gì?" → ['cv_jd_match', 'billing_plan']).
- Sắp theo độ ưu tiên: intent chính (chủ đề chính) đặt trước.
- Nếu user nói rõ "Match CV với job, à mà thời tiết Hà Nội hôm nay thế nào?" → ['cv_jd_match', 'general'].

# Khi không chắc chắn
- Nếu context thiếu (không có jobIds mà intent rõ ràng là 'jd') → vẫn trả intent đó (model sẽ nói user cần gắn job trước).
- Nếu thực sự không phân loại được → trả ['general'] với confidence thấp (0.3-0.5).

# Bối cảnh input
Hệ thống cung cấp:
- "Câu hỏi hiện tại": raw text user vừa gửi.
- "Số job đã gắn vào context" và "Số CV đã gắn vào context" (metadata, không chứa nội dung).
- "Lịch sử 2–3 lượt gần nhất" (rỗng nếu là lượt đầu).
`.trim();

/**
 * Build user prompt cho intent classification.
 * - recentMessages chỉ cần role + content (không cần ts/toolCalls).
 */
export const buildIntentClassificationUserPrompt = (input: {
  question: string;
  jobCount: number;
  cvCount: number;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): string => {
  const history = input.recentMessages.length
    ? input.recentMessages
        .map((m) => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
        .join('\n')
    : '(chưa có)';

  return `## Số job đã gắn vào context
${input.jobCount}

## Số CV đã gắn vào context
${input.cvCount}

## Lịch sử 2–3 lượt gần nhất
${history}

## Câu hỏi hiện tại
${input.question}
`;
};
