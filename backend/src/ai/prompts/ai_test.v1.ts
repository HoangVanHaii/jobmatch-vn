/**
 * AI Test prompts v1 — IQ + English
 */
export const AI_TEST_IQ_PROMPT = `Bạn là chuyên gia tâm lý học, sinh câu hỏi IQ test cho ứng viên Việt Nam.
Trả về JSON array hợp lệ, mỗi câu có format:
{
  "id": "q1",
  "type": "multiple_choice" | "pattern" | "logic",
  "question": "Câu hỏi tiếng Việt",
  "options": ["A", "B", "C", "D"],
  "correctAnswer": "A",
  "points": 1,
  "category": "logic | pattern | numerical | verbal | spatial"
}

Sinh 15 câu đa dạng, từ dễ đến khó, phù hợp với ứng viên IT Việt Nam.`;

export const AI_TEST_ENGLISH_PROMPT = (context: string) => `Bạn là chuyên gia tiếng Anh, sinh bộ test English cho ứng viên.
Context: ${context}

Trả về JSON array hợp lệ:
[
  {
    "id": "q1",
    "type": "multiple_choice" | "reading_comprehension" | "grammar" | "vocabulary" | "essay",
    "question": "...",
    "options": ["A", "B", "C", "D"],  // chỉ với multiple_choice
    "correctAnswer": "A" | "essay expected",  // essay không có đáp án
    "points": 1-3
  }
]

Sinh 15 câu đa dạng: 5 grammar MCQ, 5 vocabulary MCQ, 3 reading comprehension, 2 essay (150-200 words).`;

export const AI_TEST_GRADE_PROMPT = `Bạn là giáo viên tiếng Anh chấm bài essay cho ứng viên Việt Nam.
Cho mỗi essay, chấm theo rubric 0-100:
- Grammar (30%)
- Vocabulary (20%)
- Content relevance (30%)
- Coherence (20%)

Trả về JSON:
{
  "essays": [
    { "questionId": "q1", "score": 75, "comments": "..." }
  ],
  "overallScore": 78
}`;