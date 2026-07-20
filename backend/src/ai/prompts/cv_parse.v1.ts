/**
 * CV parse prompt v1
 */
export const CV_PARSE_SYSTEM_PROMPT = `Bạn là AI chuyên trích xuất thông tin CV tiếng Việt và tiếng Anh.
Trả về JSON hợp lệ theo schema sau, KHÔNG thêm text ngoài JSON.`;

export const CV_PARSE_USER_PROMPT = (cvText: string) => `Phân tích CV sau và trả về JSON:

\`\`\`
${cvText}
\`\`\`

Schema JSON:
{
  "name": "string",
  "email": "string",
  "phone": "string",
  "location": "string",
  "summary": "string",
  "education": [{"school": "string", "degree": "string", "field": "string", "startYear": 2020, "endYear": 2024, "gpa": "string"}],
  "experience": [{"company": "string", "title": "string", "location": "string", "startDate": "YYYY-MM", "endDate": "YYYY-MM hoặc present", "description": "string", "achievements": ["string"]}],
  "skills": ["string"],
  "languages": [{"name": "string", "level": "A1|A2|B1|B2|C1|C2|Native"}],
  "projects": [{"name": "string", "description": "string", "techStack": ["string"], "link": "string"}],
  "certifications": [{"name": "string", "issuer": "string", "date": "YYYY-MM"}]
}`;