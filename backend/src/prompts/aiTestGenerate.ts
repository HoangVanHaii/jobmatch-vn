/**
 * Prompt template cho AI sinh đề test (IQ / English) — Phase 3.
 *
 * Output là JSON khớp schema `aiTestGenerateSchema` (lib/llm/aiTestGenerate.ts)
 * — backend validate + persist vào `ai_tests.questions`.
 *
 * Lưu ý khi sửa: prompt thay đổi → test lại golden output (đề đủ số câu,
 * đáp án thuộc options, tổng points khớp totalPoints).
 */

const TYPE_RULES: Record<string, string> = {
  iq: `Sinh câu hỏi kiểm tra TƯ DUY: suy luận số (dãy số), suy luận hình (mô tả bằng chữ), logic lời văn, tìm quy luật.
KHÔNG dùng hình ảnh — mọi câu hỏi phải tự chứa đủ dữ kiện dạng text.`,
  english: `Sinh câu hỏi kiểm tra TIẾNG ANH trình độ văn phòng: ngữ pháp (grammar), từ vựng (vocabulary), đọc hiểu (reading comprehension với đoạn văn ngắn).
Câu hỏi bằng tiếng Anh, giải thích đáp án bằng tiếng Anh.`,
};

export const AI_TEST_GENERATE_SYSTEM_PROMPT = `Bạn là chuyên gia ra đề tuyển dụng cho nền tảng JobMatch VN.

Nhiệm vụ: sinh một bài test trắc nghiệm hoàn chỉnh theo yêu cầu, trả về JSON đúng schema.

Nguyên tắc BẮT BUỘC:
1. Đúng số câu hỏi và đúng loại bài (testType) được yêu cầu.
2. Mỗi câu có ĐÚNG 1 đáp án đúng, nằm trong options.
3. "correctAnswer" phải TRÙNG KHÍT chữ với 1 phần tử trong "options" của câu đó.
4. "id" của câu hỏi là chuỗi duy nhất dạng "q1", "q2", ... theo thứ tự.
5. type của mỗi câu: "multiple_choice".
6. points: chia đều, tổng đúng bằng "totalPoints" yêu cầu.
7. Độ khó theo "level" (easy/medium/hard) — câu cuối cùng khó hơn đầu.
8. Trả CHỈ raw JSON, không markdown fence, không giải thích.

${Object.entries(TYPE_RULES)
  .map(([type, rule]) => `- Nếu testType = "${type}": ${rule}`)
  .join('\n')}

Output schema:
{
  "questions": [
    {
      "id": "q1",
      "type": "multiple_choice",
      "question": "nội dung câu hỏi",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correctAnswer": "B. ...",
      "points": 5
    }
  ],
  "totalPoints": 100,
  "durationMin": 30
}`;

export interface BuildAiTestGenerateInput {
  testType: 'iq' | 'english';
  level: string;
  questionCount: number;
  pointsPerQuestion: number;
  durationMin: number;
  jobTitle: string;
  jobRequirements?: string | null;
}

export const buildAiTestGenerateUserPrompt = (input: BuildAiTestGenerateInput): string => {
  const context = input.jobRequirements
    ? `\nBối cảnh vị trí tuyển dụng: "${input.jobTitle}". Yêu cầu công việc (để đề sát ngành):\n"""\n${input.jobRequirements.slice(0, 1500)}\n"""`
    : `\nVị trí tuyển dụng: "${input.jobTitle}" (không có mô tả thêm — ra đề general).`;

  return `Hãy sinh 1 bài test:
- testType: "${input.testType}"
- level: "${input.level}"
- Số câu hỏi: ${input.questionCount}
- points mỗi câu: ${input.pointsPerQuestion} (tổng ${input.questionCount * input.pointsPerQuestion})
- durationMin: ${input.durationMin}${context}

Trả JSON đúng schema.`;
};
