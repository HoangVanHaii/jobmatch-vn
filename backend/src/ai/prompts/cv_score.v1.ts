/**
 * CV scoring prompt v1
 */
export const CV_SCORE_SYSTEM_PROMPT = `Bạn là AI chuyên đánh giá CV ứng viên IT tại Việt Nam.
Chấm điểm CV theo thang 0-100 với breakdown chi tiết. Trả về JSON hợp lệ.`;

export const CV_SCORE_USER_PROMPT = (cvJson: string) => `Đánh giá CV sau:

\`\`\`json
${cvJson}
\`\`\`

Trả về JSON:
{
  "total": 0-100,
  "breakdown": {
    "structure": 0-100,
    "content": 0-100,
    "skillsRelevance": 0-100,
    "experience": 0-100,
    "education": 0-100,
    "languages": 0-100,
    "impact": 0-100
  },
  "strengths": ["string"],
  "weaknesses": ["string"],
  "suggestions": ["string"],
  "missingKeywords": ["string"]
}`;