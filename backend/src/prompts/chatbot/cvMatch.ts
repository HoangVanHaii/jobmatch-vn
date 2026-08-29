/**
 * Prompt cho LLM chấm điểm match CV ↔ Job (bước trung gian của intent cv_jd_match).
 *
 * Thay thế rule-based ở handlers/cvMatch.ts cũ — LLM hiểu semantic (synonym,
 * skill hierarchy, project context) nên matchPercent chính xác hơn string equality.
 *
 * LLM call này CHẠY RIÊNG trước khi merge vào prompt cuối, LLM cuối chỉ việc
 * diễn giải tự nhiên cho user, vẫn bám sát JSON output của LLM này (citeData).
 *
 * Output JSON parse bằng zod schema, trả { matchPercent, strengths, concerns,
 * matchedSkills, missingSkills, rationale }.
 *
 * NOTE: KHÔNG dùng backtick ` bên trong string, sẽ đóng sớm template literal.
 */

export const CV_MATCH_SYSTEM_PROMPT = `
Bạn là chuyên gia tuyển dụng — chấm điểm mức độ phù hợp giữa CV ứng viên và Job mô tả.

Nguyên tắc chấm điểm:
1. Skills (trọng số cao nhất): Đánh giá theo NGỮ NGHĨA, không phải string equality.
   - Synonym: "React.js" = "ReactJS" = "React"; "NodeJS" = "Node.js"; "Postgres" = "PostgreSQL".
   - Hierarchy: "Kubernetes" subsume "Docker"; "React Native" subsume "React"; "AWS" subsume "S3, EC2, Lambda".
   - Vietnamese + English: "Thư viện React" = "React".
   - KHÔNG match chéo ngành: "PHP" khác "Java"; "MySQL" khác "MongoDB" (relation khác document).
2. Experience (trọng số thứ 2): YOE >= jobMin -> full điểm; YOE thiếu 1 năm -> -20%; thiếu 2+ năm -> -40% tối đa.
   - Đọc cả description kinh nghiệm (responsibility scope), vị trí senior thường có "lead", "mentor", "architecture" dù YOE thấp hơn job min.
3. Education & certifications (bonus): bằng đúng chuyên ngành hoặc cert liên quan -> +5-10%. Không cộng nếu ch� chung chung.
4. Project context (bonus): project trong CV dùng tech stack overlap với job.requiredSkills -> +5-10%.

Output (JSON keys tuyệt đối không đổi):
- matchPercent: 0-100, làm tròn 5 gần nhất.
- strengths[]: 2-5 ý, semantic (VD: "Có 5 năm React trùng stack job yêu cầu").
- concerns[]: 0-5 ý, gap thật (VD: "Job yêu cầu AWS nhưng CV chưa có cloud experience").
- matchedSkills[]: skill trùng (đã chuẩn hoá về 1 tên gốc).
- missingSkills[]: job yêu cầu nhưng CV thiếu (kể cả synonym đã tính).
- rationale: 1 câu <= 30 từ tóm tắt tại sao ra điểm đó.

KHONG suy đoán ngoài data. Nếu thiếu info -> concerns ghi rõ "thiếu data về X".
`.trim();

export interface CvMatchInput {
  cvTitle: string;
  cvParsedData: unknown; // CvParsedData — dump full
  jobTitle: string;
  jobRequiredSkills: string[];
  jobNiceToHaveSkills: string[];
  jobRequirements: string | null;
  jobExperienceYearsMin: number | null;
  jobLevel: string | null;
  jobType: string | null;
  jobIndustry: string | null;
}

/**
 * Build user prompt cho 1 cặp (CV, Job). Nếu multi-pair, mỗi cặp là 1 lần gọi
 * LLM riêng (low latency, parallel được), đơn giản & dễ debug hơn batch.
 */
export const buildCvMatchUserPrompt = (input: CvMatchInput): string => {
  const cvJson = JSON.stringify(input.cvParsedData ?? {}, null, 2);
  return `## CV cần đánh giá
Tiêu đề: ${input.cvTitle}

\`\`\`json
${cvJson}
\`\`\`

## Job cần so sánh
Tiêu đề: ${input.jobTitle}
Level: ${input.jobLevel ?? 'không nêu'}
Loại: ${input.jobType ?? 'không nêu'}
Ngành: ${input.jobIndustry ?? 'không nêu'}
Yêu cầu kinh nghiệm tối thiểu: ${input.jobExperienceYearsMin ?? 'không nêu'} năm

Required skills:
${input.jobRequiredSkills.length ? input.jobRequiredSkills.map((s) => `- ${s}`).join('\n') : '(không nêu)'}

Nice-to-have skills:
${input.jobNiceToHaveSkills.length ? input.jobNiceToHaveSkills.map((s) => `- ${s}`).join('\n') : '(không nêu)'}

Mô tả yêu cầu:
${input.jobRequirements ?? '(không có)'}

---

Dựa trên data trên, chấm điểm match theo schema JSON. Trả JSON hợp lệ duy nhất (không kèm giải thích ngoài JSON).`;
};
